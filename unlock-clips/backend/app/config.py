"""Configuração de infraestrutura lida de variáveis de ambiente.

Preferências do usuário (padrões dos cortes, domínios autorizados etc.) ficam em
``settings.json`` dentro da pasta de dados e são gerenciadas por ``SettingsStore``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"A variável {name} deve ser um número inteiro.") from exc
    return max(minimum, value)


@dataclass(frozen=True)
class AppConfig:
    data_dir: Path = DEFAULT_DATA_DIR
    frontend_dist: Path | None = DEFAULT_FRONTEND_DIST
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    max_workers: int = 2
    # Tamanho do bloco usado ao gravar uploads/downloads e ao calcular hashes.
    io_chunk_size: int = 1024 * 1024
    # Opções extras repassadas ao faster-whisper (uso avançado e testes).
    whisper_options: Mapping[str, object] | None = None

    @classmethod
    def from_env(cls) -> "AppConfig":
        data_dir = Path(os.environ.get("UNLOCK_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser()
        dist_raw = os.environ.get("UNLOCK_FRONTEND_DIST")
        frontend_dist = Path(dist_raw).expanduser() if dist_raw else DEFAULT_FRONTEND_DIST
        origins_raw = os.environ.get("UNLOCK_CORS_ORIGINS")
        origins = (
            tuple(o.strip() for o in origins_raw.split(",") if o.strip())
            if origins_raw
            else DEFAULT_CORS_ORIGINS
        )
        return cls(
            data_dir=data_dir.resolve(),
            frontend_dist=frontend_dist,
            cors_origins=origins,
            max_workers=_env_int("UNLOCK_MAX_WORKERS", 2),
        )

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def settings_file(self) -> Path:
        return self.data_dir / "settings.json"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.projects_dir, self.tmp_dir, self.models_dir):
            path.mkdir(parents=True, exist_ok=True)
