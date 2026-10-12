"""Persistência local em arquivos JSON.

Estrutura:

    data/
      settings.json
      tmp/                     arquivos parciais de upload/download
      projects/<id>/
        project.json
        source.<ext>           vídeo original
        exports/               MP4 gerados (Etapa 6)

As gravações são atômicas (arquivo temporário + ``os.replace``) para que um
encerramento inesperado não corrompa os projetos.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

from pydantic import ValidationError

from .schemas import SCHEMA_VERSION, AppSettings, Project, utcnow

logger = logging.getLogger(__name__)

_PROJECT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
PROJECT_FILE = "project.json"
EXPORTS_DIR = "exports"


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def is_valid_project_id(project_id: str) -> bool:
    return bool(_PROJECT_ID_RE.match(project_id))


class ProjectNotFound(KeyError):
    pass


class ProjectStore:
    def __init__(self, projects_dir: Path) -> None:
        self._dir = projects_dir
        self._lock = threading.RLock()
        self._dir.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        if not is_valid_project_id(project_id):
            raise ProjectNotFound(project_id)
        return self._dir / project_id

    def exports_dir(self, project_id: str) -> Path:
        return self.project_dir(project_id) / EXPORTS_DIR

    def _file(self, project_id: str) -> Path:
        return self.project_dir(project_id) / PROJECT_FILE

    def _write(self, project: Project) -> None:
        project.schema_version = SCHEMA_VERSION
        atomic_write_text(self._file(project.id), project.model_dump_json(indent=2))

    def create(self, project: Project) -> Project:
        with self._lock:
            path = self.project_dir(project.id)
            path.mkdir(parents=True, exist_ok=False)
            self._write(project)
            return project

    def get(self, project_id: str) -> Project:
        with self._lock:
            path = self._file(project_id)
            if not path.is_file():
                raise ProjectNotFound(project_id)
            return Project.model_validate_json(path.read_text(encoding="utf-8"))

    def exists(self, project_id: str) -> bool:
        try:
            return self._file(project_id).is_file()
        except ProjectNotFound:
            return False

    def list(self) -> list[Project]:
        projects: list[Project] = []
        with self._lock:
            for child in self._dir.iterdir():
                if not child.is_dir() or not is_valid_project_id(child.name):
                    continue
                path = child / PROJECT_FILE
                if not path.is_file():
                    continue
                try:
                    projects.append(Project.model_validate_json(path.read_text(encoding="utf-8")))
                except (OSError, ValidationError, json.JSONDecodeError):
                    logger.exception("Projeto ignorado por estar corrompido: %s", path)
        projects.sort(key=lambda p: p.created_at, reverse=True)
        return projects

    def update(self, project_id: str, mutate: Callable[[Project], None]) -> Project:
        """Lê, altera e grava um projeto de forma atômica em relação a outras threads."""
        with self._lock:
            project = self.get(project_id)
            mutate(project)
            project.updated_at = utcnow()
            self._write(project)
            return project

    def delete(self, project_id: str) -> None:
        with self._lock:
            path = self.project_dir(project_id)
            if not path.exists():
                raise ProjectNotFound(project_id)
            shutil.rmtree(path)


class SettingsStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()

    def get(self) -> AppSettings:
        with self._lock:
            if not self._path.is_file():
                return AppSettings()
            try:
                return AppSettings.model_validate_json(self._path.read_text(encoding="utf-8"))
            except (OSError, ValidationError, json.JSONDecodeError):
                logger.exception("settings.json inválido; usando valores padrão.")
                return AppSettings()

    def save(self, settings: AppSettings) -> AppSettings:
        with self._lock:
            atomic_write_text(self._path, settings.model_dump_json(indent=2))
            return settings
