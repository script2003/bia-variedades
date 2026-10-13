"""Regras de negócio dos projetos: criação, tarefas em segundo plano e recuperação."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import unicodedata
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import anyio

from .config import AppConfig
from .ffmpeg import (
    AUDIO_FILENAME,
    THUMBNAIL_FILENAME,
    MediaError,
    extract_audio,
    find_tools,
    make_thumbnail,
    probe,
    require_processable,
)
from .jobs import JobContext, JobError, JobManager
from .links import (
    ClientFactory,
    LinkPolicyError,
    check_url,
    default_client_factory,
    download_video,
    filename_from_response,
)
from .media import (
    ALLOWED_EXTENSIONS,
    CONTAINER_EXTENSION,
    SIGNATURE_BYTES,
    InvalidVideo,
    check_extension,
    container_mismatch_warning,
    extension_of,
    require_container,
    sanitize_filename,
    verify_video_file,
)
from .schemas import (
    ACTIVE_JOB_STATUSES,
    AppSettings,
    ExportedVideo,
    JobInfo,
    JobKind,
    LinkImportRequest,
    Project,
    ProjectStatus,
    ProjectUpdate,
    Clip,
    ClipCreate,
    ClipSet,
    ClipSettings,
    ClipsSummary,
    ClipFraming,
    ClipSubtitles,
    ClipUpdate,
    EditableCue,
    ExportsDeleted,
    ProjectStorage,
    RenderInfo,
    SubtitleCueEdit,
    SubtitleCueOut,
    SubtitleTemplateInfo,
    SubtitleWordOut,
    SourceInfo,
    SystemStats,
    Transcript,
    TranscriptSummary,
    new_id,
    utcnow,
)
from .storage import ProjectNotFound, ProjectStore, SettingsStore, atomic_write_text, is_valid_project_id
from .clips import ClipAnalyzer, detect_clips, partial_energy
from .framing import FramingPlan, center_plan, face_plan, manual_plan
from .render import editable_cues, plan_subtitles, render_clip, render_frame, requested_framing, subtitle_layout, transcript_words
from .subtitles import TEMPLATES, auto_text_cues, to_srt
from .transcription import WhisperEngine

logger = logging.getLogger(__name__)

TRANSCRIPT_FILENAME = "transcript.json"
CLIPS_FILENAME = "clips.json"
_SLUG_INVALID = re.compile(r"[^a-z0-9]+")
MAX_CLIP_SECONDS = 180.0
MIN_CLIP_SECONDS = 1.0
INTERRUPTED_MESSAGE = (
    "A aplicação foi encerrada antes de concluir esta tarefa. Clique em “Tentar novamente” para retomar."
)
# Espaço livre mínimo mantido no disco da pasta de dados (áudio extraído, vídeos gerados e arquivos temporários).
MIN_FREE_BYTES = 500 * 1024 * 1024
# Parcela do progresso da importação por link dedicada ao download (o restante é o processamento).
DOWNLOAD_PROGRESS_SHARE = 0.6
# Divisão do progresso do processamento: verificação, leitura da mídia + miniatura e extração de áudio.
VERIFY_SHARE = 0.2
PROBE_SHARE = 0.05


class ServiceError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _stored_extension(original_name: str, container: str) -> str:
    ext = extension_of(original_name)
    return ext if ALLOWED_EXTENSIONS.get(ext) == container else CONTAINER_EXTENSION[container]


def _title_from_name(name: str) -> str:
    stem = Path(name).stem.strip()
    return (stem or "Vídeo sem título")[:200]


class ProjectService:
    def __init__(
        self,
        config: AppConfig,
        store: ProjectStore,
        settings_store: SettingsStore,
        client_factory: ClientFactory = default_client_factory,
        engine: WhisperEngine | None = None,
    ) -> None:
        self.config = config
        self.store = store
        self.settings_store = settings_store
        self._client_factory = client_factory
        self.engine = engine or WhisperEngine(config.models_dir, extra_options=dict(config.whisper_options or {}))
        self._job_projects: dict[str, str] = {}
        self._job_lock = threading.Lock()
        self._clips_lock = threading.RLock()
        self._framing_cache: dict[tuple, ClipFraming] = {}
        self.jobs = JobManager(listener=self, max_workers=config.max_workers)

    # ------------------------------------------------------------------ consultas

    def get(self, project_id: str) -> Project:
        try:
            return self.store.get(project_id)
        except ProjectNotFound as exc:
            raise ServiceError(404, "Projeto não encontrado.") from exc

    def list(self) -> list[Project]:
        return self.store.list()

    def audio_path(self, project_id: str) -> Path:
        project = self.get(project_id)
        path = self.store.project_dir(project_id) / project.audio.filename if project.audio else None
        if path is None or not path.is_file():
            raise ServiceError(404, "O áudio deste projeto ainda não foi extraído.")
        return path

    def get_transcript(self, project_id: str) -> Transcript:
        project = self.get(project_id)
        path = self.store.project_dir(project_id) / project.transcript.filename if project.transcript else None
        if path is None or not path.is_file():
            raise ServiceError(404, "Este projeto ainda não foi transcrito.")
        return Transcript.model_validate_json(path.read_text(encoding="utf-8"))

    def get_clips(self, project_id: str) -> ClipSet:
        project = self.get(project_id)
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(404, "Ainda não há cortes sugeridos para este projeto.")
        exports = self.store.exports_dir(project_id)
        for clip in clip_set.clips:
            if clip.render is None:
                continue
            if not (exports / clip.render.filename).is_file():
                clip.render = None  # arquivo removido fora da aplicação
            else:
                clip.render.stale = clip.render.signature != self._render_signature(project, clip)
        return clip_set

    # ------------------------------------------------------------------ vídeos dos cortes

    def render(self, project_id: str, clip_ids: list[str] | None) -> Project:
        """Gera os MP4 (legendas + formato) dos cortes indicados ou de todos os aprovados."""
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id):
            raise ServiceError(409, "Já existe uma tarefa em andamento neste projeto.")
        if project.transcript is None or project.media is None or not project.source.filename:
            raise ServiceError(409, "O vídeo precisa estar processado e transcrito antes de gerar os cortes.")
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(409, "Gere as sugestões de cortes antes de gerar os vídeos.")
        by_id = {c.id: c for c in clip_set.clips}
        if clip_ids:
            missing = [cid for cid in clip_ids if cid not in by_id]
            if missing:
                raise ServiceError(404, f"Corte não encontrado: {missing[0]}")
            ids = list(dict.fromkeys(clip_ids))
        else:
            ids = [c.id for c in clip_set.clips if c.status == "approved"]
            if not ids:
                raise ServiceError(409, "Aprove pelo menos um corte (ou escolha um corte) para gerar o vídeo.")
        # Estimativa generosa: ~25 MB por minuto de vídeo vertical em 1080p.
        minutes = sum(by_id[i].end - by_id[i].start for i in ids) / 60
        self._require_free_space(int(minutes * 25 * 1024 * 1024), "gerar os vídeos")
        return self._start_job(project_id, "render_clips", "rendering", self._render_task(project_id, ids))

    def clip_frame(self, project_id: str, clip_id: str, at: float) -> bytes:
        """Quadro JPEG do corte exatamente como ficará no vídeo final (formato + legenda)."""
        project, clip, transcript, tools, source = self._render_context(project_id, clip_id)
        plan = None
        if requested_framing(project.settings, clip.framing_override) == "rosto":
            cached = self._framing_cache.get(self._framing_key(project, clip))
            if cached is not None:
                plan = FramingPlan(cached.mode, cached.crop_width, cached.crop_height, cached.x, cached.y, list(cached.keyframes))
        try:
            return render_frame(
                tools, source, project.media, transcript, clip.start, clip.end, project.settings, at,
                framing=clip.framing_override, subtitle_edits=clip.subtitle_cues, plan=plan,
            )  # fmt: skip
        except JobError as exc:
            raise ServiceError(422, str(exc)) from exc

    @staticmethod
    def _framing_key(project: Project, clip: Clip) -> tuple:
        override = clip.framing_override.model_dump_json() if clip.framing_override else None
        aspect, mode = project.settings.aspect_ratio, project.settings.framing
        return (project.id, project.source.sha256, round(clip.start, 3), round(clip.end, 3), aspect, mode, override)

    def clip_framing(self, project_id: str, clip_id: str) -> ClipFraming:
        """Enquadramento do corte (rosto, central ou manual), com cache, para a prévia ao vivo."""
        project, clip, _transcript, tools, source = self._render_context(project_id, clip_id)
        assert project.media is not None and project.media.video is not None
        src_w, src_h = project.media.video.display_size
        aspect = project.settings.aspect_ratio
        override = clip.framing_override
        mode = requested_framing(project.settings, override)
        key = self._framing_key(project, clip)
        cached = self._framing_cache.get(key)
        if cached is not None:
            return cached
        if mode == "rosto":
            ctx = JobContext(f"framing-{clip_id}", threading.Event(), lambda p, m: None)
            try:
                plan = face_plan(ctx, tools, source, clip.start, clip.end - clip.start, src_w, src_h, aspect)
            except JobError as exc:
                raise ServiceError(422, str(exc)) from exc
        elif mode == "manual" and override is not None:
            plan = manual_plan(src_w, src_h, aspect, override.x, override.y, override.zoom)
        else:
            plan = center_plan(src_w, src_h, aspect)
        framing = ClipFraming(
            mode=plan.mode,  # type: ignore[arg-type]
            requested=mode,  # type: ignore[arg-type]
            override=override,
            source_width=src_w,
            source_height=src_h,
            crop_width=plan.crop_w,
            crop_height=plan.crop_h,
            x=round(plan.x, 1),
            y=plan.y,
            keyframes=[(round(t, 3), round(x, 1)) for t, x in plan.keyframes],
            notes=plan.notes,
        )
        if len(self._framing_cache) > 64:
            self._framing_cache.clear()
        self._framing_cache[key] = framing
        return framing

    def clip_subtitles(self, project_id: str, clip_id: str) -> ClipSubtitles:
        project = self.get(project_id)
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(404, "Ainda não há cortes sugeridos para este projeto.")
        clip = clip_set.clips[self._clip_index(clip_set, clip_id)]
        transcript = self.get_transcript(project_id)
        plan = plan_subtitles(transcript, clip.start, clip.end, project.settings, clip.subtitle_cues)
        editable = editable_cues(transcript, clip.start, clip.end, project.settings, clip.subtitle_cues)
        template = TEMPLATES[plan.template_key]
        return ClipSubtitles(
            width=plan.layout.width,
            height=plan.layout.height,
            font_size=plan.layout.font_size,
            alignment=plan.layout.alignment,
            margin_v=plan.layout.margin_v,
            margin_h=plan.layout.margin_h,
            highlight=plan.highlight,
            template=SubtitleTemplateInfo(**template.__dict__),
            cues=[
                SubtitleCueOut(
                    start=round(cue.start, 3),
                    end=round(cue.end, 3),
                    lines=[[SubtitleWordOut(start=round(w.start, 3), end=round(w.end, 3), text=w.text) for w in line] for line in cue.lines],
                )
                for cue in plan.cues
            ],
            editable=[
                EditableCue(start=round(c.start, 3), end=round(c.end, 3), text=c.text, hidden=c.hidden, edited=c.edited)
                for c in editable
            ],
            edited=clip.subtitle_cues is not None,
        )

    def clip_srt(self, project_id: str, clip_id: str) -> tuple[str, str]:
        """Legendas do corte em SRT (com as edições), para publicar como legenda separada."""
        project = self.get(project_id)
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(404, "Ainda não há cortes sugeridos para este projeto.")
        clip = clip_set.clips[self._clip_index(clip_set, clip_id)]
        transcript = self.get_transcript(project_id)
        # SRT sem caixa-alta forçada: o texto fica como na transcrição/edição.
        settings = project.settings.model_copy(update={"subtitle_style": "classico"})
        plan = plan_subtitles(transcript, clip.start, clip.end, settings, clip.subtitle_cues)
        name = self._render_filename(clip, project.settings.aspect_ratio).removesuffix(".mp4") + ".srt"
        return to_srt(plan.cues), name

    def set_clip_subtitles(self, project_id: str, clip_id: str, cues: list[SubtitleCueEdit]) -> ClipSubtitles:
        """Salva as legendas editadas do corte. Lista vazia volta às legendas automáticas."""
        with self._clips_lock:
            project, clip_set, _analyzer, _audio = self._clip_editing_context(project_id, need_analyzer=False)
            index = self._clip_index(clip_set, clip_id)
            clip = clip_set.clips[index]
            clip.subtitle_cues = self._validate_cues(project, clip, cues) if cues else None
            clip.updated_at = utcnow()
            self._save_clips(project_id, clip_set)
        return self.clip_subtitles(project_id, clip_id)

    def _validate_cues(self, project: Project, clip: Clip, cues: list[SubtitleCueEdit]) -> list[SubtitleCueEdit] | None:
        ordered = sorted(cues, key=lambda c: c.start)
        cleaned: list[SubtitleCueEdit] = []
        for number, cue in enumerate(ordered, start=1):
            start, end = max(cue.start, clip.start), min(cue.end, clip.end)
            if end - start < 0.1:
                raise ServiceError(
                    422, f"A legenda {number} precisa durar pelo menos 0,1 s e ficar dentro do corte."
                )
            if cleaned and start < cleaned[-1].end - 0.001:
                raise ServiceError(422, f"As legendas {number - 1} e {number} se sobrepõem. Ajuste os tempos.")
            text = " ".join(cue.text.split())
            cleaned.append(SubtitleCueEdit(start=round(start, 3), end=round(end, 3), text=text, hidden=cue.hidden or not text))
        # Se nada mudou em relação às legendas automáticas, o corte continua no modo automático.
        transcript = self.get_transcript(project.id)
        words = transcript_words(transcript)
        auto = auto_text_cues(words, clip.start, clip.end, subtitle_layout(project.settings).max_chars)
        same = len(auto) == len(cleaned) and all(
            abs(a.start - c.start) < 0.01 and abs(a.end - c.end) < 0.01 and not c.hidden and " ".join(a.text.split()) == c.text
            for a, c in zip(auto, cleaned)
        )
        return None if same else cleaned

    def detect(self, project_id: str, keep_curated: bool = True) -> Project:
        """Gera (ou refaz) as sugestões de cortes a partir da transcrição."""
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id):
            raise ServiceError(409, "Já existe uma tarefa em andamento neste projeto.")
        if project.transcript is None:
            raise ServiceError(409, "Transcreva o vídeo antes de sugerir cortes.")
        return self._start_job(project_id, "detect_clips", "detecting_clips", self._detect_task(project_id, keep_curated))

    def create_clip(self, project_id: str, data: ClipCreate) -> Clip:
        with self._clips_lock:
            project, clip_set, analyzer, audio = self._clip_editing_context(project_id)
            start, end = self._validate_range(project, data.start, data.end)
            clip = analyzer.evaluate_range(
                start, end, title=(data.title or "").strip() or None, origin="manual", status="approved", edited=True
            )
            self._attach_energy(analyzer, audio, clip_set, clip)
            clip_set.clips.append(clip)
            self._save_clips(project_id, clip_set)
            return clip

    def update_clip(self, project_id: str, clip_id: str, data: ClipUpdate) -> Clip:
        with self._clips_lock:
            project, clip_set, analyzer, audio = self._clip_editing_context(project_id)
            index = self._clip_index(clip_set, clip_id)
            clip = clip_set.clips[index]
            title = data.title.strip() if data.title is not None else clip.title
            status = data.status or clip.status
            if data.start is not None or data.end is not None:
                start, end = self._validate_range(
                    project,
                    data.start if data.start is not None else clip.start,
                    data.end if data.end is not None else clip.end,
                )
                updated = analyzer.evaluate_range(start, end, title=title, status=status, origin=clip.origin, edited=True)
                self._attach_energy(analyzer, audio, clip_set, updated)
                updated.id, updated.created_at = clip.id, clip.created_at
                updated.render = clip.render  # continua disponível, mas passa a constar como desatualizado
                updated.framing_override, updated.subtitle_cues = clip.framing_override, clip.subtitle_cues
            else:
                updated = clip.model_copy(update={"title": title, "status": status, "edited": clip.edited or data.title is not None})
            if "framing_override" in data.model_fields_set:
                updated.framing_override = data.framing_override
            updated.updated_at = utcnow()
            clip_set.clips[index] = updated
            self._save_clips(project_id, clip_set)
            return updated

    def delete_clip(self, project_id: str, clip_id: str) -> None:
        with self._clips_lock:
            _project, clip_set, _analyzer, _audio = self._clip_editing_context(project_id, need_analyzer=False)
            clip = clip_set.clips.pop(self._clip_index(clip_set, clip_id))
            if clip.render is not None:
                (self.store.exports_dir(project_id) / clip.render.filename).unlink(missing_ok=True)
            self._save_clips(project_id, clip_set)

    def thumbnail_path(self, project_id: str) -> Path:
        project = self.get(project_id)
        path = self.store.project_dir(project_id) / project.thumbnail if project.thumbnail else None
        if path is None or not path.is_file():
            raise ServiceError(404, "Miniatura indisponível.")
        return path

    def source_path(self, project_id: str) -> Path:
        project = self.get(project_id)
        if project.status == "importing" or not project.source.filename:
            raise ServiceError(404, "O vídeo deste projeto ainda não está disponível.")
        path = self.store.project_dir(project_id) / project.source.filename
        if not path.is_file():
            raise ServiceError(404, "O arquivo de vídeo não foi encontrado no disco.")
        return path

    def disk_usage(self) -> tuple[int, int] | None:
        """(livre, total) em bytes no disco da pasta de dados."""
        try:
            usage = shutil.disk_usage(self.config.data_dir)
        except OSError:
            return None
        return usage.free, usage.total

    def _require_free_space(self, needed: int, action: str) -> None:
        usage = self.disk_usage()
        if usage is None or usage[0] >= needed + MIN_FREE_BYTES:
            return
        free_mb = usage[0] / 1024 / 1024
        need_mb = (needed + MIN_FREE_BYTES) / 1024 / 1024
        raise ServiceError(
            507,
            f"Espaço em disco insuficiente para {action}: há {free_mb:,.0f} MB livres e são necessários cerca de "
            f"{need_mb:,.0f} MB. Libere espaço (por exemplo, excluindo vídeos exportados ou projetos antigos)."
            .replace(",", "."),
        )

    def stats(self) -> SystemStats:
        projects = self.store.list()
        by_status: dict[str, int] = {}
        for project in projects:
            by_status[project.status] = by_status.get(project.status, 0) + 1
        storage = 0
        for root, _dirs, files in os.walk(self.config.data_dir):
            for name in files:
                try:
                    storage += (Path(root) / name).stat().st_size
                except OSError:
                    pass
        return SystemStats(
            projects_total=len(projects),
            projects_by_status=by_status,
            active_jobs=self.jobs.active_count(),
            storage_bytes=storage,
            exports_total=len(self.list_exports()),
            disk_free_bytes=usage[0] if (usage := self.disk_usage()) else None,
        )

    def list_exports(self, project_id: str | None = None) -> list[ExportedVideo]:
        exports: list[ExportedVideo] = []
        projects = [self.get(project_id)] if project_id else self.store.list()
        for project in projects:
            folder = self.store.exports_dir(project.id)
            if not folder.is_dir():
                continue
            clip_set = self._load_clips(project)
            by_file = {c.render.filename: c for c in clip_set.clips if c.render} if clip_set else {}
            for file in folder.iterdir():
                if not file.is_file() or file.suffix.lower() != ".mp4" or ".part." in file.name:
                    continue
                stat = file.stat()
                clip = by_file.get(file.name)
                render = clip.render if clip else None
                exports.append(
                    ExportedVideo(
                        project_id=project.id,
                        project_title=project.title,
                        filename=file.name,
                        size_bytes=stat.st_size,
                        created_at=_mtime(stat.st_mtime),
                        url=f"/api/projects/{project.id}/exports/{file.name}",
                        clip_id=clip.id if clip else None,
                        clip_title=clip.title if clip else None,
                        aspect_ratio=render.aspect_ratio if render else None,
                        width=render.width if render else None,
                        height=render.height if render else None,
                        duration_seconds=render.duration_seconds if render else None,
                        stale=bool(clip and render and render.signature != self._render_signature(project, clip)),
                    )
                )
        exports.sort(key=lambda e: e.created_at, reverse=True)
        return exports

    def export_path(self, project_id: str, filename: str) -> Path:
        self.get(project_id)
        if sanitize_filename(filename) != filename or not filename.lower().endswith(".mp4"):
            raise ServiceError(404, "Arquivo exportado não encontrado.")
        path = self.store.exports_dir(project_id) / filename
        if not path.is_file():
            raise ServiceError(404, "Arquivo exportado não encontrado.")
        return path

    def delete_export(self, project_id: str, filename: str) -> None:
        """Exclui um MP4 exportado; o corte continua no projeto e pode ser gerado de novo."""
        path = self.export_path(project_id, filename)
        self._delete_export_files(project_id, [path])

    def delete_exports(self, project_id: str) -> ExportsDeleted:
        """Exclui todos os MP4 exportados do projeto (libera espaço; os cortes são mantidos)."""
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id) and project.job.kind == "render_clips":
            raise ServiceError(409, "Aguarde a geração dos vídeos terminar (ou cancele-a) antes de excluir os arquivos.")
        folder = self.store.exports_dir(project_id)
        files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() == ".mp4"] if folder.is_dir() else []
        freed = sum(f.stat().st_size for f in files)
        self._delete_export_files(project_id, files)
        return ExportsDeleted(deleted=len(files), freed_bytes=freed)

    def _delete_export_files(self, project_id: str, files: list[Path]) -> None:
        names = {f.name for f in files}
        with self._clips_lock:
            for file in files:
                try:
                    file.unlink(missing_ok=True)
                except OSError as exc:
                    raise ServiceError(
                        409, f"Não foi possível excluir “{file.name}”. Feche o vídeo se ele estiver aberto em outro programa."
                    ) from exc
            project = self.get(project_id)
            clip_set = self._load_clips(project)
            if clip_set is not None and any(c.render and c.render.filename in names for c in clip_set.clips):
                for clip in clip_set.clips:
                    if clip.render is not None and clip.render.filename in names:
                        clip.render = None
                self._save_clips(project_id, clip_set)

    def storage(self, project_id: str) -> ProjectStorage:
        """Espaço em disco usado pelo projeto, por tipo de arquivo."""
        project = self.get(project_id)
        folder = self.store.project_dir(project_id)
        exports_dir = self.store.exports_dir(project_id)
        source = audio = exports = other = 0
        exports_count = 0
        for root, _dirs, files in os.walk(folder):
            for name in files:
                path = Path(root) / name
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                if path.parent == exports_dir:
                    exports += size
                    exports_count += path.suffix.lower() == ".mp4"
                elif project.source.filename and path == folder / project.source.filename:
                    source += size
                elif project.audio and path == folder / project.audio.filename:
                    audio += size
                else:
                    other += size
        return ProjectStorage(
            project_id=project_id,
            source_bytes=source,
            audio_bytes=audio,
            exports_bytes=exports,
            other_bytes=other,
            total_bytes=source + audio + exports + other,
            exports_count=exports_count,
        )

    def storage_all(self) -> list[ProjectStorage]:
        result: list[ProjectStorage] = []
        for project in self.store.list():
            try:
                result.append(self.storage(project.id))
            except ServiceError:
                continue
        return result

    # ------------------------------------------------------------------ criação

    async def create_from_upload(
        self,
        chunks: AsyncIterator[bytes],
        filename: str,
        title: str | None,
        settings: ClipSettings | None,
        declared_length: int | None,
        content_type: str | None,
    ) -> Project:
        original_name = sanitize_filename(filename)
        try:
            check_extension(original_name)
        except InvalidVideo as exc:
            raise ServiceError(415, str(exc)) from exc

        app_settings = self.settings_store.get()
        max_bytes = app_settings.max_upload_bytes
        if declared_length is not None and declared_length > max_bytes:
            raise ServiceError(413, _too_large_message(app_settings))
        self._require_free_space(declared_length or 0, "receber este vídeo")

        self.config.tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.config.tmp_dir / f"{new_id()}.part"
        written = 0
        header = b""
        container: str | None = None
        project: Project | None = None
        try:
            with open(tmp, "wb") as fh:
                buffer = bytearray()
                async for chunk in chunks:
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        raise ServiceError(413, _too_large_message(app_settings))
                    if container is None:
                        header += chunk[: SIGNATURE_BYTES - len(header)]
                        if len(header) >= SIGNATURE_BYTES:
                            container = self._require_container(header)
                    buffer += chunk
                    if len(buffer) >= self.config.io_chunk_size:
                        data = bytes(buffer)
                        buffer.clear()
                        await anyio.to_thread.run_sync(fh.write, data)
                if buffer:
                    await anyio.to_thread.run_sync(fh.write, bytes(buffer))
            if written == 0:
                raise ServiceError(400, "O arquivo enviado está vazio.")
            if container is None:
                container = self._require_container(header)

            stored_name = "source" + _stored_extension(original_name, container)
            mismatch = container_mismatch_warning(original_name, container)
            project = Project(
                title=(title or "").strip()[:200] or _title_from_name(original_name),
                status="validating",
                source=SourceInfo(
                    kind="upload",
                    original_name=original_name,
                    filename=stored_name,
                    size_bytes=written,
                    content_type=_video_content_type(content_type),
                    container=container,
                ),
                settings=settings or app_settings.clip_defaults,
                warnings=[mismatch] if mismatch else [],
            )
            self.store.create(project)
            os.replace(tmp, self.store.project_dir(project.id) / stored_name)
        except BaseException:
            tmp.unlink(missing_ok=True)
            if project is not None and self.store.exists(project.id):
                shutil.rmtree(self.store.project_dir(project.id), ignore_errors=True)
            raise
        return self._start_job(project.id, "process", "validating", self._process_task(project.id))

    def create_from_link(self, request: LinkImportRequest) -> Project:
        if not request.rights_confirmed:
            raise ServiceError(
                400, "Confirme que você possui autorização para utilizar este conteúdo antes de importar."
            )
        app_settings = self.settings_store.get()
        try:
            url = check_url(request.url, app_settings.allowed_link_domains)
        except LinkPolicyError as exc:
            raise ServiceError(400, str(exc)) from exc
        self._require_free_space(0, "importar um vídeo")
        name = filename_from_response(url, None)
        project = Project(
            title=(request.title or "").strip()[:200] or _title_from_name(name),
            status="importing",
            source=SourceInfo(kind="link", original_name=name, url=url),
            settings=request.settings or app_settings.clip_defaults,
        )
        self.store.create(project)
        return self._start_job(project.id, "import_link", "importing", self._link_task(project.id))

    # ------------------------------------------------------------------ alterações

    def update(self, project_id: str, changes: ProjectUpdate) -> Project:
        self.get(project_id)

        def mutate(project: Project) -> None:
            if changes.title is not None:
                project.title = changes.title
            if changes.settings is not None:
                project.settings = changes.settings

        return self.store.update(project_id, mutate)

    def transcribe(self, project_id: str) -> Project:
        """Inicia (ou refaz) a transcrição do áudio extraído."""
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id):
            raise ServiceError(409, "Já existe uma tarefa em andamento neste projeto.")
        if not self._has_audio(project):
            raise ServiceError(409, "Extraia o áudio do vídeo antes de transcrever.")
        return self._start_job(project_id, "transcribe", "transcribing", self._transcribe_task(project_id))

    def cancel(self, project_id: str) -> Project:
        project = self.get(project_id)
        if project.job is None or not self.jobs.is_active(project.job.id):
            raise ServiceError(409, "Não há nenhuma tarefa em andamento neste projeto.")
        self.jobs.cancel(project.job.id)
        return self.get(project_id)

    def retry(self, project_id: str) -> Project:
        """Reinicia o processamento após erro, cancelamento ou interrupção.

        Também processa projetos criados na Etapa 1, que estão prontos mas ainda sem áudio extraído.
        """
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id):
            raise ServiceError(409, "Já existe uma tarefa em andamento neste projeto.")
        needs_audio = project.status == "ready" and project.audio is None
        if project.status not in ("failed", "cancelled", "interrupted") and not needs_audio:
            raise ServiceError(409, "Este projeto não precisa ser reprocessado.")
        # Retoma só a etapa que falhou quando as anteriores já estão prontas.
        if project.job is not None and project.job.kind == "render_clips" and project.clips is not None:
            pending = self._pending_renders(project)
            if pending:
                return self._start_job(project_id, "render_clips", "rendering", self._render_task(project_id, pending))
        if project.job is not None and project.job.kind == "detect_clips" and project.transcript is not None:
            return self._start_job(project_id, "detect_clips", "detecting_clips", self._detect_task(project_id, True))
        if project.job is not None and project.job.kind == "transcribe" and self._has_audio(project):
            return self._start_job(project_id, "transcribe", "transcribing", self._transcribe_task(project_id))
        source_file = (
            self.store.project_dir(project_id) / project.source.filename if project.source.filename else None
        )
        if source_file is not None and source_file.is_file():
            return self._start_job(project_id, "process", "validating", self._process_task(project_id))
        if project.source.kind == "link" and project.source.url:
            return self._start_job(project_id, "import_link", "importing", self._link_task(project_id))
        raise ServiceError(409, "O arquivo original não existe mais. Crie um novo projeto enviando o vídeo novamente.")

    def delete(self, project_id: str) -> None:
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id):
            self.jobs.cancel(project.job.id)
            if not self.jobs.wait(project.job.id, timeout=15):
                raise ServiceError(409, "A tarefa do projeto ainda está sendo encerrada. Tente novamente em instantes.")
        try:
            self.store.delete(project_id)
        except ProjectNotFound as exc:
            raise ServiceError(404, "Projeto não encontrado.") from exc
        except OSError as exc:
            raise ServiceError(
                409, f"Não foi possível excluir todos os arquivos do projeto (algum arquivo está em uso?): {exc}"
            ) from exc

    def recover_after_restart(self) -> int:
        """Marca como interrompidas as tarefas que estavam ativas quando a aplicação foi fechada."""
        leftovers = [*self.config.tmp_dir.glob("*.part"), *self.config.projects_dir.glob("*/*.part.*")]
        for leftover in leftovers:
            try:
                leftover.unlink()
            except OSError:
                logger.warning("Não foi possível remover o arquivo temporário %s", leftover)
        recovered = 0
        for project in self.store.list():
            if project.job is None or project.job.status not in ACTIVE_JOB_STATUSES:
                continue

            def mutate(p: Project) -> None:
                assert p.job is not None
                p.job.status = "interrupted"
                p.job.finished_at = utcnow()
                p.job.error = INTERRUPTED_MESSAGE
                p.status = "interrupted"
                p.error = INTERRUPTED_MESSAGE

            self.store.update(project.id, mutate)
            recovered += 1
        return recovered

    def shutdown(self) -> None:
        self.jobs.shutdown(cancel_running=True)

    # ------------------------------------------------------------------ tarefas

    def _require_container(self, header: bytes) -> str:
        try:
            return require_container(header)
        except InvalidVideo as exc:
            raise ServiceError(415, str(exc)) from exc

    def _start_job(self, project_id: str, kind: JobKind, status: ProjectStatus, task) -> Project:
        job = JobInfo(kind=kind, message="Na fila")
        with self._job_lock:
            self._job_projects[job.id] = project_id

        def mutate(project: Project) -> None:
            project.job = job
            project.status = status
            project.error = None

        project = self.store.update(project_id, mutate)
        self.jobs.submit(job.id, task)
        return project

    def _process_task(self, project_id: str):
        def task(ctx: JobContext) -> None:
            self._process_source(ctx, project_id, 0.0, 1.0)

        return task

    def _link_task(self, project_id: str):
        def task(ctx: JobContext) -> None:
            project = self.store.get(project_id)
            settings: AppSettings = self.settings_store.get()
            assert project.source.url is not None
            tmp = self.config.tmp_dir / f"{ctx.job_id}.part"
            try:
                result = download_video(
                    ctx,
                    project.source.url,
                    tmp,
                    settings.allowed_link_domains,
                    settings.max_upload_bytes,
                    client_factory=self._client_factory,
                    chunk_size=self.config.io_chunk_size,
                    progress_scale=DOWNLOAD_PROGRESS_SHARE,
                )
                stored_name = "source" + _stored_extension(result.original_name, result.container)
                os.replace(tmp, self.store.project_dir(project_id) / stored_name)
            finally:
                tmp.unlink(missing_ok=True)

            def mutate(p: Project) -> None:
                p.status = "validating"
                p.source.original_name = result.original_name
                p.source.filename = stored_name
                p.source.size_bytes = result.size_bytes
                p.source.content_type = result.content_type
                p.source.container = result.container

            self.store.update(project_id, mutate)
            self._process_source(ctx, project_id, DOWNLOAD_PROGRESS_SHARE, 1.0)

        return task

    def _process_source(self, ctx: JobContext, project_id: str, start: float, end: float) -> None:
        """Verifica o arquivo, lê a mídia com FFprobe, gera a miniatura e extrai o áudio."""
        # Localiza o FFmpeg antes de tudo para falhar rápido, sem reler arquivos grandes à toa.
        tools = find_tools(self.settings_store.get().ffmpeg_dir)
        span = end - start
        verify_end = start + span * VERIFY_SHARE
        probe_end = verify_end + span * PROBE_SHARE
        self._verify_source(ctx, project_id, start, verify_end)

        def set_extracting(p: Project) -> None:
            p.status = "extracting_audio"
            p.media = None
            p.audio = None
            p.transcript = None

        project = self.store.update(project_id, set_extracting)
        assert project.source.filename is not None
        folder = self.store.project_dir(project_id)
        source = folder / project.source.filename

        ctx.progress(verify_end, "Lendo informações do vídeo (FFprobe)", force=True)
        media = probe(tools, source)
        # Salva as informações antes de validar, para a interface mostrar o que foi lido mesmo em caso de erro.
        self.store.update(project_id, lambda p: setattr(p, "media", media))
        require_processable(media)

        thumbnail: str | None = None
        try:
            make_thumbnail(ctx, tools, source, folder / THUMBNAIL_FILENAME, media)
            thumbnail = THUMBNAIL_FILENAME
        except MediaError as exc:
            # A miniatura é apenas visual; a falha não impede o processamento.
            logger.warning("Miniatura não gerada para %s: %s", project_id, exc)
        self.store.update(project_id, lambda p: setattr(p, "thumbnail", thumbnail))

        audio = extract_audio(
            ctx, tools, source, folder / AUDIO_FILENAME, media, progress_start=probe_end, progress_end=end
        )
        self.store.update(project_id, lambda p: setattr(p, "audio", audio))

    def _has_audio(self, project: Project) -> bool:
        return project.audio is not None and (self.store.project_dir(project.id) / project.audio.filename).is_file()

    def _transcribe_task(self, project_id: str):
        def task(ctx: JobContext) -> None:
            project = self.store.get(project_id)
            if project.audio is None:
                raise MediaError("O projeto não possui áudio extraído.")
            folder = self.store.project_dir(project_id)
            settings = self.settings_store.get().transcription
            transcript = self.engine.transcribe(
                ctx, folder / project.audio.filename, project.settings.subtitle_language, settings
            )
            ctx.check_cancelled()
            atomic_write_text(folder / TRANSCRIPT_FILENAME, transcript.model_dump_json())
            summary = TranscriptSummary(
                filename=TRANSCRIPT_FILENAME,
                engine=transcript.engine,
                model=transcript.model,
                language=transcript.language,
                segment_count=len(transcript.segments),
                word_count=transcript.word_count,
                duration_seconds=transcript.duration_seconds,
                created_at=transcript.created_at,
            )
            self.store.update(project_id, lambda p: setattr(p, "transcript", summary))

        return task

    def _detect_task(self, project_id: str, keep_curated: bool):
        def task(ctx: JobContext) -> None:
            project = self.store.get(project_id)
            transcript = self.get_transcript(project_id)
            weights = self.settings_store.get().clip_detection.weights
            keep: list[Clip] = []
            if keep_curated:
                previous = self._load_clips(project)
                if previous is not None:
                    keep = [
                        c
                        for c in previous.clips
                        if c.status != "suggested" or c.origin == "manual" or c.edited or c.render is not None
                    ]
            audio = self.store.project_dir(project_id) / project.audio.filename if self._has_audio(project) else None
            clip_set = detect_clips(
                transcript,
                duration_preset=project.settings.duration,
                max_clips=project.settings.max_clips,
                weights=weights,
                energy_source=audio,
                keep=keep,
                progress=lambda fraction, message: ctx.progress(fraction, message),
            )
            ctx.check_cancelled()
            with self._clips_lock:
                self._save_clips(project_id, clip_set)

        return task

    # ------------------------------------------------------------------ cortes (armazenamento)

    def _load_clips(self, project: Project) -> ClipSet | None:
        if project.clips is None:
            return None
        path = self.store.project_dir(project.id) / project.clips.filename
        if not path.is_file():
            return None
        return ClipSet.model_validate_json(path.read_text(encoding="utf-8"))

    def _save_clips(self, project_id: str, clip_set: ClipSet) -> None:
        clip_set.clips.sort(key=lambda c: (c.status == "rejected", -c.score))
        atomic_write_text(self.store.project_dir(project_id) / CLIPS_FILENAME, clip_set.model_dump_json())
        summary = ClipsSummary(
            filename=CLIPS_FILENAME,
            count=sum(1 for c in clip_set.clips if c.status != "rejected"),
            approved=sum(1 for c in clip_set.clips if c.status == "approved"),
            generated_at=clip_set.generated_at,
            rendered=sum(1 for c in clip_set.clips if c.render is not None),
        )
        self.store.update(project_id, lambda p: setattr(p, "clips", summary))

    def _clip_editing_context(self, project_id: str, need_analyzer: bool = True):
        project = self.get(project_id)
        if project.job is not None and self.jobs.is_active(project.job.id) and project.job.kind == "detect_clips":
            raise ServiceError(409, "Aguarde a detecção de cortes terminar para editar.")
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(409, "Gere as sugestões de cortes antes de editá-las.")
        analyzer = None
        if need_analyzer:
            transcript = self.get_transcript(project_id)
            analyzer = ClipAnalyzer(transcript, clip_set.weights, clip_set.duration_preset)
        audio = self.store.project_dir(project_id) / project.audio.filename if self._has_audio(project) else None
        return project, clip_set, analyzer, audio

    def _attach_energy(self, analyzer: ClipAnalyzer, audio: Path | None, clip_set: ClipSet, clip: Clip) -> None:
        """Recalcula o critério de ênfase medindo só o trecho do corte."""
        if audio is None or clip_set.audio_reference_db is None:
            return
        analyzer.energy = partial_energy(audio, clip.start, clip.end, clip_set.audio_reference_db)
        if analyzer.energy is None:
            return
        rescored = analyzer.evaluate_range(
            clip.start, clip.end, title=clip.title, status=clip.status, origin=clip.origin, edited=clip.edited
        )
        clip.score, clip.components = rescored.score, rescored.components
        clip.highlights, clip.warnings = rescored.highlights, rescored.warnings

    @staticmethod
    def _clip_index(clip_set: ClipSet, clip_id: str) -> int:
        for index, clip in enumerate(clip_set.clips):
            if clip.id == clip_id:
                return index
        raise ServiceError(404, "Corte não encontrado.")

    @staticmethod
    def _validate_range(project: Project, start: float, end: float) -> tuple[float, float]:
        limit = project.media.duration_seconds if project.media else None
        if limit is not None and start >= limit:
            raise ServiceError(422, "O início do corte está depois do fim do vídeo.")
        if limit is not None:
            end = min(end, limit)
        if end - start < MIN_CLIP_SECONDS:
            raise ServiceError(422, "O fim do corte precisa ser pelo menos 1 segundo depois do início.")
        if end - start > MAX_CLIP_SECONDS:
            raise ServiceError(422, f"Um corte pode ter no máximo {int(MAX_CLIP_SECONDS)} segundos.")
        return start, end

    @staticmethod
    def _render_signature(project: Project, clip: Clip) -> str:
        settings = project.settings
        payload = {
            "start": round(clip.start, 3),
            "end": round(clip.end, 3),
            "aspect": settings.aspect_ratio,
            "style": settings.subtitle_style,
            "size": settings.subtitle_font_size,
            "position": settings.subtitle_position,
            "highlight": settings.highlight_current_word,
            "framing": settings.framing,
            "transcript": project.transcript.created_at.isoformat() if project.transcript else None,
        }
        # Edições do editor entram na assinatura só quando existem (vídeos antigos continuam válidos).
        if clip.framing_override is not None:
            payload["framing_override"] = clip.framing_override.model_dump(mode="json")
        if clip.subtitle_cues is not None:
            payload["subtitle_cues"] = [c.model_dump(mode="json") for c in clip.subtitle_cues]
        return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]

    def _pending_renders(self, project: Project) -> list[str]:
        clip_set = self._load_clips(project)
        if clip_set is None:
            return []
        return [
            c.id
            for c in clip_set.clips
            if c.status == "approved" and (c.render is None or c.render.signature != self._render_signature(project, c))
        ]

    def _render_context(self, project_id: str, clip_id: str):
        project = self.get(project_id)
        if project.transcript is None or project.media is None or not project.source.filename:
            raise ServiceError(409, "O vídeo precisa estar processado e transcrito.")
        clip_set = self._load_clips(project)
        if clip_set is None:
            raise ServiceError(404, "Ainda não há cortes sugeridos para este projeto.")
        clip = clip_set.clips[self._clip_index(clip_set, clip_id)]
        tools = find_tools(self.settings_store.get().ffmpeg_dir)
        source = self.store.project_dir(project_id) / project.source.filename
        return project, clip, self.get_transcript(project_id), tools, source

    @staticmethod
    def _render_filename(clip: Clip, aspect: str) -> str:
        decomposed = unicodedata.normalize("NFD", clip.title.lower())
        ascii_title = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
        slug = _SLUG_INVALID.sub("-", ascii_title).strip("-")[:50].rstrip("-") or "corte"
        return f"{slug}-{clip.id[:6]}-{aspect.replace(':', 'x')}.mp4"

    def _render_task(self, project_id: str, clip_ids: list[str]):
        def task(ctx: JobContext) -> None:
            total = len(clip_ids)
            for index, clip_id in enumerate(clip_ids):
                ctx.check_cancelled()
                try:
                    project, clip, transcript, tools, source = self._render_context(project_id, clip_id)
                except ServiceError as exc:
                    if exc.status_code == 404:
                        continue  # o corte foi excluído enquanto a fila andava
                    raise MediaError(exc.message) from exc
                settings: ClipSettings = project.settings
                filename = self._render_filename(clip, settings.aspect_ratio)
                exports = self.store.exports_dir(project_id)
                start = index / total
                ctx.progress(start, f"Corte {index + 1} de {total}: {clip.title[:40]}", force=True)
                result = render_clip(
                    ctx, tools, source, project.media, transcript, clip.start, clip.end, settings, exports / filename,
                    framing=clip.framing_override, subtitle_edits=clip.subtitle_cues,
                    progress_start=start, progress_end=(index + 1) / total,
                )  # fmt: skip
                info = RenderInfo(
                    filename=filename,
                    aspect_ratio=settings.aspect_ratio,
                    width=result.width,
                    height=result.height,
                    duration_seconds=result.duration,
                    size_bytes=result.size_bytes,
                    framing=result.framing,  # type: ignore[arg-type]
                    subtitle_style=settings.subtitle_style,
                    subtitle_cues=result.cue_count,
                    signature=self._render_signature(project, clip),
                    notes=result.notes,
                )
                with self._clips_lock:
                    current = self._load_clips(self.store.get(project_id))
                    found = next((c for c in current.clips if c.id == clip_id), None) if current else None
                    if found is None:
                        (exports / filename).unlink(missing_ok=True)
                        continue
                    if found.render is not None and found.render.filename != filename:
                        try:
                            (exports / found.render.filename).unlink(missing_ok=True)
                        except OSError:
                            logger.warning("Vídeo antigo %s não pôde ser excluído (aberto em outro programa?)", found.render.filename)
                    found.render = info
                    self._save_clips(project_id, current)

        return task

    def _verify_source(self, ctx: JobContext, project_id: str, start: float, end: float) -> None:
        project = self.store.get(project_id)
        if not project.source.filename:
            raise InvalidVideo("O projeto não possui arquivo de vídeo.")
        path = self.store.project_dir(project_id) / project.source.filename
        container, size, sha256 = verify_video_file(path, ctx, self.config.io_chunk_size, start, end)

        duplicates = [p.title for p in self.store.list() if p.id != project_id and p.source.sha256 == sha256]
        warnings: list[str] = []
        mismatch = container_mismatch_warning(project.source.original_name, container)
        if mismatch:
            warnings.append(mismatch)
        if duplicates:
            warnings.append(f"Este vídeo é idêntico ao do projeto “{duplicates[0]}”.")

        def mutate(p: Project) -> None:
            p.source.container = container
            p.source.size_bytes = size
            p.source.sha256 = sha256
            p.warnings = warnings

        self.store.update(project_id, mutate)

    # ------------------------------------------------------------------ JobListener

    def _update_job(self, job_id: str, mutate, *, release: bool = False) -> None:
        with self._job_lock:
            project_id = self._job_projects.pop(job_id, None) if release else self._job_projects.get(job_id)
        if project_id is None or not is_valid_project_id(project_id):
            return

        def guarded(project: Project) -> None:
            if project.job is not None and project.job.id == job_id:
                mutate(project)

        try:
            self.store.update(project_id, guarded)
        except ProjectNotFound:
            pass  # projeto excluído enquanto a tarefa terminava

    def job_started(self, job_id: str) -> None:
        def mutate(project: Project) -> None:
            assert project.job is not None
            project.job.status = "running"
            project.job.started_at = utcnow()
            project.job.message = "Iniciando"

        self._update_job(job_id, mutate)

    def job_progress(self, job_id: str, progress: float | None, message: str) -> None:
        def mutate(project: Project) -> None:
            assert project.job is not None
            project.job.progress = progress
            project.job.message = message

        self._update_job(job_id, mutate)

    def job_finished(self, job_id: str, status: str, error: str | None) -> None:
        settings = self.settings_store.get()
        auto_transcribe = status == "completed" and settings.transcription.auto_transcribe
        auto_detect = status == "completed" and settings.clip_detection.auto_detect
        next_job: JobInfo | None = None

        def mutate(project: Project) -> None:
            nonlocal next_job
            assert project.job is not None
            project.job.status = status  # type: ignore[assignment]
            project.job.finished_at = utcnow()
            project.job.error = error
            if status == "completed":
                project.job.progress = 1.0
                project.job.message = "Concluído"
                project.status = "ready"
                project.error = None
                # Encadeia a transcrição na MESMA gravação: a interface nunca vê o projeto
                # "pronto e sem tarefa" entre a extração do áudio e o início da transcrição.
                if (
                    auto_transcribe
                    and project.job.kind in ("process", "import_link")
                    and project.transcript is None
                    and self._has_audio(project)
                ):
                    next_job = JobInfo(kind="transcribe", message="Na fila")
                    project.job = next_job
                    project.status = "transcribing"
                elif auto_detect and project.job.kind == "transcribe" and project.transcript is not None:
                    next_job = JobInfo(kind="detect_clips", message="Na fila")
                    project.job = next_job
                    project.status = "detecting_clips"
            elif status == "cancelled":
                project.job.message = "Cancelado pelo usuário"
                project.status = "cancelled"
            else:
                project.job.message = "Falhou"
                project.status = "failed"
                project.error = error

        with self._job_lock:
            project_id = self._job_projects.get(job_id)
        self._update_job(job_id, mutate, release=True)
        if next_job is not None and project_id is not None:
            task = (
                self._transcribe_task(project_id)
                if next_job.kind == "transcribe"
                else self._detect_task(project_id, keep_curated=True)
            )
            self._submit_existing_job(project_id, next_job, task)

    def _submit_existing_job(self, project_id: str, job: JobInfo, task) -> None:
        with self._job_lock:
            self._job_projects[job.id] = project_id
        try:
            self.jobs.submit(job.id, task)
        except RuntimeError:  # aplicação sendo encerrada: a tarefa será marcada como interrompida
            logger.warning("Etapa automática de %s não iniciada: aplicação encerrando.", project_id)


def _too_large_message(settings: AppSettings) -> str:
    return (
        f"O arquivo excede o limite de {settings.max_upload_size_mb} MB definido em Configurações."
    )


def _video_content_type(value: str | None) -> str | None:
    if not value:
        return None
    base = value.split(";", 1)[0].strip().lower()
    return base if base.startswith("video/") else None


def _mtime(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)
