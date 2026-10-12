import threading
import time

from app.jobs import JobContext, JobError, JobManager


class Recorder:
    def __init__(self):
        self.events = []
        self.lock = threading.Lock()

    def job_started(self, job_id):
        with self.lock:
            self.events.append(("started", job_id))

    def job_progress(self, job_id, progress, message):
        with self.lock:
            self.events.append(("progress", job_id, progress, message))

    def job_finished(self, job_id, status, error):
        with self.lock:
            self.events.append(("finished", job_id, status, error))

    def finished(self, job_id):
        return [e for e in self.events if e[0] == "finished" and e[1] == job_id]


def test_completed_job_reports_progress():
    rec = Recorder()
    manager = JobManager(rec, max_workers=1)

    def task(ctx: JobContext):
        for i in range(5):
            ctx.progress(i / 4, f"passo {i}", force=True)

    manager.submit("a", task)
    assert manager.wait("a", 5)
    assert rec.finished("a") == [("finished", "a", "completed", None)]
    progress = [e[2] for e in rec.events if e[0] == "progress"]
    assert progress == [0.0, 0.25, 0.5, 0.75, 1.0]
    assert not manager.is_active("a")
    manager.shutdown()


def test_cancel_running_job():
    rec = Recorder()
    manager = JobManager(rec, max_workers=1)
    started = threading.Event()

    def task(ctx: JobContext):
        started.set()
        while True:
            ctx.check_cancelled()
            time.sleep(0.01)

    manager.submit("b", task)
    assert started.wait(5)
    assert manager.cancel("b")
    assert manager.wait("b", 5)
    assert rec.finished("b") == [("finished", "b", "cancelled", None)]
    manager.shutdown()


def test_cancel_queued_job_never_runs():
    rec = Recorder()
    manager = JobManager(rec, max_workers=1)
    gate = threading.Event()
    ran = threading.Event()
    manager.submit("blocker", lambda ctx: gate.wait(5))
    manager.submit("queued", lambda ctx: ran.set())
    assert manager.cancel("queued")
    gate.set()
    assert manager.wait("queued", 5)
    assert manager.wait("blocker", 5)
    assert not ran.is_set()
    assert rec.finished("queued") == [("finished", "queued", "cancelled", None)]
    manager.shutdown()


def test_failures_are_reported_with_message():
    rec = Recorder()
    manager = JobManager(rec, max_workers=1)

    def expected(ctx):
        raise JobError("arquivo inválido")

    def unexpected(ctx):
        raise RuntimeError("boom")

    manager.submit("e1", expected)
    manager.submit("e2", unexpected)
    assert manager.wait("e1", 5) and manager.wait("e2", 5)
    assert rec.finished("e1") == [("finished", "e1", "failed", "arquivo inválido")]
    assert rec.finished("e2")[0][2] == "failed"
    assert "boom" in rec.finished("e2")[0][3]
    manager.shutdown()


def test_cancel_kills_registered_process():
    import subprocess
    import sys

    rec = Recorder()
    manager = JobManager(rec, max_workers=1)
    holder = {}
    registered = threading.Event()

    def task(ctx: JobContext):
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        holder["proc"] = proc
        ctx.register_process(proc)
        registered.set()
        proc.wait()
        ctx.check_cancelled()

    manager.submit("p", task)
    assert registered.wait(10)
    manager.cancel("p")
    assert manager.wait("p", 10)
    assert holder["proc"].poll() is not None
    assert rec.finished("p")[0][2] == "cancelled"
    manager.shutdown()


def test_progress_is_throttled():
    rec = Recorder()
    manager = JobManager(rec, max_workers=1)

    def task(ctx: JobContext):
        for i in range(1000):
            ctx.progress(i / 1000, "mesma mensagem")

    manager.submit("t", task)
    assert manager.wait("t", 5)
    progress_events = [e for e in rec.events if e[0] == "progress"]
    assert 1 <= len(progress_events) < 50
    manager.shutdown()
