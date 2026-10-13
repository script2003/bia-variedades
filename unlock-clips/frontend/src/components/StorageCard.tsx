import { HardDrive, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Project, ProjectStorage } from "../api/types";
import { formatBytes } from "../lib/format";
import { hasActiveJob } from "../lib/projects";

interface Props {
  project: Project;
  onChanged: () => void;
  onMessage: (tone: "error" | "success", text: string) => void;
}

/** Espaço em disco do projeto, com opção de apagar os vídeos exportados (os cortes continuam salvos). */
export default function StorageCard({ project, onChanged, onMessage }: Props) {
  const [storage, setStorage] = useState<ProjectStorage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .projectStorage(project.id)
      .then((data) => active && setStorage(data))
      .catch(() => active && setStorage(null));
    return () => {
      active = false;
    };
  }, [project.id, project.updated_at]);

  if (!storage) return null;

  const removeExports = async () => {
    if (!window.confirm(`Excluir os ${storage.exports_count} vídeo(s) exportado(s) deste projeto? Os cortes e as edições continuam salvos e podem ser exportados de novo.`)) return;
    setBusy(true);
    try {
      const result = await api.deleteProjectExports(project.id);
      onMessage("success", `${result.deleted} vídeo(s) excluído(s), ${formatBytes(result.freed_bytes)} liberados.`);
      onChanged();
    } catch (err) {
      onMessage("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, number][] = [
    ["Vídeo original", storage.source_bytes],
    ["Áudio extraído", storage.audio_bytes],
    [`Vídeos exportados (${storage.exports_count})`, storage.exports_bytes],
    ["Transcrição, cortes e miniatura", storage.other_bytes],
  ];

  return (
    <section className="card p-5" aria-label="Espaço em disco">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <HardDrive className="size-4 text-brand-400" aria-hidden /> Espaço em disco
      </h2>
      <dl className="grid gap-1.5 text-sm">
        {rows.map(([label, bytes]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-mono text-xs text-zinc-300 tabular-nums">{formatBytes(bytes)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-3 border-t border-ink-700 pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="font-mono text-xs tabular-nums">{formatBytes(storage.total_bytes)}</dd>
        </div>
      </dl>
      {storage.exports_count > 0 && (
        <button
          type="button"
          className="btn btn-secondary mt-4 w-full justify-center text-xs"
          onClick={removeExports}
          disabled={busy || hasActiveJob(project)}
        >
          <Trash2 className="size-3.5" aria-hidden /> Excluir vídeos exportados
        </button>
      )}
    </section>
  );
}
