import subprocess
import threading
from pathlib import Path

import pytest

from app.ffmpeg import find_tools
from app.framing import (
    FramingPlan,
    center_plan,
    choose_face,
    crop_size,
    face_detection_status,
    face_plan,
    manual_plan,
    simplify,
    smooth_track,
)
from app.jobs import JobContext

from .conftest import requires_ffmpeg

ASSETS = Path(__file__).parent / "assets"


def ctx() -> JobContext:
    return JobContext("j", threading.Event(), lambda p, m: None)


def test_crop_sizes():
    assert crop_size(1280, 720, "9:16") == (404, 720)  # 405 arredondado para par
    assert crop_size(1920, 1080, "9:16") == (608, 1080)
    assert crop_size(1920, 1080, "1:1") == (1080, 1080)
    assert crop_size(1920, 1080, "16:9") == (1920, 1080)
    assert crop_size(1080, 1920, "9:16") == (1080, 1920)
    assert crop_size(1080, 1920, "16:9") == (1080, 608)


def test_center_plan_and_expression():
    plan = center_plan(1920, 1080, "9:16")
    assert (plan.x, plan.y, plan.mode) == (656, 0, "centro")
    assert plan.filter() == "crop=w=608:h=1080:x='656':y=0"
    moving = FramingPlan("rosto", 608, 1080, 100, 0, keyframes=[(0, 100), (2, 300), (4, 300)])
    assert moving.x_at(1) == 200 and moving.x_at(10) == 300
    expr = moving.x_expression()
    assert expr.count("gte(t,") == 1 and expr.count("lt(t,") == 1


def test_simplify_keeps_only_needed_points():
    line = [(t, 10.0 * t) for t in range(10)]
    assert simplify(line, 1) == [line[0], line[-1]]
    corner = [(0, 0.0), (1, 0.0), (2, 0.0), (3, 50.0), (4, 100.0)]
    assert (2, 0.0) in simplify(corner, 1)


def test_smooth_track_ignores_jitter_and_follows_movement():
    times = [t / 2 for t in range(40)]
    jitter = [960 + (15 if k % 2 else -15) for k in range(40)]
    still = smooth_track(times, jitter, 608, 1920)
    assert len(still) == 2 and still[0][1] == still[1][1]  # câmera parada apesar do tremor
    assert abs(still[0][1] - (960 - 304)) <= 15
    moving = smooth_track(times, [400 + 30 * k for k in range(40)], 608, 1920)
    xs = [x for _, x in moving]
    assert xs == sorted(xs) and xs[-1] > xs[0] + 500
    assert all(0 <= x <= 1920 - 608 for x in xs)
    gaps = smooth_track(times, [None] * 5 + [1000.0] * 35, 608, 1920)
    assert gaps[0][1] == pytest.approx(1000 - 304)


def test_choose_face_prefers_largest_then_nearest():
    faces = [(100, 0, 50, 50, 0.9), (800, 0, 60, 60, 0.9), (400, 0, 10, 10, 0.9)]
    assert choose_face(faces, None) == 830
    assert choose_face(faces, 120) == 125  # mantém o rosto que já estava sendo seguido
    assert choose_face([], 100) is None


def test_face_detector_finds_the_astronaut():
    available, reason = face_detection_status()
    assert available, reason
    import cv2

    from app.framing import FaceDetector

    image = cv2.imread(str(ASSETS / "astronaut.jpg"))
    faces = FaceDetector(image.shape[1], image.shape[0]).faces(image)
    assert len(faces) == 1
    x, y, w, h, score = faces[0]
    assert 100 < x + w / 2 < 160 and score > 0.8


@pytest.fixture(scope="module")
def moving_face_video(tmp_path_factory):
    """Fundo 1280×720 com a foto da astronauta atravessando da esquerda para a direita."""
    path = tmp_path_factory.mktemp("faces") / "moving.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "color=c=0x334455:s=1280x720:r=25:d=10",
         "-loop", "1", "-i", str(ASSETS / "astronaut.jpg"),
         "-filter_complex", "[1:v]scale=240:240[a];[0:v][a]overlay=x='100+t*80':y=240:shortest=1",
         "-t", "10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )  # fmt: skip
    return path


@requires_ffmpeg
def test_face_plan_follows_the_moving_face(moving_face_video):
    plan = face_plan(ctx(), find_tools(None), moving_face_video, 0, 10, 1280, 720, "9:16")
    assert plan.mode == "rosto" and plan.face_coverage > 0.8
    # Rosto: centro em 100 + 120 + 80t (no vídeo de 1280 px).
    for t in (1, 5, 8.5):
        face_center = 220 + 80 * t
        crop_center = plan.x_at(t) + plan.crop_w / 2
        assert abs(crop_center - face_center) < 0.25 * plan.crop_w, (t, crop_center, face_center)


@requires_ffmpeg
def test_face_plan_falls_back_to_center_without_faces(tmp_path):
    video = tmp_path / "noface.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=640x360:r=10:d=4",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )  # fmt: skip
    plan = face_plan(ctx(), find_tools(None), video, 0, 4, 640, 360, "9:16")
    assert plan.mode == "centro" and "enquadramento central" in plan.notes[0]
    vertical = face_plan(ctx(), find_tools(None), video, 0, 4, 360, 640, "9:16")
    assert vertical.mode == "centro" and vertical.notes == []  # já ocupa a largura toda


def test_manual_plan_position_and_zoom():
    left = manual_plan(1920, 1080, "9:16", 0.0, 0.5, 1.0)
    assert (left.mode, left.crop_w, left.crop_h, left.x, left.y) == ("manual", 608, 1080, 0, 0)
    right = manual_plan(1920, 1080, "9:16", 1.0, 0.5, 1.0)
    assert right.x == 1920 - 608
    zoomed = manual_plan(1920, 1080, "9:16", 0.5, 0.0, 2.0)
    assert (zoomed.crop_w, zoomed.crop_h) == (304, 540) and zoomed.y == 0
    assert zoomed.x == round((1920 - 304) * 0.5)
    assert zoomed.filter() == "crop=w=304:h=540:x='808':y=0"
    assert zoomed.notes and "desfocada" in zoomed.notes[0]  # 304 px ampliados para 1080 px
    assert manual_plan(1920, 1080, "9:16", 0.5, 0.5, 1.2).notes == []
    # Valores fora da faixa são limitados.
    assert manual_plan(1920, 1080, "9:16", 2.0, -1.0, 9.0).x == 1920 - manual_plan(1920, 1080, "9:16", 0, 0, 3).crop_w
