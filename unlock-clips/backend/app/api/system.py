"""Rotas gerais: saúde, estatísticas, configurações e vídeos exportados."""

from __future__ import annotations

import shutil
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from .. import __version__
from ..schemas import AppSettings, ExportedVideo, HealthInfo, SystemStats
from ..services import ProjectService
from ..storage import SettingsStore
from .deps import get_service, get_settings_store

router = APIRouter(prefix="/api", tags=["sistema"])

Service = Annotated[ProjectService, Depends(get_service)]
Settings = Annotated[SettingsStore, Depends(get_settings_store)]


@router.get("/health", response_model=HealthInfo)
def health(request: Request) -> HealthInfo:
    return HealthInfo(
        version=__version__,
        ffmpeg_available=shutil.which("ffmpeg") is not None,
        ffprobe_available=shutil.which("ffprobe") is not None,
        data_dir=str(request.app.state.config.data_dir),
    )


@router.get("/stats", response_model=SystemStats)
def stats(service: Service) -> SystemStats:
    return service.stats()


@router.get("/settings", response_model=AppSettings)
def get_settings(store: Settings) -> AppSettings:
    return store.get()


@router.put("/settings", response_model=AppSettings)
def save_settings(body: AppSettings, store: Settings) -> AppSettings:
    return store.save(body)


@router.get("/exports", response_model=list[ExportedVideo])
def list_exports(service: Service) -> list[ExportedVideo]:
    return service.list_exports()
