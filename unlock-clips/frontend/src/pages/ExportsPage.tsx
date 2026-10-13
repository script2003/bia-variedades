import { Download, Film } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import EmptyState from "../components/EmptyState";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";
import { usePolling } from "../hooks/usePolling";
import { formatBytes, formatDateTime } from "../lib/format";

export default function ExportsPage() {
  const { data, error, loading } = usePolling(api.listExports, () => 15000);

  return (
    <>
      <PageHeader title="Vídeos exportados" description="Arquivos MP4 finalizados, prontos para publicar." />
      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {loading && !data ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Film} title="Nenhum vídeo exportado ainda">
          Os cortes exportados em MP4 aparecerão aqui. Gere os vídeos na página de um projeto, no painel “Cortes sugeridos”.
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-ink-700">
          {data.map((item) => (
            <li key={item.url} className="flex items-center gap-4 px-5 py-4">
              <Film className="size-5 shrink-0 text-brand-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{item.clip_title ?? item.filename}</p>
                {item.clip_title && <p className="truncate font-mono text-[11px] text-zinc-500">{item.filename}</p>}
                <p className="truncate text-xs text-zinc-500">
                  <Link to={`/projetos/${item.project_id}`} className="hover:text-zinc-300">
                    {item.project_title}
                  </Link>{" "}
                  · {formatBytes(item.size_bytes)} · {formatDateTime(item.created_at)}
                </p>
              </div>
              <a href={item.url} download className="btn btn-secondary">
                <Download className="size-4" aria-hidden /> Baixar
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
