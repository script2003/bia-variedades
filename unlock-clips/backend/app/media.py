"""Validação de arquivos de vídeo sem depender do FFmpeg.

A verificação aqui é estrutural (extensão + assinatura do contêiner). A análise
detalhada das trilhas com ``ffprobe`` é feita na Etapa 2.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path, PureWindowsPath

from .jobs import JobContext, JobError

# extensão -> família do contêiner esperada
ALLOWED_EXTENSIONS: dict[str, str] = {
    ".mp4": "mp4",
    ".m4v": "mp4",
    ".mov": "mp4",
    ".mkv": "matroska",
    ".webm": "matroska",
    ".avi": "avi",
}

CONTAINER_EXTENSION: dict[str, str] = {"mp4": ".mp4", "matroska": ".mkv", "avi": ".avi"}
CONTAINER_LABELS: dict[str, str] = {"mp4": "MP4/MOV", "matroska": "Matroska/WebM", "avi": "AVI"}

# Bytes mínimos necessários para identificar o contêiner.
SIGNATURE_BYTES = 12

_ISO_BMFF_BOXES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
_UNSAFE_CHARS = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')
# Nomes que o Windows não aceita como nome de arquivo, com qualquer extensão (CON.mp4, nul.txt…).
_WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$", re.IGNORECASE)


class InvalidVideo(JobError):
    pass


def allowed_extensions_text() -> str:
    return ", ".join(sorted(ALLOWED_EXTENSIONS))


def sanitize_filename(raw: str, max_length: int = 180) -> str:
    """Remove caminhos e caracteres problemáticos (inclusive no Windows) de um nome de arquivo."""
    name = PureWindowsPath(raw.replace("/", "\\")).name
    name = unicodedata.normalize("NFC", name)
    name = _UNSAFE_CHARS.sub("_", name).strip(" .")
    if len(name) > max_length:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            name = stem[: max_length - len(ext) - 1] + "." + ext
        else:
            name = name[:max_length]
    if _WINDOWS_RESERVED.match(name):
        name = "_" + name
    return name or "video"


def extension_of(filename: str) -> str:
    return Path(filename).suffix.lower()


def check_extension(filename: str) -> str:
    ext = extension_of(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise InvalidVideo(
            f"Formato não suportado ({ext or 'sem extensão'}). Envie um arquivo {allowed_extensions_text()}."
        )
    return ext


def detect_container(header: bytes) -> str | None:
    """Identifica o contêiner pelos primeiros bytes do arquivo."""
    if len(header) >= 8 and header[4:8] in _ISO_BMFF_BOXES:
        return "mp4"
    if header[:4] == b"\x1aE\xdf\xa3":
        return "matroska"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"AVI ":
        return "avi"
    return None


def require_container(header: bytes) -> str:
    container = detect_container(header)
    if container is None:
        raise InvalidVideo(
            "O conteúdo do arquivo não corresponde a um vídeo suportado "
            f"({allowed_extensions_text()}). Verifique se o arquivo não está corrompido."
        )
    return container


def container_mismatch_warning(filename: str, container: str) -> str | None:
    expected = ALLOWED_EXTENSIONS.get(extension_of(filename))
    if expected is not None and expected != container:
        return (
            f"A extensão do arquivo ({extension_of(filename)}) não corresponde ao conteúdo "
            f"detectado ({CONTAINER_LABELS[container]}). O arquivo será tratado pelo conteúdo real."
        )
    return None


def verify_video_file(
    path: Path,
    ctx: JobContext,
    chunk_size: int = 1024 * 1024,
    progress_start: float = 0.0,
    progress_end: float = 1.0,
) -> tuple[str, int, str]:
    """Verifica o arquivo e calcula seu SHA-256 com progresso real.

    O progresso é reportado no intervalo ``[progress_start, progress_end]``,
    permitindo que a verificação seja a parte final de uma tarefa maior.
    Retorna ``(container, tamanho_em_bytes, sha256)``.
    """
    if not path.is_file():
        raise InvalidVideo("O arquivo de vídeo do projeto não foi encontrado no disco.")
    size = path.stat().st_size
    if size == 0:
        raise InvalidVideo("O arquivo de vídeo está vazio.")

    digest = hashlib.sha256()
    read = 0
    container: str | None = None
    span = progress_end - progress_start
    ctx.progress(progress_start, "Verificando o arquivo", force=True)
    with open(path, "rb") as fh:
        while True:
            ctx.check_cancelled()
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            if container is None:
                container = require_container(chunk[:SIGNATURE_BYTES])
            digest.update(chunk)
            read += len(chunk)
            ctx.progress(progress_start + span * read / size, "Verificando integridade do arquivo")
    if read != size:
        raise InvalidVideo("O arquivo foi alterado durante a verificação. Tente novamente.")
    assert container is not None
    ctx.progress(progress_end, "Arquivo verificado", force=True)
    return container, size, digest.hexdigest()
