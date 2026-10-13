import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Clapperboard,
  Download,
  Smartphone,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Clip, ClipSet, ClipStatus, ClipUpdate, Project } from "../api/types";
import { formatBytes, formatDuration, formatTimecode } from "../lib/format";
import { canDetectClips } from "../lib/projects";
import ClipPreview from "./ClipPreview";
import RangeEditor from "./RangeEditor";
import Notice from "./Notice";

interface Props {
  project: Project;
  currentTime: number;
  onPreview: (start: number, end: number) => void;
  onProjectChange: (project: Project) => void;
  onError: (message: string) => void;
}

type Filter = "all" | ClipStatus;

const FILTER_LABELS: Record<Filter, string> = {
  all: "Todos",
  suggested: "Sugeridos",
  approved: "Aprovados",
  rejected: "Descartados",
};

const STATUS_STYLE: Record<ClipStatus, string> = {
  suggested: "bg-ink-700 text-zinc-300",
  approved: "bg-brand-400/15 text-brand-300",
  rejected: "bg-red-500/10 text-red-300",
};

const STATUS_LABEL: Record<ClipStatus, string> = { suggested: "Sugerido", approved: "Aprovado", rejected: "Descartado" };

function scoreTone(score: number): string {
  if (score >= 65) return "text-brand-300 ring-brand-400/40";
  if (score >= 45) return "text-sky-300 ring-sky-400/40";
  return "text-zinc-400 ring-ink-500";
}

function ScoreBreakdown({ clip }: { clip: Clip }) {
  return (
    <div className="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-3">
      <p className="mb-2 text-xs text-zinc-500">
        Cada critério vale de 0 a 100% e contribui conforme o peso definido em Configurações. A soma das contribuições é a
        pontuação ({clip.score.toLocaleString("pt-BR")}).
      </p>
      <ul className="grid gap-2">
        {clip.components.map((component) => (
          <li key={component.key} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-zinc-300">{component.label}</span>
              <span className="font-mono text-zinc-500 tabular-nums">
                {Math.round(component.value * 100)}% · +{component.points.toLocaleString("pt-BR")} pts
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-700" aria-hidden>
              <div className="h-full rounded-full bg-brand-400/80" style={{ width: `${Math.round(component.value * 100)}%` }} />
            </div>
            {component.details.length > 0 && <p className="text-[11px] text-zinc-500">{component.details.join(" · ")}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClipCard({
  clip,
  editorUrl,
  rank,
  currentTime,
  onPreview,
  onUpdate,
  onDelete,
  canRender,
  exportUrl,
  onRender,
  onOpenFormat,
}: {
  clip: Clip;
  editorUrl: string;
  rank: number;
  currentTime: number;
  onPreview: (start: number, end: number) => void;
  onUpdate: (clip: Clip, data: ClipUpdate) => Promise<void>;
  onDelete: (clip: Clip) => Promise<void>;
  canRender: boolean;
  exportUrl: string | null;
  onRender: (clip: Clip) => void;
  onOpenFormat: (clip: Clip, tab: "live" | "rendered") => void;
}) {
  const [showScore, setShowScore] = useState(false);
  const [editingRange, setEditingRange] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [expanded, setExpanded] = useState(false);
  const duration = clip.end - clip.start;

  const saveTitle = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await onUpdate(clip, { title: title.trim() });
    setEditingTitle(false);
  };

  return (
    <article
      className={`rounded-2xl border p-4 transition ${clip.status === "rejected" ? "border-ink-700 bg-ink-900/50 opacity-70" : "border-ink-700 bg-ink-850/60"}`}
      aria-label={`Corte ${rank}: ${clip.title}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid size-14 shrink-0 place-items-center rounded-2xl bg-ink-900 ring-2 ${scoreTone(clip.score)}`}
          title="Pontuação heurística (0–100)"
        >
          <span className="text-lg leading-none font-bold tabular-nums">{Math.round(clip.score)}</span>
          <span className="-mt-2 text-[9px] tracking-wide text-zinc-500 uppercase">pontos</span>
        </div>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <form onSubmit={saveTitle} className="flex flex-wrap gap-2">
              <input
                className="input flex-1 font-semibold"
                aria-label="Título do corte"
                maxLength={200}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button type="submit" className="btn btn-primary px-3">
                Salvar
              </button>
              <button
                type="button"
                className="btn btn-secondary px-3"
                onClick={() => {
                  setTitle(clip.title);
                  setEditingTitle(false);
                }}
              >
                Cancelar
              </button>
            </form>
          ) : (
            <div className="flex items-start gap-1">
              <h3 className="font-semibold text-zinc-100">
                {rank > 0 && <span className="mr-1.5 text-zinc-500">#{rank}</span>}
                {clip.title}
              </h3>
              <button type="button" className="btn btn-ghost -mt-1 px-1.5" aria-label="Editar título do corte" onClick={() => setEditingTitle(true)}>
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono tabular-nums">
              {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
            </span>
            <span>({duration.toFixed(1).replace(".", ",")} s)</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[clip.status]}`}>{STATUS_LABEL[clip.status]}</span>
            {clip.origin === "manual" && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px]">Manual</span>}
            {clip.edited && clip.origin === "auto" && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px]">Ajustado</span>}
            {clip.subtitle_cues && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px]">Legendas editadas</span>}
            {clip.framing_override && (
              <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px]">
                {clip.framing_override.mode === "manual" ? "Enquadramento manual" : `Enquadramento: ${clip.framing_override.mode}`}
              </span>
            )}
          </p>
        </div>
      </div>

      {(clip.highlights.length > 0 || clip.warnings.length > 0) && (
        <ul className="mt-3 grid gap-1 text-xs">
          {clip.highlights.slice(0, 3).map((h) => (
            <li key={h} className="flex gap-1.5 text-zinc-300">
              <Check className="mt-0.5 size-3.5 shrink-0 text-brand-400" aria-hidden /> {h}
            </li>
          ))}
          {clip.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-amber-200/90">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}

      {clip.text && (
        <p className={`mt-3 text-sm text-zinc-400 ${expanded ? "" : "line-clamp-2"}`}>
          {clip.text}{" "}
          {clip.text.length > 160 && (
            <button type="button" className="text-xs text-brand-400 hover:text-brand-300" onClick={() => setExpanded(!expanded)}>
              {expanded ? "mostrar menos" : "mostrar tudo"}
            </button>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={editorUrl} className="btn btn-primary px-3 py-1.5 text-xs">
          <SlidersHorizontal className="size-3.5" aria-hidden /> Abrir no editor
        </Link>
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onPreview(clip.start, clip.end)}>
          <Play className="size-3.5" aria-hidden /> Pré-visualizar
        </button>
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onOpenFormat(clip, "live")}>
          <Smartphone className="size-3.5" aria-hidden /> Prévia no formato
        </button>
        {clip.status !== "approved" && (
          <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onUpdate(clip, { status: "approved" })}>
            <Check className="size-3.5" aria-hidden /> Aprovar
          </button>
        )}
        {clip.status !== "rejected" ? (
          <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onUpdate(clip, { status: "rejected" })}>
            <X className="size-3.5" aria-hidden /> Descartar
          </button>
        ) : (
          <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onUpdate(clip, { status: "suggested" })}>
            <RotateCcw className="size-3.5" aria-hidden /> Restaurar
          </button>
        )}
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditingRange(!editingRange)}>
          <Scissors className="size-3.5" aria-hidden /> Ajustar início e fim
        </button>
        <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setShowScore(!showScore)} aria-expanded={showScore}>
          {showScore ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          Por que esta pontuação?
        </button>
        <button type="button" className="btn btn-ghost ml-auto px-2 py-1.5 text-xs text-zinc-500 hover:text-red-300" aria-label="Excluir corte" onClick={() => onDelete(clip)}>
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {clip.status !== "rejected" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-700 pt-3 text-xs">
          {clip.render ? (
            <>
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${clip.render.stale ? "bg-amber-500/15 text-amber-300" : "bg-brand-400/15 text-brand-300"}`}
              >
                {clip.render.stale ? "Vídeo desatualizado" : "Vídeo pronto"}
              </span>
              <span className="text-zinc-500">
                {clip.render.width}×{clip.render.height} · {formatBytes(clip.render.size_bytes)}
                {clip.render.framing === "rosto" ? " · rosto acompanhado" : ""}
              </span>
              <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onOpenFormat(clip, "rendered")}>
                <Play className="size-3.5" aria-hidden /> Assistir
              </button>
              {exportUrl && (
                <a href={exportUrl} download className="btn btn-secondary px-3 py-1.5 text-xs">
                  <Download className="size-3.5" aria-hidden /> Baixar MP4
                </a>
              )}
            </>
          ) : (
            <span className="text-zinc-500">Vídeo ainda não gerado.</span>
          )}
          {canRender && (
            <button type="button" className="btn btn-secondary ml-auto px-3 py-1.5 text-xs" onClick={() => onRender(clip)}>
              <Clapperboard className="size-3.5" aria-hidden /> {clip.render ? "Gerar novamente" : "Gerar vídeo"}
            </button>
          )}
        </div>
      )}
      {clip.render?.notes.map((note) => (
        <p key={note} className="mt-2 text-xs text-amber-200/90">
          {note}
        </p>
      ))}

      {editingRange && (
        <RangeEditor
          clip={clip}
          currentTime={currentTime}
          onCancel={() => setEditingRange(false)}
          onSave={async (start, end) => {
            await onUpdate(clip, { start, end });
            setEditingRange(false);
          }}
        />
      )}
      {showScore && <ScoreBreakdown clip={clip} />}
    </article>
  );
}

export default function ClipsPanel({ project, currentTime, onPreview, onProjectChange, onError }: Props) {
  const [clipSet, setClipSet] = useState<ClipSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [formatPreview, setFormatPreview] = useState<{ clip: Clip; tab: "live" | "rendered" } | null>(null);
  // Recarrega quando as sugestões mudam, quando uma tarefa termina (ex.: vídeos gerados) e quando a
  // configuração do projeto muda (o servidor recalcula quais vídeos ficaram desatualizados).
  const version = project.clips
    ? [project.clips.generated_at, project.clips.rendered, project.job?.id, project.job?.status, JSON.stringify(project.settings)].join("|")
    : null;

  useEffect(() => {
    if (!version) {
      setClipSet(null);
      return;
    }
    let active = true;
    setLoadError(null);
    api
      .getClips(project.id)
      .then((data) => active && setClipSet(data))
      .catch((err: Error) => active && setLoadError(err.message));
    return () => {
      active = false;
    };
  }, [project.id, version]);

  const clips = clipSet?.clips ?? [];
  const counts = useMemo(
    () => ({
      all: clips.length,
      suggested: clips.filter((c) => c.status === "suggested").length,
      approved: clips.filter((c) => c.status === "approved").length,
      rejected: clips.filter((c) => c.status === "rejected").length,
    }),
    [clips],
  );
  const visible = filter === "all" ? clips : clips.filter((c) => c.status === filter);
  const ranks = new Map(clips.filter((c) => c.status !== "rejected").map((c, index) => [c.id, index + 1]));
  const editable = canDetectClips(project);

  const replaceClip = (updated: Clip) =>
    setClipSet((current) =>
      current
        ? {
            ...current,
            clips: [...current.clips.map((c) => (c.id === updated.id ? updated : c))].sort(
              (a, b) => Number(a.status === "rejected") - Number(b.status === "rejected") || b.score - a.score,
            ),
          }
        : current,
    );

  const refreshProject = async () => {
    try {
      onProjectChange(await api.getProject(project.id));
    } catch {
      /* a atualização periódica da página corrige depois */
    }
  };

  const update = async (clip: Clip, data: ClipUpdate) => {
    try {
      replaceClip(await api.updateClip(project.id, clip.id, data));
      if (data.status) void refreshProject();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (data.start !== undefined || data.end !== undefined) throw err;
      onError(message);
    }
  };

  const remove = async (clip: Clip) => {
    if (!window.confirm(`Excluir o corte “${clip.title}”?`)) return;
    try {
      await api.deleteClip(project.id, clip.id);
      setClipSet((current) => (current ? { ...current, clips: current.clips.filter((c) => c.id !== clip.id) } : current));
      void refreshProject();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const render = async (ids?: string[]) => {
    setBusy(true);
    try {
      onProjectChange(await api.renderClips(project.id, ids));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (
      clipSet &&
      !window.confirm(
        "Gerar novas sugestões? Cortes aprovados, descartados, ajustados e manuais serão mantidos; os demais serão substituídos.",
      )
    )
      return;
    setBusy(true);
    try {
      onProjectChange(await api.detectClips(project.id, true));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const duration = project.media?.duration_seconds ?? currentTime + 30;
    const start = Math.min(currentTime, Math.max(0, duration - 1));
    const end = Math.min(start + 30, duration);
    setBusy(true);
    try {
      const clip = await api.createClip(project.id, { start, end });
      setClipSet((current) => (current ? { ...current, clips: [clip, ...current.clips] } : current));
      setFilter("all");
      void refreshProject();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-label="Cortes sugeridos">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-4.5 text-brand-400" aria-hidden /> Cortes sugeridos
          </h2>
          {clipSet && (
            <p className="mt-0.5 text-xs text-zinc-500">
              {counts.all - counts.rejected} corte(s) · {counts.approved} aprovado(s) · {clipSet.candidates_evaluated.toLocaleString("pt-BR")}{" "}
              trechos avaliados · faixa de {clipSet.duration_preset.replace("-", "–")} s
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {clipSet && editable && counts.approved > 0 && (
            <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => render()} disabled={busy}>
              <Clapperboard className="size-3.5" aria-hidden /> Gerar vídeos dos aprovados ({counts.approved})
            </button>
          )}
          {clipSet && editable && (
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={addManual} disabled={busy}>
              <Plus className="size-3.5" aria-hidden /> Adicionar corte em {formatDuration(currentTime)}
            </button>
          )}
          {editable && (
            <button type="button" className={`btn ${clipSet ? "btn-secondary" : "btn-primary"} px-3 py-1.5 text-xs`} onClick={regenerate} disabled={busy}>
              {clipSet ? <RefreshCw className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
              {clipSet ? "Gerar novamente" : "Sugerir cortes"}
            </button>
          )}
        </div>
      </div>

      {!clipSet && !loadError && (
        <p className="text-sm text-zinc-400">
          {project.status === "detecting_clips"
            ? "Procurando os melhores trechos. Acompanhe o progresso acima do vídeo."
            : project.transcript
              ? "A transcrição está pronta. Clique em “Sugerir cortes” para encontrar os melhores trechos."
              : "As sugestões de cortes aparecem depois da transcrição."}
        </p>
      )}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {clipSet && (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            A pontuação é <strong className="text-zinc-400">heurística</strong>: indica características do trecho (gancho,
            pergunta e resposta, história, opinião, clareza…) e serve para comparar os trechos deste vídeo. Ela não prevê
            visualizações nem viralização.
          </p>
          {clipSet.notes.map((note) => (
            <div key={note} className="mb-3">
              <Notice tone="info">{note}</Notice>
            </div>
          ))}
          {clips.length > 0 && (
            <div role="tablist" aria-label="Filtrar cortes" className="mb-3 flex flex-wrap gap-1">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filter === key ? "bg-ink-700 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"}`}
                >
                  {FILTER_LABELS[key]} ({counts[key]})
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3">
            {visible.map((clip) => (
              <ClipCard
                key={`${clip.id}-${clip.updated_at}`}
                clip={clip}
                editorUrl={`/projetos/${project.id}/cortes/${clip.id}`}
                rank={ranks.get(clip.id) ?? 0}
                currentTime={currentTime}
                onPreview={onPreview}
                onUpdate={update}
                onDelete={remove}
                canRender={editable}
                exportUrl={clip.render ? api.exportUrl(project.id, clip.render.filename) : null}
                onRender={(c) => render([c.id])}
                onOpenFormat={(c, tab) => setFormatPreview({ clip: c, tab })}
              />
            ))}
            {visible.length === 0 && clips.length > 0 && <p className="text-sm text-zinc-500">Nenhum corte neste filtro.</p>}
          </div>
        </>
      )}
      {formatPreview && (
        <ClipPreview
          project={project}
          clip={formatPreview.clip}
          initialTab={formatPreview.tab}
          onClose={() => setFormatPreview(null)}
        />
      )}
    </section>
  );
}
