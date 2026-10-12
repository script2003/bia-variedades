import threading

import httpx
import pytest

from app.jobs import JobContext
from app.links import (
    DownloadError,
    LinkPolicyError,
    check_url,
    download_video,
    filename_from_response,
    host_is_allowed,
)

from .conftest import MKV_HEADER, fake_video

ALLOWED = ["exemplo.com"]


def ctx() -> JobContext:
    return JobContext("job", threading.Event(), lambda p, m: None)


def factory(handler):
    return lambda: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_host_is_allowed_matches_subdomains_only():
    assert host_is_allowed("exemplo.com", ALLOWED)
    assert host_is_allowed("www.exemplo.com", ALLOWED)
    assert host_is_allowed("cdn.exemplo.com", ALLOWED)
    assert not host_is_allowed("exemplo.com.malicioso.net", ALLOWED)
    assert not host_is_allowed("naoexemplo.com", ALLOWED)


@pytest.mark.parametrize(
    "url, message",
    [
        ("ftp://exemplo.com/a.mp4", "http"),
        ("file:///C:/videos/a.mp4", "http"),
        ("https://usuario:senha@exemplo.com/a.mp4", "usuário"),
        ("https://outro.com/a.mp4", "não está na lista"),
        ("https:///a.mp4", "domínio"),
    ],
)
def test_check_url_rejections(url, message):
    with pytest.raises(LinkPolicyError, match=message):
        check_url(url, ALLOWED)


def test_check_url_requires_configured_domains():
    with pytest.raises(LinkPolicyError, match="Nenhum domínio autorizado"):
        check_url("https://exemplo.com/a.mp4", [])


def test_filename_from_response():
    assert filename_from_response("https://exemplo.com/pasta/Meu%20Podcast.mp4?x=1", None) == "Meu Podcast.mp4"
    assert filename_from_response("https://exemplo.com/d", 'attachment; filename="ep 1.mkv"') == "ep 1.mkv"
    assert (
        filename_from_response("https://exemplo.com/d", "attachment; filename*=UTF-8''epis%C3%B3dio.mp4")
        == "episódio.mp4"
    )


def test_download_success_with_redirect(tmp_path):
    data = fake_video(200_000)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/link":
            return httpx.Response(302, headers={"location": "https://cdn.exemplo.com/arquivo.mp4"})
        assert request.url.host == "cdn.exemplo.com"
        return httpx.Response(200, headers={"content-type": "video/mp4"}, content=data)

    dest = tmp_path / "out.part"
    result = download_video(ctx(), "https://exemplo.com/link", dest, ALLOWED, 10**9, factory(handler), 16_384)
    assert dest.read_bytes() == data
    assert result.size_bytes == len(data)
    assert result.container == "mp4"
    assert result.original_name == "arquivo.mp4"
    assert result.final_url == "https://cdn.exemplo.com/arquivo.mp4"


def test_download_fixes_extension_from_content(tmp_path):
    handler = lambda r: httpx.Response(200, headers={"content-type": "application/octet-stream"}, content=fake_video(50_000, MKV_HEADER))  # noqa: E731
    result = download_video(ctx(), "https://exemplo.com/baixar?id=1", tmp_path / "o", ALLOWED, 10**9, factory(handler))
    assert result.container == "matroska"
    assert result.original_name == "baixar.mkv"


def test_redirect_to_unauthorized_domain_is_blocked(tmp_path):
    handler = lambda r: httpx.Response(301, headers={"location": "https://malicioso.net/a.mp4"})  # noqa: E731
    with pytest.raises(DownloadError, match="Redirecionamento recusado"):
        download_video(ctx(), "https://exemplo.com/a.mp4", tmp_path / "o", ALLOWED, 10**9, factory(handler))


@pytest.mark.parametrize(
    "content_type, message",
    [
        ("text/html; charset=utf-8", "página web"),
        ("application/vnd.apple.mpegurl", "streaming"),
        ("application/json", "não retornou um vídeo"),
    ],
)
def test_non_video_responses_are_rejected(tmp_path, content_type, message):
    handler = lambda r: httpx.Response(200, headers={"content-type": content_type}, content=b"x" * 100)  # noqa: E731
    with pytest.raises(DownloadError, match=message):
        download_video(ctx(), "https://exemplo.com/a.mp4", tmp_path / "o", ALLOWED, 10**9, factory(handler))


def test_size_limit_and_invalid_signature(tmp_path):
    big = lambda r: httpx.Response(200, headers={"content-type": "video/mp4"}, content=fake_video(5000))  # noqa: E731
    with pytest.raises(DownloadError, match="limite"):
        download_video(ctx(), "https://exemplo.com/a.mp4", tmp_path / "o", ALLOWED, 1000, factory(big))

    fake = lambda r: httpx.Response(200, headers={"content-type": "video/mp4"}, content=b"<html>" * 100)  # noqa: E731
    with pytest.raises(DownloadError, match="não corresponde"):
        download_video(ctx(), "https://exemplo.com/a.mp4", tmp_path / "o", ALLOWED, 10**9, factory(fake))


def test_http_error_status(tmp_path):
    handler = lambda r: httpx.Response(403)  # noqa: E731
    with pytest.raises(DownloadError, match="403"):
        download_video(ctx(), "https://exemplo.com/a.mp4", tmp_path / "o", ALLOWED, 10**9, factory(handler))
