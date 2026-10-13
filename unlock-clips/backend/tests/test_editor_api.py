"""Editor de cortes (Etapa 6): legendas editáveis, enquadramento manual e gestão dos vídeos exportados."""

import subprocess

import pytest

from app.ffmpeg import find_tools

from .conftest import requires_ffmpeg, wait_for_status
from .test_clips_api import clip_client, clips_of, ready_project  # noqa: F401 - fixtures reutilizadas

pytestmark = requires_ffmpeg


def first_clip(client, pid):
    return clips_of(client, pid)["clips"][0]


def get_clip(client, pid, clip_id):
    return next(c for c in clips_of(client, pid)["clips"] if c["id"] == clip_id)


def subtitles_of(client, pid, clip_id):
    response = client.get(f"/api/projects/{pid}/clips/{clip_id}/subtitles")
    assert response.status_code == 200, response.text
    return response.json()


def render(client, pid, clip_id):
    started = client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip_id]})
    assert started.status_code == 200, started.text
    project = wait_for_status(client, pid, {"ready", "failed"}, timeout=120)
    assert project["status"] == "ready", project
    return get_clip(client, pid, clip_id)


def test_subtitles_are_editable_and_persisted(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    original = subtitles_of(clip_client, pid, clip["id"])
    editable = original["editable"]
    assert original["edited"] is False and len(editable) >= 2
    assert editable[0]["start"] >= clip["start"] - 0.01 and editable[-1]["end"] <= clip["end"] + 0.01
    assert not any(c["edited"] for c in editable)

    # Corrige o texto do 1º bloco e oculta o 2º.
    edits = [dict(c) for c in editable]
    edits[0]["text"] = "Legenda corrigida no editor"
    edits[1]["hidden"] = True
    payload = {"cues": [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in edits]}
    saved = clip_client.put(f"/api/projects/{pid}/clips/{clip['id']}/subtitles", json=payload)
    assert saved.status_code == 200, saved.text
    data = saved.json()
    assert data["edited"] is True
    assert data["editable"][0]["text"] == "Legenda corrigida no editor" and data["editable"][0]["edited"] is True
    assert data["editable"][1]["hidden"] is True
    # A prévia usa o texto editado (em caixa-alta no modelo "destaque") e não mostra o bloco oculto.
    first_words = " ".join(w["text"] for line in data["cues"][0]["lines"] for w in line)
    assert first_words == "LEGENDA CORRIGIDA NO EDITOR"
    assert len(data["cues"]) == len(original["cues"]) - 1

    # Persistido em disco: continua após recarregar.
    assert subtitles_of(clip_client, pid, clip["id"])["editable"][0]["text"] == "Legenda corrigida no editor"
    assert get_clip(clip_client, pid, clip["id"])["subtitle_cues"] is not None

    srt = clip_client.get(f"/api/projects/{pid}/clips/{clip['id']}/subtitles.srt")
    assert srt.status_code == 200 and "attachment" in srt.headers["content-disposition"]
    assert srt.text.startswith("1\n00:00:00,") and "Legenda corrigida no editor" in srt.text.replace("\n", " ")

    # Voltar às legendas automáticas.
    reset = clip_client.delete(f"/api/projects/{pid}/clips/{clip['id']}/subtitles").json()
    assert reset["edited"] is False and reset["editable"][0]["text"] == editable[0]["text"]
    assert get_clip(clip_client, pid, clip["id"])["subtitle_cues"] is None


def test_unchanged_subtitles_stay_automatic_and_invalid_edits_are_rejected(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    editable = subtitles_of(clip_client, pid, clip["id"])["editable"]
    url = f"/api/projects/{pid}/clips/{clip['id']}/subtitles"
    same = [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in editable]
    assert clip_client.put(url, json={"cues": same}).json()["edited"] is False

    overlapping = [dict(same[0]), dict(same[1])]
    overlapping[1]["start"] = overlapping[0]["start"] + 0.05
    response = clip_client.put(url, json={"cues": overlapping})
    assert response.status_code == 422 and "sobrepõem" in response.json()["detail"]

    outside = [{"start": clip["end"] + 5, "end": clip["end"] + 8, "text": "fora do corte"}]
    assert clip_client.put(url, json={"cues": outside}).status_code == 422
    too_long = [{"start": clip["start"], "end": clip["start"] + 1, "text": "x" * 401}]
    assert clip_client.put(url, json={"cues": too_long}).status_code == 422
    assert clip_client.put(f"/api/projects/{pid}/clips/naoexiste/subtitles", json={"cues": same}).status_code == 404


def test_subtitle_edits_survive_range_changes(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    editable = subtitles_of(clip_client, pid, clip["id"])["editable"]
    cues = [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in editable]
    cues[0]["text"] = "Começo editado"
    clip_client.put(f"/api/projects/{pid}/clips/{clip['id']}/subtitles", json={"cues": cues})

    # Ampliar o fim do corte: o bloco editado é mantido e o trecho novo recebe legendas automáticas.
    new_end = min(clip["end"] + 6, ready_project["media"]["duration_seconds"])
    updated = clip_client.patch(f"/api/projects/{pid}/clips/{clip['id']}", json={"end": new_end})
    assert updated.status_code == 200, updated.text
    assert updated.json()["subtitle_cues"] is not None
    after = subtitles_of(clip_client, pid, clip["id"])
    assert after["editable"][0]["text"] == "Começo editado"
    assert after["editable"][-1]["end"] > editable[-1]["end"]


def test_manual_framing_override(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    url = f"/api/projects/{pid}/clips/{clip['id']}"
    default = clip_client.get(f"{url}/framing").json()
    assert default["requested"] == "centro" and default["override"] is None

    override = {"mode": "manual", "x": 0.0, "y": 0.5, "zoom": 2.0}
    updated = clip_client.patch(url, json={"framing_override": override})
    assert updated.status_code == 200 and updated.json()["framing_override"] == override
    framing = clip_client.get(f"{url}/framing").json()
    # Vídeo de teste 64×64 → 9:16: recorte base 36×64; zoom 2× → 18×32, encostado à esquerda e centralizado na vertical.
    assert (framing["mode"], framing["requested"]) == ("manual", "manual")
    assert (framing["crop_width"], framing["crop_height"], framing["x"], framing["y"]) == (18, 32, 0, 16)

    frame = clip_client.get(f"{url}/frame.jpg", params={"t": 1})
    assert frame.status_code == 200 and frame.content[:2] == b"\xff\xd8"

    assert clip_client.patch(url, json={"framing_override": {"mode": "manual", "zoom": 5}}).status_code == 422
    assert clip_client.patch(url, json={"framing_override": {"mode": "inexistente"}}).status_code == 422
    # Título sem mexer no enquadramento: o ajuste continua.
    assert clip_client.patch(url, json={"title": "Outro título"}).json()["framing_override"] == override
    # null volta ao padrão do projeto.
    assert clip_client.patch(url, json={"framing_override": None}).json()["framing_override"] is None
    assert clip_client.get(f"{url}/framing").json()["mode"] == "centro"


def test_render_uses_editor_changes_and_becomes_stale(clip_client, ready_project, config):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    url = f"/api/projects/{pid}/clips/{clip['id']}"
    clip_client.patch(url, json={"framing_override": {"mode": "manual", "x": 1.0, "y": 0.5, "zoom": 1.0}})
    rendered = render(clip_client, pid, clip["id"])
    info = rendered["render"]
    assert info["framing"] == "manual" and info["stale"] is False and (info["width"], info["height"]) == (1080, 1920)

    # Editar a legenda deixa o vídeo desatualizado; gerar novamente atualiza.
    editable = subtitles_of(clip_client, pid, clip["id"])["editable"]
    cues = [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in editable]
    cues[0]["text"] = "Nova legenda"
    clip_client.put(f"{url}/subtitles", json={"cues": cues})
    assert get_clip(clip_client, pid, clip["id"])["render"]["stale"] is True
    exports = clip_client.get("/api/exports").json()
    assert exports[0]["stale"] is True and exports[0]["aspect_ratio"] == "9:16"

    again = render(clip_client, pid, clip["id"])["render"]
    assert again["stale"] is False and again["subtitle_cues"] == len(subtitles_of(clip_client, pid, clip["id"])["cues"])

    # O vídeo final está mesmo no formato 9:16 e com a duração do corte.
    tools = find_tools(None)
    path = config.projects_dir / pid / "exports" / again["filename"]
    probe = subprocess.run(
        [tools.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    assert probe.stdout.strip() == "1080,1920"


def test_export_management(clip_client, ready_project, config):  # noqa: F811
    pid = ready_project["id"]
    clips = clips_of(clip_client, pid)["clips"][:2]
    for clip in clips:
        clip_client.patch(f"/api/projects/{pid}/clips/{clip['id']}", json={"status": "approved"})
    clip_client.post(f"/api/projects/{pid}/clips/render")
    assert wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=180)["clips"]["rendered"] == 2

    listed = clip_client.get(f"/api/projects/{pid}/exports").json()
    assert len(listed) == 2 and all(e["duration_seconds"] and e["width"] == 1080 for e in listed)
    inline = clip_client.get(listed[0]["url"], params={"download": "false"})
    assert inline.status_code == 200 and inline.headers["content-disposition"].startswith("inline")
    assert clip_client.get(listed[0]["url"]).headers["content-disposition"].startswith("attachment")

    storage = clip_client.get(f"/api/projects/{pid}/storage").json()
    assert storage["exports_count"] == 2 and storage["exports_bytes"] == sum(e["size_bytes"] for e in listed)
    assert storage["source_bytes"] > 0 and storage["audio_bytes"] > 0
    assert storage["total_bytes"] >= storage["source_bytes"] + storage["audio_bytes"] + storage["exports_bytes"]
    assert [s["project_id"] for s in clip_client.get("/api/storage").json()] == [pid]

    # Excluir um vídeo: o arquivo some e o corte volta a "vídeo não gerado".
    target = listed[0]
    assert clip_client.delete(target["url"]).status_code == 204
    assert not (config.projects_dir / pid / "exports" / target["filename"]).exists()
    assert get_clip(clip_client, pid, target["clip_id"])["render"] is None
    assert clip_client.get(f"/api/projects/{pid}").json()["clips"]["rendered"] == 1
    assert clip_client.delete(target["url"]).status_code == 404
    assert clip_client.delete(f"/api/projects/{pid}/exports/..%2Fproject.json").status_code == 404

    # Excluir todos.
    removed = clip_client.delete(f"/api/projects/{pid}/exports").json()
    assert removed["deleted"] == 1 and removed["freed_bytes"] > 0
    assert clip_client.get("/api/exports").json() == []
    assert clip_client.get(f"/api/projects/{pid}").json()["clips"]["rendered"] == 0
    assert all(c["render"] is None for c in clips_of(clip_client, pid)["clips"])


def test_curated_edits_survive_regeneration(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = first_clip(clip_client, pid)
    url = f"/api/projects/{pid}/clips/{clip['id']}"
    override = {"mode": "manual", "x": 0.25, "y": 0.5, "zoom": 1.5}
    clip_client.patch(url, json={"status": "approved", "framing_override": override})
    editable = subtitles_of(clip_client, pid, clip["id"])["editable"]
    cues = [{k: c[k] for k in ("start", "end", "text", "hidden")} for c in editable]
    cues[0]["text"] = "Mantida"
    clip_client.put(f"{url}/subtitles", json={"cues": cues})

    clip_client.post(f"/api/projects/{pid}/clips/detect", json={"keep_curated": True})
    wait_for_status(clip_client, pid, {"ready", "failed"}, timeout=60)
    kept = get_clip(clip_client, pid, clip["id"])
    assert kept["framing_override"] == override
    assert kept["subtitle_cues"][0]["text"] == "Mantida"


@pytest.mark.parametrize("path", ["subtitles", "subtitles.srt", "framing"])
def test_editor_endpoints_404_for_unknown_clip(clip_client, ready_project, path):  # noqa: F811
    assert clip_client.get(f"/api/projects/{ready_project['id']}/clips/naoexiste/{path}").status_code == 404
