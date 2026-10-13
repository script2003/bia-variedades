"""Geração do vídeo final de um corte com o FFmpeg.

Um único comando faz tudo: corta o trecho, enquadra no formato escolhido (central ou
acompanhando o rosto), redimensiona (1080×1920, 1080×1080 ou 1920×1080), incorpora as
legendas (arquivo ASS via libass) e codifica em MP4 H.264 + AAC, compatível com
TikTok, Reels e Shorts. O progresso é real e o cancelamento encerra o FFmpeg.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .ffmpeg import _CREATION_FLAGS, FFmpegTools, MediaError, probe, run_ffmpeg
from .framing import (
    OUTPUT_SIZES,
    FaceDetector,
    FramingPlan,
    center_plan,
    choose_face,
    face_detection_status,
    face_plan,
    manual_plan,
    sample_frames,
)
from .jobs import JobContext
from .schemas import ClipSettings, FramingOverride, MediaInfo, SubtitleCueEdit, Transcript
from .subtitles import (
    TEMPLATES,
    Cue,
    SubtitleLayout,
    TextCue,
    build_cues,
    cues_from_text,
    layout_for,
    merge_edits,
    to_ass,
)

ASS_NAME = "legendas.ass"
MAX_FPS = 60


@lru_cache(maxsize=4)
def _encoders(ffmpeg: str) -> str:
    try:
        return subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20, creationflags=_CREATION_FLAGS
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def require_encoders(tools: FFmpegTools) -> None:
    available = _encoders(tools.ffmpeg)
    if " libx264 " not in available:
        raise MediaError(
            "Este FFmpeg não tem o codificador H.264 (libx264). Instale uma versão completa — no Windows, "
            "'winget install -e --id Gyan.FFmpeg' já inclui o libx264."
        )


def transcript_words(transcript: Transcript) -> list[tuple[float, float, str]]:
    words: list[tuple[float, float, str]] = []
    for segment in transcript.segments:
        if segment.words:
            words.extend((w.start, w.end, w.text) for w in segment.words)
        else:
            parts = segment.text.split()
            step = max(segment.end - segment.start, 0.01) / max(len(parts), 1)
            words.extend((segment.start + k * step, segment.start + (k + 1) * step, p) for k, p in enumerate(parts))
    return sorted(words)


@dataclass
class SubtitlePlan:
    cues: list[Cue]
    layout: SubtitleLayout
    template_key: str
    highlight: bool


def subtitle_layout(settings: ClipSettings) -> SubtitleLayout:
    width, height = OUTPUT_SIZES[settings.aspect_ratio]
    template = TEMPLATES[settings.subtitle_style]
    return layout_for(template, width, height, settings.subtitle_font_size, settings.subtitle_position)


def editable_cues(
    transcript: Transcript,
    start: float,
    end: float,
    settings: ClipSettings,
    edits: list[SubtitleCueEdit] | None = None,
) -> list[TextCue]:
    """Blocos de legenda do corte como texto (o que o editor mostra), com as edições aplicadas."""
    words = transcript_words(transcript)
    layout = subtitle_layout(settings)
    text_edits = [TextCue(e.start, e.end, e.text, e.hidden) for e in edits or []]
    return merge_edits(words, start, end, layout.max_chars, text_edits)


def plan_subtitles(
    transcript: Transcript,
    start: float,
    end: float,
    settings: ClipSettings,
    edits: list[SubtitleCueEdit] | None = None,
) -> SubtitlePlan:
    template = TEMPLATES[settings.subtitle_style]
    layout = subtitle_layout(settings)
    words = transcript_words(transcript)
    if edits is None:
        cues = build_cues(words, start, end, layout.max_chars, uppercase=template.uppercase)
    else:
        text_cues = editable_cues(transcript, start, end, settings, edits)
        cues = cues_from_text(text_cues, words, start, end, layout.max_chars, uppercase=template.uppercase)
    return SubtitlePlan(cues, layout, template.key, settings.highlight_current_word)


def requested_framing(settings: ClipSettings, override: FramingOverride | None) -> str:
    return override.mode if override is not None else settings.framing


def _source_size(media: MediaInfo) -> tuple[int, int]:
    if media.video is None:
        raise MediaError("O vídeo original não tem trilha de imagem.")
    return media.video.display_size


def _video_filter(plan: FramingPlan, size: tuple[int, int], fps: float | None, subtitles: bool) -> str:
    width, height = size
    steps = [plan.filter(), f"scale={width}:{height}:flags=lanczos", "setsar=1"]
    if fps and fps > MAX_FPS:
        steps.append(f"fps={MAX_FPS}")
    steps.append("format=yuv420p")
    if subtitles:
        steps.append(f"ass={ASS_NAME}")
    return ",".join(steps)


@dataclass
class RenderResult:
    width: int
    height: int
    duration: float
    size_bytes: int
    framing: str
    cue_count: int
    notes: list[str] = field(default_factory=list)


def render_clip(
    ctx: JobContext,
    tools: FFmpegTools,
    source: Path,
    media: MediaInfo,
    transcript: Transcript,
    start: float,
    end: float,
    settings: ClipSettings,
    output: Path,
    *,
    framing: FramingOverride | None = None,
    subtitle_edits: list[SubtitleCueEdit] | None = None,
    progress_start: float = 0.0,
    progress_end: float = 1.0,
) -> RenderResult:
    require_encoders(tools)
    src_w, src_h = _source_size(media)
    duration = end - start
    span = progress_end - progress_start
    mode = requested_framing(settings, framing)
    framing_end = progress_start + (span * 0.25 if mode == "rosto" else 0.0)

    if mode == "rosto":
        plan = face_plan(ctx, tools, source, start, duration, src_w, src_h, settings.aspect_ratio,
                         progress_start=progress_start, progress_end=framing_end)  # fmt: skip
    elif mode == "manual" and framing is not None:
        plan = manual_plan(src_w, src_h, settings.aspect_ratio, framing.x, framing.y, framing.zoom)
    else:
        plan = center_plan(src_w, src_h, settings.aspect_ratio)
    subtitles = plan_subtitles(transcript, start, end, settings, subtitle_edits)
    audio = media.preferred_audio()

    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(f"{output.stem}.part{output.suffix}")
    with tempfile.TemporaryDirectory(prefix="unlock-render-") as work:
        work_dir = Path(work)
        has_subtitles = bool(subtitles.cues)
        if has_subtitles:
            ass = to_ass(subtitles.cues, TEMPLATES[subtitles.template_key], subtitles.layout, highlight_words=subtitles.highlight)
            (work_dir / ASS_NAME).write_text(ass, encoding="utf-8")
        size = OUTPUT_SIZES[settings.aspect_ratio]
        fps = media.video.fps if media.video else None
        args = [
            "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
            "-filter_complex", f"[0:v]{_video_filter(plan, size, fps, has_subtitles)}[v]",
            "-map", "[v]",
        ]  # fmt: skip
        if audio is not None:
            args += ["-map", f"0:{audio.index}", "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"]
        args += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
            "-movflags", "+faststart", "-metadata", "comment=Gerado pelo UNLOCK CLIPS",
            str(partial.resolve()),
        ]  # fmt: skip
        try:
            run_ffmpeg(ctx, tools, args, duration=duration, progress_start=framing_end, progress_end=progress_end,
                       message="Gerando vídeo com legendas", cwd=work_dir)  # fmt: skip
            os.replace(partial, output)
        finally:
            partial.unlink(missing_ok=True)

    info = probe(tools, output)
    notes = list(plan.notes)
    if not subtitles.cues:
        notes.append("Não há fala transcrita neste trecho: o vídeo foi gerado sem legendas.")
    return RenderResult(
        width=size[0],
        height=size[1],
        duration=info.duration_seconds,
        size_bytes=output.stat().st_size,
        framing=plan.mode,
        cue_count=len(subtitles.cues),
        notes=notes,
    )


def _single_frame_plan(
    tools: FFmpegTools, source: Path, at: float, src_w: int, src_h: int, aspect: str
) -> FramingPlan:
    """Enquadramento por rosto avaliado em um único quadro (prévia rápida)."""
    available, reason = face_detection_status()
    if not available:
        return center_plan(src_w, src_h, aspect, f"Acompanhamento de rosto indisponível: {reason}")
    plan = center_plan(src_w, src_h, aspect)
    if plan.crop_w >= src_w:
        return plan
    from .jobs import JobContext as _Ctx
    import threading

    ctx = _Ctx("preview", threading.Event(), lambda p, m: None)
    for _t, frame, width, height in sample_frames(ctx, tools, source, at, 0.5, src_w, src_h):
        center = choose_face(FaceDetector(width, height).faces(frame), None)
        if center is not None:
            x = min(max(center * src_w / width - plan.crop_w / 2, 0), src_w - plan.crop_w)
            plan.mode, plan.x = "rosto", x
        else:
            plan.notes.append("Nenhum rosto neste quadro: prévia com enquadramento central.")
        break
    return plan


def render_frame(
    tools: FFmpegTools,
    source: Path,
    media: MediaInfo,
    transcript: Transcript,
    start: float,
    end: float,
    settings: ClipSettings,
    at: float,
    *,
    framing: FramingOverride | None = None,
    subtitle_edits: list[SubtitleCueEdit] | None = None,
    plan: FramingPlan | None = None,
) -> bytes:
    """Gera um JPEG do quadro em ``at`` segundos do corte, exatamente como no vídeo final.

    ``plan`` permite reutilizar um enquadramento já calculado (ex.: o acompanhamento de rosto).
    """
    src_w, src_h = _source_size(media)
    at = min(max(at, 0.0), max(end - start - 0.05, 0.0))
    mode = requested_framing(settings, framing)
    if plan is not None:
        plan = FramingPlan(plan.mode, plan.crop_w, plan.crop_h, plan.x_at(at), plan.y)
    elif mode == "rosto":
        plan = _single_frame_plan(tools, source, start + at, src_w, src_h, settings.aspect_ratio)
    elif mode == "manual" and framing is not None:
        plan = manual_plan(src_w, src_h, settings.aspect_ratio, framing.x, framing.y, framing.zoom)
    else:
        plan = center_plan(src_w, src_h, settings.aspect_ratio)
    subtitles = plan_subtitles(transcript, start, end, settings, subtitle_edits)
    with tempfile.TemporaryDirectory(prefix="unlock-frame-") as work:
        work_dir = Path(work)
        has_subtitles = bool(subtitles.cues)
        if has_subtitles:
            ass = to_ass(subtitles.cues, TEMPLATES[subtitles.template_key], subtitles.layout,
                         highlight_words=subtitles.highlight, time_offset=-at)  # fmt: skip
            (work_dir / ASS_NAME).write_text(ass, encoding="utf-8")
        size = OUTPUT_SIZES[settings.aspect_ratio]
        cmd = [
            tools.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
            "-ss", f"{start + at:.3f}", "-i", str(source), "-frames:v", "1",
            "-filter_complex", f"[0:v]{_video_filter(plan, size, None, has_subtitles)}[v]", "-map", "[v]",
            "-f", "image2", "-c:v", "mjpeg", "-q:v", "3", "pipe:1",
        ]  # fmt: skip
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=60, cwd=work_dir, creationflags=_CREATION_FLAGS)
        except subprocess.TimeoutExpired as exc:
            raise MediaError("O FFmpeg demorou demais para gerar a prévia.") from exc
    if result.returncode != 0 or not result.stdout:
        detail = result.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [f"código {result.returncode}"]
        raise MediaError(f"Não foi possível gerar a prévia: {detail[0]}")
    return result.stdout


def ffmpeg_available_for_render() -> bool:
    return shutil.which("ffmpeg") is not None
