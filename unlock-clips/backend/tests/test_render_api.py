
import pytest

from .conftest import requires_ffmpeg, wait_for_status
from .test_clips_api import clip_client, clips_of, ready_project  # noqa: F401 - fixtures reutilizadas

pytestmark = requires_ffmpeg


def approve_first(client, pid):
    clip = clips_of(client, pid)["clips"][0]
    client.patch(f"/api/projects/{pid}/clips/{clip['id']}", json={"status": "approved"})
    return clip


def test_render_approved_clips_and_export(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    assert clip_client.post(f"/api/projects/{pid}/clips/render").status_code == 409  # nenhum aprovado
    clip = approve_first(clip_client, pid)

    started = clip_client.post(f"/api/projects/{pid}/clips/render")
    assert started.status_code == 200 and started.json()["status"] == "rendering"
    assert started.json()["job"]["kind"] == "render_clips"
    project = wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=120)
    assert project["status"] == "ready", project
    assert project["clips"]["rendered"] == 1

    rendered = next(c for c in clips_of(clip_client, pid)["clips"] if c["id"] == clip["id"])
    info = rendered["render"]
    assert (info["width"], info["height"], info["aspect_ratio"]) == (1080, 1920, "9:16")
    assert info["filename"].endswith(f"-{clip['id'][:6]}-9x16.mp4") and info["stale"] is False
    assert info["subtitle_cues"] > 0 and info["duration_seconds"] == pytest.approx(clip["end"] - clip["start"], abs=0.6)  # vídeo de teste: 2 fps

    exports = clip_client.get("/api/exports").json()
    assert [e["clip_id"] for e in exports] == [clip["id"]] and exports[0]["clip_title"] == clip["title"]
    video = clip_client.get(exports[0]["url"])
    assert video.status_code == 200 and video.content[4:8] == b"ftyp"
    assert clip_client.get(f"/api/projects/{pid}").json()["clips"]["rendered"] == 1


def test_render_becomes_stale_when_clip_or_settings_change(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = approve_first(clip_client, pid)
    clip_client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip["id"]]})
    wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=120)

    clip_client.patch(f"/api/projects/{pid}/clips/{clip['id']}", json={"title": "Só o título"})
    current = next(c for c in clips_of(clip_client, pid)["clips"] if c["id"] == clip["id"])
    assert current["render"]["stale"] is False  # o título não aparece no vídeo

    settings = ready_project["settings"] | {"subtitle_style": "caixa"}
    clip_client.patch(f"/api/projects/{pid}", json={"settings": settings})
    current = next(c for c in clips_of(clip_client, pid)["clips"] if c["id"] == clip["id"])
    assert current["render"]["stale"] is True

    # "Tentar novamente" depois de uma falha regera os aprovados pendentes.
    clip_client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip["id"]]})
    wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=120)
    current = next(c for c in clips_of(clip_client, pid)["clips"] if c["id"] == clip["id"])
    assert current["render"]["stale"] is False and current["render"]["subtitle_style"] == "caixa"


def test_render_failure_then_retry(clip_client, ready_project, tmp_path):  # noqa: F811
    pid = ready_project["id"]
    approve_first(clip_client, pid)
    settings = clip_client.get("/api/settings").json()
    settings["ffmpeg_dir"] = str(tmp_path / "nada")
    clip_client.put("/api/settings", json=settings)
    clip_client.post(f"/api/projects/{pid}/clips/render")
    failed = wait_for_status(clip_client, pid, {"failed", "ready"})
    assert failed["status"] == "failed" and failed["job"]["kind"] == "render_clips"

    settings["ffmpeg_dir"] = None
    clip_client.put("/api/settings", json=settings)
    retried = clip_client.post(f"/api/projects/{pid}/retry").json()
    assert retried["job"]["kind"] == "render_clips"
    assert wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=120)["clips"]["rendered"] == 1


def test_frame_preview_and_subtitles(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = clips_of(clip_client, pid)["clips"][0]
    frame = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/frame.jpg", params={"t": 1.5})
    assert frame.status_code == 200 and frame.headers["content-type"] == "image/jpeg"
    assert frame.content[:2] == b"\xff\xd8"
    assert clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/frame.jpg", params={"t": -1}).status_code == 422

    subtitles = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/subtitles").json()
    assert (subtitles["width"], subtitles["height"]) == (1080, 1920)
    assert subtitles["template"]["key"] == "destaque" and subtitles["highlight"] is True
    first = subtitles["cues"][0]
    assert first["start"] >= 0 and first["lines"][0][0]["text"] == first["lines"][0][0]["text"].upper()
    assert subtitles["cues"][-1]["end"] <= clip["end"] - clip["start"] + 0.01
    assert clip_client.get(f"/api/projects/{pid}/clips/naoexiste/subtitles").status_code == 404


def test_deleting_a_clip_removes_its_video(clip_client, ready_project, config):  # noqa: F811
    pid = ready_project["id"]
    clip = approve_first(clip_client, pid)
    clip_client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip["id"]]})
    wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=120)
    filename = next(c for c in clips_of(clip_client, pid)["clips"] if c["id"] == clip["id"])["render"]["filename"]
    assert (config.projects_dir / pid / "exports" / filename).is_file()
    clip_client.delete(f"/api/projects/{pid}/clips/{clip['id']}")
    assert not (config.projects_dir / pid / "exports" / filename).exists()
    assert clip_client.get("/api/exports").json() == []


def test_templates_and_health(client):
    templates = client.get("/api/subtitle-templates").json()
    assert [t["key"] for t in templates] == ["destaque", "classico", "caixa", "minimalista"]
    assert templates[0]["uppercase"] and templates[0]["highlight"].startswith("#")
    health = client.get("/api/health").json()
    assert health["face_detection_available"] is True and health["face_detection_error"] is None


def test_framing_endpoint(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = clips_of(clip_client, pid)["clips"][0]
    center = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/framing").json()
    assert center["mode"] == "centro" and center["notes"] == [] and center["keyframes"] == []
    clip_client.patch(f"/api/projects/{pid}", json={"settings": ready_project["settings"] | {"framing": "rosto"}})
    framing = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/framing").json()
    # O vídeo de teste é cinza (sem rostos): mesmo pedindo "rosto", o enquadramento central é usado e explicado.
    assert framing["mode"] == "centro" and framing["source_width"] == 64
    assert framing["crop_width"] <= 64 and "enquadramento central" in framing["notes"][0]
    again = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/framing").json()
    assert again == framing  # cache
