import { Activity, FolderOpen, HardDrive, Film } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Project, SystemStats } from "../api/types";
import EmptyState from "../components/EmptyState";
import NewProjectPanel from "../components/NewProjectPanel";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";
import ProjectList from "../components/ProjectList";
import { usePolling } from "../hooks/usePolling";
import { formatBytes } from "../lib/format";
import { hasActiveJob, pollIntervalFor } from "../lib/projects";

interface DashboardData {
  projects: Project[];
  stats: SystemStats;
}

export default function DashboardPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, loading, refresh } = usePolling<DashboardData>(
    async () => {
      const [projects, stats] = await Promise.all([api.listProjects(), api.stats()]);
      return { projects, stats };
    },
    (current) => pollIntervalFor(current?.projects ?? null),
  );

  const projects = data?.projects ?? [];
  const active = projects.filter(hasActiveJob);
  const recent = projects.filter((p) => !hasActiveJob(p)).slice(0, 5);

  const cards = [
    { label: "Projetos", value: data ? String(data.stats.projects_total) : "—", icon: FolderOpen },
    { label: "Tarefas em andamento", value: data ? String(data.stats.active_jobs) : "—", icon: Activity },
    { label: "Vídeos exportados", value: data ? String(data.stats.exports_total) : "—", icon: Film },
    { label: "Armazenamento usado", value: data ? formatBytes(data.stats.storage_bytes) : "—", icon: HardDrive },
  ];

  return (
    <>
      <PageHeader
        title="Painel"
        description="Envie um vídeo longo — podcast, entrevista, debate ou aula — e acompanhe o processamento dos seus projetos."
      />

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {actionError && (
        <div className="mb-6">
          <Notice tone="error">{actionError}</Notice>
        </div>
      )}

      <section aria-label="Resumo" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-ink-800 text-brand-400">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-zinc-500">{label}</p>
              <p className="text-lg font-bold tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Novo vídeo</h2>
        <NewProjectPanel />
      </section>

      {active.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Em processamento</h2>
          <ProjectList projects={active} onChange={() => void refresh()} onError={setActionError} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projetos recentes</h2>
          {projects.length > 0 && (
            <Link to="/projetos" className="text-sm font-medium text-brand-400 hover:text-brand-300">
              Ver todos
            </Link>
          )}
        </div>
        {loading && !data ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : recent.length > 0 ? (
          <ProjectList projects={recent} onError={setActionError} />
        ) : (
          <EmptyState icon={FolderOpen} title="Nenhum projeto concluído ainda">
            Os vídeos que você enviar aparecerão aqui.
          </EmptyState>
        )}
      </section>
    </>
  );
}
