"""Importação de vídeos por link, restrita a fontes autorizadas.

Regras:

* somente ``http``/``https``, sem credenciais embutidas na URL;
* o domínio (ou um subdomínio dele) precisa estar na lista de domínios
  autorizados definida pelo usuário em Configurações;
* cada redirecionamento é validado com as mesmas regras;
* a resposta precisa ser um arquivo de vídeo (``video/*`` ou binário genérico)
  com assinatura de contêiner reconhecida.

Páginas HTML, playlists de streaming (HLS/DASH) e conteúdos protegidos por DRM
não são suportados: a ferramenta apenas baixa arquivos de vídeo diretos que o
usuário está autorizado a utilizar.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

import httpx

from .jobs import JobContext, JobError
from .media import (
    ALLOWED_EXTENSIONS,
    CONTAINER_EXTENSION,
    SIGNATURE_BYTES,
    extension_of,
    require_container,
    sanitize_filename,
)

MAX_REDIRECTS = 5
ACCEPTED_GENERIC_TYPES = {"application/octet-stream", "binary/octet-stream"}
STREAMING_TYPES = {
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "application/dash+xml",
}
DEFAULT_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=60.0, pool=15.0)

ClientFactory = Callable[[], httpx.Client]


class LinkPolicyError(ValueError):
    """URL recusada pelas regras de origem autorizada."""


class DownloadError(JobError):
    pass


def default_client_factory() -> httpx.Client:
    return httpx.Client(timeout=DEFAULT_TIMEOUT, follow_redirects=False, headers={"User-Agent": "UNLOCK-CLIPS/0.5"})


def host_is_allowed(host: str, allowed_domains: list[str]) -> bool:
    host = host.lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    return any(host == domain or host.endswith("." + domain) for domain in allowed_domains)


def check_url(url: str, allowed_domains: list[str]) -> str:
    """Valida a URL e retorna-a normalizada. Lança ``LinkPolicyError`` se recusada."""
    url = url.strip()
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise LinkPolicyError("Link inválido.") from exc
    if parts.scheme not in ("http", "https"):
        raise LinkPolicyError("Somente links http:// ou https:// são aceitos.")
    if parts.username or parts.password:
        raise LinkPolicyError("Links com usuário ou senha embutidos não são aceitos.")
    host = parts.hostname
    if not host:
        raise LinkPolicyError("O link não possui um domínio válido.")
    if not allowed_domains:
        raise LinkPolicyError(
            "Nenhum domínio autorizado foi configurado. Adicione os domínios das suas fontes "
            "autorizadas em Configurações > Links autorizados."
        )
    if not host_is_allowed(host, allowed_domains):
        raise LinkPolicyError(
            f"O domínio '{host}' não está na lista de fontes autorizadas. "
            "Adicione-o em Configurações caso você tenha direito de uso sobre esse conteúdo."
        )
    return url


_CD_FILENAME_STAR = re.compile(r"filename\*\s*=\s*[^']*'[^']*'([^;]+)", re.IGNORECASE)
_CD_FILENAME = re.compile(r'filename\s*=\s*"?([^";]+)"?', re.IGNORECASE)


def filename_from_response(url: str, content_disposition: str | None) -> str:
    if content_disposition:
        match = _CD_FILENAME_STAR.search(content_disposition) or _CD_FILENAME.search(content_disposition)
        if match:
            return sanitize_filename(unquote(match.group(1).strip()))
    path_name = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    return sanitize_filename(path_name) if path_name else "video"


@dataclass
class DownloadResult:
    final_url: str
    original_name: str
    content_type: str | None
    size_bytes: int
    container: str


def _check_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None
    base = content_type.split(";", 1)[0].strip().lower()
    if base in STREAMING_TYPES:
        raise DownloadError(
            "O link aponta para uma playlist de streaming (HLS/DASH). Informe o link direto de um arquivo de vídeo."
        )
    if base.startswith("video/") or base in ACCEPTED_GENERIC_TYPES:
        return base
    if base.startswith("text/html"):
        raise DownloadError(
            "O link aponta para uma página web, não para um arquivo de vídeo. "
            "Use o link direto do arquivo (por exemplo, terminado em .mp4)."
        )
    raise DownloadError(f"O link não retornou um vídeo (tipo recebido: {base}).")


def download_video(
    ctx: JobContext,
    url: str,
    destination: Path,
    allowed_domains: list[str],
    max_bytes: int,
    client_factory: ClientFactory = default_client_factory,
    chunk_size: int = 1024 * 1024,
    progress_scale: float = 1.0,
) -> DownloadResult:
    """Baixa o vídeo para ``destination`` com progresso e cancelamento."""
    current = check_url(url, allowed_domains)
    ctx.progress(None, "Conectando à fonte", force=True)
    with client_factory() as client:
        for _ in range(MAX_REDIRECTS + 1):
            ctx.check_cancelled()
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise DownloadError("A fonte retornou um redirecionamento inválido.")
                        try:
                            current = check_url(str(response.url.join(location)), allowed_domains)
                        except LinkPolicyError as exc:
                            raise DownloadError(f"Redirecionamento recusado: {exc}") from exc
                        continue
                    if response.status_code != 200:
                        raise DownloadError(f"A fonte respondeu com o código HTTP {response.status_code}.")
                    return _save_stream(ctx, response, current, destination, max_bytes, chunk_size, progress_scale)
            except httpx.TimeoutException as exc:
                raise DownloadError("Tempo de conexão esgotado ao baixar o vídeo.") from exc
            except httpx.HTTPError as exc:
                raise DownloadError(f"Falha de rede ao baixar o vídeo: {exc}") from exc
    raise DownloadError("Redirecionamentos demais ao acessar o link.")


def _save_stream(
    ctx: JobContext,
    response: httpx.Response,
    url: str,
    destination: Path,
    max_bytes: int,
    chunk_size: int,
    progress_scale: float,
) -> DownloadResult:
    content_type = _check_content_type(response.headers.get("content-type"))
    total: int | None = None
    length_header = response.headers.get("content-length")
    if length_header and length_header.isdigit():
        total = int(length_header)
        if total > max_bytes:
            raise DownloadError(
                f"O vídeo tem {total / 1024 / 1024:.0f} MB, acima do limite configurado de "
                f"{max_bytes / 1024 / 1024:.0f} MB."
            )

    original_name = filename_from_response(url, response.headers.get("content-disposition"))
    written = 0
    container: str | None = None
    header = b""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open(destination, "wb") as fh:
        for chunk in response.iter_bytes(chunk_size):
            ctx.check_cancelled()
            if container is None:
                header += chunk[: SIGNATURE_BYTES - len(header)]
                if len(header) >= SIGNATURE_BYTES:
                    try:
                        container = require_container(header)
                    except JobError as exc:
                        raise DownloadError(str(exc)) from exc
            written += len(chunk)
            if written > max_bytes:
                raise DownloadError(
                    f"O vídeo excede o limite configurado de {max_bytes / 1024 / 1024:.0f} MB."
                )
            fh.write(chunk)
            mb = written / 1024 / 1024
            if total:
                ctx.progress(progress_scale * written / total, f"Baixando vídeo ({mb:.1f} MB)")
            else:
                ctx.progress(None, f"Baixando vídeo ({mb:.1f} MB)")
    if written == 0:
        raise DownloadError("A fonte retornou um arquivo vazio.")
    if total is not None and written != total:
        raise DownloadError("O download foi interrompido antes de terminar. Tente novamente.")
    if container is None:
        raise DownloadError("O arquivo baixado é pequeno demais para ser um vídeo válido.")
    if extension_of(original_name) not in ALLOWED_EXTENSIONS:
        stem = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
        original_name = stem + CONTAINER_EXTENSION[container]
    return DownloadResult(
        final_url=url,
        original_name=original_name,
        content_type=content_type,
        size_bytes=written,
        container=container,
    )
