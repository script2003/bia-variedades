import { ApiError, errorMessageFromBody } from "./client";
import type { ClipSettings, Project } from "./types";

export interface UploadProgress {
  loaded: number;
  total: number;
  fraction: number;
}

export interface UploadOptions {
  file: File;
  title?: string;
  settings?: ClipSettings;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export class UploadCancelled extends Error {
  constructor() {
    super("Envio cancelado.");
    this.name = "UploadCancelled";
  }
}

export function buildUploadUrl(file: File, title?: string, settings?: ClipSettings): string {
  const params = new URLSearchParams({ filename: file.name });
  if (title?.trim()) params.set("title", title.trim());
  if (settings) params.set("settings", JSON.stringify(settings));
  return `/api/projects/upload?${params.toString()}`;
}

/**
 * Envia o arquivo como corpo bruto da requisição. Usa XMLHttpRequest porque o
 * `fetch` não informa o progresso do envio. O navegador lê o arquivo do disco
 * em partes; ele não é carregado inteiro na memória.
 */
export function uploadVideo({ file, title, settings, onProgress, signal }: UploadOptions): Promise<Project> {
  return new Promise<Project>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCancelled());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUploadUrl(file, title, settings));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : file.size;
      onProgress({ loaded: event.loaded, total, fraction: total > 0 ? Math.min(1, event.loaded / total) : 0 });
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Project);
      else reject(new ApiError(xhr.status, errorMessageFromBody(xhr.status, body)));
    };
    xhr.onerror = () => reject(new ApiError(0, errorMessageFromBody(0, null)));
    xhr.onabort = () => reject(new UploadCancelled());

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", onAbort);
    xhr.send(file);
  });
}
