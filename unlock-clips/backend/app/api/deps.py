from __future__ import annotations

from fastapi import Request

from ..services import ProjectService
from ..storage import SettingsStore


def get_service(request: Request) -> ProjectService:
    return request.app.state.service


def get_settings_store(request: Request) -> SettingsStore:
    return request.app.state.settings_store
