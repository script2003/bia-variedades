import pytest

from app.schemas import AppSettings, Project, SourceInfo
from app.storage import ProjectNotFound, ProjectStore, SettingsStore


def make_project(title="Teste") -> Project:
    return Project(title=title, status="ready", source=SourceInfo(kind="upload", original_name="a.mp4"))


def test_create_get_update_delete(tmp_path):
    store = ProjectStore(tmp_path / "projects")
    project = store.create(make_project())
    assert store.get(project.id).title == "Teste"

    updated = store.update(project.id, lambda p: setattr(p, "title", "Novo"))
    assert updated.title == "Novo"
    assert updated.updated_at >= project.updated_at
    assert store.get(project.id).title == "Novo"

    store.delete(project.id)
    with pytest.raises(ProjectNotFound):
        store.get(project.id)


def test_list_sorted_and_skips_corrupted(tmp_path):
    store = ProjectStore(tmp_path / "projects")
    first = store.create(make_project("primeiro"))
    second = store.create(make_project("segundo"))
    corrupted = make_project("corrompido")
    store.create(corrupted)
    (store.project_dir(corrupted.id) / "project.json").write_text("{nao é json", encoding="utf-8")

    titles = [p.title for p in store.list()]
    assert titles == ["segundo", "primeiro"]
    assert first.id != second.id


def test_invalid_ids_are_rejected(tmp_path):
    store = ProjectStore(tmp_path / "projects")
    for bad in ["../etc", "abc", "..", "A" * 32]:
        with pytest.raises(ProjectNotFound):
            store.get(bad)
        assert not store.exists(bad)


def test_settings_store_roundtrip_and_defaults(tmp_path):
    store = SettingsStore(tmp_path / "settings.json")
    assert store.get() == AppSettings()
    saved = store.save(AppSettings(allowed_link_domains=["exemplo.com"], max_upload_size_mb=100))
    assert store.get() == saved
    (tmp_path / "settings.json").write_text("lixo", encoding="utf-8")
    assert store.get() == AppSettings()
