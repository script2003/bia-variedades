import { Download, FileText, Languages, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { Project, Transcript, TranscriptSegment } from "../api/types";
import { formatDuration } from "../lib/format";
import { canTranscribe, hasActiveJob } from "../lib/projects";
import Notice from "./Notice";

interface Props {
  project: Project;
  /** Tempo atual do player de vídeo, em segundos (para destacar o trecho falado). */
  currentTime: number;
  onSeek: (seconds: number) => void;
  onProjectChange: (project: Project) => void;
  onError: (message: string) => void;
}

const LANGUAGE_NAMES: Record<string, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  it: "Italiano",
  de: "Alemão",
};

/** Índice do segmento que contém `time` (ou -1). Busca binária: transcrições longas têm milhares de trechos. */
export function activeSegmentIndex(segments: TranscriptSegment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid]!;
    if (time < segment.start) high = mid - 1;
    else if (time >= segment.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

export default function TranscriptPanel({ project, currentTime, onSeek, onProjectChange, onError }: Props) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const version = project.transcript?.created_at ?? null;

  useEffect(() => {
    if (!version) {
      setTranscript(null);
      return;
    }
    let active = true;
    setLoadError(null);
    api
      .getTranscript(project.id)
      .then((data) => active && setTranscript(data))
      .catch((err: Error) => active && setLoadError(err.message));
    return () => {
      active = false;
    };
  }, [project.id, version]);

  const segments = transcript?.segments ?? [];
  const activeIndex = activeSegmentIndex(segments, currentTime);
  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return term ? segments.filter((s) => normalize(s.text).includes(term)) : segments;
  }, [segments, query]);

  useEffect(() => {
    if (!follow || query || activeIndex < 0) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-segment="${activeIndex}"]`);
    if (item && typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" });
  }, [activeIndex, follow, query]);

  const start = async () => {
    if (project.transcript && !window.confirm("Transcrever novamente? A transcrição atual será substituída.")) return;
    setStarting(true);
    try {
      onProjectChange(await api.transcribe(project.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const summary = project.transcript;
  const showButton = canTranscribe(project);

  return (
    <section className="card p-5 sm:p-6" aria-label="Transcrição">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Transcrição</h2>
          {summary && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
              <Languages className="size-3.5" aria-hidden />
              {LANGUAGE_NAMES[summary.language] ?? summary.language} · {summary.word_count.toLocaleString("pt-BR")} palavras ·{" "}
              {summary.segment_count.toLocaleString("pt-BR")} trechos · modelo {summary.model}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {summary &&
            (["srt", "vtt", "txt"] as const).map((format) => (
              <a key={format} href={api.transcriptDownloadUrl(project.id, format)} download className="btn btn-secondary px-3 py-1.5 text-xs">
                <Download className="size-3.5" aria-hidden /> {format.toUpperCase()}
              </a>
            ))}
          {showButton && (
            <button type="button" className={`btn ${summary ? "btn-secondary" : "btn-primary"} px-3 py-1.5 text-xs`} onClick={start} disabled={starting}>
              {summary ? <RefreshCw className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
              {starting ? "Iniciando…" : summary ? "Transcrever novamente" : "Transcrever agora"}
            </button>
          )}
        </div>
      </div>

      {!summary &&
        (project.status === "transcribing" ? (
          <p className="text-sm text-zinc-400">A transcrição está em andamento. Acompanhe o progresso acima do vídeo.</p>
        ) : project.audio ? (
          <p className="text-sm text-zinc-400">
            O áudio está pronto. A transcrição roda no seu computador com o faster-whisper; o modelo e o idioma podem ser
            ajustados em Configurações e nas configurações dos cortes.
          </p>
        ) : (
          <p className="text-sm text-zinc-500">A transcrição fica disponível depois da extração do áudio.</p>
        ))}

      {loadError && <Notice tone="error">{loadError}</Notice>}

      {transcript && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              <input
                className="input pl-9"
                placeholder="Buscar na transcrição"
                aria-label="Buscar na transcrição"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" className="size-4 accent-brand-400" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              Acompanhar o vídeo
            </label>
          </div>
          {query && (
            <p className="mb-2 text-xs text-zinc-500" role="status">
              {filtered.length === 0 ? "Nenhum trecho encontrado." : `${filtered.length} trecho(s) encontrado(s).`}
            </p>
          )}
          {segments.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma fala foi detectada no áudio.</p>
          ) : (
            <ol ref={listRef} className="max-h-[28rem] overflow-y-auto rounded-xl border border-ink-700 bg-ink-850" aria-label="Trechos da transcrição">
              {filtered.map((segment) => {
                const active = segment.id === activeIndex;
                return (
                  <li key={segment.id} data-segment={segment.id}>
                    <button
                      type="button"
                      onClick={() => onSeek(segment.start)}
                      aria-current={active ? "true" : undefined}
                      className={[
                        "flex w-full gap-3 border-b border-ink-700/60 px-3 py-2 text-left text-sm transition last:border-b-0",
                        active ? "bg-brand-400/10 text-zinc-50" : "text-zinc-300 hover:bg-ink-800",
                      ].join(" ")}
                    >
                      <span className={`shrink-0 font-mono text-xs tabular-nums ${active ? "text-brand-300" : "text-zinc-500"}`}>
                        {formatDuration(segment.start)}
                      </span>
                      <span className="min-w-0">{segment.text}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {hasActiveJob(project) && project.job?.kind === "transcribe" && (
            <p className="mt-2 text-xs text-zinc-500">Uma nova transcrição está em andamento; esta será substituída ao terminar.</p>
          )}
        </>
      )}
    </section>
  );
}
