"""Rotas gerais: saúde, estatísticas, configurações e vídeos exportados."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from .. import __version__
from ..ffmpeg import FFmpegNotFound, find_tools, tool_version
from ..transcription import engine_status
from ..clips import criteria
from ..framing import face_detection_status
from ..subtitles import TEMPLATES
from ..schemas import (
    AppSettings,
    ExportedVideo,
    HealthInfo,
    ScoringCriterion,
    SubtitleTemplateInfo,
    SystemStats,
    WhisperModelOption,
)
from ..services import ProjectService
from ..storage import SettingsStore
from .deps import get_service, get_settings_store

router = APIRouter(prefix="/api", tags=["sistema"])

Service = Annotated[ProjectService, Depends(get_service)]
Settings = Annotated[SettingsStore, Depends(get_settings_store)]


@router.get("/health", response_model=HealthInfo)
def health(request: Request, store: Settings) -> HealthInfo:
    info = HealthInfo(
        version=__version__,
        ffmpeg_available=False,
        ffprobe_available=False,
        data_dir=str(request.app.state.config.data_dir),
    )
    info.transcription_available, info.transcription_error = engine_status()
    info.face_detection_available, info.face_detection_error = face_detection_status()
    try:
        tools = find_tools(store.get().ffmpeg_dir)
    except FFmpegNotFound as exc:
        info.ffmpeg_error = str(exc)
        return info
    info.ffmpeg_path, info.ffprobe_path = tools.ffmpeg, tools.ffprobe
    info.ffmpeg_version = tool_version(tools.ffmpeg)
    info.ffmpeg_available = info.ffmpeg_version is not None
    info.ffprobe_available = tool_version(tools.ffprobe) is not None
    if not (info.ffmpeg_available and info.ffprobe_available):
        info.ffmpeg_error = "O FFmpeg foi encontrado, mas não pôde ser executado."
    return info


@router.get("/stats", response_model=SystemStats)
def stats(service: Service) -> SystemStats:
    return service.stats()


@router.get("/settings", response_model=AppSettings)
def get_settings(store: Settings) -> AppSettings:
    return store.get()


@router.put("/settings", response_model=AppSettings)
def save_settings(body: AppSettings, store: Settings) -> AppSettings:
    return store.save(body)


@router.get("/transcription/models", response_model=list[WhisperModelOption])
def transcription_models(service: Service) -> list[WhisperModelOption]:
    """Modelos disponíveis e quais já foram baixados para uso offline."""
    return service.engine.catalog()


@router.get("/clip-scoring/criteria", response_model=list[ScoringCriterion])
def scoring_criteria() -> list[ScoringCriterion]:
    """Critérios da pontuação heurística dos cortes, com descrição e peso padrão."""
    return criteria()


@router.get("/subtitle-templates", response_model=list[SubtitleTemplateInfo])
def subtitle_templates() -> list[SubtitleTemplateInfo]:
    """Modelos de legenda disponíveis, com cores e características para a prévia."""
    return [SubtitleTemplateInfo(**template.__dict__) for template in TEMPLATES.values()]


@router.get("/exports", response_model=list[ExportedVideo])
def list_exports(service: Service) -> list[ExportedVideo]:
    return service.list_exports()
