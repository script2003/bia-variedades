"""Transcrição local com faster-whisper.

Decisões importantes:

* O áudio é lido diretamente do ``audio.wav`` gerado na Etapa 2 (PCM 16 bits, mono,
  16 kHz) e entregue ao modelo como array NumPy. Assim não dependemos do PyAV para
  decodificar (versões recentes do PyAV são incompatíveis com o faster-whisper 1.2).
* Vídeos longos são processados em blocos de ~10 minutos, cortados no trecho mais
  silencioso perto do limite, para não carregar horas de áudio na memória e não
  cortar palavras ao meio. O fim de cada bloco é usado como contexto do próximo.
* O progresso é real (tempo já transcrito / duração total) e o cancelamento é
  verificado a cada segmento — o atraso máximo é o de uma janela de 30 s do modelo.
* O modelo carregado fica em cache e só uma transcrição roda por vez, para não
  esgotar a memória e o processador.
* Os modelos são baixados uma única vez do Hugging Face para ``data/models`` ou
  podem ser fornecidos manualmente (pasta configurável), funcionando offline.
"""

from __future__ import annotations

import inspect
import logging
import os
import threading
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .jobs import JobCancelled, JobContext, JobError
from .schemas import (
    Transcript,
    TranscriptionSettings,
    TranscriptSegment,
    TranscriptWord,
    WhisperModelOption,
)

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
CHUNK_SECONDS = 600  # ~10 minutos por bloco
CUT_SEARCH_SECONDS = 30  # procura o trecho mais silencioso nos últimos 30 s do bloco
ENERGY_WINDOW_SECONDS = 0.1
PROMPT_CHARS = 200
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json")


@dataclass(frozen=True)
class ModelCatalogEntry:
    repo_id: str
    label: str
    size_mb: int
    description: str


# Modelos multilíngues convertidos para CTranslate2 (os mesmos usados pelo faster-whisper).
MODEL_CATALOG: dict[str, ModelCatalogEntry] = {
    "tiny": ModelCatalogEntry("Systran/faster-whisper-tiny", "Tiny", 75, "Muito rápido, precisão baixa. Bom para testes."),
    "base": ModelCatalogEntry("Systran/faster-whisper-base", "Base", 145, "Rápido, precisão razoável."),
    "small": ModelCatalogEntry("Systran/faster-whisper-small", "Small", 484, "Recomendado para CPU: bom equilíbrio."),
    "medium": ModelCatalogEntry("Systran/faster-whisper-medium", "Medium", 1530, "Mais preciso, bem mais lento em CPU."),
    "large-v3-turbo": ModelCatalogEntry(
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "Large v3 Turbo", 1620, "Alta precisão; ideal com GPU NVIDIA."
    ),
    "large-v3": ModelCatalogEntry("Systran/faster-whisper-large-v3", "Large v3", 3090, "Máxima precisão; exige GPU ou muita paciência."),
}


class TranscriptionError(JobError):
    pass


# ---------------------------------------------------------------------- idioma


def whisper_language(code: str) -> str:
    """Converte o idioma das legendas ("pt-BR") no código do Whisper ("pt")."""
    base = code.split("-", 1)[0].lower()
    if base not in SUPPORTED_LANGUAGES:
        raise TranscriptionError(f"O idioma '{code}' não é suportado pelo Whisper.")
    return base


SUPPORTED_LANGUAGES = frozenset(
    (
        "en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la "
        "mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be "
        "tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su"
    ).split()
)


# ---------------------------------------------------------------------- áudio


class WavReader:
    """Lê trechos de um WAV PCM 16 bits mono 16 kHz sem carregar o arquivo inteiro."""

    def __init__(self, path: Path) -> None:
        try:
            self._wav = wave.open(str(path), "rb")
        except (OSError, wave.Error, EOFError) as exc:
            raise TranscriptionError(f"Não foi possível abrir o áudio extraído: {exc}") from exc
        if (self._wav.getnchannels(), self._wav.getsampwidth(), self._wav.getframerate()) != (1, 2, SAMPLE_RATE):
            self._wav.close()
            raise TranscriptionError(
                "O áudio extraído não está no formato esperado (WAV mono 16 kHz). Reprocesse o projeto."
            )
        self.frames = self._wav.getnframes()

    @property
    def duration(self) -> float:
        return self.frames / SAMPLE_RATE

    def read(self, start: int, end: int) -> np.ndarray:
        start, end = max(0, start), min(self.frames, end)
        self._wav.setpos(start)
        data = self._wav.readframes(max(0, end - start))
        return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0

    def close(self) -> None:
        self._wav.close()

    def __enter__(self) -> "WavReader":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def quietest_frame(samples: np.ndarray, offset: int) -> int:
    """Retorna a posição (em frames absolutos) da janela de 100 ms com menor energia."""
    window = int(SAMPLE_RATE * ENERGY_WINDOW_SECONDS)
    count = len(samples) // window
    if count == 0:
        return offset + len(samples)
    energy = np.square(samples[: count * window].reshape(count, window)).mean(axis=1)
    # Entre janelas praticamente tão silenciosas quanto a mínima, prefere a mais próxima do
    # limite do bloco, para não encurtar os blocos em trechos sem pausas.
    candidates = np.flatnonzero(energy <= energy.min() * 1.05 + 1e-10)
    best = int(candidates[-1])
    return offset + best * window + window // 2


def plan_chunks(reader: WavReader, chunk_seconds: int = CHUNK_SECONDS, search_seconds: int = CUT_SEARCH_SECONDS) -> list[tuple[int, int]]:
    """Divide o áudio em blocos cortados nos trechos mais silenciosos."""
    chunk = chunk_seconds * SAMPLE_RATE
    search = min(search_seconds * SAMPLE_RATE, chunk // 2)
    bounds: list[tuple[int, int]] = []
    start = 0
    while start < reader.frames:
        target = start + chunk
        if target >= reader.frames:
            bounds.append((start, reader.frames))
            break
        cut = quietest_frame(reader.read(target - search, target), target - search)
        bounds.append((start, cut))
        start = cut
    return bounds


# ---------------------------------------------------------------------- modelos


def is_model_dir(path: Path) -> bool:
    return all((path / name).is_file() for name in MODEL_FILES)


def _directory_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def snapshot_download(repo_id: str, local_dir: Path) -> None:
    """Baixa os arquivos do modelo, compatível com huggingface_hub 0.x e 1.x/2.x."""
    import huggingface_hub

    kwargs: dict[str, Any] = {
        "local_dir": str(local_dir),
        "allow_patterns": ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
    }
    parameters = inspect.signature(huggingface_hub.snapshot_download).parameters
    if "local_dir_use_symlinks" in parameters:  # versões antigas
        kwargs["local_dir_use_symlinks"] = False
    huggingface_hub.snapshot_download(repo_id, **kwargs)


def _resolve_compute_type(settings: TranscriptionSettings) -> str:
    if settings.compute_type != "auto":
        return settings.compute_type
    return "float16" if settings.device == "cuda" else "int8"


ModelFactory = Callable[[str, str, str], Any]


def _default_model_factory(path: str, device: str, compute_type: str) -> Any:
    from faster_whisper import WhisperModel

    threads = max(1, min(8, (os.cpu_count() or 4) - 1))
    return WhisperModel(path, device=device, compute_type=compute_type, cpu_threads=threads)


def engine_status() -> tuple[bool, str | None]:
    try:
        import faster_whisper  # noqa: F401
    except ImportError as exc:
        return False, f"faster-whisper não está instalado ({exc}). Rode: pip install -r requirements.txt"
    return True, None


class WhisperEngine:
    def __init__(
        self,
        models_dir: Path,
        *,
        model_factory: ModelFactory = _default_model_factory,
        downloader: Callable[[str, Path], None] = snapshot_download,
        extra_options: dict[str, Any] | None = None,
    ) -> None:
        self.models_dir = models_dir
        self._model_factory = model_factory
        self._downloader = downloader
        self._extra_options = dict(extra_options or {})
        self._run_lock = threading.Lock()
        self._download_lock = threading.Lock()
        self._model: Any = None
        self._model_key: tuple[str, str, str] | None = None

    # ------------------------------------------------------------- catálogo

    def model_path(self, name: str) -> Path:
        return self.models_dir / name

    def catalog(self) -> list[WhisperModelOption]:
        return [
            WhisperModelOption(
                name=name,
                label=entry.label,
                size_mb=entry.size_mb,
                description=entry.description,
                installed=is_model_dir(self.model_path(name)),
                path=str(self.model_path(name)),
            )
            for name, entry in MODEL_CATALOG.items()
        ]

    def release(self) -> None:
        """Libera o modelo da memória (ele é recarregado na próxima transcrição)."""
        with self._run_lock:
            self._model = None
            self._model_key = None

    # ------------------------------------------------------------- preparação

    def _acquire(self, ctx: JobContext) -> None:
        first = True
        while not self._run_lock.acquire(timeout=0.5):
            if first:
                ctx.progress(None, "Aguardando outra transcrição terminar", force=True)
                first = False
            ctx.check_cancelled()

    def resolve_model(self, ctx: JobContext, settings: TranscriptionSettings) -> tuple[str, Path]:
        if settings.model_dir:
            path = Path(settings.model_dir).expanduser()
            if not is_model_dir(path):
                raise TranscriptionError(
                    f"A pasta de modelo configurada ({path}) não contém um modelo faster-whisper válido "
                    f"(arquivos esperados: {', '.join(MODEL_FILES)})."
                )
            return path.name, path

        name = settings.model
        path = self.model_path(name)
        if is_model_dir(path):
            return name, path
        if not settings.allow_download:
            raise TranscriptionError(
                f"O modelo '{name}' não está instalado e o download automático está desativado em Configurações."
            )
        self._download(ctx, name, path)
        return name, path

    def _download(self, ctx: JobContext, name: str, path: Path) -> None:
        entry = MODEL_CATALOG[name]
        if not self._download_lock.acquire(blocking=False):
            ctx.progress(None, "Aguardando outro download de modelo terminar", force=True)
            while not self._download_lock.acquire(timeout=0.5):
                ctx.check_cancelled()
        try:
            if is_model_dir(path):
                return
            path.mkdir(parents=True, exist_ok=True)
            errors: list[BaseException] = []

            def run() -> None:
                try:
                    self._downloader(entry.repo_id, path)
                except BaseException as exc:  # noqa: BLE001 - repassado para a tarefa
                    errors.append(exc)

            # O download roda em outra thread para que o cancelamento responda na hora.
            # Se a tarefa for cancelada, o download continua em segundo plano e será reaproveitado.
            worker = threading.Thread(target=run, name=f"download-{name}", daemon=True)
            worker.start()
            while worker.is_alive():
                mb = _directory_size(path) / 1024 / 1024
                ctx.progress(
                    None, f"Baixando o modelo {entry.label} ({mb:.0f} MB de ~{entry.size_mb} MB) — apenas na primeira vez"
                )
                worker.join(timeout=0.5)
        finally:
            self._download_lock.release()

        if errors:
            raise TranscriptionError(
                f"Não foi possível baixar o modelo '{name}': {errors[0]}. Verifique a conexão com a internet ou "
                f"baixe manualmente os arquivos de https://huggingface.co/{entry.repo_id} e informe a pasta em "
                "Configurações > Transcrição."
            ) from errors[0]
        if not is_model_dir(path):
            raise TranscriptionError(f"O download do modelo '{name}' terminou incompleto. Tente novamente.")

    def _load(self, ctx: JobContext, path: Path, settings: TranscriptionSettings) -> Any:
        compute_type = _resolve_compute_type(settings)
        key = (str(path), settings.device, compute_type)
        if self._model is not None and self._model_key == key:
            return self._model
        self._model = None
        ctx.progress(None, "Carregando o modelo de transcrição", force=True)
        try:
            model = self._model_factory(str(path), settings.device, compute_type)
        except Exception as exc:  # noqa: BLE001 - erros variam conforme a plataforma
            hint = " Selecione 'CPU' em Configurações > Transcrição." if settings.device == "cuda" else ""
            raise TranscriptionError(f"Falha ao carregar o modelo ({compute_type}, {settings.device}): {exc}.{hint}") from exc
        self._model, self._model_key = model, key
        return model

    # ------------------------------------------------------------- transcrição

    def transcribe(
        self,
        ctx: JobContext,
        audio_path: Path,
        language: str,
        settings: TranscriptionSettings,
        *,
        progress_start: float = 0.0,
        progress_end: float = 1.0,
        chunk_seconds: int = CHUNK_SECONDS,
    ) -> Transcript:
        lang = whisper_language(language)
        model_name, model_path = self.resolve_model(ctx, settings)
        self._acquire(ctx)
        try:
            model = self._load(ctx, model_path, settings)
            return self._run(ctx, model, model_name, audio_path, lang, settings, progress_start, progress_end, chunk_seconds)
        finally:
            self._run_lock.release()

    def _run(
        self,
        ctx: JobContext,
        model: Any,
        model_name: str,
        audio_path: Path,
        language: str,
        settings: TranscriptionSettings,
        progress_start: float,
        progress_end: float,
        chunk_seconds: int,
    ) -> Transcript:
        span = progress_end - progress_start
        segments: list[TranscriptSegment] = []
        detected_probability: float | None = None
        prompt: str | None = None
        started = time.monotonic()

        with WavReader(audio_path) as reader:
            total = reader.duration
            if total <= 0:
                raise TranscriptionError("O áudio extraído está vazio.")
            ctx.progress(progress_start, "Transcrevendo", force=True)
            for start_frame, end_frame in plan_chunks(reader, chunk_seconds):
                ctx.check_cancelled()
                offset = start_frame / SAMPLE_RATE
                audio = reader.read(start_frame, end_frame)
                options: dict[str, Any] = {
                    "language": language,
                    "task": "transcribe",
                    "beam_size": settings.beam_size,
                    "vad_filter": settings.vad_filter,
                    "word_timestamps": True,
                    "condition_on_previous_text": True,
                    "initial_prompt": prompt,
                    **self._extra_options,
                }
                try:
                    iterator, info = model.transcribe(audio, **options)
                    detected_probability = getattr(info, "language_probability", detected_probability)
                    chunk_texts: list[str] = []
                    for raw in iterator:
                        segment = _convert_segment(raw, offset, len(segments))
                        if segment is not None:
                            segments.append(segment)
                            chunk_texts.append(segment.text)
                        position = min(total, offset + float(raw.end))
                        ctx.progress(
                            progress_start + span * position / total,
                            f"Transcrevendo ({_clock(position)} de {_clock(total)})",
                        )
                except JobCancelled:
                    raise
                except Exception as exc:  # noqa: BLE001 - falhas do modelo viram mensagem para o usuário
                    raise TranscriptionError(f"Falha durante a transcrição: {exc}") from exc
                text = " ".join(chunk_texts).strip()
                prompt = text[-PROMPT_CHARS:] if text else None

        logger.info("Transcrição de %.0f s concluída em %.0f s", total, time.monotonic() - started)
        ctx.progress(progress_end, "Transcrição concluída", force=True)
        return Transcript(
            model=model_name,
            language=language,
            language_probability=None if detected_probability is None else round(float(detected_probability), 4),
            duration_seconds=round(total, 3),
            segments=segments,
        )


def _convert_segment(raw: Any, offset: float, index: int) -> TranscriptSegment | None:
    text = str(raw.text).strip()
    if not text:
        return None
    words = [
        TranscriptWord(
            start=round(offset + float(w.start), 3),
            end=round(offset + float(w.end), 3),
            text=str(w.word),
            probability=round(float(w.probability), 4),
        )
        for w in (raw.words or [])
        if str(w.word).strip()
    ]
    return TranscriptSegment(
        id=index,
        start=round(offset + float(raw.start), 3),
        end=round(offset + float(raw.end), 3),
        text=text,
        words=words,
        avg_logprob=_maybe_round(getattr(raw, "avg_logprob", None)),
        no_speech_prob=_maybe_round(getattr(raw, "no_speech_prob", None)),
    )


def _maybe_round(value: Any) -> float | None:
    return None if value is None else round(float(value), 4)


def _clock(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ---------------------------------------------------------------------- exportação


def _timestamp(seconds: float, separator: str) -> str:
    millis = max(0, round(seconds * 1000))
    h, rem = divmod(millis, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{separator}{ms:03d}"


def to_srt(transcript: Transcript) -> str:
    blocks = [
        f"{i}\n{_timestamp(seg.start, ',')} --> {_timestamp(seg.end, ',')}\n{seg.text}\n"
        for i, seg in enumerate(transcript.segments, start=1)
    ]
    return "\n".join(blocks)


def to_vtt(transcript: Transcript) -> str:
    cues = [f"{_timestamp(seg.start, '.')} --> {_timestamp(seg.end, '.')}\n{seg.text}\n" for seg in transcript.segments]
    return "WEBVTT\n\n" + "\n".join(cues)


def to_text(transcript: Transcript) -> str:
    return "\n".join(f"[{_clock(seg.start)}] {seg.text}" for seg in transcript.segments) + "\n"
