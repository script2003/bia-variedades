import type {
  AppSettings,
  Clip,
  ClipFraming,
  ClipSet,
  ClipSettings,
  ClipSubtitles,
  Project,
  RenderInfo,
  ScoringCriterion,
  Transcript,
} from "../api/types";

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
  clip_detection: {
    auto_detect: true,
    weights: { hook: 20, impact: 15, opinion: 12, qa: 15, story: 12, clarity: 10, context: 16, emphasis: 5, duration: 5 },
  },
};

export const scoringCriteria: ScoringCriterion[] = [
  { key: "hook", label: "Gancho inicial", description: "Os primeiros segundos prendem a atenção.", default_weight: 20 },
  { key: "story", label: "História completa", description: "Início, desenvolvimento e conclusão.", default_weight: 12 },
];

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
    clips: { filename: "clips.json", count: 2, approved: 1, generated_at: "2026-10-10T12:31:00Z", rendered: 0 },
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

export function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    title: "Por que a maioria nunca guarda dinheiro?",
    start: 21.9,
    end: 42.0,
    score: 74.5,
    components: [
      { key: "hook", label: "Gancho inicial", weight: 20, value: 0.9, points: 17.1, details: ["Abre com uma pergunta"] },
      { key: "qa", label: "Pergunta e resposta", weight: 15, value: 1, points: 14.3, details: ["Pergunta respondida em 17 s"] },
      { key: "story", label: "História completa", weight: 12, value: 0, points: 0, details: [] },
    ],
    highlights: ["Abre com uma pergunta", "Pergunta respondida em 17 s"],
    warnings: [],
    text: "Por que a maioria das pessoas nunca consegue guardar dinheiro? A resposta é simples.",
    status: "suggested",
    origin: "auto",
    edited: false,
    render: null,
    framing_override: null,
    subtitle_cues: null,
    created_at: "2026-10-10T12:31:00Z",
    updated_at: "2026-10-10T12:31:00Z",
    ...overrides,
  };
}

export const sampleClipSet: ClipSet = {
  generated_at: "2026-10-10T12:31:00Z",
  language: "pt",
  duration_preset: "15-30",
  max_clips: 10,
  weights: appSettings.clip_detection.weights,
  candidates_evaluated: 120,
  audio_reference_db: -24.5,
  notes: [],
  clips: [
    makeClip(),
    makeClip({
      id: "clip-2",
      title: "Uma vez eu perdi todo o meu dinheiro",
      start: 64.4,
      end: 81.7,
      score: 44.7,
      status: "approved",
      warnings: ["Começa com “e”, pode depender do que foi dito antes"],
      text: "Uma vez eu perdi todo o meu dinheiro.",
    }),
    makeClip({ id: "clip-3", title: "Trecho descartado", start: 100, end: 118, score: 20, status: "rejected", text: "e aí tipo" }),
  ],
};

export function makeRender(overrides: Partial<RenderInfo> = {}): RenderInfo {
  return {
    filename: "por-que-a-maioria-clip-1-9x16.mp4",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    duration_seconds: 20.1,
    size_bytes: 4_200_000,
    framing: "rosto",
    subtitle_style: "destaque",
    subtitle_cues: 7,
    signature: "abc",
    notes: [],
    created_at: "2026-10-10T13:00:00Z",
    stale: false,
    ...overrides,
  };
}

export const sampleSubtitles: ClipSubtitles = {
  width: 1080,
  height: 1920,
  font_size: 64,
  alignment: 2,
  margin_v: 384,
  margin_h: 76,
  highlight: true,
  template: {
    key: "destaque",
    label: "Destaque",
    description: "Letras grandes",
    font: "Arial",
    bold: true,
    uppercase: true,
    primary: "#FFFFFF",
    highlight: "#C4F34A",
    outline_color: "#000000",
    outline: 6,
    shadow: 2,
    box: false,
    box_color: "#000000",
    box_opacity: 0,
    size_factor: 1,
    highlight_scale: 108,
  },
  cues: [
    {
      start: 0,
      end: 1.6,
      lines: [
        [
          { start: 0, end: 0.4, text: "POR" },
          { start: 0.4, end: 0.8, text: "QUE" },
          { start: 0.8, end: 1.4, text: "GUARDAR" },
        ],
      ],
    },
    { start: 2, end: 3, lines: [[{ start: 2, end: 3, text: "DINHEIRO?" }]] },
  ],
  editable: [
    { start: 21.9, end: 23.5, text: "Por que guardar", hidden: false, edited: false },
    { start: 23.9, end: 24.9, text: "dinheiro?", hidden: false, edited: false },
  ],
  edited: false,
};

export const sampleFraming: ClipFraming = {
  mode: "centro",
  requested: "centro",
  override: null,
  source_width: 1920,
  source_height: 1080,
  crop_width: 608,
  crop_height: 1080,
  x: 656,
  y: 0,
  keyframes: [],
  notes: [],
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
