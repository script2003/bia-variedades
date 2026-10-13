import type { ProjectStatus } from "../api/types";
import { PROJECT_STATUS_LABEL } from "../lib/format";

const STYLES: Record<ProjectStatus, string> = {
  importing: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  validating: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  extracting_audio: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  transcribing: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  detecting_clips: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  ready: "bg-brand-400/15 text-brand-300 ring-brand-400/30",
  failed: "bg-red-500/15 text-red-300 ring-red-500/30",
  cancelled: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  interrupted: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export default function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STYLES[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}
