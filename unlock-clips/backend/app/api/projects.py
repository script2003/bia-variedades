"""Rotas de projetos: upload, importação por link, consulta, edição e tarefas."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import ValidationError

from ..schemas import ClipSettings, LinkImportRequest, Project, ProjectUpdate
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


@router.get("/{project_id}/exports/{filename}")
def download_export(project_id: str, filename: str, service: Service) -> FileResponse:
    path = service.export_path(project_id, filename)
    return FileResponse(path, media_type="video/mp4", filename=filename)
