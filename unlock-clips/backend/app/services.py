"""Regras de negócio dos projetos: criação, tarefas em segundo plano e recuperação."""

from __future__ import annotations

import logging
import os
import shutil
import threading
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
from .jobs import JobContext, JobManager
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
    ClipSettings,
    ExportedVideo,
    JobInfo,
    JobKind,
    LinkImportRequest,
    Project,
    ProjectStatus,
    ProjectUpdate,
    SourceInfo,
    SystemStats,
    new_id,
    utcnow,
)
from .storage import ProjectNotFound, ProjectStore, SettingsStore, is_valid_project_id

logger = logging.getLogger(__name__)

INTERRUPTED_MESSAGE = (
    "A aplicação foi encerrada antes de concluir esta tarefa. Clique em “Tentar novamente” para retomar."
)
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
    ) -> None:
        self.config = config
        self.store = store
        self.settings_store = settings_store
        self._client_factory = client_factory
        self._job_projects: dict[str, str] = {}
        self._job_lock = threading.Lock()
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
        )

    def list_exports(self) -> list[ExportedVideo]:
        exports: list[ExportedVideo] = []
        for project in self.store.list():
            folder = self.store.exports_dir(project.id)
            if not folder.is_dir():
                continue
            for file in folder.iterdir():
                if not file.is_file() or file.suffix.lower() != ".mp4":
                    continue
                stat = file.stat()
                exports.append(
                    ExportedVideo(
                        project_id=project.id,
                        project_title=project.title,
                        filename=file.name,
                        size_bytes=stat.st_size,
                        created_at=_mtime(stat.st_mtime),
                        url=f"/api/projects/{project.id}/exports/{file.name}",
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
        def mutate(project: Project) -> None:
            assert project.job is not None
            project.job.status = status  # type: ignore[assignment]
            project.job.finished_at = utcnow()
            project.job.error = error
            if status == "completed":
                project.job.progress = 1.0
                project.job.message = "Concluído"
                project.status = "ready"
                project.error = None
            elif status == "cancelled":
                project.job.message = "Cancelado pelo usuário"
                project.status = "cancelled"
            else:
                project.job.message = "Falhou"
                project.status = "failed"
                project.error = error

        self._update_job(job_id, mutate, release=True)


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
