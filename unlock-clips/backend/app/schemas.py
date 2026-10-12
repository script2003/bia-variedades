"""Modelos de dados (Pydantic) compartilhados entre API, armazenamento e tarefas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = 2

DurationPreset = Literal["15-30", "30-60", "60-90"]
AspectRatio = Literal["9:16", "1:1", "16:9"]
SubtitleStyle = Literal["classico", "destaque", "caixa", "minimalista"]
SubtitlePosition = Literal["inferior", "centro", "superior"]
FramingMode = Literal["centro", "rosto"]

# "validate" é mantido para ler projetos criados na Etapa 1.
JobKind = Literal["process", "import_link", "validate"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
ACTIVE_JOB_STATUSES: frozenset[str] = frozenset({"queued", "running"})

ProjectStatus = Literal[
    "importing",  # baixando o vídeo a partir de um link
    "validating",  # verificando o arquivo recebido
    "extracting_audio",  # lendo a mídia com FFprobe e extraindo o áudio com FFmpeg
    "ready",  # áudio extraído, pronto para as próximas etapas
    "failed",
    "cancelled",
    "interrupted",  # a aplicação foi fechada durante uma tarefa
]

_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(-[A-Z]{2})?$")
_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


class ClipSettings(BaseModel):
    """Preferências de geração de cortes de um projeto."""

    model_config = ConfigDict(extra="ignore")

    duration: DurationPreset = "30-60"
    aspect_ratio: AspectRatio = "9:16"
    subtitle_language: str = "pt-BR"
    subtitle_style: SubtitleStyle = "destaque"
    subtitle_font_size: int = Field(default=64, ge=24, le=160)
    subtitle_position: SubtitlePosition = "inferior"
    highlight_current_word: bool = True
    framing: FramingMode = "centro"
    max_clips: int = Field(default=10, ge=1, le=50)

    @field_validator("subtitle_language")
    @classmethod
    def _check_language(cls, value: str) -> str:
        value = value.strip()
        if not _LANGUAGE_RE.match(value):
            raise ValueError("Idioma inválido. Use códigos como 'pt-BR', 'en' ou 'es'.")
        return value


def normalize_domain(raw: str) -> str:
    """Normaliza um domínio informado pelo usuário (remove esquema, caminho e 'www.')."""
    value = raw.strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if "@" in value:
        raise ValueError(f"Domínio inválido: {raw!r}")
    value = value.split(":", 1)[0].strip(".")
    if value.startswith("*."):
        value = value[2:]
    if value.startswith("www."):
        value = value[4:]
    if not _DOMAIN_RE.match(value):
        raise ValueError(f"Domínio inválido: {raw!r}")
    return value


class AppSettings(BaseModel):
    """Preferências globais persistidas em ``settings.json``."""

    model_config = ConfigDict(extra="ignore")

    clip_defaults: ClipSettings = Field(default_factory=ClipSettings)
    allowed_link_domains: list[str] = Field(default_factory=list, max_length=200)
    max_upload_size_mb: int = Field(default=8192, ge=1, le=102_400)
    # Pasta com ffmpeg(.exe) e ffprobe(.exe). Vazio = procurar no PATH do sistema.
    ffmpeg_dir: str | None = Field(default=None, max_length=1024)

    @field_validator("ffmpeg_dir")
    @classmethod
    def _strip_ffmpeg_dir(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().strip('"').strip()
        return value or None

    @field_validator("allowed_link_domains")
    @classmethod
    def _check_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for raw in values:
            if not raw.strip():
                continue
            domain = normalize_domain(raw)
            if domain not in normalized:
                normalized.append(domain)
        return normalized

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


class JobInfo(BaseModel):
    id: str = Field(default_factory=new_id)
    kind: JobKind
    status: JobStatus = "queued"
    # None = progresso indeterminado (ex.: download sem Content-Length).
    progress: float | None = 0.0
    message: str = ""
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_JOB_STATUSES


class SourceInfo(BaseModel):
    kind: Literal["upload", "link"]
    original_name: str
    url: str | None = None
    # Nome do arquivo dentro da pasta do projeto (ex.: "source.mp4").
    filename: str | None = None
    size_bytes: int | None = None
    content_type: str | None = None
    container: str | None = None
    sha256: str | None = None


class VideoStreamInfo(BaseModel):
    index: int
    codec: str
    width: int
    height: int
    fps: float | None = None
    rotation: int = 0

    @property
    def display_size(self) -> tuple[int, int]:
        """Dimensões como o vídeo aparece na tela (considerando rotação)."""
        if abs(self.rotation) % 180 == 90:
            return self.height, self.width
        return self.width, self.height


class AudioStreamInfo(BaseModel):
    index: int
    codec: str
    sample_rate: int | None = None
    channels: int | None = None
    language: str | None = None
    default: bool = False


class MediaInfo(BaseModel):
    """Resultado do FFprobe sobre o vídeo original."""

    duration_seconds: float
    format_name: str
    bit_rate: int | None = None
    video: VideoStreamInfo | None = None
    audio_streams: list[AudioStreamInfo] = Field(default_factory=list)

    def preferred_audio(self) -> AudioStreamInfo | None:
        for stream in self.audio_streams:
            if stream.default:
                return stream
        return self.audio_streams[0] if self.audio_streams else None


class AudioInfo(BaseModel):
    """Áudio extraído para transcrição: WAV PCM 16 bits, mono, 16 kHz."""

    filename: str
    source_stream_index: int
    codec: str = "pcm_s16le"
    sample_rate: int = 16_000
    channels: int = 1
    duration_seconds: float
    size_bytes: int


class Project(BaseModel):
    schema_version: int = SCHEMA_VERSION
    id: str = Field(default_factory=new_id)
    title: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    status: ProjectStatus
    source: SourceInfo
    settings: ClipSettings = Field(default_factory=ClipSettings)
    media: MediaInfo | None = None
    audio: AudioInfo | None = None
    thumbnail: str | None = None
    job: JobInfo | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    settings: ClipSettings | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("O título não pode ficar vazio.")
        return value


class LinkImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=200)
    rights_confirmed: bool = False
    settings: ClipSettings | None = None


class ExportedVideo(BaseModel):
    project_id: str
    project_title: str
    filename: str
    size_bytes: int
    created_at: datetime
    url: str


class SystemStats(BaseModel):
    projects_total: int
    projects_by_status: dict[str, int]
    active_jobs: int
    storage_bytes: int
    exports_total: int


class HealthInfo(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    ffmpeg_available: bool
    ffprobe_available: bool
    ffmpeg_path: str | None = None
    ffprobe_path: str | None = None
    ffmpeg_version: str | None = None
    ffmpeg_error: str | None = None
    data_dir: str
