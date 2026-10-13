// Tipos espelhando os modelos Pydantic de backend/app/schemas.py.

export type DurationPreset = "15-30" | "30-60" | "60-90";
export type AspectRatio = "9:16" | "1:1" | "16:9";
export type SubtitleStyle = "classico" | "destaque" | "caixa" | "minimalista";
export type SubtitlePosition = "inferior" | "centro" | "superior";
export type FramingMode = "centro" | "rosto";

export interface ClipSettings {
  duration: DurationPreset;
  aspect_ratio: AspectRatio;
  subtitle_language: string;
  subtitle_style: SubtitleStyle;
  subtitle_font_size: number;
  subtitle_position: SubtitlePosition;
  highlight_current_word: boolean;
  framing: FramingMode;
  max_clips: number;
}

export type WhisperModelName = "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3";
export type WhisperDevice = "cpu" | "cuda";
export type WhisperComputeType = "auto" | "int8" | "int8_float16" | "float16" | "float32";

export interface TranscriptionSettings {
  model: WhisperModelName;
  model_dir: string | null;
  device: WhisperDevice;
  compute_type: WhisperComputeType;
  beam_size: number;
  vad_filter: boolean;
  auto_transcribe: boolean;
  allow_download: boolean;
}

export interface ClipDetectionSettings {
  auto_detect: boolean;
  weights: Record<string, number>;
}

export interface AppSettings {
  clip_defaults: ClipSettings;
  allowed_link_domains: string[];
  max_upload_size_mb: number;
  ffmpeg_dir: string | null;
  transcription: TranscriptionSettings;
  clip_detection: ClipDetectionSettings;
}

export interface ScoringCriterion {
  key: string;
  label: string;
  description: string;
  default_weight: number;
}

export type ClipStatus = "suggested" | "approved" | "rejected";

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  value: number;
  points: number;
  details: string[];
}

export interface RenderInfo {
  filename: string;
  aspect_ratio: AspectRatio;
  width: number;
  height: number;
  duration_seconds: number;
  size_bytes: number;
  framing: FramingMode;
  subtitle_style: SubtitleStyle;
  subtitle_cues: number;
  signature: string;
  notes: string[];
  created_at: string;
  stale: boolean;
}

export interface SubtitleTemplateInfo {
  key: SubtitleStyle;
  label: string;
  description: string;
  font: string;
  bold: boolean;
  uppercase: boolean;
  primary: string;
  highlight: string;
  outline_color: string;
  outline: number;
  shadow: number;
  box: boolean;
  box_color: string;
  box_opacity: number;
  size_factor: number;
  highlight_scale: number;
}

export interface SubtitleWord {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  lines: SubtitleWord[][];
}

export interface ClipSubtitles {
  width: number;
  height: number;
  font_size: number;
  alignment: number;
  margin_v: number;
  margin_h: number;
  highlight: boolean;
  template: SubtitleTemplateInfo;
  cues: SubtitleCue[];
}

export interface ClipFraming {
  mode: FramingMode;
  source_width: number;
  source_height: number;
  crop_width: number;
  crop_height: number;
  x: number;
  y: number;
  keyframes: [number, number][];
  notes: string[];
}

export interface Clip {
  id: string;
  title: string;
  start: number;
  end: number;
  score: number;
  components: ScoreComponent[];
  highlights: string[];
  warnings: string[];
  text: string;
  status: ClipStatus;
  origin: "auto" | "manual";
  edited: boolean;
  render: RenderInfo | null;
  created_at: string;
  updated_at: string;
}

export interface ClipSet {
  generated_at: string;
  language: string;
  duration_preset: DurationPreset;
  max_clips: number;
  weights: Record<string, number>;
  candidates_evaluated: number;
  audio_reference_db: number | null;
  notes: string[];
  clips: Clip[];
}

export interface ClipsSummary {
  filename: string;
  count: number;
  approved: number;
  generated_at: string;
  rendered: number;
}

export interface ClipUpdate {
  title?: string;
  start?: number;
  end?: number;
  status?: ClipStatus;
}

export interface WhisperModelOption {
  name: WhisperModelName;
  label: string;
  size_mb: number;
  description: string;
  installed: boolean;
  path: string;
}

export type JobKind = "process" | "import_link" | "transcribe" | "detect_clips" | "render_clips" | "validate";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface JobInfo {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number | null;
  message: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type ProjectStatus =
  | "importing"
  | "validating"
  | "extracting_audio"
  | "transcribing"
  | "detecting_clips"
  | "rendering"
  | "ready"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SourceInfo {
  kind: "upload" | "link";
  original_name: string;
  url: string | null;
  filename: string | null;
  size_bytes: number | null;
  content_type: string | null;
  container: string | null;
  sha256: string | null;
}

export interface VideoStreamInfo {
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  rotation: number;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  sample_rate: number | null;
  channels: number | null;
  language: string | null;
  default: boolean;
}

export interface MediaInfo {
  duration_seconds: number;
  format_name: string;
  bit_rate: number | null;
  video: VideoStreamInfo | null;
  audio_streams: AudioStreamInfo[];
}

export interface AudioInfo {
  filename: string;
  source_stream_index: number;
  codec: string;
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  size_bytes: number;
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
  probability: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  avg_logprob: number | null;
  no_speech_prob: number | null;
}

export interface Transcript {
  engine: string;
  model: string;
  language: string;
  language_probability: number | null;
  duration_seconds: number;
  created_at: string;
  segments: TranscriptSegment[];
}

export interface TranscriptSummary {
  filename: string;
  engine: string;
  model: string;
  language: string;
  segment_count: number;
  word_count: number;
  duration_seconds: number;
  created_at: string;
}

export interface Project {
  schema_version: number;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: ProjectStatus;
  source: SourceInfo;
  settings: ClipSettings;
  media: MediaInfo | null;
  audio: AudioInfo | null;
  thumbnail: string | null;
  transcript: TranscriptSummary | null;
  clips: ClipsSummary | null;
  job: JobInfo | null;
  warnings: string[];
  error: string | null;
}

export interface ProjectUpdate {
  title?: string;
  settings?: ClipSettings;
}

export interface LinkImportRequest {
  url: string;
  title?: string;
  rights_confirmed: boolean;
  settings?: ClipSettings;
}

export interface ExportedVideo {
  project_id: string;
  project_title: string;
  filename: string;
  size_bytes: number;
  created_at: string;
  url: string;
  clip_id: string | null;
  clip_title: string | null;
}

export interface SystemStats {
  projects_total: number;
  projects_by_status: Record<string, number>;
  active_jobs: number;
  storage_bytes: number;
  exports_total: number;
}

export interface HealthInfo {
  status: "ok";
  version: string;
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
  ffmpeg_version: string | null;
  ffmpeg_error: string | null;
  transcription_available: boolean;
  transcription_error: string | null;
  face_detection_available: boolean;
  face_detection_error: string | null;
  data_dir: string;
}
