from pathlib import Path

import pytest

from app.jobs import JobContext
from app.media import (
    InvalidVideo,
    check_extension,
    container_mismatch_warning,
    detect_container,
    sanitize_filename,
    verify_video_file,
)

from .conftest import AVI_HEADER, MKV_HEADER, MP4_HEADER, fake_video


def make_ctx(events: list | None = None, cancel=None) -> JobContext:
    import threading

    event = cancel or threading.Event()
    return JobContext("job", event, lambda p, m: events.append((p, m)) if events is not None else None)


@pytest.mark.parametrize(
    "header, expected",
    [(MP4_HEADER, "mp4"), (MKV_HEADER, "matroska"), (AVI_HEADER, "avi"), (b"\x00\x00\x00\x08moov1234", "mp4")],
)
def test_detect_container(header, expected):
    assert detect_container(header) == expected


@pytest.mark.parametrize("header", [b"", b"GIF89a", b"<html><body>", b"RIFF\x00\x00\x00\x00WAVEfmt "])
def test_detect_container_rejects_non_video(header):
    assert detect_container(header) is None


def test_sanitize_filename_strips_paths_and_reserved_chars():
    assert sanitize_filename(r"C:\Users\ana\Vídeos\podcast.mp4") == "podcast.mp4"
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename('ep:1 <final>?.mp4') == "ep_1 _final__.mp4"
    assert sanitize_filename("...") == "video"
    long = "a" * 300 + ".mp4"
    result = sanitize_filename(long)
    assert len(result) == 180 and result.endswith(".mp4")


def test_check_extension():
    assert check_extension("Aula.MP4") == ".mp4"
    assert check_extension("debate.webm") == ".webm"
    with pytest.raises(InvalidVideo, match="Formato não suportado"):
        check_extension("documento.pdf")
    with pytest.raises(InvalidVideo):
        check_extension("semextensao")


def test_container_mismatch_warning():
    assert container_mismatch_warning("video.mp4", "mp4") is None
    assert container_mismatch_warning("video.mov", "mp4") is None
    warning = container_mismatch_warning("video.mp4", "matroska")
    assert warning and "Matroska" in warning


def test_verify_video_file_reports_progress_and_hash(tmp_path: Path):
    import hashlib

    data = fake_video(500_000)
    path = tmp_path / "v.mp4"
    path.write_bytes(data)
    events: list = []
    container, size, sha = verify_video_file(path, make_ctx(events), chunk_size=10_000)
    assert container == "mp4"
    assert size == len(data)
    assert sha == hashlib.sha256(data).hexdigest()
    assert events[0][0] == 0.0 and events[-1][0] == 1.0
    progresses = [p for p, _ in events]
    assert progresses == sorted(progresses)


def test_verify_video_file_progress_range(tmp_path: Path):
    path = tmp_path / "v.mp4"
    path.write_bytes(fake_video(50_000))
    events: list = []
    verify_video_file(path, make_ctx(events), chunk_size=1000, progress_start=0.8, progress_end=1.0)
    assert all(0.8 <= p <= 1.0 for p, _ in events)


def test_verify_video_file_rejects_invalid(tmp_path: Path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"isto nao e um video" * 100)
    with pytest.raises(InvalidVideo, match="não corresponde"):
        verify_video_file(bad, make_ctx())
    empty = tmp_path / "empty.mp4"
    empty.write_bytes(b"")
    with pytest.raises(InvalidVideo, match="vazio"):
        verify_video_file(empty, make_ctx())
    with pytest.raises(InvalidVideo, match="não foi encontrado"):
        verify_video_file(tmp_path / "missing.mp4", make_ctx())
