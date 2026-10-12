import hashlib
import json
import time

import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import SCHEMA_VERSION, JobInfo, Project, SourceInfo
from app.storage import ProjectStore

from .conftest import fake_video, upload, wait_for_status


def allow_domains(client: TestClient, *domains: str) -> None:
    settings = client.get("/api/settings").json()
    settings["allowed_link_domains"] = list(domains)
    assert client.put("/api/settings", json=settings).status_code == 200


# ----------------------------------------------------------------- sistema


def test_health_and_empty_state(client):
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert isinstance(health["ffmpeg_available"], bool)
    assert client.get("/api/projects").json() == []
    assert client.get("/api/exports").json() == []
    stats = client.get("/api/stats").json()
    assert stats["projects_total"] == 0 and stats["active_jobs"] == 0


def test_settings_roundtrip_and_validation(client):
    settings = client.get("/api/settings").json()
    assert settings["clip_defaults"]["aspect_ratio"] == "9:16"
    settings["clip_defaults"]["duration"] = "15-30"
    settings["allowed_link_domains"] = ["https://www.MeuSite.com.br/videos", "cdn.exemplo.com"]
    saved = client.put("/api/settings", json=settings).json()
    assert saved["allowed_link_domains"] == ["meusite.com.br", "cdn.exemplo.com"]
    assert client.get("/api/settings").json()["clip_defaults"]["duration"] == "15-30"

    settings["clip_defaults"]["aspect_ratio"] = "4:3"
    response = client.put("/api/settings", json=settings)
    assert response.status_code == 422
    assert "aspect_ratio" in response.json()["detail"]


# ----------------------------------------------------------------- upload


def test_upload_validates_and_becomes_ready(client, real_video):
    data = real_video
    response = upload(client, data, filename=r"C:\fakepath\Podcast Ep 1.mp4")
    assert response.status_code == 201, response.text
    project = response.json()
    assert project["title"] == "Podcast Ep 1"
    assert project["source"]["original_name"] == "Podcast Ep 1.mp4"
    assert project["source"]["filename"] == "source.mp4"
    assert project["job"]["kind"] == "process"

    project = wait_for_status(client, project["id"], {"ready", "failed"})
    assert project["status"] == "ready", project
    assert project["job"]["status"] == "completed" and project["job"]["progress"] == 1.0
    assert project["source"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert project["source"]["size_bytes"] == len(data)
    assert project["settings"]["aspect_ratio"] == "9:16"


def test_upload_uses_custom_title_and_settings(client):
    settings = {"duration": "60-90", "aspect_ratio": "1:1", "max_clips": 3}
    response = upload(client, fake_video(), title="Debate", settings=json.dumps(settings))
    assert response.status_code == 201
    project = response.json()
    assert project["title"] == "Debate"
    assert project["settings"]["duration"] == "60-90"
    assert project["settings"]["max_clips"] == 3

    bad = upload(client, fake_video(), settings=json.dumps({"max_clips": 999}))
    assert bad.status_code == 422


def test_upload_rejections(client, config):
    assert upload(client, fake_video(), filename="notas.pdf").status_code == 415
    response = upload(client, b"<html>nao sou video</html>" * 100, filename="falso.mp4")
    assert response.status_code == 415
    assert "não corresponde" in response.json()["detail"]
    assert upload(client, b"", filename="vazio.mp4").status_code == 400

    settings = client.get("/api/settings").json()
    settings["max_upload_size_mb"] = 1
    client.put("/api/settings", json=settings)
    too_big = upload(client, fake_video(2 * 1024 * 1024))
    assert too_big.status_code == 413

    # Nenhum projeto nem arquivo temporário deve sobrar.
    assert client.get("/api/projects").json() == []
    assert list(config.tmp_dir.iterdir()) == []


def test_upload_extension_mismatch_warns(client, media_dir):
    mkv = (media_dir / "sample.mkv").read_bytes()
    project = upload(client, mkv, filename="gravacao.mp4").json()
    assert project["source"]["filename"] == "source.mkv"
    project = wait_for_status(client, project["id"], {"ready"})
    assert any("não corresponde" in w for w in project["warnings"])


def test_duplicate_upload_warns(client, real_video):
    data = real_video
    first = upload(client, data, title="Original").json()
    wait_for_status(client, first["id"], {"ready"})
    second = upload(client, data, title="Cópia").json()
    second = wait_for_status(client, second["id"], {"ready"})
    assert any("Original" in w for w in second["warnings"])


def test_source_streaming_supports_range(client, real_video):
    data = real_video
    project = upload(client, data).json()
    wait_for_status(client, project["id"], {"ready"})
    full = client.get(f"/api/projects/{project['id']}/source")
    assert full.status_code == 200 and full.content == data
    partial = client.get(f"/api/projects/{project['id']}/source", headers={"Range": "bytes=100-199"})
    assert partial.status_code == 206
    assert partial.content == data[100:200]
    assert partial.headers["content-range"] == f"bytes 100-199/{len(data)}"


# ----------------------------------------------------------------- edição e exclusão


def test_update_and_delete_project(client, config, real_video):
    project = upload(client, real_video).json()
    wait_for_status(client, project["id"], {"ready"})
    updated = client.patch(
        f"/api/projects/{project['id']}",
        json={"title": "Novo título", "settings": {"aspect_ratio": "16:9", "framing": "rosto"}},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Novo título"
    assert updated.json()["settings"]["framing"] == "rosto"
    assert client.patch(f"/api/projects/{project['id']}", json={"title": ""}).status_code == 422
    assert client.patch(f"/api/projects/{project['id']}", json={"desconhecido": 1}).status_code == 422

    assert client.post(f"/api/projects/{project['id']}/retry").status_code == 409
    assert client.post(f"/api/projects/{project['id']}/cancel").status_code == 409

    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
    assert not (config.projects_dir / project["id"]).exists()


def test_unknown_and_malicious_ids(client):
    assert client.get("/api/projects/" + "0" * 32).status_code == 404
    assert client.get("/api/projects/..%2F..%2Fsettings").status_code == 404
    assert client.delete("/api/projects/abc").status_code == 404


# ----------------------------------------------------------------- links


def test_link_import_end_to_end(client, mock_source, real_video):
    data = real_video
    mock_source.handler = lambda r: httpx.Response(200, headers={"content-type": "video/mp4"}, content=data)
    allow_domains(client, "exemplo.com")
    response = client.post(
        "/api/projects/from-link",
        json={"url": "https://cdn.exemplo.com/podcast.mp4", "rights_confirmed": True},
    )
    assert response.status_code == 201, response.text
    project = response.json()
    assert project["status"] == "importing"
    assert project["title"] == "podcast"
    project = wait_for_status(client, project["id"], {"ready", "failed"})
    assert project["status"] == "ready", project
    assert project["source"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert client.get(f"/api/projects/{project['id']}/source").content == data


def test_link_import_policy(client):
    payload = {"url": "https://exemplo.com/a.mp4", "rights_confirmed": True}
    no_domains = client.post("/api/projects/from-link", json=payload)
    assert no_domains.status_code == 400
    assert "Nenhum domínio" in no_domains.json()["detail"]

    allow_domains(client, "exemplo.com")
    not_confirmed = client.post("/api/projects/from-link", json={**payload, "rights_confirmed": False})
    assert not_confirmed.status_code == 400
    other = client.post("/api/projects/from-link", json={**payload, "url": "https://youtube.com/watch?v=x"})
    assert other.status_code == 400
    assert client.get("/api/projects").json() == []


def test_link_failure_then_retry(client, mock_source, real_video):
    allow_domains(client, "exemplo.com")
    mock_source.handler = lambda r: httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>")
    project = client.post(
        "/api/projects/from-link", json={"url": "https://exemplo.com/pagina", "rights_confirmed": True}
    ).json()
    project = wait_for_status(client, project["id"], {"failed"})
    assert "página web" in project["error"]

    mock_source.handler = lambda r: httpx.Response(200, headers={"content-type": "video/mp4"}, content=real_video)
    retried = client.post(f"/api/projects/{project['id']}/retry")
    assert retried.status_code == 200
    project = wait_for_status(client, project["id"], {"ready"})
    assert project["error"] is None
    assert project["source"]["filename"] == "source.mp4"


def test_cancel_link_download(client, mock_source, config):
    allow_domains(client, "exemplo.com")

    def slow_stream():
        yield fake_video(64 * 1024)
        for _ in range(500):
            time.sleep(0.02)
            yield b"\x00" * 1024

    mock_source.handler = lambda r: httpx.Response(200, headers={"content-type": "video/mp4"}, content=slow_stream())
    project = client.post(
        "/api/projects/from-link", json={"url": "https://exemplo.com/longo.mp4", "rights_confirmed": True}
    ).json()
    deadline = time.monotonic() + 5
    while client.get(f"/api/projects/{project['id']}").json()["job"]["status"] != "running":
        assert time.monotonic() < deadline
        time.sleep(0.02)

    assert client.post(f"/api/projects/{project['id']}/cancel").status_code == 200
    project = wait_for_status(client, project["id"], {"cancelled"})
    assert project["job"]["status"] == "cancelled"
    assert list(config.tmp_dir.iterdir()) == []
    assert not (config.projects_dir / project["id"] / "source.mp4").exists()


# ----------------------------------------------------------------- persistência


def test_restart_marks_interrupted_and_retry_resumes(config, mock_source, real_video):
    config.ensure_dirs()
    store = ProjectStore(config.projects_dir)
    project = Project(
        title="Antigo",
        status="validating",
        source=SourceInfo(kind="upload", original_name="a.mp4", filename="source.mp4"),
        job=JobInfo(kind="validate", status="running", progress=0.4),
    )
    store.create(project)
    (store.project_dir(project.id) / "source.mp4").write_bytes(real_video)
    (config.tmp_dir / "lixo.part").write_bytes(b"123")

    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        loaded = client.get(f"/api/projects/{project.id}").json()
        assert loaded["status"] == "interrupted"
        assert loaded["job"]["status"] == "interrupted"
        assert "Tentar novamente" in loaded["error"]
        assert not (config.tmp_dir / "lixo.part").exists()

        assert client.post(f"/api/projects/{project.id}/retry").status_code == 200
        assert wait_for_status(client, project.id, {"ready"})["source"]["sha256"]

    # Os dados continuam disponíveis depois de "fechar e abrir" a aplicação.
    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        projects = client.get("/api/projects").json()
        assert [p["title"] for p in projects] == ["Antigo"]
        assert projects[0]["status"] == "ready"


def test_exports_listing_and_download(client, config, real_video):
    project = upload(client, real_video).json()
    wait_for_status(client, project["id"], {"ready"})
    exports_dir = config.projects_dir / project["id"] / "exports"
    exports_dir.mkdir()
    (exports_dir / "corte-01.mp4").write_bytes(b"conteudo")
    (exports_dir / "ignorar.txt").write_text("x")

    exports = client.get("/api/exports").json()
    assert [e["filename"] for e in exports] == ["corte-01.mp4"]
    downloaded = client.get(exports[0]["url"])
    assert downloaded.status_code == 200 and downloaded.content == b"conteudo"
    assert client.get(f"/api/projects/{project['id']}/exports/..%2Fproject.json").status_code == 404
    assert client.get("/api/stats").json()["exports_total"] == 1


def test_serves_built_frontend(config, mock_source, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<div id=root></div>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    from dataclasses import replace

    app = create_app(replace(config, frontend_dist=dist), client_factory=mock_source.factory)
    with TestClient(app) as client:
        assert client.get("/").text == "<div id=root></div>"
        assert client.get("/projetos/abc").text == "<div id=root></div>"
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/inexistente").status_code == 404
        assert client.get("/api/health").status_code == 200


# ----------------------------------------------------------------- Etapa 2: FFmpeg


def test_processing_extracts_media_audio_and_thumbnail(client, real_video):
    import io
    import wave

    project = upload(client, real_video).json()
    project = wait_for_status(client, project["id"], {"ready", "failed"})
    assert project["status"] == "ready", project
    media = project["media"]
    assert 2.9 <= media["duration_seconds"] <= 3.2
    assert (media["video"]["width"], media["video"]["height"]) == (160, 120)
    assert media["audio_streams"][0]["channels"] == 2
    audio = project["audio"]
    assert (audio["sample_rate"], audio["channels"], audio["codec"]) == (16000, 1, "pcm_s16le")
    assert project["thumbnail"] == "thumbnail.jpg"

    wav_response = client.get(f"/api/projects/{project['id']}/audio")
    assert wav_response.status_code == 200
    assert wav_response.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(wav_response.content)) as wav:
        assert (wav.getnchannels(), wav.getframerate()) == (1, 16000)
    assert client.get(f"/api/projects/{project['id']}/audio", headers={"Range": "bytes=0-43"}).status_code == 206

    thumb = client.get(f"/api/projects/{project['id']}/thumbnail")
    assert thumb.status_code == 200 and thumb.content[:2] == b"\xff\xd8"


def test_video_without_audio_fails_with_clear_message(client, media_dir):
    project = upload(client, (media_dir / "silent.mp4").read_bytes(), filename="sem-audio.mp4").json()
    project = wait_for_status(client, project["id"], {"failed", "ready"})
    assert project["status"] == "failed"
    assert "não possui trilha de áudio" in project["error"]
    assert project["audio"] is None
    assert project["media"]["video"]["width"] == 160  # informações lidas continuam disponíveis
    assert client.get(f"/api/projects/{project['id']}/audio").status_code == 404


def test_audio_only_file_is_rejected(client, media_dir):
    project = upload(client, (media_dir / "audio_only.mp4").read_bytes(), filename="so-audio.mp4").json()
    project = wait_for_status(client, project["id"], {"failed", "ready"})
    assert "trilha de vídeo" in project["error"]


def test_missing_ffmpeg_fails_then_retry_after_fixing(client, real_video, tmp_path):
    settings = client.get("/api/settings").json()
    settings["ffmpeg_dir"] = str(tmp_path / "sem-ffmpeg")
    assert client.put("/api/settings", json=settings).json()["ffmpeg_dir"] == str(tmp_path / "sem-ffmpeg")
    health = client.get("/api/health").json()
    assert health["ffmpeg_available"] is False and "pasta configurada" in health["ffmpeg_error"]

    project = upload(client, real_video).json()
    project = wait_for_status(client, project["id"], {"failed", "ready"})
    assert project["status"] == "failed"
    assert "não foram encontrados" in project["error"]
    assert project["source"]["sha256"] is None  # falhou antes de reler o arquivo

    settings["ffmpeg_dir"] = "   "
    assert client.put("/api/settings", json=settings).json()["ffmpeg_dir"] is None
    assert client.post(f"/api/projects/{project['id']}/retry").status_code == 200
    assert wait_for_status(client, project["id"], {"ready"})["audio"] is not None


def test_health_reports_ffmpeg_version(client):
    health = client.get("/api/health").json()
    assert health["ffmpeg_available"] and health["ffprobe_available"]
    assert health["ffmpeg_version"].startswith("ffmpeg version")
    assert health["ffmpeg_path"] and health["ffmpeg_error"] is None


def test_stage1_project_can_be_processed(config, mock_source, real_video):
    """Projetos da Etapa 1 (prontos, sem áudio) podem ser processados pelo botão de retomada."""
    config.ensure_dirs()
    store = ProjectStore(config.projects_dir)
    legacy = Project(
        schema_version=1,
        title="Etapa 1",
        status="ready",
        source=SourceInfo(kind="upload", original_name="a.mp4", filename="source.mp4", sha256="x" * 64),
        job=JobInfo(kind="validate", status="completed", progress=1.0),
    )
    store.create(legacy)
    (store.project_dir(legacy.id) / "source.mp4").write_bytes(real_video)

    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        assert client.get(f"/api/projects/{legacy.id}").json()["job"]["kind"] == "validate"
        assert client.post(f"/api/projects/{legacy.id}/retry").status_code == 200
        project = wait_for_status(client, legacy.id, {"ready", "failed"})
        assert project["status"] == "ready" and project["audio"] is not None
        assert project["schema_version"] == SCHEMA_VERSION
        assert client.post(f"/api/projects/{legacy.id}/retry").status_code == 409
