import type { Project } from "../api/types";

export function hasActiveJob(project: Project): boolean {
  return project.job !== null && (project.job.status === "queued" || project.job.status === "running");
}

export function canRetry(project: Project): boolean {
  return !hasActiveJob(project) && ["failed", "cancelled", "interrupted"].includes(project.status);
}

/** O áudio já foi extraído e nenhuma tarefa está rodando: pode transcrever (ou refazer). */
export function canTranscribe(project: Project): boolean {
  return !hasActiveJob(project) && project.status === "ready" && project.audio !== null;
}

/** Já existe transcrição e nenhuma tarefa está rodando: pode gerar (ou refazer) as sugestões de cortes. */
export function canDetectClips(project: Project): boolean {
  return !hasActiveJob(project) && project.status === "ready" && project.transcript !== null;
}

/** Projetos criados antes da Etapa 2: prontos, mas sem o áudio extraído. */
export function needsAudioExtraction(project: Project): boolean {
  return !hasActiveJob(project) && project.status === "ready" && project.audio === null;
}

export function hasPlayableSource(project: Project): boolean {
  return project.status !== "importing" && project.source.filename !== null;
}

/** Intervalo de atualização: rápido com tarefas ativas, lento sem elas. */
export function pollIntervalFor(projects: Project[] | null): number {
  return projects?.some(hasActiveJob) ? 1000 : 8000;
}
