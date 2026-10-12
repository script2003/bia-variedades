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

export interface AppSettings {
  clip_defaults: ClipSettings;
  allowed_link_domains: string[];
  max_upload_size_mb: number;
}

export type JobKind = "validate" | "import_link";
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

export type ProjectStatus = "importing" | "validating" | "ready" | "failed" | "cancelled" | "interrupted";

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

export interface Project {
  schema_version: number;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: ProjectStatus;
  source: SourceInfo;
  settings: ClipSettings;
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
  data_dir: string;
}
