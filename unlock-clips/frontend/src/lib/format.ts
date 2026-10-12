import type { JobKind, JobStatus, ProjectStatus } from "../api/types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`;
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "";
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

/** "há 5 min", "há 2 h", "há 3 dias" — usado nas listas. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 60) return "agora mesmo";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "há 1 dia" : `há ${days} dias`;
  return formatDateTime(iso);
}

/** 3,2 s → "0:03"; 3725 s → "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBitrate(bitsPerSecond: number | null | undefined): string {
  if (!bitsPerSecond || bitsPerSecond <= 0) return "—";
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mb/s`;
  return `${Math.round(bitsPerSecond / 1000)} kb/s`;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  importing: "Importando",
  validating: "Verificando",
  extracting_audio: "Extraindo áudio",
  ready: "Pronto",
  failed: "Erro",
  cancelled: "Cancelado",
  interrupted: "Interrompido",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Na fila",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
  interrupted: "Interrompida",
};

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  process: "Preparação do vídeo",
  validate: "Verificação do arquivo",
  import_link: "Importação por link",
};

export const CONTAINER_LABEL: Record<string, string> = {
  mp4: "MP4 / MOV",
  matroska: "Matroska / WebM",
  avi: "AVI",
};
