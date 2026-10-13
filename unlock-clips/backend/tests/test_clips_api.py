from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import SCORING_CRITERIA_DEFAULTS
from app.transcription import WhisperEngine

from .clip_fixtures import PODCAST, make_transcript
from .conftest import requires_ffmpeg, upload, wait_for_status, write_settings


class ScriptedWhisperModel:
    """Modelo simulado que devolve sempre a mesma transcrição (o podcast de teste)."""

    def __init__(self):
        self.transcript = make_transcript(PODCAST)

    def transcribe(self, audio, **options):
        def segments():
            for seg in self.transcript.segments:
                words = [SimpleNamespace(start=w.start, end=w.end, word=w.text, probability=w.probability) for w in seg.words]
                yield SimpleNamespace(text=seg.text, start=seg.start, end=seg.end, words=words, avg_logprob=-0.2, no_speech_prob=0.01)

        return segments(), SimpleNamespace(language="pt", language_probability=0.99)


@pytest.fixture
def clip_client(config, mock_source, tmp_path):
    model_dir = tmp_path / "modelo"
    model_dir.mkdir()
    for name in ("model.bin", "config.json", "tokenizer.json"):
        (model_dir / name).write_text("x")
    engine = WhisperEngine(config.models_dir, model_factory=lambda path, device, compute: ScriptedWhisperModel())
    write_settings(config, auto_transcribe=True, model_dir=str(model_dir))
    with TestClient(create_app(config, client_factory=mock_source.factory, engine=engine)) as client:
        yield client


@pytest.fixture
def ready_project(clip_client, media_dir):
    project = upload(clip_client, (media_dir / "long.mp4").read_bytes(), filename="podcast.mp4").json()
    project = wait_for_status(clip_client, project["id"], {"ready", "failed"}, timeout=60)
    assert project["status"] == "ready", project
    return project


def clips_of(client, project_id):
    response = client.get(f"/api/projects/{project_id}/clips")
    assert response.status_code == 200, response.text
    return response.json()


@requires_ffmpeg
def test_full_pipeline_suggests_explained_clips(clip_client, ready_project):
    project = ready_project
    assert project["job"]["kind"] == "detect_clips"
    assert project["clips"]["count"] >= 2 and project["clips"]["approved"] == 0
    clip_set = clips_of(clip_client, project["id"])
    assert clip_set["duration_preset"] == "30-60" and clip_set["language"] == "pt"
    assert clip_set["audio_reference_db"] is not None
    top = clip_set["clips"][0]
    assert top["text"].startswith("Por que a maioria")
    assert 30 <= top["end"] - top["start"] <= 60
    keys = [c["key"] for c in top["components"]]
    assert keys == list(SCORING_CRITERIA_DEFAULTS)
    emphasis = next(c for c in top["components"] if c["key"] == "emphasis")
    assert emphasis["details"] != ["Sem áudio para medir"]
    assert top["highlights"] and isinstance(top["warnings"], list)


@requires_ffmpeg
def test_edit_approve_reject_and_manual_clips(clip_client, ready_project):
    pid = ready_project["id"]
    clip_set = clips_of(clip_client, pid)
    first = clip_set["clips"][0]

    renamed = clip_client.patch(f"/api/projects/{pid}/clips/{first['id']}", json={"title": "Guardar dinheiro", "status": "approved"}).json()
    assert renamed["title"] == "Guardar dinheiro" and renamed["status"] == "approved" and renamed["score"] == first["score"]

    moved = clip_client.patch(f"/api/projects/{pid}/clips/{first['id']}", json={"start": first["start"] + 1.0}).json()
    assert moved["edited"] and moved["title"] == "Guardar dinheiro" and moved["status"] == "approved"
    assert moved["start"] > first["start"] and moved["score"] != first["score"]
    assert "Começa no meio de uma frase" in moved["warnings"]

    for bad in ({"start": 10, "end": 9.5}, {"start": 400}):
        response = clip_client.patch(f"/api/projects/{pid}/clips/{first['id']}", json=bad)
        assert response.status_code == 422, (bad, response.text)
    # O fim depois do término do vídeo é ajustado para o fim do vídeo.
    clamped = clip_client.patch(f"/api/projects/{pid}/clips/{first['id']}", json={"start": 120, "end": 200}).json()
    assert clamped["end"] <= 150.1
    assert clip_client.patch(f"/api/projects/{pid}/clips/naoexiste", json={"title": "x"}).status_code == 404
    assert clip_client.patch(f"/api/projects/{pid}/clips/{first['id']}", json={"status": "talvez"}).status_code == 422

    manual = clip_client.post(f"/api/projects/{pid}/clips", json={"start": 64.5, "end": 82.0, "title": "História"})
    assert manual.status_code == 201
    manual = manual.json()
    assert manual["origin"] == "manual" and manual["status"] == "approved" and manual["title"] == "História"
    story = next(c for c in manual["components"] if c["key"] == "story")
    assert story["value"] >= 0.8

    summary = clip_client.get(f"/api/projects/{pid}").json()["clips"]
    assert summary["approved"] == 2
    assert clip_client.delete(f"/api/projects/{pid}/clips/{manual['id']}").status_code == 204
    assert clip_client.get(f"/api/projects/{pid}").json()["clips"]["approved"] == 1
    assert clip_client.delete(f"/api/projects/{pid}/clips/{manual['id']}").status_code == 404


@requires_ffmpeg
def test_regenerate_keeps_curated_clips(clip_client, ready_project):
    pid = ready_project["id"]
    clips = clips_of(clip_client, pid)["clips"]
    approved, rejected = clips[0], clips[1]
    clip_client.patch(f"/api/projects/{pid}/clips/{approved['id']}", json={"status": "approved"})
    clip_client.patch(f"/api/projects/{pid}/clips/{rejected['id']}", json={"status": "rejected"})

    assert clip_client.post(f"/api/projects/{pid}/clips/detect").json()["status"] == "detecting_clips"
    wait_for_status(clip_client, pid, {"ready", "failed"})
    regenerated = {c["id"]: c for c in clips_of(clip_client, pid)["clips"]}
    assert regenerated[approved["id"]]["status"] == "approved"
    assert regenerated[rejected["id"]]["status"] == "rejected"
    assert clips_of(clip_client, pid)["clips"][-1]["status"] == "rejected"  # descartados vão para o fim

    clip_client.post(f"/api/projects/{pid}/clips/detect", json={"keep_curated": False})
    wait_for_status(clip_client, pid, {"ready", "failed"})
    fresh = clips_of(clip_client, pid)["clips"]
    assert all(c["status"] == "suggested" for c in fresh)
    assert approved["id"] not in {c["id"] for c in fresh}


@requires_ffmpeg
def test_changing_project_settings_then_regenerating(clip_client, ready_project):
    pid = ready_project["id"]
    settings = ready_project["settings"] | {"duration": "15-30", "max_clips": 2}
    clip_client.patch(f"/api/projects/{pid}", json={"settings": settings})
    clip_client.post(f"/api/projects/{pid}/clips/detect", json={"keep_curated": False})
    wait_for_status(clip_client, pid, {"ready", "failed"})
    clip_set = clips_of(clip_client, pid)
    assert clip_set["duration_preset"] == "15-30" and len(clip_set["clips"]) == 2
    assert all(15 <= c["end"] - c["start"] <= 30 for c in clip_set["clips"])


@requires_ffmpeg
def test_detection_failure_then_retry_only_detects(clip_client, ready_project, config):
    pid = ready_project["id"]
    transcript_path = config.projects_dir / pid / "transcript.json"
    original = transcript_path.read_text(encoding="utf-8")
    transcript_path.write_text("corrompido", encoding="utf-8")
    clip_client.post(f"/api/projects/{pid}/clips/detect")
    failed = wait_for_status(clip_client, pid, {"failed", "ready"})
    assert failed["status"] == "failed" and failed["job"]["kind"] == "detect_clips"

    transcript_path.write_text(original, encoding="utf-8")
    retried = clip_client.post(f"/api/projects/{pid}/retry").json()
    assert retried["job"]["kind"] == "detect_clips"
    assert wait_for_status(clip_client, pid, {"ready", "failed"})["status"] == "ready"


def test_clip_endpoints_require_previous_steps(client, real_video):
    project = upload(client, real_video).json()
    project = wait_for_status(client, project["id"], {"ready", "failed"})
    pid = project["id"]
    assert client.post(f"/api/projects/{pid}/clips/detect").status_code == 409
    assert client.get(f"/api/projects/{pid}/clips").status_code == 404
    assert client.post(f"/api/projects/{pid}/clips", json={"start": 0, "end": 2}).status_code == 409


def test_criteria_and_weight_settings(client):
    criteria = client.get("/api/clip-scoring/criteria").json()
    assert [c["key"] for c in criteria] == list(SCORING_CRITERIA_DEFAULTS)
    assert all(c["label"] and c["description"] for c in criteria)

    settings = client.get("/api/settings").json()
    assert settings["clip_detection"]["weights"] == SCORING_CRITERIA_DEFAULTS
    settings["clip_detection"]["weights"] = {"story": 40, "hook": 0}
    saved = client.put("/api/settings", json=settings).json()["clip_detection"]["weights"]
    assert saved["story"] == 40 and saved["hook"] == 0 and saved["qa"] == SCORING_CRITERIA_DEFAULTS["qa"]
    for bad in ({"viral": 10}, {"story": -1}, {"story": 101}, {k: 0 for k in SCORING_CRITERIA_DEFAULTS}):
        settings["clip_detection"]["weights"] = bad
        assert client.put("/api/settings", json=settings).status_code == 422, bad


def test_range_validation_rules():
    from app.schemas import MediaInfo, Project, SourceInfo
    from app.services import ProjectService, ServiceError

    project = Project(
        title="x",
        status="ready",
        source=SourceInfo(kind="upload", original_name="a.mp4"),
        media=MediaInfo(duration_seconds=600, format_name="mp4"),
    )
    assert ProjectService._validate_range(project, 10, 40) == (10, 40)
    assert ProjectService._validate_range(project, 590, 700) == (590, 600)
    for start, end, message in ((10, 10.5, "pelo menos 1 segundo"), (0, 181, "no máximo 180"), (600, 610, "depois do fim")):
        with pytest.raises(ServiceError, match=message):
            ProjectService._validate_range(project, start, end)
