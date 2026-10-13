import subprocess
import threading

import numpy as np
import pytest

from app import render as render_module
from app.ffmpeg import MediaError, find_tools, probe
from app.jobs import JobCancelled, JobContext
from app.render import render_clip, render_frame
from app.schemas import ClipSettings, Transcript

from .clip_fixtures import QA, make_transcript
from .conftest import requires_ffmpeg
from .test_framing import moving_face_video  # noqa: F401 - fixture reutilizada

pytestmark = requires_ffmpeg


def ctx(events=None, cancel=None):
    return JobContext("j", cancel or threading.Event(), lambda p, m: events.append((p, m)) if events is not None else None)


def frame_at(path, t: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    info = probe(find_tools(None), path)
    return np.frombuffer(out, dtype=np.uint8).reshape(info.video.height, info.video.width)


@pytest.fixture(scope="module")
def tools():
    return find_tools(None)


@pytest.fixture(scope="module")
def transcript():
    return make_transcript(QA, start=0.3)


@pytest.mark.parametrize("aspect, size", [("9:16", (1080, 1920)), ("1:1", (1080, 1080)), ("16:9", (1920, 1080))])
def test_render_formats(tmp_path, tools, transcript, moving_face_video, aspect, size):  # noqa: F811
    media = probe(tools, moving_face_video)
    events = []
    result = render_clip(ctx(events), tools, moving_face_video, media, transcript, 1.0, 7.0,
                         ClipSettings(aspect_ratio=aspect, framing="centro"), tmp_path / "out.mp4")  # fmt: skip
    info = probe(tools, tmp_path / "out.mp4")
    assert (info.video.width, info.video.height) == size == (result.width, result.height)
    assert info.video.codec == "h264" and info.duration_seconds == pytest.approx(6.0, abs=0.2)
    assert result.cue_count > 0 and result.framing == "centro"
    progress = [p for p, _ in events if p is not None]
    assert progress == sorted(progress) and progress[-1] == 1.0
    assert not list(tmp_path.glob("*.part*"))


def test_subtitles_are_burned_into_the_video(tmp_path, tools, transcript, moving_face_video):  # noqa: F811
    media = probe(tools, moving_face_video)
    settings = ClipSettings(aspect_ratio="9:16", subtitle_style="caixa", subtitle_position="inferior")
    render_clip(ctx(), tools, moving_face_video, media, transcript, 0, 6, settings, tmp_path / "com.mp4")
    empty = Transcript(model="m", language="pt", duration_seconds=10)
    result = render_clip(ctx(), tools, moving_face_video, media, empty, 0, 6, settings, tmp_path / "sem.mp4")
    assert result.cue_count == 0 and "sem legendas" in result.notes[0]
    with_subs, without = frame_at(tmp_path / "com.mp4", 2.0), frame_at(tmp_path / "sem.mp4", 2.0)
    band = slice(1920 - 384 - 260, 1920 - 384 + 20)  # área das legendas (margem inferior de 20%)
    assert np.abs(with_subs[band].astype(int) - without[band].astype(int)).mean() > 5
    top = slice(0, 300)
    assert np.abs(with_subs[top].astype(int) - without[top].astype(int)).mean() < 2


def test_face_framing_keeps_the_face_centered(tmp_path, tools, transcript, moving_face_video):  # noqa: F811
    media = probe(tools, moving_face_video)
    events = []
    result = render_clip(ctx(events), tools, moving_face_video, media, transcript, 0, 10,
                         ClipSettings(aspect_ratio="9:16", framing="rosto"), tmp_path / "rosto.mp4")  # fmt: skip
    assert result.framing == "rosto"
    assert any(m == "Procurando rostos" for _, m in events)
    import cv2

    from app.framing import FaceDetector

    for t in (1.5, 5.0, 8.5):
        gray = frame_at(tmp_path / "rosto.mp4", t)
        bgr = cv2.cvtColor(cv2.resize(gray, (540, 960)), cv2.COLOR_GRAY2BGR)
        faces = FaceDetector(540, 960, threshold=0.6).faces(bgr)
        assert faces, f"nenhum rosto visível em {t}s"
        x, _y, w, _h, _s = max(faces, key=lambda f: f[2] * f[3])
        assert abs((x + w / 2) - 270) < 540 * 0.25, (t, x + w / 2)


def test_preview_frame_matches_output_size(tools, transcript, moving_face_video):  # noqa: F811
    media = probe(tools, moving_face_video)
    jpeg = render_frame(tools, moving_face_video, media, transcript, 0, 8, ClipSettings(aspect_ratio="1:1", framing="rosto"), 2.0)
    assert jpeg[:2] == b"\xff\xd8"
    import cv2

    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert image.shape[:2] == (1080, 1080)


def test_cancel_stops_ffmpeg_and_removes_partial_file(tmp_path, tools, transcript, moving_face_video):  # noqa: F811
    media = probe(tools, moving_face_video)
    cancel = threading.Event()

    def report(progress, message):
        if progress and progress > 0.1:
            cancel.set()

    context = JobContext("j", cancel, report)
    with pytest.raises(JobCancelled):
        render_clip(context, tools, moving_face_video, media, transcript, 0, 10, ClipSettings(), tmp_path / "x.mp4")
    assert list(tmp_path.iterdir()) == []


def test_missing_h264_encoder_is_reported(tmp_path, tools, transcript, moving_face_video, monkeypatch):  # noqa: F811
    monkeypatch.setattr(render_module, "_encoders", lambda ffmpeg: " mpeg4 ")
    with pytest.raises(MediaError, match="libx264"):
        render_clip(ctx(), tools, moving_face_video, probe(tools, moving_face_video), transcript, 0, 2, ClipSettings(), tmp_path / "x.mp4")
