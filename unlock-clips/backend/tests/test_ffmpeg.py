import os
import threading
import time
import wave

import pytest

from app import ffmpeg
from app.ffmpeg import (
    FFmpegNotFound,
    MediaError,
    extract_audio,
    find_tools,
    make_thumbnail,
    parse_probe,
    parse_progress_seconds,
    probe,
    require_processable,
    run_ffmpeg,
)
from app.jobs import JobCancelled, JobContext
from app.schemas import AudioStreamInfo, MediaInfo, VideoStreamInfo

from .conftest import requires_ffmpeg


def make_ctx(events=None, cancel=None) -> JobContext:
    return JobContext("job", cancel or threading.Event(), lambda p, m: events.append((p, m)) if events is not None else None)


PROBE_SAMPLE = {
    "streams": [
        {"index": 0, "codec_type": "video", "codec_name": "mjpeg", "width": 300, "height": 300,
         "disposition": {"attached_pic": 1}},
        {"index": 1, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
         "avg_frame_rate": "30000/1001", "r_frame_rate": "30000/1001", "duration": "61.2",
         "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}]},
        {"index": 2, "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2,
         "tags": {"language": "eng"}, "disposition": {"default": 0}},
        {"index": 3, "codec_type": "audio", "codec_name": "opus", "sample_rate": "48000", "channels": 2,
         "tags": {"language": "por"}, "disposition": {"default": 1}},
    ],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "61.250000", "bit_rate": "5000000"},
}  # fmt: skip


def test_parse_probe_extracts_streams():
    media = parse_probe(PROBE_SAMPLE)
    assert media.duration_seconds == 61.25
    assert media.bit_rate == 5_000_000
    assert media.video is not None
    assert (media.video.index, media.video.codec, media.video.fps) == (1, "h264", 29.97)
    assert media.video.rotation == 90
    assert media.video.display_size == (1080, 1920)
    assert [a.index for a in media.audio_streams] == [2, 3]
    assert media.preferred_audio().language == "por"


def test_parse_probe_fallbacks():
    data = {
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "vp9", "width": 640, "height": 360,
             "avg_frame_rate": "0/0", "r_frame_rate": "25/1", "tags": {"rotate": "180"}, "duration": "12.5"},
            {"index": 1, "codec_type": "audio", "codec_name": "opus", "duration": "12.4"},
        ],
        "format": {"format_name": "matroska,webm"},
    }  # fmt: skip
    media = parse_probe(data)
    assert media.duration_seconds == 12.5
    assert media.video.fps == 25.0 and media.video.rotation == 180
    assert media.video.display_size == (640, 360)
    assert media.preferred_audio().index == 1
    assert parse_probe({}).duration_seconds == 0


def test_require_processable():
    video = VideoStreamInfo(index=0, codec="h264", width=10, height=10)
    audio = AudioStreamInfo(index=1, codec="aac")
    assert require_processable(MediaInfo(duration_seconds=5, format_name="mp4", video=video, audio_streams=[audio])) == audio
    with pytest.raises(MediaError, match="trilha de vídeo"):
        require_processable(MediaInfo(duration_seconds=5, format_name="mp4", audio_streams=[audio]))
    with pytest.raises(MediaError, match="trilha de áudio"):
        require_processable(MediaInfo(duration_seconds=5, format_name="mp4", video=video))
    with pytest.raises(MediaError, match="duração"):
        require_processable(MediaInfo(duration_seconds=0, format_name="mp4", video=video, audio_streams=[audio]))


def test_parse_progress_seconds():
    assert parse_progress_seconds("out_time_us=1500000\n") == 1.5
    assert parse_progress_seconds("out_time_ms=2000000") == 2.0
    assert parse_progress_seconds("out_time_us=N/A") is None
    assert parse_progress_seconds("progress=continue") is None


def test_find_tools_in_configured_dir(tmp_path):
    exe = ".exe" if os.name == "nt" else ""
    bin_dir = tmp_path / "ffmpeg" / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / f"ffmpeg{exe}").write_text("")
    (bin_dir / f"ffprobe{exe}").write_text("")
    tools = find_tools(str(tmp_path / "ffmpeg"))  # aceita a pasta raiz ou a pasta bin
    assert tools.ffmpeg == str(bin_dir / f"ffmpeg{exe}")
    with pytest.raises(FFmpegNotFound, match="pasta configurada"):
        find_tools(str(tmp_path / "vazia"))


def test_find_tools_missing_from_path(monkeypatch):
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: None)
    with pytest.raises(FFmpegNotFound, match="winget install"):
        find_tools(None)


# ------------------------------------------------------------- FFmpeg real


@requires_ffmpeg
def test_probe_real_files(media_dir):
    tools = find_tools(None)
    media = probe(tools, media_dir / "sample.mp4")
    assert 2.9 <= media.duration_seconds <= 3.2
    assert (media.video.width, media.video.height) == (160, 120)
    assert media.audio_streams[0].sample_rate == 44100
    assert probe(tools, media_dir / "silent.mp4").audio_streams == []
    assert probe(tools, media_dir / "audio_only.mp4").video is None


@requires_ffmpeg
def test_probe_rejects_corrupted_file(tmp_path):
    bad = tmp_path / "ruim.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 5000)
    with pytest.raises(MediaError, match="FFprobe não conseguiu ler"):
        probe(find_tools(None), bad)


@requires_ffmpeg
def test_extract_audio_and_thumbnail(media_dir, tmp_path):
    tools = find_tools(None)
    media = probe(tools, media_dir / "sample.mp4")
    events: list = []
    audio = extract_audio(make_ctx(events), tools, media_dir / "sample.mp4", tmp_path / "audio.wav", media,
                          progress_start=0.3, progress_end=1.0)  # fmt: skip
    with wave.open(str(tmp_path / "audio.wav")) as wav:
        assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (1, 16000, 2)
        assert 2.9 <= wav.getnframes() / 16000 <= 3.2
    assert audio.size_bytes == (tmp_path / "audio.wav").stat().st_size
    assert 2.9 <= audio.duration_seconds <= 3.2
    assert all(0.3 <= p <= 1.0 for p, _ in events) and events[-1][0] == 1.0
    assert not list(tmp_path.glob("*.part*"))

    make_thumbnail(make_ctx(), tools, media_dir / "sample.mp4", tmp_path / "thumb.jpg", media)
    assert (tmp_path / "thumb.jpg").read_bytes()[:2] == b"\xff\xd8"


@requires_ffmpeg
def test_run_ffmpeg_reports_failures(tmp_path):
    with pytest.raises(MediaError, match="O FFmpeg falhou"):
        run_ffmpeg(make_ctx(), find_tools(None), ["-i", str(tmp_path / "inexistente.mp4"), str(tmp_path / "o.wav")])


@requires_ffmpeg
def test_run_ffmpeg_cancellation_kills_process():
    """Um FFmpeg em tempo real (-re) de 30 s deve parar logo após o cancelamento."""
    cancel = threading.Event()
    events: list = []
    ctx = make_ctx(events, cancel)
    args = ["-re", "-f", "lavfi", "-i", "sine=duration=30", "-f", "null", "-"]
    timer = threading.Timer(1.0, lambda: (cancel.set(), ctx._kill_processes()))
    timer.start()
    started = time.monotonic()
    with pytest.raises(JobCancelled):
        run_ffmpeg(ctx, find_tools(None), args, duration=30, message="teste")
    assert time.monotonic() - started < 10
    assert any(p and p > 0 for p, _ in events), "o progresso real deveria ter avançado antes do cancelamento"
