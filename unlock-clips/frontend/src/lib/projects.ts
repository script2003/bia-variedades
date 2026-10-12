import type { Project } from "../api/types";

export function hasActiveJob(project: Project): boolean {
  return project.job !== null && (project.job.status === "queued" || project.job.status === "running");
}

export function canRetry(project: Project): boolean {
  return !hasActiveJob(project) && ["failed", "cancelled", "interrupted"].includes(project.status);
}

export function hasPlayableSource(project: Project): boolean {
  return project.status !== "importing" && project.source.filename !== null;
}

/** Intervalo de atualização: rápido com tarefas ativas, lento sem elas. */
export function pollIntervalFor(projects: Project[] | null): number {
  return projects?.some(hasActiveJob) ? 1000 : 8000;
}
