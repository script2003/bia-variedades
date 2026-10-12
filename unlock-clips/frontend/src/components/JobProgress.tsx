import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type { Project } from "../api/types";
import { JOB_KIND_LABEL, formatPercent } from "../lib/format";
import { hasActiveJob } from "../lib/projects";
import ProgressBar from "./ProgressBar";

interface Props {
  project: Project;
  onChange?: (project: Project) => void;
  onError?: (message: string) => void;
}

/** Progresso real da tarefa em segundo plano, com botão de cancelamento. */
export default function JobProgress({ project, onChange, onError }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const job = project.job;
  if (!job || !hasActiveJob(project)) return null;

  const cancel = async () => {
    setCancelling(true);
    try {
      onChange?.(await api.cancelJob(project.id));
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-zinc-300">
          <Loader2 className="size-4 shrink-0 animate-spin text-brand-400" aria-hidden />
          <span className="truncate">
            {JOB_KIND_LABEL[job.kind]} · {job.message || (job.status === "queued" ? "Na fila" : "Processando")}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-400 tabular-nums">{formatPercent(job.progress)}</span>
          <button type="button" className="btn btn-ghost py-1 text-xs" onClick={cancel} disabled={cancelling}>
            <X className="size-3.5" aria-hidden />
            {cancelling ? "Cancelando…" : "Cancelar"}
          </button>
        </span>
      </div>
      <ProgressBar value={job.status === "queued" ? 0 : job.progress} label={`Progresso de ${project.title}`} />
    </div>
  );
}
