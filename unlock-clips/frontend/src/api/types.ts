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

export interface AppSettings {
  clip_defaults: ClipSettings;
  allowed_link_domains: string[];
  max_upload_size_mb: number;
  ffmpeg_dir: string | null;
  transcription: TranscriptionSettings;
}

export interface WhisperModelOption {
  name: WhisperModelName;
  label: string;
  size_mb: number;
  description: string;
  installed: boolean;
  path: string;
}

export type JobKind = "process" | "import_link" | "transcribe" | "validate";
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
  data_dir: string;
}
