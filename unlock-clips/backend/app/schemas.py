"""Modelos de dados (Pydantic) compartilhados entre API, armazenamento e tarefas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = 6

DurationPreset = Literal["15-30", "30-60", "60-90"]
AspectRatio = Literal["9:16", "1:1", "16:9"]
SubtitleStyle = Literal["classico", "destaque", "caixa", "minimalista"]
SubtitlePosition = Literal["inferior", "centro", "superior"]
FramingMode = Literal["centro", "rosto"]
ClipFramingMode = Literal["centro", "rosto", "manual"]

# "validate" é mantido para ler projetos criados na Etapa 1.
JobKind = Literal["process", "import_link", "transcribe", "detect_clips", "render_clips", "validate"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
ACTIVE_JOB_STATUSES: frozenset[str] = frozenset({"queued", "running"})

ProjectStatus = Literal[
    "importing",  # baixando o vídeo a partir de um link
    "validating",  # verificando o arquivo recebido
    "extracting_audio",  # lendo a mídia com FFprobe e extraindo o áudio com FFmpeg
    "transcribing",  # transcrevendo o áudio com faster-whisper
    "detecting_clips",  # procurando os melhores trechos na transcrição
    "rendering",  # gerando os vídeos dos cortes (legendas + formato)
    "ready",  # etapas concluídas até o momento (áudio extraído e, se ativado, transcrito)
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


WhisperModelName = Literal["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"]
WhisperDevice = Literal["cpu", "cuda"]
WhisperComputeType = Literal["auto", "int8", "int8_float16", "float16", "float32"]


class TranscriptionSettings(BaseModel):
    """Configuração do faster-whisper (modelos locais, sem serviços pagos)."""

    model_config = ConfigDict(extra="ignore")

    model: WhisperModelName = "small"
    # Pasta de um modelo já convertido para CTranslate2 (substitui o modelo da lista).
    model_dir: str | None = Field(default=None, max_length=1024)
    device: WhisperDevice = "cpu"
    compute_type: WhisperComputeType = "auto"
    beam_size: int = Field(default=5, ge=1, le=10)
    vad_filter: bool = True
    auto_transcribe: bool = True
    allow_download: bool = True

    @field_validator("model_dir")
    @classmethod
    def _strip_model_dir(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().strip('"').strip()
        return value or None


# Critérios da pontuação heurística dos cortes (chave -> peso padrão).
SCORING_CRITERIA_DEFAULTS: dict[str, float] = {
    "hook": 20,
    "impact": 15,
    "opinion": 12,
    "qa": 15,
    "story": 12,
    "clarity": 10,
    "context": 16,
    "emphasis": 5,
    "duration": 5,
}


class ClipDetectionSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    auto_detect: bool = True
    weights: dict[str, float] = Field(default_factory=lambda: dict(SCORING_CRITERIA_DEFAULTS))

    @field_validator("weights")
    @classmethod
    def _check_weights(cls, values: dict[str, float]) -> dict[str, float]:
        unknown = set(values) - set(SCORING_CRITERIA_DEFAULTS)
        if unknown:
            raise ValueError(f"Critérios desconhecidos: {', '.join(sorted(unknown))}")
        merged = {**SCORING_CRITERIA_DEFAULTS, **values}
        for key, weight in merged.items():
            if not 0 <= weight <= 100:
                raise ValueError(f"O peso de '{key}' deve ficar entre 0 e 100.")
        if sum(merged.values()) <= 0:
            raise ValueError("Pelo menos um critério precisa ter peso maior que zero.")
        return merged


class AppSettings(BaseModel):
    """Preferências globais persistidas em ``settings.json``."""

    model_config = ConfigDict(extra="ignore")

    clip_defaults: ClipSettings = Field(default_factory=ClipSettings)
    allowed_link_domains: list[str] = Field(default_factory=list, max_length=200)
    max_upload_size_mb: int = Field(default=8192, ge=1, le=102_400)
    # Pasta com ffmpeg(.exe) e ffprobe(.exe). Vazio = procurar no PATH do sistema.
    ffmpeg_dir: str | None = Field(default=None, max_length=1024)
    transcription: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    clip_detection: ClipDetectionSettings = Field(default_factory=ClipDetectionSettings)

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


class TranscriptWord(BaseModel):
    start: float
    end: float
    text: str
    probability: float


class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: list[TranscriptWord] = Field(default_factory=list)
    avg_logprob: float | None = None
    no_speech_prob: float | None = None


class Transcript(BaseModel):
    """Transcrição completa, salva em ``transcript.json`` na pasta do projeto."""

    engine: str = "faster-whisper"
    model: str
    language: str
    language_probability: float | None = None
    duration_seconds: float
    created_at: datetime = Field(default_factory=utcnow)
    segments: list[TranscriptSegment] = Field(default_factory=list)

    @property
    def word_count(self) -> int:
        return sum(len(segment.words) or len(segment.text.split()) for segment in self.segments)


class TranscriptSummary(BaseModel):
    """Resumo guardado no ``project.json`` (o texto completo fica em ``transcript.json``)."""

    filename: str
    engine: str
    model: str
    language: str
    segment_count: int
    word_count: int
    duration_seconds: float
    created_at: datetime


ClipStatus = Literal["suggested", "approved", "rejected"]


class ScoreComponent(BaseModel):
    """Contribuição de um critério para a pontuação (explicável)."""

    key: str
    label: str
    weight: float
    value: float  # 0..1
    points: float  # contribuição na escala 0..100
    details: list[str] = Field(default_factory=list)


class RenderInfo(BaseModel):
    """Vídeo MP4 gerado para um corte (pasta ``exports`` do projeto)."""

    filename: str
    aspect_ratio: AspectRatio
    width: int
    height: int
    duration_seconds: float
    size_bytes: int
    framing: ClipFramingMode
    subtitle_style: SubtitleStyle
    subtitle_cues: int
    signature: str  # configuração usada; se mudar, o vídeo fica desatualizado
    notes: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    stale: bool = False  # calculado ao consultar


class FramingOverride(BaseModel):
    """Enquadramento escolhido para um corte específico (substitui o padrão do projeto).

    No modo ``manual``, ``x`` e ``y`` indicam a posição do recorte no espaço livre do quadro
    (0 = esquerda/topo, 0,5 = centro, 1 = direita/base) e ``zoom`` aproxima a imagem.
    """

    model_config = ConfigDict(extra="forbid")

    mode: ClipFramingMode
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.5, ge=0, le=1)
    zoom: float = Field(default=1.0, ge=1, le=3)


class SubtitleCueEdit(BaseModel):
    """Bloco de legenda editado pelo usuário. Tempos em segundos do vídeo original."""

    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(default="", max_length=400)
    hidden: bool = False


class Clip(BaseModel):
    id: str = Field(default_factory=lambda: new_id()[:12])
    title: str
    start: float
    end: float
    score: float  # 0..100, heurística — não é previsão de visualizações
    components: list[ScoreComponent] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    text: str = ""
    status: ClipStatus = "suggested"
    origin: Literal["auto", "manual"] = "auto"
    edited: bool = False
    render: RenderInfo | None = None
    # Edições do editor: ``None`` = usa o padrão do projeto / legendas automáticas.
    framing_override: FramingOverride | None = None
    subtitle_cues: list[SubtitleCueEdit] | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @property
    def duration(self) -> float:
        return self.end - self.start


class ClipSet(BaseModel):
    """Cortes de um projeto, salvos em ``clips.json``."""

    generated_at: datetime = Field(default_factory=utcnow)
    language: str
    duration_preset: str
    max_clips: int
    weights: dict[str, float]
    candidates_evaluated: int = 0
    audio_reference_db: float | None = None
    notes: list[str] = Field(default_factory=list)
    clips: list[Clip] = Field(default_factory=list)


class ClipsSummary(BaseModel):
    filename: str
    count: int
    approved: int
    generated_at: datetime
    rendered: int = 0


class ClipCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)
    title: str | None = Field(default=None, max_length=200)


class ClipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    status: ClipStatus | None = None
    # Enviar ``null`` volta ao enquadramento padrão do projeto.
    framing_override: FramingOverride | None = None


class DetectClipsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Mantém cortes aprovados e criados manualmente ao gerar novas sugestões.
    keep_curated: bool = True


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Cortes a gerar; vazio = todos os aprovados.
    clip_ids: list[str] | None = Field(default=None, max_length=100)


class SubtitleTemplateInfo(BaseModel):
    key: SubtitleStyle
    label: str
    description: str
    font: str
    bold: bool
    uppercase: bool
    primary: str
    highlight: str
    outline_color: str
    outline: float
    shadow: float
    box: bool
    box_color: str
    box_opacity: float
    size_factor: float
    highlight_scale: int


class SubtitleWordOut(BaseModel):
    start: float
    end: float
    text: str


class SubtitleCueOut(BaseModel):
    start: float
    end: float
    lines: list[list[SubtitleWordOut]]


class EditableCue(BaseModel):
    """Bloco de legenda como aparece no editor (tempos em segundos do vídeo original)."""

    start: float
    end: float
    text: str
    hidden: bool = False
    edited: bool = False  # texto, tempo ou visibilidade diferentes da transcrição


class SubtitleEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cues: list[SubtitleCueEdit] = Field(max_length=2000)


class ClipSubtitles(BaseModel):
    """Legendas de um corte já divididas em blocos, para a prévia no navegador."""

    width: int
    height: int
    font_size: int
    alignment: int
    margin_v: int
    margin_h: int
    highlight: bool
    template: SubtitleTemplateInfo
    cues: list[SubtitleCueOut]  # tempos relativos ao início do corte, já divididos em linhas
    editable: list[EditableCue] = Field(default_factory=list)
    edited: bool = False  # o corte usa legendas editadas


class ClipFraming(BaseModel):
    """Enquadramento calculado para um corte (o mesmo usado ao gerar o vídeo)."""

    mode: ClipFramingMode
    requested: ClipFramingMode  # modo pedido (do corte ou do projeto)
    override: FramingOverride | None = None
    source_width: int
    source_height: int
    crop_width: int
    crop_height: int
    x: float
    y: int
    keyframes: list[tuple[float, float]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ScoringCriterion(BaseModel):
    key: str
    label: str
    description: str
    default_weight: float


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
    transcript: TranscriptSummary | None = None
    clips: ClipsSummary | None = None
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
    clip_id: str | None = None
    clip_title: str | None = None
    aspect_ratio: AspectRatio | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    stale: bool = False


class ExportsDeleted(BaseModel):
    deleted: int
    freed_bytes: int


class ProjectStorage(BaseModel):
    """Espaço em disco de um projeto (bytes)."""

    project_id: str
    source_bytes: int
    audio_bytes: int
    exports_bytes: int
    other_bytes: int
    total_bytes: int
    exports_count: int


class WhisperModelOption(BaseModel):
    name: str
    label: str
    size_mb: int
    description: str
    installed: bool
    path: str


class SystemStats(BaseModel):
    projects_total: int
    projects_by_status: dict[str, int]
    active_jobs: int
    storage_bytes: int
    exports_total: int
    disk_free_bytes: int | None = None


class HealthInfo(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    ffmpeg_available: bool
    ffprobe_available: bool
    ffmpeg_path: str | None = None
    ffprobe_path: str | None = None
    ffmpeg_version: str | None = None
    ffmpeg_error: str | None = None
    transcription_available: bool = False
    transcription_error: str | None = None
    face_detection_available: bool = False
    face_detection_error: str | None = None
    data_dir: str
    disk_free_bytes: int | None = None
    disk_total_bytes: int | None = None
    log_file: str | None = None
