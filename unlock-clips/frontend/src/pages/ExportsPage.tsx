import { Download, Film, Play, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { ExportedVideo, HealthInfo } from "../api/types";
import EmptyState from "../components/EmptyState";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";
import { usePolling } from "../hooks/usePolling";
import { formatBytes, formatDateTime } from "../lib/format";

function PlayerDialog({ item, onClose }: { item: ExportedVideo; onClose: () => void }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "9 / 16";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Assistir: ${item.clip_title ?? item.filename}`}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{item.clip_title ?? item.filename}</h2>
            <p className="truncate text-xs text-zinc-500">
              {item.project_title} · {formatBytes(item.size_bytes)}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <video
          src={`${item.url}?download=false`}
          controls
          autoPlay
          playsInline
          onError={() => setError(true)}
          className="mx-auto rounded-xl bg-black"
          style={{ aspectRatio: ratio, maxHeight: "70vh", maxWidth: "100%" }}
        />
        {error && (
          <Notice tone="warning">
            Este navegador não conseguiu reproduzir o MP4 (H.264). Baixe o arquivo para assistir — ele funciona no celular, no
            Windows e nas redes sociais.
          </Notice>
        )}
        <a href={item.url} download className="btn btn-primary justify-self-start">
          <Download className="size-4" aria-hidden /> Baixar MP4
        </a>
      </div>
    </div>
  );
}

export default function ExportsPage() {
  const { data, error, loading, refresh, setData } = usePolling(api.listExports, () => 15000);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [playing, setPlaying] = useState<ExportedVideo | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null));
  }, []);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data ?? []) map.set(item.project_id, item.project_title);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [data]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return (data ?? []).filter(
      (item) =>
        (projectId === "all" || item.project_id === projectId) &&
        (!term ||
          (item.clip_title ?? "").toLocaleLowerCase("pt-BR").includes(term) ||
          item.filename.toLocaleLowerCase("pt-BR").includes(term) ||
          item.project_title.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [data, query, projectId]);

  const totalBytes = filtered.reduce((sum, item) => sum + item.size_bytes, 0);

  const remove = async (item: ExportedVideo) => {
    if (!window.confirm(`Excluir o vídeo “${item.clip_title ?? item.filename}”? O corte continua no projeto e pode ser gerado de novo.`)) return;
    setBusy(true);
    try {
      await api.deleteExport(item.project_id, item.filename);
      setData((data ?? []).filter((e) => e.url !== item.url));
      setMessage({ tone: "success", text: `Vídeo excluído (${formatBytes(item.size_bytes)} liberados).` });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const removeProjectExports = async () => {
    const title = projects.find(([id]) => id === projectId)?.[1] ?? "";
    if (!window.confirm(`Excluir todos os vídeos exportados de “${title}”? Os cortes e as edições continuam no projeto.`)) return;
    setBusy(true);
    try {
      const result = await api.deleteProjectExports(projectId);
      setMessage({ tone: "success", text: `${result.deleted} vídeo(s) excluído(s), ${formatBytes(result.freed_bytes)} liberados.` });
      setProjectId("all");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <>
      <PageHeader title="Vídeos exportados" description="Arquivos MP4 finalizados, com legendas incorporadas, prontos para publicar." />
      {(error || message) && (
        <div className="mb-6">
          <Notice tone={message?.tone ?? "error"}>{message?.text ?? error}</Notice>
        </div>
      )}
      {loading && !data ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Film} title="Nenhum vídeo exportado ainda">
          Os cortes exportados em MP4 aparecerão aqui. Abra um corte no editor (ou use “Gerar vídeos dos aprovados” na página do
          projeto) para criar o primeiro.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              <input
                className="input pl-9"
                placeholder="Buscar por título, arquivo ou projeto"
                aria-label="Buscar vídeos"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select className="input w-auto" aria-label="Filtrar por projeto" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="all">Todos os projetos</option>
              {projects.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
            {projectId !== "all" && (
              <button type="button" className="btn btn-danger" onClick={removeProjectExports} disabled={busy}>
                <Trash2 className="size-4" aria-hidden /> Excluir todos deste projeto
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            {filtered.length} vídeo(s) · {formatBytes(totalBytes)}
            {health && (
              <>
                {" "}
                · salvos em <span className="font-mono">{health.data_dir}</span> (pasta <span className="font-mono">projects/&lt;projeto&gt;/exports</span>)
              </>
            )}
          </p>
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum vídeo corresponde aos filtros.</p>
          ) : (
            <ul className="card divide-y divide-ink-700">
              {filtered.map((item) => (
                <li key={item.url} className="flex flex-wrap items-center gap-4 px-5 py-4" aria-label={item.clip_title ?? item.filename}>
                  <Film className="size-5 shrink-0 text-brand-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <span className="truncate">{item.clip_title ?? item.filename}</span>
                      {item.aspect_ratio && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] font-medium text-zinc-300">{item.aspect_ratio}</span>}
                      {item.stale && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300" title="O corte foi alterado depois de gerar este vídeo.">
                          Desatualizado
                        </span>
                      )}
                    </p>
                    {item.clip_title && <p className="truncate font-mono text-[11px] text-zinc-500">{item.filename}</p>}
                    <p className="truncate text-xs text-zinc-500">
                      <Link to={`/projetos/${item.project_id}`} className="hover:text-zinc-300">
                        {item.project_title}
                      </Link>
                      {item.duration_seconds !== null && ` · ${item.duration_seconds.toFixed(1).replace(".", ",")} s`} ·{" "}
                      {formatBytes(item.size_bytes)} · {formatDateTime(item.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setPlaying(item)}>
                      <Play className="size-3.5" aria-hidden /> Assistir
                    </button>
                    <a href={item.url} download className="btn btn-secondary px-3 py-1.5 text-xs">
                      <Download className="size-3.5" aria-hidden /> Baixar
                    </a>
                    {item.clip_id && (
                      <Link to={`/projetos/${item.project_id}/cortes/${item.clip_id}`} className="btn btn-secondary px-3 py-1.5 text-xs">
                        <SlidersHorizontal className="size-3.5" aria-hidden /> Editar
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1.5 text-xs text-zinc-500 hover:text-red-300"
                      aria-label={`Excluir ${item.clip_title ?? item.filename}`}
                      onClick={() => remove(item)}
                      disabled={busy}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {playing && <PlayerDialog item={playing} onClose={() => setPlaying(null)} />}
    </>
  );
}
