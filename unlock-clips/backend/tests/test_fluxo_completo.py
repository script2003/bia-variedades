"""Fluxo completo pela API, do envio ao MP4 exportado, como na interface (Etapa 7).

envio → verificação → áudio → transcrição → sugestões → edição → MP4 → exportados → exclusão.
A transcrição usa um modelo simulado que devolve sempre o podcast de exemplo (tests/clip_fixtures.py).
"""

import json
import subprocess

from app.ffmpeg import find_tools

from .conftest import requires_ffmpeg, upload, wait_for_status
from .test_clips_api import clip_client  # noqa: F401 - fixture reutilizada

pytestmark = requires_ffmpeg


def test_full_flow_from_upload_to_exported_mp4(clip_client, media_dir, config):  # noqa: F811
    api = clip_client
    settings = {"duration": "15-30", "aspect_ratio": "9:16", "subtitle_style": "classico", "max_clips": 5}

    created = upload(api, (media_dir / "long.mp4").read_bytes(), filename="podcast-ep1.mp4", settings=json.dumps(settings))
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    # 1) Processamento automático em segundo plano até as sugestões de cortes.
    project = wait_for_status(api, pid, {"ready", "failed"}, timeout=90)
    assert project["status"] == "ready", project
    assert project["source"]["sha256"] and project["media"]["duration_seconds"] > 140
    assert project["audio"]["sample_rate"] == 16000
    assert project["transcript"]["word_count"] > 50
    assert project["clips"]["count"] >= 1
    assert project["settings"]["subtitle_style"] == "classico"

    clips = api.get(f"/api/projects/{pid}/clips").json()["clips"]
    best = clips[0]
    assert best["score"] > 0 and best["components"] and 15 - 1 <= best["end"] - best["start"] <= 30 + 1

    # 2) Edição: título, aprovação, trecho, enquadramento e legenda.
    url = f"/api/projects/{pid}/clips/{best['id']}"
    edited = api.patch(url, json={"title": "Meu melhor corte", "status": "approved", "end": best["end"] - 1}).json()
    assert edited["title"] == "Meu melhor corte" and edited["edited"] is True
    api.patch(url, json={"framing_override": {"mode": "manual", "x": 0.2, "y": 0.5, "zoom": 1.5}})
    cues = [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in api.get(f"{url}/subtitles").json()["editable"]]
    cues[0]["text"] = "Primeira legenda revisada"
    assert api.put(f"{url}/subtitles", json={"cues": cues}).json()["edited"] is True

    # 3) Exportação do MP4.
    assert api.post(f"/api/projects/{pid}/clips/render").json()["status"] == "rendering"
    project = wait_for_status(api, pid, {"ready", "failed"}, timeout=180)
    assert project["status"] == "ready" and project["clips"]["rendered"] == 1
    render = api.get(url.rsplit("/", 1)[0]).json()["clips"]
    render = next(c for c in render if c["id"] == best["id"])["render"]
    assert render["framing"] == "manual" and render["stale"] is False and render["subtitle_style"] == "classico"
    assert render["filename"].startswith("meu-melhor-corte-")

    exported = api.get("/api/exports").json()
    assert [e["clip_title"] for e in exported] == ["Meu melhor corte"]
    mp4 = config.projects_dir / pid / "exports" / render["filename"]
    tools = find_tools(None)
    probe = subprocess.run(
        [tools.ffprobe, "-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", str(mp4)],
        capture_output=True, text=True, check=True,
    ).stdout.split()  # fmt: skip
    assert probe == ["h264,1080,1920", "aac"]
    srt = api.get(f"{url}/subtitles.srt").text
    assert "Primeira legenda revisada" in srt.replace("\n", " ")

    # 4) Retomar depois de "fechar a aplicação": os dados continuam no disco.
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(config)) as reopened:
        again = reopened.get(f"/api/projects/{pid}").json()
        assert again["status"] == "ready" and again["clips"]["rendered"] == 1
        kept = reopened.get(f"/api/projects/{pid}/clips").json()["clips"]
        assert next(c for c in kept if c["id"] == best["id"])["subtitle_cues"][0]["text"] == "Primeira legenda revisada"

    # 5) Excluir o projeto remove todos os arquivos.
    assert api.delete(f"/api/projects/{pid}").status_code == 204
    assert not (config.projects_dir / pid).exists()
    assert api.get("/api/exports").json() == [] and api.get("/api/projects").json() == []
