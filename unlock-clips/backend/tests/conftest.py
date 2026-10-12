from __future__ import annotations

import time
from collections.abc import Callable, Iterator

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
