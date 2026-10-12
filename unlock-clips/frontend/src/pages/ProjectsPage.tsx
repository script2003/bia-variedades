import { FolderOpen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { ProjectStatus } from "../api/types";
import EmptyState from "../components/EmptyState";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";
import ProjectList from "../components/ProjectList";
import { usePolling } from "../hooks/usePolling";
import { PROJECT_STATUS_LABEL } from "../lib/format";
import { pollIntervalFor } from "../lib/projects";

export default function ProjectsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, loading, refresh } = usePolling(api.listProjects, pollIntervalFor);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return (data ?? []).filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!term ||
          p.title.toLocaleLowerCase("pt-BR").includes(term) ||
          p.source.original_name.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [data, query, status]);

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
        </div>
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
        <ProjectList projects={filtered} onChange={() => void refresh()} onError={setActionError} />
      )}
    </>
  );
}
