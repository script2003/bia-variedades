import type {
  AppSettings,
  Clip,
  ClipSet,
  ClipUpdate,
  ScoringCriterion,
  ExportedVideo,
  HealthInfo,
  LinkImportRequest,
  Project,
  ProjectUpdate,
  SystemStats,
  Transcript,
  WhisperModelOption,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Extrai a mensagem de erro do corpo `{ detail }` retornado pelo FastAPI. */
export function errorMessageFromBody(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  }
  if (status === 0) return "Não foi possível conectar ao servidor. Verifique se o back-end está em execução.";
  if (status === 413) return "O arquivo excede o tamanho máximo permitido.";
  if (status >= 500) return "Erro interno no servidor. Consulte o terminal do back-end para detalhes.";
  return `Falha na requisição (HTTP ${status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, errorMessageFromBody(0, null));
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) throw new ApiError(response.status, errorMessageFromBody(response.status, body));
  return body as T;
}

export const api = {
  health: () => request<HealthInfo>("/api/health"),
  stats: () => request<SystemStats>("/api/stats"),
  getSettings: () => request<AppSettings>("/api/settings"),
  saveSettings: (settings: AppSettings) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}`),
  updateProject: (id: string, changes: ProjectUpdate) =>
    request<Project>(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  cancelJob: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  retryJob: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  transcribe: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}/transcribe`, { method: "POST" }),
  getTranscript: (id: string) => request<Transcript>(`/api/projects/${encodeURIComponent(id)}/transcript`),
  transcriptDownloadUrl: (id: string, format: "srt" | "vtt" | "txt") =>
    `/api/projects/${encodeURIComponent(id)}/transcript.${format}`,
  transcriptionModels: () => request<WhisperModelOption[]>("/api/transcription/models"),
  scoringCriteria: () => request<ScoringCriterion[]>("/api/clip-scoring/criteria"),
  getClips: (id: string) => request<ClipSet>(`/api/projects/${encodeURIComponent(id)}/clips`),
  detectClips: (id: string, keepCurated = true) =>
    request<Project>(`/api/projects/${encodeURIComponent(id)}/clips/detect`, {
      method: "POST",
      body: JSON.stringify({ keep_curated: keepCurated }),
    }),
  createClip: (id: string, data: { start: number; end: number; title?: string }) =>
    request<Clip>(`/api/projects/${encodeURIComponent(id)}/clips`, { method: "POST", body: JSON.stringify(data) }),
  updateClip: (id: string, clipId: string, data: ClipUpdate) =>
    request<Clip>(`/api/projects/${encodeURIComponent(id)}/clips/${encodeURIComponent(clipId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteClip: (id: string, clipId: string) =>
    request<void>(`/api/projects/${encodeURIComponent(id)}/clips/${encodeURIComponent(clipId)}`, { method: "DELETE" }),
  importFromLink: (payload: LinkImportRequest) =>
    request<Project>("/api/projects/from-link", { method: "POST", body: JSON.stringify(payload) }),
  listExports: () => request<ExportedVideo[]>("/api/exports"),
  sourceUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/source`,
  audioUrl: (project: Project) =>
    `/api/projects/${encodeURIComponent(project.id)}/audio?v=${encodeURIComponent(project.audio?.size_bytes ?? 0)}`,
  /** A versão na URL evita que o navegador mostre uma miniatura antiga após reprocessar. */
  thumbnailUrl: (project: Project) =>
    project.thumbnail
      ? `/api/projects/${encodeURIComponent(project.id)}/thumbnail?v=${encodeURIComponent(project.updated_at)}`
      : null,
};
