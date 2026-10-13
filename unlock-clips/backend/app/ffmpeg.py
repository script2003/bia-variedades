"""Integração com FFmpeg e FFprobe.

* ``find_tools`` localiza os executáveis (pasta configurada ou PATH);
* ``probe`` lê duração, trilhas e codecs com FFprobe;
* ``run_ffmpeg`` executa o FFmpeg com progresso real (``-progress pipe:1``) e
  cancelamento: o processo é registrado no ``JobContext`` e encerrado
  imediatamente quando o usuário cancela;
* ``extract_audio`` gera o WAV mono 16 kHz usado pela transcrição (Etapa 3);
* ``make_thumbnail`` gera a miniatura exibida na interface.

Todos os comandos são executados com lista de argumentos (sem shell), o que
evita problemas com espaços e acentos nos caminhos do Windows.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from collections import deque
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

from .jobs import JobContext, JobError
from .schemas import AudioInfo, AudioStreamInfo, MediaInfo, VideoStreamInfo

FFMPEG_MISSING_MESSAGE = (
    "FFmpeg não foi encontrado. No Windows, instale com "
    "'winget install -e --id Gyan.FFmpeg', feche e abra o terminal e reinicie o back-end — "
    "ou informe a pasta do FFmpeg em Configurações."
)

AUDIO_SAMPLE_RATE = 16_000
AUDIO_FILENAME = "audio.wav"
THUMBNAIL_FILENAME = "thumbnail.jpg"

# Evita que uma janela de console apareça para cada processo no Windows.
_CREATION_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


class FFmpegNotFound(JobError):
    pass


class MediaError(JobError):
    pass


@dataclass(frozen=True)
class FFmpegTools:
    ffmpeg: str
    ffprobe: str


def _executable(name: str) -> str:
    return f"{name}.exe" if os.name == "nt" else name


def find_tools(configured_dir: str | None) -> FFmpegTools:
    """Localiza ffmpeg e ffprobe. Lança ``FFmpegNotFound`` com instruções se faltarem."""
    if configured_dir:
        base = Path(configured_dir).expanduser()
        for folder in (base, base / "bin"):
            ffmpeg = folder / _executable("ffmpeg")
            ffprobe = folder / _executable("ffprobe")
            if ffmpeg.is_file() and ffprobe.is_file():
                return FFmpegTools(str(ffmpeg), str(ffprobe))
        raise FFmpegNotFound(
            f"ffmpeg e ffprobe não foram encontrados na pasta configurada ({base}). "
            "Corrija o caminho em Configurações ou deixe o campo vazio para usar o PATH do sistema."
        )
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    if not ffmpeg_path or not ffprobe_path:
        raise FFmpegNotFound(FFMPEG_MISSING_MESSAGE)
    return FFmpegTools(ffmpeg_path, ffprobe_path)


def tool_version(executable: str) -> str | None:
    try:
        result = subprocess.run(
            [executable, "-hide_banner", "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            creationflags=_CREATION_FLAGS,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    first_line = result.stdout.splitlines()[0] if result.stdout else ""
    return first_line.strip() or None


# ---------------------------------------------------------------------- FFprobe


def _parse_rate(value: Any) -> float | None:
    if not value or value in ("0/0", "N/A"):
        return None
    try:
        rate = float(Fraction(str(value)))
    except (ValueError, ZeroDivisionError):
        return None
    return round(rate, 3) if rate > 0 else None


def _parse_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number >= 0 else None  # descarta NaN


def _parse_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rotation(stream: dict[str, Any]) -> int:
    """Rotação de exibição em graus (sentido horário), comum em vídeos gravados no celular."""
    rotate = _parse_int((stream.get("tags") or {}).get("rotate"))
    if rotate is not None:
        return rotate % 360
    for side_data in stream.get("side_data_list") or []:
        if "rotation" in side_data:
            try:
                # A matriz de exibição usa o sentido anti-horário.
                return int(-round(float(side_data["rotation"]))) % 360
            except (TypeError, ValueError):
                continue
    return 0


def parse_probe(data: dict[str, Any]) -> MediaInfo:
    """Converte o JSON do FFprobe em ``MediaInfo``."""
    streams: list[dict[str, Any]] = data.get("streams") or []
    fmt: dict[str, Any] = data.get("format") or {}

    video: VideoStreamInfo | None = None
    audio_streams: list[AudioStreamInfo] = []
    durations: list[float] = []
    for stream in streams:
        kind = stream.get("codec_type")
        disposition = stream.get("disposition") or {}
        duration = _parse_float(stream.get("duration"))
        if duration:
            durations.append(duration)
        if kind == "video" and video is None and not disposition.get("attached_pic"):
            width, height = _parse_int(stream.get("width")), _parse_int(stream.get("height"))
            if width and height:
                video = VideoStreamInfo(
                    index=int(stream.get("index", 0)),
                    codec=str(stream.get("codec_name") or "desconhecido"),
                    width=width,
                    height=height,
                    fps=_parse_rate(stream.get("avg_frame_rate")) or _parse_rate(stream.get("r_frame_rate")),
                    rotation=_rotation(stream),
                )
        elif kind == "audio":
            audio_streams.append(
                AudioStreamInfo(
                    index=int(stream.get("index", 0)),
                    codec=str(stream.get("codec_name") or "desconhecido"),
                    sample_rate=_parse_int(stream.get("sample_rate")),
                    channels=_parse_int(stream.get("channels")),
                    language=(stream.get("tags") or {}).get("language"),
                    default=bool(disposition.get("default")),
                )
            )

    duration = _parse_float(fmt.get("duration")) or (max(durations) if durations else 0.0)
    return MediaInfo(
        duration_seconds=round(duration, 3),
        format_name=str(fmt.get("format_name") or "desconhecido"),
        bit_rate=_parse_int(fmt.get("bit_rate")),
        video=video,
        audio_streams=audio_streams,
    )


def _last_lines(text: str, count: int = 3) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return " | ".join(lines[-count:])


def probe(tools: FFmpegTools, path: Path, timeout: float = 120) -> MediaInfo:
    cmd = [tools.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=_CREATION_FLAGS,
        )
    except subprocess.TimeoutExpired as exc:
        raise MediaError("O FFprobe demorou demais para ler o vídeo.") from exc
    except OSError as exc:
        raise FFmpegNotFound(f"Não foi possível executar o FFprobe: {exc}") from exc
    if result.returncode != 0:
        detail = _last_lines(result.stderr) or f"código {result.returncode}"
        raise MediaError(f"O FFprobe não conseguiu ler o vídeo ({detail}). O arquivo pode estar corrompido.")
    try:
        return parse_probe(json.loads(result.stdout or "{}"))
    except json.JSONDecodeError as exc:
        raise MediaError("Resposta inválida do FFprobe.") from exc


def require_processable(media: MediaInfo) -> AudioStreamInfo:
    """Garante que o vídeo tem imagem, áudio e duração; retorna a trilha de áudio escolhida."""
    if media.video is None:
        raise MediaError("O arquivo não contém uma trilha de vídeo.")
    if media.duration_seconds <= 0:
        raise MediaError("Não foi possível determinar a duração do vídeo.")
    audio = media.preferred_audio()
    if audio is None:
        raise MediaError(
            "O vídeo não possui trilha de áudio. Sem áudio não é possível transcrever nem sugerir cortes."
        )
    return audio


# ---------------------------------------------------------------------- FFmpeg


def parse_progress_seconds(line: str) -> float | None:
    """Lê ``out_time_us``/``out_time_ms`` da saída de ``-progress`` (ambos em microssegundos)."""
    key, _, value = line.strip().partition("=")
    if key in ("out_time_us", "out_time_ms") and value.isdigit():
        return int(value) / 1_000_000
    return None


def run_ffmpeg(
    ctx: JobContext,
    tools: FFmpegTools,
    args: list[str],
    *,
    duration: float = 0.0,
    progress_start: float = 0.0,
    progress_end: float = 1.0,
    message: str = "Processando com FFmpeg",
    cwd: Path | None = None,
) -> None:
    """Executa o FFmpeg reportando o progresso real com base no tempo processado.

    ``cwd`` permite referenciar arquivos auxiliares (ex.: legendas) por nome relativo dentro
    dos filtros, evitando o escape de caminhos do Windows ("C:\\...") no filtergraph.
    """
    ctx.check_cancelled()
    cmd = [tools.ffmpeg, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1", *args]
    try:
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=_CREATION_FLAGS,
            cwd=str(cwd) if cwd else None,
        )
    except OSError as exc:
        raise FFmpegNotFound(f"Não foi possível executar o FFmpeg: {exc}") from exc
    ctx.register_process(process)

    # O stderr é lido em paralelo para que o buffer nunca encha e trave o FFmpeg.
    errors: deque[str] = deque(maxlen=20)
    assert process.stderr is not None and process.stdout is not None
    reader = threading.Thread(target=lambda: errors.extend(process.stderr), daemon=True)  # type: ignore[arg-type]
    reader.start()

    span = progress_end - progress_start
    ctx.progress(progress_start, message, force=True)
    try:
        for line in process.stdout:
            seconds = parse_progress_seconds(line)
            if seconds is not None and duration > 0:
                ctx.progress(progress_start + span * min(1.0, seconds / duration), message)
            else:
                ctx.check_cancelled()
    finally:
        if ctx.cancelled and process.poll() is None:
            process.kill()
        process.wait()
        reader.join(timeout=5)

    ctx.check_cancelled()
    if process.returncode != 0:
        detail = _last_lines("".join(errors)) or f"código {process.returncode}"
        raise MediaError(f"O FFmpeg falhou: {detail}")
    ctx.progress(progress_end, message, force=True)


def _partial_path(dest: Path) -> Path:
    # Mantém a extensão final para que o FFmpeg escolha o formato correto.
    return dest.with_name(f"{dest.stem}.part{dest.suffix}")


def extract_audio(
    ctx: JobContext,
    tools: FFmpegTools,
    source: Path,
    dest: Path,
    media: MediaInfo,
    *,
    progress_start: float = 0.0,
    progress_end: float = 1.0,
) -> AudioInfo:
    """Extrai a trilha de áudio preferida como WAV PCM 16 bits, mono, 16 kHz."""
    stream = require_processable(media)
    partial = _partial_path(dest)
    args = [
        "-i", str(source),
        "-map", f"0:{stream.index}",
        "-vn", "-sn", "-dn",
        "-ac", "1",
        "-ar", str(AUDIO_SAMPLE_RATE),
        "-c:a", "pcm_s16le",
        str(partial),
    ]  # fmt: skip
    try:
        run_ffmpeg(
            ctx,
            tools,
            args,
            duration=media.duration_seconds,
            progress_start=progress_start,
            progress_end=progress_end,
            message="Extraindo áudio",
        )
        if not partial.is_file() or partial.stat().st_size <= 44:
            raise MediaError("O FFmpeg não gerou o arquivo de áudio.")
        os.replace(partial, dest)
    finally:
        partial.unlink(missing_ok=True)

    extracted = probe(tools, dest)
    return AudioInfo(
        filename=dest.name,
        source_stream_index=stream.index,
        sample_rate=AUDIO_SAMPLE_RATE,
        channels=1,
        duration_seconds=extracted.duration_seconds,
        size_bytes=dest.stat().st_size,
    )


def make_thumbnail(ctx: JobContext, tools: FFmpegTools, source: Path, dest: Path, media: MediaInfo) -> None:
    """Gera uma miniatura JPEG (até 640 px de largura) a partir de ~10% do vídeo."""
    seek = min(max(media.duration_seconds * 0.1, 0.0), 10.0)
    partial = _partial_path(dest)
    args = [
        "-ss", f"{seek:.3f}",
        "-i", str(source),
        "-frames:v", "1",
        "-vf", "scale='min(640,iw)':-2",
        "-q:v", "3",
        str(partial),
    ]  # fmt: skip
    try:
        run_ffmpeg(ctx, tools, args, message="Gerando miniatura")
        if not partial.is_file() or partial.stat().st_size == 0:
            raise MediaError("O FFmpeg não gerou a miniatura.")
        os.replace(partial, dest)
    finally:
        partial.unlink(missing_ok=True)
