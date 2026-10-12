import type { AppSettings, ClipSettings, Project, Transcript } from "../api/types";

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
  ffmpeg_dir: null,
  transcription: {
    model: "small",
    model_dir: null,
    device: "cpu",
    compute_type: "auto",
    beam_size: 5,
    vad_filter: true,
    auto_transcribe: true,
    allow_download: true,
  },
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
    media: {
      duration_seconds: 3725,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      bit_rate: 2_500_000,
      video: { index: 0, codec: "h264", width: 1920, height: 1080, fps: 29.97, rotation: 0 },
      audio_streams: [{ index: 1, codec: "aac", sample_rate: 48000, channels: 2, language: "por", default: true }],
    },
    audio: {
      filename: "audio.wav",
      source_stream_index: 1,
      codec: "pcm_s16le",
      sample_rate: 16000,
      channels: 1,
      duration_seconds: 3725,
      size_bytes: 119_200_044,
    },
    thumbnail: "thumbnail.jpg",
    transcript: {
      filename: "transcript.json",
      engine: "faster-whisper",
      model: "small",
      language: "pt",
      segment_count: 3,
      word_count: 9,
      duration_seconds: 3725,
      created_at: "2026-10-10T12:30:00Z",
    },
    job: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

export const sampleTranscript: Transcript = {
  engine: "faster-whisper",
  model: "small",
  language: "pt",
  language_probability: 0.99,
  duration_seconds: 3725,
  created_at: "2026-10-10T12:30:00Z",
  segments: [
    { id: 0, start: 0, end: 4.2, text: "Bem-vindos ao podcast.", words: [], avg_logprob: -0.2, no_speech_prob: 0.01 },
    { id: 1, start: 4.2, end: 9.8, text: "Hoje vamos falar de educação.", words: [], avg_logprob: -0.3, no_speech_prob: 0.01 },
    { id: 2, start: 65, end: 70, text: "A pergunta é: por que isso importa?", words: [], avg_logprob: -0.25, no_speech_prob: 0.02 },
  ],
};

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
