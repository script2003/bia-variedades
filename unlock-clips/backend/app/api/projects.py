"""Rotas de projetos: upload, importação por link, consulta, edição e tarefas."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import ValidationError

from ..schemas import ClipSettings, LinkImportRequest, Project, ProjectUpdate, Transcript
from ..transcription import to_srt, to_text, to_vtt
from ..services import ProjectService
from .deps import get_service

router = APIRouter(prefix="/api/projects", tags=["projetos"])

Service = Annotated[ProjectService, Depends(get_service)]


@router.get("", response_model=list[Project])
def list_projects(service: Service) -> list[Project]:
    return service.list()


@router.post("/upload", response_model=Project, status_code=201)
async def upload_video(
    request: Request,
    service: Service,
    filename: Annotated[str, Query(min_length=1, max_length=255)],
    title: Annotated[str | None, Query(max_length=200)] = None,
    settings: Annotated[str | None, Query(max_length=4000, description="ClipSettings em JSON")] = None,
) -> Project:
    """Recebe o vídeo como corpo bruto da requisição (sem multipart).

    O arquivo é gravado em disco em blocos, sem ser carregado inteiro na memória.
    """
    clip_settings: ClipSettings | None = None
    if settings:
        try:
            clip_settings = ClipSettings.model_validate_json(settings)
        except ValidationError as exc:
            raise HTTPException(422, f"Configurações de corte inválidas: {exc.errors()[0]['msg']}") from exc
    length_header = request.headers.get("content-length")
    declared = int(length_header) if length_header and length_header.isdigit() else None
    return await service.create_from_upload(
        request.stream(),
        filename=filename,
        title=title,
        settings=clip_settings,
        declared_length=declared,
        content_type=request.headers.get("content-type"),
    )


@router.post("/from-link", response_model=Project, status_code=201)
def import_from_link(body: LinkImportRequest, service: Service) -> Project:
    return service.create_from_link(body)


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: str, service: Service) -> Project:
    return service.get(project_id)


@router.patch("/{project_id}", response_model=Project)
def update_project(project_id: str, body: ProjectUpdate, service: Service) -> Project:
    return service.update(project_id, body)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, service: Service) -> Response:
    service.delete(project_id)
    return Response(status_code=204)


@router.post("/{project_id}/cancel", response_model=Project)
def cancel_job(project_id: str, service: Service) -> Project:
    return service.cancel(project_id)


@router.post("/{project_id}/retry", response_model=Project)
def retry_job(project_id: str, service: Service) -> Project:
    return service.retry(project_id)


@router.get("/{project_id}/source")
def stream_source(project_id: str, service: Service) -> FileResponse:
    """Serve o vídeo original com suporte a requisições parciais (Range) para o player."""
    path = service.source_path(project_id)
    return FileResponse(path, content_disposition_type="inline", filename=path.name)


@router.get("/{project_id}/audio")
def stream_audio(project_id: str, service: Service) -> FileResponse:
    """Áudio extraído (WAV mono 16 kHz), com suporte a Range para o player."""
    path = service.audio_path(project_id)
    return FileResponse(path, media_type="audio/wav", content_disposition_type="inline", filename=path.name)


@router.post("/{project_id}/transcribe", response_model=Project)
def transcribe(project_id: str, service: Service) -> Project:
    """Inicia (ou refaz) a transcrição do áudio extraído com o modelo configurado."""
    return service.transcribe(project_id)


@router.get("/{project_id}/transcript", response_model=Transcript)
def get_transcript(project_id: str, service: Service) -> Transcript:
    return service.get_transcript(project_id)


_TRANSCRIPT_FORMATS = {
    "srt": (to_srt, "application/x-subrip"),
    "vtt": (to_vtt, "text/vtt"),
    "txt": (to_text, "text/plain"),
}


@router.get("/{project_id}/transcript.{fmt}")
def download_transcript(project_id: str, fmt: str, service: Service) -> PlainTextResponse:
    if fmt not in _TRANSCRIPT_FORMATS:
        raise HTTPException(404, "Formato não suportado. Use srt, vtt ou txt.")
    transcript = service.get_transcript(project_id)
    render, media_type = _TRANSCRIPT_FORMATS[fmt]
    filename = f"transcricao-{project_id[:8]}.{fmt}"
    return PlainTextResponse(
        render(transcript),
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{project_id}/thumbnail")
def thumbnail(project_id: str, service: Service) -> FileResponse:
    path = service.thumbnail_path(project_id)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.get("/{project_id}/exports/{filename}")
def download_export(project_id: str, filename: str, service: Service) -> FileResponse:
    path = service.export_path(project_id, filename)
    return FileResponse(path, media_type="video/mp4", filename=filename)
