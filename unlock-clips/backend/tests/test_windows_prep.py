"""Preparação para o Windows (Etapa 7): inicialização, porta ocupada, log, espaço em disco e arquivos em uso."""

import logging
import logging.config
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app import __main__ as launcher
from app.logs import log_file, uvicorn_log_config
from app.media import sanitize_filename

from .conftest import requires_ffmpeg, upload, wait_for_status
from .test_clips_api import clip_client, clips_of, ready_project  # noqa: F401 - fixtures reutilizadas


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("CON.mp4", "_CON.mp4"),
        ("nul", "_nul"),
        ("com1.mkv", "_com1.mkv"),
        ("lpt9.txt", "_lpt9.txt"),
        ("console.mp4", "console.mp4"),  # só o nome exato é reservado
        ("C:\\Users\\ana\\Vídeos\\aula.mp4", "aula.mp4"),
        ('entrevista: "parte 1"?.mp4', "entrevista_ _parte 1__.mp4"),
    ],
)
def test_windows_safe_filenames(raw, expected):
    assert sanitize_filename(raw) == expected


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _Health(BaseHTTPRequestHandler):
    body = b'{"status": "ok", "version": "9.9.9"}'

    def do_GET(self):  # noqa: N802 - nome exigido pelo http.server
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(self.body)

    def log_message(self, *args):
        pass


@pytest.fixture
def fake_server():
    server = HTTPServer(("127.0.0.1", 0), _Health)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def test_port_detection():
    port = free_port()
    assert launcher.port_in_use("127.0.0.1", port) is False
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", port))
        sock.listen()
        assert launcher.port_in_use("127.0.0.1", port) is True


def test_already_running_instance_is_reused(fake_server, monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(launcher.webbrowser, "open", opened.append)
    port = fake_server.server_address[1]
    assert launcher.running_instance(f"http://127.0.0.1:{port}") == "9.9.9"
    assert launcher.main(["--port", str(port), "--abrir"]) == 0
    assert "já está em execução" in capsys.readouterr().out
    assert opened == [f"http://127.0.0.1:{port}"]


def test_port_used_by_another_program(fake_server, monkeypatch, capsys):
    monkeypatch.setattr(_Health, "body", b"<html>outro programa</html>")
    port = fake_server.server_address[1]
    assert launcher.running_instance(f"http://127.0.0.1:{port}") is None
    assert launcher.main(["--port", str(port)]) == 2
    assert f"A porta {port} já está sendo usada" in capsys.readouterr().err


def test_python_version_check(monkeypatch, capsys):
    monkeypatch.setattr(launcher, "MIN_PYTHON", (99, 0))
    assert launcher.main([]) == 1
    assert "Python 99.0" in capsys.readouterr().err


def test_log_config_writes_utf8_file(tmp_path):
    config = uvicorn_log_config(tmp_path)
    assert config["handlers"]["file"]["encoding"] == "utf-8"
    assert config["loggers"]["uvicorn.access"]["level"] == "WARNING"  # sem o "barulho" das consultas periódicas
    root = logging.getLogger()
    saved = (root.level, list(root.handlers))
    try:
        logging.config.dictConfig(config)
        logging.getLogger("app.teste").info("Transcrição concluída — ação")
        for handler in root.handlers:
            handler.flush()
        assert "Transcrição concluída — ação" in log_file(tmp_path).read_text(encoding="utf-8")
    finally:
        for handler in root.handlers:
            if handler not in saved[1]:
                handler.close()
        root.handlers[:] = saved[1]
        root.setLevel(saved[0])


def test_health_reports_disk_and_log(client, config):
    health = client.get("/api/health").json()
    assert health["disk_free_bytes"] > 0 and health["disk_total_bytes"] >= health["disk_free_bytes"]
    assert health["log_file"].endswith("unlock-clips.log")
    assert client.get("/api/stats").json()["disk_free_bytes"] > 0


def test_low_disk_space_is_refused_clearly(client, real_video):
    service = client.app.state.service
    service.disk_usage = lambda: (100 * 1024 * 1024, 10 * 1024**3)  # 100 MB livres
    response = upload(client, real_video)
    assert response.status_code == 507
    assert "Espaço em disco insuficiente" in response.json()["detail"]


@requires_ffmpeg
def test_render_refused_when_disk_is_full(clip_client, ready_project):  # noqa: F811
    pid = ready_project["id"]
    clip = clips_of(clip_client, pid)["clips"][0]
    clip_client.app.state.service.disk_usage = lambda: (10 * 1024 * 1024, 10 * 1024**3)
    response = clip_client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip["id"]]})
    assert response.status_code == 507 and "gerar os vídeos" in response.json()["detail"]


@requires_ffmpeg
def test_export_locked_by_another_program(clip_client, ready_project, monkeypatch):  # noqa: F811
    """No Windows, um MP4 aberto em um player não pode ser substituído: o erro precisa ser claro."""
    import os

    import app.render

    real_replace = os.replace

    def locked(src, dst):
        if str(dst).endswith(".mp4"):
            raise PermissionError(13, "O arquivo já está sendo usado por outro processo")
        return real_replace(src, dst)

    monkeypatch.setattr(app.render.os, "replace", locked)
    pid = ready_project["id"]
    clip = clips_of(clip_client, pid)["clips"][0]
    clip_client.post(f"/api/projects/{pid}/clips/render", json={"clip_ids": [clip["id"]]})
    project = wait_for_status(clip_client, pid, {"failed", "ready"}, timeout=120)
    assert project["status"] == "failed"
    assert "aberto em outro programa" in project["error"]
    exports = clip_client.app.state.config.projects_dir / pid / "exports"
    assert not any(exports.glob("*.part.mp4"))  # o arquivo parcial é removido


def test_scripts_are_windows_friendly():
    """Os scripts PowerShell precisam de BOM (Windows PowerShell 5.1) e os .bat devem ser só ASCII."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    scripts = sorted((root / "scripts").glob("*.ps1"))
    assert {s.name for s in scripts} >= {"instalar.ps1", "iniciar.ps1", "testar.ps1", "desenvolver.ps1"}
    for script in scripts:
        assert script.read_bytes().startswith(b"\xef\xbb\xbf"), script.name
    for bat in root.glob("*.bat"):
        bat.read_bytes().decode("ascii")


def test_config_from_environment(monkeypatch, tmp_path):
    from app.config import DEFAULT_CORS_ORIGINS, AppConfig

    for name in ("UNLOCK_DATA_DIR", "UNLOCK_FRONTEND_DIST", "UNLOCK_CORS_ORIGINS", "UNLOCK_MAX_WORKERS"):
        monkeypatch.delenv(name, raising=False)
    default = AppConfig.from_env()
    assert default.cors_origins == DEFAULT_CORS_ORIGINS and default.max_workers == 2

    monkeypatch.setenv("UNLOCK_DATA_DIR", str(tmp_path / "Meus Dados"))
    monkeypatch.setenv("UNLOCK_FRONTEND_DIST", str(tmp_path / "dist"))
    monkeypatch.setenv("UNLOCK_CORS_ORIGINS", "http://a.local:5173, ,http://b.local")
    monkeypatch.setenv("UNLOCK_MAX_WORKERS", "0")
    config = AppConfig.from_env()
    assert config.data_dir == (tmp_path / "Meus Dados").resolve()
    assert config.frontend_dist == tmp_path / "dist"
    assert config.cors_origins == ("http://a.local:5173", "http://b.local")
    assert config.max_workers == 1  # mínimo
    config.ensure_dirs()
    assert all(p.is_dir() for p in (config.projects_dir, config.tmp_dir, config.models_dir))

    monkeypatch.setenv("UNLOCK_MAX_WORKERS", "dois")
    with pytest.raises(ValueError, match="UNLOCK_MAX_WORKERS"):
        AppConfig.from_env()
