"""Execução de tarefas em segundo plano com progresso e cancelamento cooperativo.

As tarefas rodam em um ``ThreadPoolExecutor``. Cada tarefa recebe um
``JobContext`` para informar o progresso e verificar se foi cancelada. Etapas
futuras (FFmpeg, transcrição) podem registrar subprocessos no contexto para
que o cancelamento os encerre imediatamente.
"""

from __future__ import annotations

import logging
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Protocol

logger = logging.getLogger(__name__)


class JobCancelled(Exception):
    """Lançada dentro de uma tarefa quando o usuário pede o cancelamento."""


class JobError(Exception):
    """Erro esperado, com mensagem adequada para exibir ao usuário."""


class JobListener(Protocol):
    def job_started(self, job_id: str) -> None: ...

    def job_progress(self, job_id: str, progress: float | None, message: str) -> None: ...

    def job_finished(self, job_id: str, status: str, error: str | None) -> None: ...


class JobContext:
    """Interface exposta às tarefas."""

    # Intervalo mínimo entre notificações de progresso (evita gravar o JSON a cada bloco).
    PROGRESS_INTERVAL = 0.25

    def __init__(
        self,
        job_id: str,
        cancel_event: threading.Event,
        report: Callable[[float | None, str], None],
    ) -> None:
        self.job_id = job_id
        self._cancel_event = cancel_event
        self._report = report
        self._last_report = 0.0
        self._last_message = ""
        self._processes: list[subprocess.Popen] = []
        self._lock = threading.Lock()

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def check_cancelled(self) -> None:
        if self._cancel_event.is_set():
            raise JobCancelled()

    def progress(self, fraction: float | None, message: str | None = None, *, force: bool = False) -> None:
        """Informa o progresso (0..1, ou None se indeterminado) e verifica cancelamento."""
        self.check_cancelled()
        if fraction is not None:
            fraction = min(1.0, max(0.0, fraction))
        msg = self._last_message if message is None else message
        now = time.monotonic()
        if force or msg != self._last_message or now - self._last_report >= self.PROGRESS_INTERVAL:
            self._last_report = now
            self._last_message = msg
            self._report(fraction, msg)

    def register_process(self, process: subprocess.Popen) -> None:
        with self._lock:
            self._processes.append(process)
        if self.cancelled:
            self._kill_processes()

    def _kill_processes(self) -> None:
        with self._lock:
            processes = list(self._processes)
        for proc in processes:
            if proc.poll() is None:
                try:
                    proc.kill()
                except OSError:
                    logger.warning("Não foi possível encerrar o processo %s", proc.pid)


Task = Callable[[JobContext], None]


@dataclass
class _Entry:
    cancel_event: threading.Event
    done_event: threading.Event = field(default_factory=threading.Event)
    future: Future | None = None
    context: JobContext | None = None


class JobManager:
    def __init__(self, listener: JobListener, max_workers: int = 2) -> None:
        self._listener = listener
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="unlock-job")
        self._entries: dict[str, _Entry] = {}
        self._lock = threading.Lock()

    def submit(self, job_id: str, task: Task) -> None:
        entry = _Entry(cancel_event=threading.Event())
        with self._lock:
            if job_id in self._entries:
                raise ValueError(f"Tarefa {job_id} já está registrada.")
            self._entries[job_id] = entry
        entry.future = self._executor.submit(self._run, job_id, task, entry)

    def is_active(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._entries

    def active_count(self) -> int:
        with self._lock:
            return len(self._entries)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            entry = self._entries.get(job_id)
        if entry is None:
            return False
        entry.cancel_event.set()
        if entry.context is not None:
            entry.context._kill_processes()
        if entry.future is not None and entry.future.cancel():
            # A tarefa ainda estava na fila e nunca será executada.
            self._finish(job_id, entry, "cancelled", None)
        return True

    def wait(self, job_id: str, timeout: float | None = None) -> bool:
        """Aguarda o término da tarefa. Retorna True se terminou (ou não existia)."""
        with self._lock:
            entry = self._entries.get(job_id)
        if entry is None:
            return True
        return entry.done_event.wait(timeout)

    def shutdown(self, cancel_running: bool = True) -> None:
        if cancel_running:
            with self._lock:
                job_ids = list(self._entries)
            for job_id in job_ids:
                self.cancel(job_id)
        self._executor.shutdown(wait=True, cancel_futures=True)

    def _finish(self, job_id: str, entry: _Entry, status: str, error: str | None) -> None:
        try:
            self._listener.job_finished(job_id, status, error)
        except Exception:
            logger.exception("Falha ao registrar o término da tarefa %s", job_id)
        finally:
            with self._lock:
                self._entries.pop(job_id, None)
            entry.done_event.set()

    def _run(self, job_id: str, task: Task, entry: _Entry) -> None:
        if entry.cancel_event.is_set():
            self._finish(job_id, entry, "cancelled", None)
            return

        def report(progress: float | None, message: str) -> None:
            self._listener.job_progress(job_id, progress, message)

        ctx = JobContext(job_id, entry.cancel_event, report)
        entry.context = ctx
        status, error = "completed", None
        try:
            self._listener.job_started(job_id)
            task(ctx)
            if ctx.cancelled:
                status = "cancelled"
        except JobCancelled:
            status = "cancelled"
        except JobError as exc:
            status, error = ("cancelled", None) if ctx.cancelled else ("failed", str(exc))
        except Exception as exc:  # noqa: BLE001 - qualquer falha precisa ser registrada
            logger.exception("Erro inesperado na tarefa %s", job_id)
            status, error = ("cancelled", None) if ctx.cancelled else ("failed", f"Erro inesperado: {exc}")
        finally:
            ctx._kill_processes()
        self._finish(job_id, entry, status, error)
