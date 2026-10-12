import pytest
from pydantic import ValidationError

from app.schemas import AppSettings, ClipSettings, ProjectUpdate, normalize_domain


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("exemplo.com", "exemplo.com"),
        ("https://www.Exemplo.com/videos/a.mp4", "exemplo.com"),
        ("*.cdn.exemplo.com.br", "cdn.exemplo.com.br"),
        ("arquivos.exemplo.com:8443", "arquivos.exemplo.com"),
    ],
)
def test_normalize_domain(raw, expected):
    assert normalize_domain(raw) == expected


@pytest.mark.parametrize("raw", ["localhost", "user@exemplo.com", "exem plo.com", "-ruim.com", ""])
def test_normalize_domain_rejects(raw):
    with pytest.raises(ValueError):
        normalize_domain(raw)


def test_app_settings_deduplicates_domains_and_ignores_blank():
    settings = AppSettings(allowed_link_domains=["exemplo.com", " ", "https://exemplo.com/x", "outro.org"])
    assert settings.allowed_link_domains == ["exemplo.com", "outro.org"]
    assert settings.max_upload_bytes == 8192 * 1024 * 1024


def test_clip_settings_validation():
    assert ClipSettings().duration == "30-60"
    assert ClipSettings(subtitle_language="en").subtitle_language == "en"
    with pytest.raises(ValidationError):
        ClipSettings(subtitle_language="português")
    with pytest.raises(ValidationError):
        ClipSettings(max_clips=0)
    with pytest.raises(ValidationError):
        ClipSettings(aspect_ratio="4:3")


def test_project_update_rejects_blank_title():
    with pytest.raises(ValidationError):
        ProjectUpdate(title="   ")
    assert ProjectUpdate(title="  Novo  ").title == "Novo"
