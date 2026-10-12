"""Ponto de entrada da API UNLOCK CLIPS.

Execução:  python -m app            (ou: uvicorn app.main:create_app --factory --reload)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .api import projects, system
from .config import AppConfig
from .links import ClientFactory, default_client_factory
from .services import ProjectService, ServiceError
from .storage import ProjectStore, SettingsStore

logger = logging.getLogger("unlock_clips")


def create_app(config: AppConfig | None = None, client_factory: ClientFactory = default_client_factory) -> FastAPI:
    config = config or AppConfig.from_env()
    config.ensure_dirs()

    settings_store = SettingsStore(config.settings_file)
    store = ProjectStore(config.projects_dir)
    service = ProjectService(config, store, settings_store, client_factory=client_factory)
    recovered = service.recover_after_restart()
    if recovered:
        logger.warning("%d tarefa(s) interrompida(s) no último encerramento foram marcadas para retomada.", recovered)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        service.shutdown()

    app = FastAPI(title="UNLOCK CLIPS API", version=__version__, lifespan=lifespan)
    app.state.config = config
    app.state.service = service
    app.state.settings_store = settings_store

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ServiceError)
    async def _service_error(_request: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()) if part not in ("body", "query"))
        message = first.get("msg", "Dados inválidos.")
        detail = f"{location}: {message}" if location else message
        return JSONResponse(status_code=422, content={"detail": detail, "errors": jsonable_errors(exc)})

    app.include_router(projects.router)
    app.include_router(system.router)

    _mount_frontend(app, config.frontend_dist)
    return app


def jsonable_errors(exc: RequestValidationError) -> list[dict]:
    return [{"loc": list(err.get("loc", ())), "msg": err.get("msg", "")} for err in exc.errors()]


def _mount_frontend(app: FastAPI, dist: Path | None) -> None:
    """Serve o front-end compilado (npm run build), se existir, no mesmo endereço da API."""
    if dist is None or not (dist / "index.html").is_file():
        return
    root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(404, "Rota não encontrada.")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(root / "index.html")

