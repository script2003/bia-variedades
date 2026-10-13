"""Registro (log) da aplicação: no terminal e em ``data/logs/unlock-clips.log``.

O arquivo é rotativo (5 MB × 3) e ajuda a investigar problemas — inclusive quando a
aplicação é iniciada por um atalho, sem terminal visível.
"""

from __future__ import annotations

from pathlib import Path

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
LOG_FILENAME = "unlock-clips.log"


def log_file(data_dir: Path) -> Path:
    return data_dir / "logs" / LOG_FILENAME


def uvicorn_log_config(data_dir: Path, *, access_log: bool = False) -> dict:
    """Configuração de log usada pelo uvicorn (terminal + arquivo rotativo, em UTF-8)."""
    path = log_file(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    handlers = ["console", "file"]
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": {"format": LOG_FORMAT}},
        "handlers": {
            "console": {"class": "logging.StreamHandler", "formatter": "default", "stream": "ext://sys.stderr"},
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "formatter": "default",
                "filename": str(path),
                "maxBytes": 5 * 1024 * 1024,
                "backupCount": 3,
                "encoding": "utf-8",
            },
        },
        "root": {"level": "INFO", "handlers": handlers},
        "loggers": {
            "uvicorn": {"level": "INFO", "handlers": handlers, "propagate": False},
            "uvicorn.error": {"level": "INFO", "handlers": handlers, "propagate": False},
            # A interface consulta o servidor a cada segundo durante as tarefas: sem isso o log ficaria enorme.
            "uvicorn.access": {"level": "INFO" if access_log else "WARNING", "handlers": ["console"], "propagate": False},
        },
    }
