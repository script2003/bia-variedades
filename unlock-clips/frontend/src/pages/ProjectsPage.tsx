import { FolderOpen, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Project, ProjectStatus, ProjectStorage } from "../api/types";
import EmptyState from "../components/EmptyState";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";
import ProjectList from "../components/ProjectList";
import { usePolling } from "../hooks/usePolling";
import { PROJECT_STATUS_LABEL, formatBytes } from "../lib/format";
import { pollIntervalFor } from "../lib/projects";

type Sort = "recent" | "oldest" | "title" | "size";

const SORT_LABEL: Record<Sort, string> = {
  recent: "Mais recentes",
  oldest: "Mais antigos",
  title: "Nome (A–Z)",
  size: "Mais espaço em disco",
};

export default function ProjectsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [actionError, setActionError] = useState<string | null>(null);
  const [storage, setStorage] = useState<Map<string, ProjectStorage>>(new Map());
  const { data, error, loading, refresh } = usePolling(api.listProjects, pollIntervalFor);

  // O espaço em disco muda quando vídeos são gerados ou excluídos; atualiza junto com a lista.
  const storageVersion = (data ?? []).map((p) => `${p.id}:${p.updated_at}`).join("|");
  useEffect(() => {
    let active = true;
    api
      .storage()
      .then((items) => active && setStorage(new Map(items.map((item) => [item.project_id, item]))))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [storageVersion]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    const list = (data ?? []).filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!term ||
          p.title.toLocaleLowerCase("pt-BR").includes(term) ||
          p.source.original_name.toLocaleLowerCase("pt-BR").includes(term)),
    );
    const size = (p: Project) => storage.get(p.id)?.total_bytes ?? 0;
    const compare: Record<Sort, (a: Project, b: Project) => number> = {
      recent: (a, b) => b.created_at.localeCompare(a.created_at),
      oldest: (a, b) => a.created_at.localeCompare(b.created_at),
      title: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
      size: (a, b) => size(b) - size(a),
    };
    return [...list].sort(compare[sort]);
  }, [data, query, status, sort, storage]);

  const totalBytes = [...storage.values()].reduce((sum, item) => sum + item.total_bytes, 0);

  const remove = async (project: Project) => {
    if (!window.confirm(`Excluir o projeto “${project.title}” e todos os arquivos dele (vídeo, áudio, transcrição e cortes)? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.deleteProject(project.id);
      setActionError(null);
      void refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Meus projetos"
        description="Todos os projetos ficam salvos no seu computador e podem ser retomados a qualquer momento."
        actions={
          <Link to="/criar" className="btn btn-primary">
            <Plus className="size-4" aria-hidden /> Novo projeto
          </Link>
        }
      />

      {(error || actionError) && (
        <div className="mb-6">
          <Notice tone="error">{error ?? actionError}</Notice>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              className="input pl-9"
              placeholder="Buscar por título ou arquivo"
              aria-label="Buscar projetos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus | "all")}
          >
            <option value="all">Todos os status</option>
            {Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select className="input w-auto" aria-label="Ordenar projetos" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {Object.entries(SORT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {data && data.length > 0 && storage.size > 0 && (
        <p className="mb-3 text-xs text-zinc-500">
          {data.length} projeto(s) · {formatBytes(totalBytes)} em disco
        </p>
      )}

      {loading && !data ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Você ainda não tem projetos"
          action={
            <Link to="/criar" className="btn btn-primary">
              Criar o primeiro projeto
            </Link>
          }
        >
          Envie um vídeo para começar.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum projeto corresponde aos filtros.</p>
      ) : (
        <ProjectList projects={filtered} onChange={() => void refresh()} onError={setActionError} storage={storage} onDelete={remove} />
      )}
    </>
  );
}
