from __future__ import annotations

import shutil
import subprocess
import time
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app

# Cabeçalho mínimo de um MP4 (caixa "ftyp") seguido de dados de preenchimento.
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
MKV_HEADER = b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\xf7\x81\x01"
AVI_HEADER = b"RIFF\x00\x00\x00\x00AVI LIST"


def fake_video(size: int = 300_000, header: bytes = MP4_HEADER) -> bytes:
    filler = bytes(range(256)) * (size // 256 + 1)
    return (header + filler)[:size]


HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
requires_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="FFmpeg/FFprobe não encontrados no PATH")


def _generate(path: Path, *args: str) -> Path:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, str(path)]
    subprocess.run(cmd, check=True, timeout=120)
    return path


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory) -> Path:
    """Vídeos reais e pequenos gerados com o FFmpeg (codecs internos, sem dependências extras)."""
    if not HAS_FFMPEG:
        pytest.skip("FFmpeg/FFprobe não encontrados no PATH")
    folder = tmp_path_factory.mktemp("media")
    video = ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=15:duration=3"]
    audio = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3"]
    _generate(folder / "sample.mp4", *video, *audio, "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-shortest")
    _generate(folder / "sample.mkv", *video, *audio, "-c:v", "mpeg4", "-c:a", "aac", "-shortest")
    _generate(folder / "silent.mp4", *video, "-c:v", "mpeg4")
    _generate(folder / "audio_only.mp4", *audio, "-c:a", "aac")
    return folder


@pytest.fixture(scope="session")
def real_video(media_dir) -> bytes:
    """MP4 real de 3 s com vídeo 160x120 e áudio estéreo 44,1 kHz."""
    return (media_dir / "sample.mp4").read_bytes()


@pytest.fixture
def config(tmp_path) -> AppConfig:
    return AppConfig(
        data_dir=tmp_path / "data",
        frontend_dist=None,
        cors_origins=("http://localhost:5173",),
        max_workers=2,
        io_chunk_size=64 * 1024,
    )


class MockSource:
    """Substitui a internet nos testes: cada teste registra um handler httpx."""

    def __init__(self) -> None:
        self.handler: Callable[[httpx.Request], httpx.Response] = lambda request: httpx.Response(404)

    def factory(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(lambda r: self.handler(r)), follow_redirects=False)


@pytest.fixture
def mock_source() -> MockSource:
    return MockSource()


@pytest.fixture
def client(config, mock_source) -> Iterator[TestClient]:
    app = create_app(config, client_factory=mock_source.factory)
    with TestClient(app) as test_client:
        yield test_client


def wait_for_status(client: TestClient, project_id: str, statuses: set[str], timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    project: dict = {}
    while time.monotonic() < deadline:
        project = client.get(f"/api/projects/{project_id}").json()
        if project["status"] in statuses:
            return project
        time.sleep(0.02)
    raise AssertionError(f"Status esperado {statuses}, obtido {project.get('status')}: {project}")


def upload(client: TestClient, data: bytes, filename: str = "entrevista.mp4", **params) -> httpx.Response:
    return client.post(
        "/api/projects/upload",
        params={"filename": filename, **params},
        content=data,
        headers={"Content-Type": "video/mp4"},
    )
