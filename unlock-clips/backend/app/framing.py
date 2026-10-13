"""Enquadramento dos cortes nos formatos 9:16, 1:1 e 16:9.

* **Central**: recorte fixo no centro do quadro (preenche todo o formato de saída).
* **Posição fixa (manual)**: o usuário escolhe no editor a posição horizontal/vertical do
  recorte e um zoom de até 3×.
* **Acompanhar rosto**: amostra 2 quadros por segundo, detecta rostos com o modelo
  YuNet (OpenCV, incluído no projeto, funciona offline) e move uma "câmera virtual"
  horizontal suave: só se desloca quando o rosto sai da zona central, sem tremer.
  Se nenhum rosto for encontrado na maior parte do trecho, volta ao enquadramento
  central e avisa o usuário.

A posição do recorte ao longo do tempo é enviada ao FFmpeg como uma expressão do
filtro ``crop`` (interpolação linear entre pontos-chave já simplificados).
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .ffmpeg import _CREATION_FLAGS, FFmpegTools, MediaError
from .jobs import JobContext

logger = logging.getLogger(__name__)

OUTPUT_SIZES: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}
FACE_MODEL = Path(__file__).resolve().parent / "assets" / "face_detection_yunet_2023mar.onnx"
SAMPLE_FPS = 2.0
SAMPLE_WIDTH = 480
MIN_FACE_COVERAGE = 0.3  # fração mínima de amostras com rosto para usar o acompanhamento
DEAD_ZONE = 0.12  # fração da largura do recorte em que a câmera não se mexe
FOLLOW = 0.5  # quanto a câmera se aproxima do rosto a cada amostra (0..1)
SIMPLIFY_PX = 4.0


def _even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def crop_size(src_w: int, src_h: int, aspect: str) -> tuple[int, int]:
    """Maior recorte com a proporção de saída que cabe no quadro original."""
    out_w, out_h = OUTPUT_SIZES[aspect]
    ratio = out_w / out_h
    if src_w / src_h > ratio:
        return min(src_w, _even(src_h * ratio)), src_h - src_h % 2
    return src_w - src_w % 2, min(src_h, _even(src_w / ratio))


@dataclass
class FramingPlan:
    mode: str  # "centro", "rosto" ou "manual" (o que foi efetivamente usado)
    crop_w: int
    crop_h: int
    x: float  # posição fixa (quando não há pontos-chave)
    y: int
    keyframes: list[tuple[float, float]] = field(default_factory=list)  # (tempo relativo, x)
    notes: list[str] = field(default_factory=list)
    face_coverage: float | None = None

    def x_at(self, t: float) -> float:
        if not self.keyframes:
            return self.x
        times = [k[0] for k in self.keyframes]
        return float(np.interp(t, times, [k[1] for k in self.keyframes]))

    def x_expression(self) -> str:
        """Expressão do FFmpeg para a posição horizontal do recorte em função de ``t``."""
        if len(self.keyframes) < 2:
            return str(round(self.x_at(0)))
        terms: list[str] = []
        pairs = list(zip(self.keyframes, self.keyframes[1:]))
        for index, ((t0, x0), (t1, x1)) in enumerate(pairs):
            slope = (x1 - x0) / (t1 - t0)
            lower = "1" if index == 0 else f"gte(t,{t0:.3f})"
            upper = f"lt(t,{t1:.3f})" if index < len(pairs) - 1 else "1"
            terms.append(f"{lower}*{upper}*({x0:.1f}+({slope:.3f})*(t-{t0:.3f}))")
        return "+".join(terms)

    def filter(self) -> str:
        x = self.x_expression()
        return f"crop=w={self.crop_w}:h={self.crop_h}:x='{x}':y={self.y}"


def center_plan(src_w: int, src_h: int, aspect: str, note: str | None = None) -> FramingPlan:
    cw, ch = crop_size(src_w, src_h, aspect)
    return FramingPlan(mode="centro", crop_w=cw, crop_h=ch, x=(src_w - cw) // 2, y=(src_h - ch) // 2, notes=[note] if note else [])


def manual_plan(src_w: int, src_h: int, aspect: str, x: float, y: float, zoom: float) -> FramingPlan:
    """Recorte fixo na posição escolhida pelo usuário (``x``/``y`` de 0 a 1 no espaço livre)."""
    base_w, base_h = crop_size(src_w, src_h, aspect)
    zoom = min(max(zoom, 1.0), 3.0)
    cw = min(base_w, _even(base_w / zoom))
    ch = min(base_h, _even(base_h / zoom))
    px = round((src_w - cw) * min(max(x, 0.0), 1.0))
    py = round((src_h - ch) * min(max(y, 0.0), 1.0))
    notes: list[str] = []
    out_w = OUTPUT_SIZES[aspect][0]
    if cw * 2.5 < out_w:
        notes.append(
            f"Zoom alto: o recorte tem só {cw}×{ch} px do vídeo original e será ampliado para o formato final, "
            "o que pode deixar a imagem desfocada."
        )
    return FramingPlan(mode="manual", crop_w=cw, crop_h=ch, x=px, y=py, notes=notes)


# ---------------------------------------------------------------------- detecção de rostos


class FaceDetector:
    """Detector YuNet do OpenCV (opcional: sem OpenCV, o enquadramento central é usado)."""

    def __init__(self, width: int, height: int, threshold: float = 0.7) -> None:
        import cv2

        try:  # silencia avisos de backend do OpenCV 5
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
        except AttributeError:
            pass
        self._cv2 = cv2
        self._detector = cv2.FaceDetectorYN.create(str(FACE_MODEL), "", (width, height), threshold, 0.3, 5000)

    def faces(self, frame_bgr: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        """Retorna (x, y, largura, altura, confiança) de cada rosto encontrado."""
        _count, faces = self._detector.detect(frame_bgr)
        if faces is None:
            return []
        return [(float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])) for f in faces]


def face_detection_status() -> tuple[bool, str | None]:
    if not FACE_MODEL.is_file():
        return False, "Modelo de detecção de rostos não encontrado (app/assets)."
    try:
        import cv2

        cv2.FaceDetectorYN  # noqa: B018
    except (ImportError, AttributeError) as exc:
        return False, f"OpenCV indisponível ({exc}). Rode: pip install -r requirements.txt"
    return True, None


def choose_face(faces: list[tuple[float, float, float, float, float]], previous: float | None) -> float | None:
    """Centro horizontal do rosto principal: o maior, preferindo o mais próximo do anterior."""
    if not faces:
        return None
    largest = max(f[2] * f[3] for f in faces)
    candidates = [f for f in faces if f[2] * f[3] >= 0.5 * largest]
    if previous is not None:
        best = min(candidates, key=lambda f: abs(f[0] + f[2] / 2 - previous))
    else:
        best = max(candidates, key=lambda f: f[2] * f[3])
    return best[0] + best[2] / 2


def smooth_track(times: list[float], centers: list[float | None], crop_w: int, src_w: int) -> list[tuple[float, float]]:
    """Converte os centros detectados em posições de recorte suaves (pontos-chave simplificados)."""
    known = [c for c in centers if c is not None]
    values: list[float] = []
    last = known[0] if known else src_w / 2
    for c in centers:  # preenche falhas de detecção com o último valor conhecido
        last = c if c is not None else last
        values.append(last)
    # Filtro de mediana (janela 5) remove detecções isoladas erradas.
    padded = [values[0]] * 2 + values + [values[-1]] * 2
    medians = [float(np.median(padded[i : i + 5])) for i in range(len(values))]
    camera = medians[0]
    dead = DEAD_ZONE * crop_w
    positions: list[tuple[float, float]] = []
    for t, target in zip(times, medians):
        if abs(target - camera) > dead:
            camera += (target - camera) * FOLLOW
        x = min(max(camera - crop_w / 2, 0.0), float(src_w - crop_w))
        positions.append((t, x))
    return simplify(positions, SIMPLIFY_PX)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer–Douglas–Peucker: mantém só os pontos necessários para a curva (expressão menor)."""
    if len(points) < 3:
        return points
    (t0, x0), (t1, x1) = points[0], points[-1]
    worst, index = 0.0, 0
    for k in range(1, len(points) - 1):
        t, x = points[k]
        expected = x0 + (x1 - x0) * (t - t0) / (t1 - t0) if t1 != t0 else x0
        error = abs(x - expected)
        if error > worst:
            worst, index = error, k
    if worst <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def sample_frames(
    ctx: JobContext, tools: FFmpegTools, source: Path, start: float, duration: float, src_w: int, src_h: int
):
    """Gera (tempo relativo, quadro BGR reduzido) com o FFmpeg, sem gravar arquivos."""
    width = SAMPLE_WIDTH if src_w > SAMPLE_WIDTH else src_w - src_w % 2
    height = _even(width * src_h / src_w)
    cmd = [
        tools.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
        "-vf", f"fps={SAMPLE_FPS},scale={width}:{height}", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ]  # fmt: skip
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=_CREATION_FLAGS)
    ctx.register_process(process)
    frame_size = width * height * 3
    index = 0
    assert process.stdout is not None
    try:
        while True:
            data = process.stdout.read(frame_size)
            if len(data) < frame_size:
                break
            yield index / SAMPLE_FPS, np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3), width, height
            index += 1
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()


def face_plan(
    ctx: JobContext,
    tools: FFmpegTools,
    source: Path,
    start: float,
    duration: float,
    src_w: int,
    src_h: int,
    aspect: str,
    *,
    progress_start: float = 0.0,
    progress_end: float = 1.0,
) -> FramingPlan:
    cw, ch = crop_size(src_w, src_h, aspect)
    if cw >= src_w:
        # O recorte ocupa toda a largura (ex.: vídeo vertical para 9:16): nada a acompanhar.
        return center_plan(src_w, src_h, aspect)
    available, reason = face_detection_status()
    if not available:
        return center_plan(src_w, src_h, aspect, f"Acompanhamento de rosto indisponível: {reason} Enquadramento central usado.")

    detector: FaceDetector | None = None
    times: list[float] = []
    centers: list[float | None] = []
    previous: float | None = None
    expected = max(1, int(duration * SAMPLE_FPS))
    span = progress_end - progress_start
    for t, frame, width, height in sample_frames(ctx, tools, source, start, duration, src_w, src_h):
        if detector is None:
            detector = FaceDetector(width, height)
        center = choose_face(detector.faces(frame), None if previous is None else previous * width / src_w)
        center_src = None if center is None else center * src_w / width
        if center_src is not None:
            previous = center_src
        times.append(t)
        centers.append(center_src)
        ctx.progress(progress_start + span * min(1.0, len(times) / expected), "Procurando rostos")
    ctx.check_cancelled()
    if not times:
        raise MediaError("Não foi possível ler os quadros do vídeo para o enquadramento.")

    coverage = sum(c is not None for c in centers) / len(centers)
    if coverage < MIN_FACE_COVERAGE:
        plan = center_plan(
            src_w, src_h, aspect, f"Rosto encontrado em só {round(coverage * 100)}% do trecho: enquadramento central usado."
        )
        plan.face_coverage = coverage
        return plan
    keyframes = smooth_track(times, centers, cw, src_w)
    return FramingPlan(
        mode="rosto",
        crop_w=cw,
        crop_h=ch,
        x=keyframes[0][1],
        y=(src_h - ch) // 2,
        keyframes=keyframes if len(keyframes) > 1 else [],
        face_coverage=coverage,
    )
