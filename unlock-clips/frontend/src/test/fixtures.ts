import type { AppSettings, ClipSettings, Project } from "../api/types";

export const clipDefaults: ClipSettings = {
  duration: "30-60",
  aspect_ratio: "9:16",
  subtitle_language: "pt-BR",
  subtitle_style: "destaque",
  subtitle_font_size: 64,
  subtitle_position: "inferior",
  highlight_current_word: true,
  framing: "centro",
  max_clips: 10,
};

export const appSettings: AppSettings = {
  clip_defaults: clipDefaults,
  allowed_link_domains: ["exemplo.com"],
  max_upload_size_mb: 10,
};

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    schema_version: 1,
    id: "a".repeat(32),
    title: "Podcast",
    created_at: "2026-10-10T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
    status: "ready",
    source: {
      kind: "upload",
      original_name: "podcast.mp4",
      url: null,
      filename: "source.mp4",
      size_bytes: 1024,
      content_type: "video/mp4",
      container: "mp4",
      sha256: "f".repeat(64),
    },
    settings: clipDefaults,
    job: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

/** Substitui `fetch` por um roteador simples baseado em método + caminho. */
export function mockFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: { key: string; init?: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    calls.push({ key, init });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ detail: `rota não simulada: ${key}` }), { status: 404 });
    const { status = 200, body = null } = handler(init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn, calls };
}
