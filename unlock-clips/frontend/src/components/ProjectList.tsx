import { FileVideo, Link2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../api/types";
import { formatBytes, formatDuration, formatRelative } from "../lib/format";
import JobProgress from "./JobProgress";
import StatusBadge from "./StatusBadge";

interface Props {
  projects: Project[];
  onChange?: (project: Project) => void;
  onError?: (message: string) => void;
}

export default function ProjectList({ projects, onChange, onError }: Props) {
  return (
    <ul className="card divide-y divide-ink-700 overflow-hidden">
      {projects.map((project) => {
        const SourceIcon = project.source.kind === "link" ? Link2 : FileVideo;
        const thumbnail = api.thumbnailUrl(project);
        return (
          <li key={project.id} className="grid gap-3 px-4 py-4 transition hover:bg-ink-850 sm:px-5">
            <div className="flex min-w-0 items-center gap-4">
              {thumbnail ? (
                <img src={thumbnail} alt="" loading="lazy" className="h-10 w-16 shrink-0 rounded-lg bg-ink-800 object-cover" />
              ) : (
                <span className="grid h-10 w-16 shrink-0 place-items-center rounded-lg bg-ink-800 text-zinc-400">
                  <SourceIcon className="size-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <Link to={`/projetos/${project.id}`} className="block truncate font-semibold hover:text-brand-300">
                  {project.title}
                </Link>
                <p className="truncate text-xs text-zinc-500">
                  {project.source.original_name} · {formatBytes(project.source.size_bytes)}
                  {project.media && ` · ${formatDuration(project.media.duration_seconds)}`} · {formatRelative(project.created_at)}
                </p>
              </div>
              <StatusBadge status={project.status} />
            </div>
            <JobProgress project={project} onChange={onChange} onError={onError} />
            {project.status === "failed" && project.error && (
              <p className="text-xs text-red-300">{project.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
