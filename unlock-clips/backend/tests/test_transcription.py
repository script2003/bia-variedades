import subprocess
import threading
import time
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.jobs import JobCancelled, JobContext
from app.main import create_app
from app.schemas import Transcript, TranscriptionSettings, TranscriptSegment
from app.transcription import (
    SAMPLE_RATE,
    TranscriptionError,
    WavReader,
    WhisperEngine,
    plan_chunks,
    to_srt,
    to_text,
    to_vtt,
    whisper_language,
)

from .conftest import FAST_WHISPER_OPTIONS, requires_ffmpeg, upload, wait_for_status, write_settings


def make_ctx(events=None, cancel=None) -> JobContext:
    return JobContext("job", cancel or threading.Event(), lambda p, m: events.append((p, m)) if events is not None else None)


def write_wav(path: Path, samples: np.ndarray, rate: int = SAMPLE_RATE, channels: int = 1) -> Path:
    data = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(data.tobytes())
    return path


def tone(seconds: float, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


# ------------------------------------------------------------------ utilitários


def test_whisper_language():
    assert whisper_language("pt-BR") == "pt"
    assert whisper_language("en") == "en"
    with pytest.raises(TranscriptionError, match="não é suportado"):
        whisper_language("xx-YY")


def test_wav_reader_reads_ranges_and_validates_format(tmp_path):
    samples = tone(2.0)
    path = write_wav(tmp_path / "a.wav", samples)
    with WavReader(path) as reader:
        assert reader.frames == len(samples) and reader.duration == 2.0
        part = reader.read(100, 200)
        assert part.dtype == np.float32 and len(part) == 100
        assert np.allclose(part, samples[100:200], atol=1e-4)
        assert len(reader.read(31_000, 40_000)) == 1000  # corta no fim do arquivo

    stereo = write_wav(tmp_path / "s.wav", np.zeros(32000), channels=2)
    with pytest.raises(TranscriptionError, match="formato esperado"):
        WavReader(stereo)
    with pytest.raises(TranscriptionError, match="Não foi possível abrir"):
        WavReader(tmp_path / "inexistente.wav")


def test_chunks_are_cut_at_the_quietest_point(tmp_path):
    # 25 s de tom contínuo com silêncio entre 16,5 s e 17,5 s.
    samples = tone(25)
    samples[int(16.5 * SAMPLE_RATE) : int(17.5 * SAMPLE_RATE)] = 0
    path = write_wav(tmp_path / "a.wav", samples)
    with WavReader(path) as reader:
        chunks = plan_chunks(reader, chunk_seconds=20, search_seconds=5)
    assert len(chunks) == 2
    cut = chunks[0][1] / SAMPLE_RATE
    assert 16.5 <= cut <= 17.5
    assert chunks[0][0] == 0 and chunks[1] == (chunks[0][1], len(samples))


def test_short_audio_is_a_single_chunk(tmp_path):
    with WavReader(write_wav(tmp_path / "a.wav", tone(3))) as reader:
        assert plan_chunks(reader, chunk_seconds=600) == [(0, 3 * SAMPLE_RATE)]


def test_caption_exports():
    transcript = Transcript(
        model="small",
        language="pt",
        duration_seconds=3725.5,
        segments=[
            TranscriptSegment(id=0, start=0.0, end=2.5, text="Olá, pessoal."),
            TranscriptSegment(id=1, start=3661.04, end=3662.5, text="Até a próxima!"),
        ],
    )
    assert to_srt(transcript) == (
        "1\n00:00:00,000 --> 00:00:02,500\nOlá, pessoal.\n\n2\n01:01:01,040 --> 01:01:02,500\nAté a próxima!\n"
    )
    assert to_vtt(transcript).startswith("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nOlá, pessoal.\n")
    assert to_text(transcript) == "[0:00] Olá, pessoal.\n[1:01:01] Até a próxima!\n"


# ------------------------------------------------------------------ motor (modelo simulado)


class FakeWhisperModel:
    """Imita a interface do faster-whisper: devolve um segmento por segundo de áudio."""

    def __init__(self, delay: float = 0.0):
        self.calls: list[dict] = []
        self.delay = delay

    def transcribe(self, audio, **options):
        self.calls.append({"samples": len(audio), **options})
        seconds = int(len(audio) / SAMPLE_RATE)

        def segments():
            for i in range(seconds):
                time.sleep(self.delay)
                word = SimpleNamespace(start=i + 0.1, end=i + 0.9, word=f" palavra{i}", probability=0.9)
                yield SimpleNamespace(text=f" palavra{i}", start=float(i), end=i + 1.0, words=[word], avg_logprob=-0.2, no_speech_prob=0.01)

        return segments(), SimpleNamespace(language=options.get("language"), language_probability=0.98)


def make_engine(tmp_path, model=None, **kwargs):
    model = model or FakeWhisperModel()
    created = []

    def factory(path, device, compute_type):
        created.append((path, device, compute_type))
        return model

    engine = WhisperEngine(tmp_path / "models", model_factory=factory, **kwargs)
    return engine, model, created


def fake_model_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    for name in ("model.bin", "config.json", "tokenizer.json"):
        (path / name).write_text("x")
    return path


def test_engine_offsets_prompts_progress_and_cache(tmp_path):
    engine, model, created = make_engine(tmp_path, extra_options={"temperature": 0.0})
    audio = write_wav(tmp_path / "a.wav", tone(25))
    settings = TranscriptionSettings(model_dir=str(fake_model_dir(tmp_path / "meu-modelo")), beam_size=2, vad_filter=False)
    events: list = []
    transcript = engine.transcribe(make_ctx(events), audio, "pt-BR", settings, chunk_seconds=10)

    assert transcript.model == "meu-modelo" and transcript.language == "pt"
    assert transcript.language_probability == 0.98 and transcript.duration_seconds == 25
    starts = [s.start for s in transcript.segments]
    assert starts == sorted(starts) and starts[0] == 0.0
    assert [s.id for s in transcript.segments] == list(range(len(transcript.segments)))
    # Os tempos do segundo bloco recebem o deslocamento do início do bloco.
    second_chunk_start = model.calls[0]["samples"] / SAMPLE_RATE
    first_of_second = transcript.segments[int(second_chunk_start)]
    assert first_of_second.start == pytest.approx(second_chunk_start, abs=0.01)
    assert first_of_second.words[0].start == pytest.approx(second_chunk_start + 0.1, abs=0.01)

    assert len(model.calls) == 3
    assert model.calls[0]["initial_prompt"] is None
    last_word_of_first_chunk = int(model.calls[0]["samples"] / SAMPLE_RATE) - 1
    assert model.calls[1]["initial_prompt"].endswith(f"palavra{last_word_of_first_chunk}")
    assert 9.5 <= model.calls[0]["samples"] / SAMPLE_RATE <= 10  # tom contínuo: corta perto do limite
    assert all(c["language"] == "pt" and c["beam_size"] == 2 and c["word_timestamps"] and c["temperature"] == 0.0 for c in model.calls)
    progresses = [p for p, _ in events if p is not None]
    assert progresses == sorted(progresses) and progresses[-1] == 1.0
    assert any("Transcrevendo (0:24 de 0:25)" in m for _, m in events)

    engine.transcribe(make_ctx(), audio, "pt", settings)
    assert len(created) == 1, "o modelo deve ficar em cache entre transcrições"
    assert created[0][1:] == ("cpu", "int8")


def test_engine_cancellation_between_segments(tmp_path):
    engine, _model, _ = make_engine(tmp_path, model=FakeWhisperModel(delay=0.05))
    audio = write_wav(tmp_path / "a.wav", tone(60))
    settings = TranscriptionSettings(model_dir=str(fake_model_dir(tmp_path / "m")))
    cancel = threading.Event()
    threading.Timer(0.2, cancel.set).start()
    started = time.monotonic()
    with pytest.raises(JobCancelled):
        engine.transcribe(make_ctx(cancel=cancel), audio, "pt", settings)
    assert time.monotonic() - started < 2
    # O bloqueio foi liberado: uma nova transcrição funciona.
    engine.transcribe(make_ctx(), write_wav(tmp_path / "b.wav", tone(2)), "pt", settings)


def test_engine_model_errors(tmp_path):
    engine, _model, _ = make_engine(tmp_path)
    audio = write_wav(tmp_path / "a.wav", tone(2))
    with pytest.raises(TranscriptionError, match="não contém um modelo"):
        engine.transcribe(make_ctx(), audio, "pt", TranscriptionSettings(model_dir=str(tmp_path / "vazia")))
    with pytest.raises(TranscriptionError, match="download automático está desativado"):
        engine.transcribe(make_ctx(), audio, "pt", TranscriptionSettings(model="tiny", allow_download=False))

    def broken_factory(path, device, compute_type):
        raise RuntimeError("CUDA driver version is insufficient")

    broken = WhisperEngine(tmp_path / "models", model_factory=broken_factory)
    settings = TranscriptionSettings(model_dir=str(fake_model_dir(tmp_path / "m")), device="cuda")
    with pytest.raises(TranscriptionError, match="float16, cuda.*Selecione 'CPU'"):
        broken.transcribe(make_ctx(), audio, "pt", settings)


def test_engine_downloads_missing_model_once(tmp_path):
    downloads = []

    def downloader(repo_id, path):
        downloads.append(repo_id)
        time.sleep(0.6)
        fake_model_dir(path)

    engine, _model, _ = make_engine(tmp_path, downloader=downloader)
    audio = write_wav(tmp_path / "a.wav", tone(2))
    events: list = []
    engine.transcribe(make_ctx(events), audio, "pt", TranscriptionSettings(model="base"))
    engine.transcribe(make_ctx(), audio, "pt", TranscriptionSettings(model="base"))
    assert downloads == ["Systran/faster-whisper-base"]
    assert any("Baixando o modelo Base" in m for _, m in events)
    assert [m.installed for m in engine.catalog() if m.name == "base"] == [True]


def test_engine_reports_download_failure(tmp_path):
    def downloader(repo_id, path):
        raise OSError("403 Forbidden")

    engine, _model, _ = make_engine(tmp_path, downloader=downloader)
    with pytest.raises(TranscriptionError, match="baixe manualmente.*huggingface.co/Systran/faster-whisper-small"):
        engine.transcribe(make_ctx(), write_wav(tmp_path / "a.wav", tone(1)), "pt", TranscriptionSettings())


# ------------------------------------------------------------------ faster-whisper real (modelo minúsculo)


@requires_ffmpeg
def test_real_faster_whisper_with_tiny_model(tiny_model_dir, tmp_path):
    """Executa o faster-whisper de verdade; o texto é aleatório, mas os tempos precisam ser coerentes."""
    wav = tmp_path / "a.wav"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-ac", "1", "-ar", "16000", str(wav)],
        check=True,
    )
    engine = WhisperEngine(tmp_path / "models", extra_options=FAST_WHISPER_OPTIONS)
    events: list = []
    settings = TranscriptionSettings(model_dir=str(tiny_model_dir), beam_size=1, vad_filter=False)
    transcript = engine.transcribe(make_ctx(events), wav, "pt-BR", settings)
    assert transcript.engine == "faster-whisper" and transcript.language == "pt"
    assert transcript.segments, "o modelo deveria produzir ao menos um segmento"
    for segment in transcript.segments:
        assert 0 <= segment.start <= segment.end <= 6.05
        for word in segment.words:
            assert segment.start - 0.05 <= word.start <= word.end <= segment.end + 0.05
    assert events[-1][0] == 1.0


@requires_ffmpeg
def test_real_vad_filter_skips_silence(tiny_model_dir, tmp_path):
    """Com o filtro de voz (VAD), 5 s de silêncio não geram segmentos."""
    wav = write_wav(tmp_path / "silencio.wav", np.zeros(5 * SAMPLE_RATE, dtype=np.float32))
    engine = WhisperEngine(tmp_path / "models", extra_options=FAST_WHISPER_OPTIONS)
    settings = TranscriptionSettings(model_dir=str(tiny_model_dir), beam_size=1, vad_filter=True)
    assert engine.transcribe(make_ctx(), wav, "pt", settings).segments == []


def _has_flite() -> bool:
    result = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True)
    return " flite " in result.stdout


@requires_ffmpeg
def test_real_vad_keeps_speech_with_original_timestamps(tiny_model_dir, tmp_path):
    """3 s de silêncio + fala sintetizada: os segmentos devem começar onde a fala começa."""
    if not _has_flite():
        pytest.skip("FFmpeg sem o filtro flite (síntese de voz)")
    wav = tmp_path / "fala.wav"
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=3",
            "-f", "lavfi", "-i", "flite=text='Hello everyone, welcome to the podcast.'",
            "-filter_complex", "[0][1]concat=n=2:v=0:a=1", "-ac", "1", "-ar", "16000", str(wav),
        ],
        check=True,
    )  # fmt: skip
    engine = WhisperEngine(tmp_path / "models", extra_options=FAST_WHISPER_OPTIONS)
    settings = TranscriptionSettings(model_dir=str(tiny_model_dir), beam_size=1, vad_filter=True)
    transcript = engine.transcribe(make_ctx(), wav, "en", settings)
    assert transcript.segments
    assert 2.0 <= transcript.segments[0].start <= 3.5
    assert transcript.segments[-1].end <= transcript.duration_seconds + 0.05


# ------------------------------------------------------------------ API


@pytest.fixture
def whisper_client(config, mock_source, tiny_model_dir):
    write_settings(config, auto_transcribe=True, model_dir=str(tiny_model_dir), beam_size=1, vad_filter=False)
    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        yield client


@requires_ffmpeg
def test_upload_is_transcribed_automatically(whisper_client, real_video):
    client = whisper_client
    project = upload(client, real_video).json()
    seen = set()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        project = client.get(f"/api/projects/{project['id']}").json()
        seen.add(project["status"])
        # A troca extração → transcrição é atômica: nunca "pronto" sem transcrição no meio do caminho.
        assert not (project["status"] == "ready" and project["transcript"] is None), project
        if project["status"] in ("ready", "failed") and project["transcript"] is not None or project["status"] == "failed":
            break
        time.sleep(0.02)
    assert project["status"] == "ready", project
    assert "transcribing" in seen
    # Com a detecção automática ligada (padrão), a última etapa é a sugestão de cortes.
    assert project["job"]["kind"] == "detect_clips"
    assert project["clips"] is not None
    summary = project["transcript"]
    assert summary["language"] == "pt" and summary["model"] == "tiny-random" and summary["segment_count"] > 0

    transcript = client.get(f"/api/projects/{project['id']}/transcript").json()
    assert len(transcript["segments"]) == summary["segment_count"]
    assert transcript["segments"][0]["words"]

    srt = client.get(f"/api/projects/{project['id']}/transcript.srt")
    assert srt.status_code == 200 and srt.text.startswith("1\n00:00:")
    assert "attachment" in srt.headers["content-disposition"]
    assert client.get(f"/api/projects/{project['id']}/transcript.vtt").text.startswith("WEBVTT")
    assert client.get(f"/api/projects/{project['id']}/transcript.txt").text.startswith("[0:0")
    assert client.get(f"/api/projects/{project['id']}/transcript.pdf").status_code == 404


@requires_ffmpeg
def test_manual_transcription_and_retranscription(config, mock_source, tiny_model_dir, real_video):
    write_settings(config, auto_transcribe=False, model_dir=str(tiny_model_dir), beam_size=1, vad_filter=False)
    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        project = upload(client, real_video).json()
        project = wait_for_status(client, project["id"], {"ready", "failed"})
        assert project["transcript"] is None
        assert client.get(f"/api/projects/{project['id']}/transcript").status_code == 404

        started = client.post(f"/api/projects/{project['id']}/transcribe")
        assert started.status_code == 200 and started.json()["status"] == "transcribing"
        assert client.post(f"/api/projects/{project['id']}/transcribe").status_code == 409  # já em andamento
        first = wait_for_status(client, project["id"], {"ready", "failed"})
        assert first["transcript"] is not None

        assert client.post(f"/api/projects/{project['id']}/transcribe").status_code == 200  # refazer
        second = wait_for_status(client, project["id"], {"ready", "failed"})
        assert second["transcript"]["created_at"] > first["transcript"]["created_at"]


def test_transcribe_requires_audio(client, real_video, media_dir):
    project = upload(client, (media_dir / "silent.mp4").read_bytes()).json()
    wait_for_status(client, project["id"], {"failed"})
    response = client.post(f"/api/projects/{project['id']}/transcribe")
    assert response.status_code == 409 and "Extraia o áudio" in response.json()["detail"]


@requires_ffmpeg
def test_transcription_failure_then_retry_only_transcribes(config, mock_source, tiny_model_dir, real_video, tmp_path):
    write_settings(config, auto_transcribe=True, model_dir=str(tmp_path / "modelo-inexistente"))
    with TestClient(create_app(config, client_factory=mock_source.factory)) as client:
        project = upload(client, real_video).json()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            project = client.get(f"/api/projects/{project['id']}").json()
            if project["status"] == "failed":
                break
            time.sleep(0.02)
        assert project["status"] == "failed" and project["job"]["kind"] == "transcribe"
        assert "não contém um modelo" in project["error"]
        audio_before = project["audio"]

        settings = client.get("/api/settings").json()
        settings["transcription"].update(model_dir=str(tiny_model_dir), beam_size=1, vad_filter=False)
        client.put("/api/settings", json=settings)
        retried = client.post(f"/api/projects/{project['id']}/retry").json()
        assert retried["job"]["kind"] == "transcribe" and retried["status"] == "transcribing"
        project = wait_for_status(client, project["id"], {"ready", "failed"})
        assert project["status"] == "ready" and project["transcript"] is not None
        assert project["audio"] == audio_before  # o áudio não foi extraído de novo


@requires_ffmpeg
def test_cancel_transcription(config, mock_source, real_video, tmp_path):
    engine, _model, _ = make_engine(tmp_path, model=FakeWhisperModel(delay=0.5))
    write_settings(config, auto_transcribe=True, model_dir=str(fake_model_dir(tmp_path / "m")))
    with TestClient(create_app(config, client_factory=mock_source.factory, engine=engine)) as client:
        project = upload(client, real_video).json()
        wait_for_status(client, project["id"], {"transcribing"})
        deadline = time.monotonic() + 10
        while client.get(f"/api/projects/{project['id']}").json()["job"]["status"] != "running":
            assert time.monotonic() < deadline
            time.sleep(0.02)
        assert client.post(f"/api/projects/{project['id']}/cancel").status_code == 200
        project = wait_for_status(client, project["id"], {"cancelled"})
        assert project["transcript"] is None
        assert not (config.projects_dir / project["id"] / "transcript.json").exists()
        # "Tentar novamente" retoma apenas a transcrição.
        assert client.post(f"/api/projects/{project['id']}/retry").json()["job"]["kind"] == "transcribe"


def test_models_catalog_and_health(client, config):
    models = client.get("/api/transcription/models").json()
    assert [m["name"] for m in models] == ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"]
    assert not any(m["installed"] for m in models)
    fake_model_dir(config.models_dir / "small")
    assert [m["name"] for m in client.get("/api/transcription/models").json() if m["installed"]] == ["small"]
    health = client.get("/api/health").json()
    assert health["transcription_available"] is True and health["transcription_error"] is None


def test_transcription_settings_validation(client):
    settings = client.get("/api/settings").json()
    assert settings["transcription"]["model"] == "small" and settings["transcription"]["device"] == "cpu"
    settings["transcription"]["model"] = "gigante"
    assert client.put("/api/settings", json=settings).status_code == 422
    settings["transcription"].update(model="base", beam_size=11)
    assert client.put("/api/settings", json=settings).status_code == 422
    settings["transcription"].update(beam_size=3, model_dir='  "C:\\Modelos\\whisper"  ')
    saved = client.put("/api/settings", json=settings).json()["transcription"]
    assert saved["model_dir"] == "C:\\Modelos\\whisper" and saved["beam_size"] == 3
