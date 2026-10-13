import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Crop,
  Download,
  FileVideo,
  Pencil,
  RotateCcw,
  Scissors,
  Subtitles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Clip, ClipFraming, ClipSet, ClipSubtitles, ClipUpdate, EditableCue, FramingOverride, HealthInfo } from "../api/types";
import { ClipPreviewTabs, FRAMING_LABEL, framingStatusText } from "../components/ClipPreview";
import EmptyState from "../components/EmptyState";
import JobProgress from "../components/JobProgress";
import type { LivePlayerHandle } from "../components/LivePlayer";
import Notice from "../components/Notice";
import RangeEditor from "../components/RangeEditor";
import FramingEditor, { sameFraming } from "../components/editor/FramingEditor";
import SubtitleEditor, { subtitlesDirty, validateDraft } from "../components/editor/SubtitleEditor";
import { usePolling } from "../hooks/usePolling";
import { formatBytes, formatTimecode } from "../lib/format";
import { displaySize, localFraming } from "../lib/framing";
import { draftSubtitles } from "../lib/subtitles";
import { hasActiveJob } from "../lib/projects";

function Section({ icon: Icon, title, children, aside }: { icon: typeof Crop; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-5" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon className="size-4 text-brand-400" aria-hidden /> {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATUS_LABEL = { suggested: "Sugerido", approved: "Aprovado", rejected: "Descartado" } as const;

export default function ClipEditorPage() {
  const { projectId = "", clipId = "" } = useParams();
  // A chave reinicia o editor (rascunhos e prévias) ao trocar de corte.
  return <ClipEditor key={`${projectId}/${clipId}`} projectId={projectId} clipId={clipId} />;
}

function ClipEditor({ projectId, clipId }: { projectId: string; clipId: string }) {
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [clipSet, setClipSet] = useState<ClipSet | null>(null);
  const [clipsError, setClipsError] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<ClipSubtitles | null>(null);
  const [subtitleDraft, setSubtitleDraft] = useState<EditableCue[]>([]);
  const [serverFraming, setServerFraming] = useState<ClipFraming | null>(null);
  const [framingLoading, setFramingLoading] = useState(false);
  const [framingDraft, setFramingDraft] = useState<FramingOverride | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [saving, setSaving] = useState<"subtitles" | "framing" | "title" | "range" | "render" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState(0);
  const [rangeNonce, setRangeNonce] = useState(0);
  const player = useRef<LivePlayerHandle>(null);

  const { data: project, error: projectError, loading, setData: setProject } = usePolling(
    () => api.getProject(projectId),
    (current) => (current && hasActiveJob(current) ? 1000 : 10000),
  );

  const showError = (err: unknown) => setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });

  // Recarrega os cortes quando as sugestões mudam ou uma tarefa (ex.: geração do vídeo) termina.
  const clipsVersion = project?.clips
    ? [project.clips.generated_at, project.clips.rendered, project.job?.id, project.job?.status, JSON.stringify(project.settings)].join("|")
    : null;
  useEffect(() => {
    if (!clipsVersion) return;
    let active = true;
    api
      .getClips(projectId)
      .then((data) => active && setClipSet(data))
      .catch((err: Error) => active && setClipsError(err.message));
    return () => {
      active = false;
    };
  }, [projectId, clipsVersion]);

  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null));
  }, []);

  const clip = clipSet?.clips.find((c) => c.id === clipId) ?? null;

  // Legendas: recarregadas quando o trecho, as configurações ou a transcrição mudam.
  const subtitlesKey = clip && project ? [clip.start, clip.end, JSON.stringify(project.settings), project.transcript?.created_at].join("|") : null;
  useEffect(() => {
    if (!subtitlesKey) return;
    let active = true;
    api
      .clipSubtitles(projectId, clipId)
      .then((data) => {
        if (!active) return;
        setSubtitles(data);
        setSubtitleDraft(data.editable);
      })
      .catch((err: Error) => active && showError(err));
    return () => {
      active = false;
    };
  }, [projectId, clipId, subtitlesKey]);

  // Enquadramento salvo (calculado no servidor — necessário para o acompanhamento de rosto).
  const savedOverride = clip?.framing_override ?? null;
  const framingKey = clip && project ? [clip.start, clip.end, project.settings.aspect_ratio, project.settings.framing, JSON.stringify(savedOverride)].join("|") : null;
  useEffect(() => {
    if (!framingKey) return;
    let active = true;
    setFramingLoading(true);
    api
      .clipFraming(projectId, clipId)
      .then((data) => active && setServerFraming(data))
      .catch(() => active && setServerFraming(null))
      .finally(() => active && setFramingLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, clipId, framingKey]);

  // O rascunho do enquadramento começa igual ao salvo.
  const savedOverrideJson = JSON.stringify(savedOverride);
  useEffect(() => {
    setFramingDraft(savedOverrideJson ? (JSON.parse(savedOverrideJson) as FramingOverride | null) : null);
  }, [savedOverrideJson]);

  const subtitlesChanged = subtitles ? subtitlesDirty(subtitles.editable, subtitleDraft) : false;
  const framingChanged = !sameFraming(framingDraft, savedOverride);
  const unsaved = subtitlesChanged || framingChanged;

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const sourceSize = useMemo<[number, number] | null>(() => {
    if (serverFraming) return [serverFraming.source_width, serverFraming.source_height];
    return project?.media?.video ? displaySize(project.media.video) : null;
  }, [serverFraming, project?.media?.video]);

  if (loading && !project) return <p className="text-sm text-zinc-500">Carregando…</p>;
  if (!project) {
    return (
      <EmptyState icon={FileVideo} title="Projeto não encontrado" action={<Link to="/projetos" className="btn btn-primary">Ver meus projetos</Link>}>
        {projectError ?? "Este projeto não existe ou foi excluído."}
      </EmptyState>
    );
  }
  if (clipsError || (clipSet && !clip)) {
    return (
      <EmptyState
        icon={Scissors}
        title="Corte não encontrado"
        action={<Link to={`/projetos/${projectId}`} className="btn btn-primary">Voltar ao projeto</Link>}
      >
        {clipsError ?? "Este corte foi excluído ou substituído por novas sugestões."}
      </EmptyState>
    );
  }
  if (!clip) return <p className="text-sm text-zinc-500">Carregando o corte…</p>;

  const settings = project.settings;
  const requested = framingDraft?.mode ?? settings.framing;
  // Prévia do enquadramento: modos central e manual são calculados aqui na hora; o rosto vem do servidor.
  const previewFraming: ClipFraming | null =
    requested === "rosto"
      ? framingChanged
        ? null
        : serverFraming
      : sourceSize
        ? localFraming(sourceSize[0], sourceSize[1], settings.aspect_ratio, framingDraft)
        : serverFraming;
  const framingStatus =
    requested === "rosto" && framingChanged
      ? "Salve o enquadramento para calcular o acompanhamento do rosto (a prévia mostra o centro até lá)."
      : framingStatusText(requested, framingChanged ? previewFraming : serverFraming, framingLoading && !framingChanged);
  const previewSubtitles = subtitles && subtitlesChanged ? draftSubtitles(subtitles, subtitleDraft, clip.start) : subtitles;

  const busy = hasActiveJob(project);
  const rendering = busy && project.job?.kind === "render_clips";
  const ordered = (clipSet?.clips ?? []).filter((c) => c.status !== "rejected" || c.id === clip.id);
  const position = ordered.findIndex((c) => c.id === clip.id);
  const previous = position > 0 ? ordered[position - 1] : null;
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null;

  const replaceClip = (updated: Clip) =>
    setClipSet((current) => (current ? { ...current, clips: current.clips.map((c) => (c.id === updated.id ? updated : c)) } : current));

  const refreshClips = async () => {
    try {
      setClipSet(await api.getClips(projectId));
    } catch {
      /* a atualização seguinte corrige */
    }
  };

  const update = async (data: ClipUpdate, what: "title" | "range" | "framing" | null = null) => {
    setSaving(what);
    try {
      const updated = await api.updateClip(projectId, clip.id, data);
      replaceClip(updated);
      // Recalcula "vídeo desatualizado" no servidor.
      void refreshClips();
      return updated;
    } finally {
      setSaving(null);
    }
  };

  const saveTitle = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await update({ title: title.trim() }, "title");
      setEditingTitle(false);
    } catch (err) {
      showError(err);
    }
  };

  const saveFraming = async () => {
    try {
      await update({ framing_override: framingDraft }, "framing");
      setMessage({ tone: "success", text: "Enquadramento salvo. Gere o vídeo novamente para aplicá-lo ao MP4." });
    } catch (err) {
      showError(err);
    }
  };

  const persistSubtitles = async () => {
    const problem = validateDraft(subtitleDraft, clip.start, clip.end);
    if (problem) throw new Error(problem);
    const data = await api.saveClipSubtitles(
      projectId,
      clip.id,
      subtitleDraft.map(({ start, end, text, hidden }) => ({ start, end, text, hidden })),
    );
    setSubtitles(data);
    setSubtitleDraft(data.editable);
    await refreshClips();
  };

  const saveSubtitles = async () => {
    setSaving("subtitles");
    try {
      await persistSubtitles();
      setMessage({ tone: "success", text: "Legendas salvas. Gere o vídeo novamente para aplicá-las ao MP4." });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(null);
    }
  };

  const resetSubtitles = async () => {
    if (!window.confirm("Descartar todas as edições das legendas deste corte e voltar ao texto da transcrição?")) return;
    setSaving("subtitles");
    try {
      const data = await api.resetClipSubtitles(projectId, clip.id);
      setSubtitles(data);
      setSubtitleDraft(data.editable);
      await refreshClips();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(null);
    }
  };

  /** Salva o que estiver pendente e gera o MP4 do corte (com legendas e enquadramento). */
  const exportClip = async () => {
    setSaving("render");
    setMessage(null);
    try {
      if (framingChanged) await api.updateClip(projectId, clip.id, { framing_override: framingDraft }).then(replaceClip);
      if (subtitlesChanged) await persistSubtitles();
      setProject(await api.renderClips(projectId, [clip.id]));
    } catch (err) {
      showError(err);
    } finally {
      setSaving(null);
    }
  };

  const render = clip.render;
  const exportLabel = render ? (render.stale || unsaved ? "Gerar novamente com as alterações" : "Gerar novamente") : "Exportar MP4";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/projetos/${projectId}`} className="inline-flex min-w-0 items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100">
          <ArrowLeft className="size-4 shrink-0" aria-hidden /> <span className="truncate">{project.title}</span>
        </Link>
        {ordered.length > 1 && (
          <nav className="flex items-center gap-1 text-xs text-zinc-400" aria-label="Navegar entre cortes">
            {previous ? (
              <Link to={`/projetos/${projectId}/cortes/${previous.id}`} className="btn btn-ghost px-2 py-1" aria-label="Corte anterior">
                <ChevronLeft className="size-4" />
              </Link>
            ) : (
              <span className="btn btn-ghost px-2 py-1 opacity-30" aria-hidden>
                <ChevronLeft className="size-4" />
              </span>
            )}
            <span>
              Corte {position + 1} de {ordered.length}
            </span>
            {next ? (
              <Link to={`/projetos/${projectId}/cortes/${next.id}`} className="btn btn-ghost px-2 py-1" aria-label="Próximo corte">
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className="btn btn-ghost px-2 py-1 opacity-30" aria-hidden>
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <form onSubmit={saveTitle} className="flex flex-wrap items-center gap-2">
              <input
                className="input max-w-xl flex-1 text-lg font-semibold"
                aria-label="Título do corte"
                maxLength={200}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={saving === "title"}>
                {saving === "title" ? "Salvando…" : "Salvar"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingTitle(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight break-words sm:text-2xl">{clip.title}</h1>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Editar título do corte"
                onClick={() => {
                  setTitle(clip.title);
                  setEditingTitle(true);
                }}
              >
                <Pencil className="size-4" />
              </button>
            </div>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono tabular-nums">
              {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
            </span>
            <span>({(clip.end - clip.start).toFixed(1).replace(".", ",")} s)</span>
            <span>· {Math.round(clip.score)} pontos (heurística)</span>
            <span>
              · {settings.aspect_ratio} · {FRAMING_LABEL[requested]}
            </span>
            <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">{STATUS_LABEL[clip.status]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {clip.status !== "approved" && (
            <button type="button" className="btn btn-secondary" onClick={() => update({ status: "approved" }).catch(showError)}>
              <Check className="size-4" aria-hidden /> Aprovar
            </button>
          )}
          {clip.status !== "rejected" ? (
            <button type="button" className="btn btn-secondary" onClick={() => update({ status: "rejected" }).catch(showError)}>
              <X className="size-4" aria-hidden /> Descartar
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => update({ status: "suggested" }).catch(showError)}>
              <RotateCcw className="size-4" aria-hidden /> Restaurar
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-6 xl:sticky xl:top-6 xl:self-start">
          <section className="card p-5" aria-label="Pré-visualização">
            <ClipPreviewTabs
              project={project}
              clip={clip}
              subtitles={previewSubtitles}
              framing={previewFraming}
              framingStatus={framingStatus}
              playerRef={player}
              onTimeChange={setTime}
              maxHeight="60vh"
            />
          </section>

          <Section icon={Clapperboard} title="Exportação">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {render ? (
                  <>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${render.stale ? "bg-amber-500/15 text-amber-300" : "bg-brand-400/15 text-brand-300"}`}
                    >
                      {render.stale ? "Vídeo desatualizado" : "Vídeo pronto"}
                    </span>
                    <span className="text-zinc-500">
                      {render.width}×{render.height} · {render.duration_seconds.toFixed(1).replace(".", ",")} s · {formatBytes(render.size_bytes)}
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-500">O MP4 deste corte ainda não foi gerado.</span>
                )}
              </div>
              {unsaved && !rendering && (
                <p className="text-xs text-amber-300">Há alterações não salvas: elas serão salvas antes de gerar o vídeo.</p>
              )}
              {rendering && <JobProgress project={project} onChange={setProject} onError={(m) => setMessage({ tone: "error", text: m })} />}
              {busy && !rendering && <p className="text-xs text-zinc-400">Aguarde a tarefa em andamento no projeto terminar para gerar o vídeo.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={exportClip} disabled={busy || saving !== null}>
                  <Clapperboard className="size-4" aria-hidden /> {saving === "render" ? "Iniciando…" : exportLabel}
                </button>
                {render && (
                  <a href={api.exportUrl(projectId, render.filename)} download className={`btn ${render.stale ? "btn-secondary" : "btn-primary"}`}>
                    <Download className="size-4" aria-hidden /> {render.stale ? "Baixar versão anterior" : "Baixar MP4"}
                  </a>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                MP4 H.264 + AAC, {settings.aspect_ratio}, com as legendas incorporadas — pronto para TikTok, Reels e Shorts. O
                arquivo também aparece em <Link to="/exportados" className="text-brand-400 hover:underline">Vídeos exportados</Link>.
              </p>
            </div>
          </Section>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Section icon={Scissors} title="Início e fim">
            <RangeEditor
              key={`${clip.start}-${clip.end}-${rangeNonce}`}
              clip={clip}
              currentTime={clip.start + time}
              cancelLabel="Desfazer"
              onCancel={() => setRangeNonce((n) => n + 1)}
              onSave={async (start, end) => {
                if (subtitlesChanged && !window.confirm("As legendas não salvas serão descartadas ao mudar o trecho. Continuar?")) return;
                await update({ start, end }, "range");
                setMessage({ tone: "success", text: "Trecho atualizado. A pontuação e as legendas foram recalculadas." });
              }}
            />
          </Section>

          <Section icon={Crop} title="Enquadramento">
            {sourceSize ? (
              <FramingEditor
                aspect={settings.aspect_ratio}
                projectDefault={settings.framing}
                sourceWidth={sourceSize[0]}
                sourceHeight={sourceSize[1]}
                value={framingDraft}
                saved={savedOverride}
                faceAvailable={health?.face_detection_available ?? true}
                saving={saving === "framing"}
                onChange={setFramingDraft}
                onSave={saveFraming}
              />
            ) : (
              <p className="text-sm text-zinc-500">Carregando as dimensões do vídeo…</p>
            )}
          </Section>

          <Section
            icon={Subtitles}
            title="Legendas"
            aside={subtitles?.edited ? <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] text-zinc-300">Editadas</span> : undefined}
          >
            {subtitles ? (
              <SubtitleEditor
                saved={subtitles.editable}
                draft={subtitleDraft}
                edited={subtitles.edited}
                clipStart={clip.start}
                clipEnd={clip.end}
                currentTime={time}
                saving={saving === "subtitles"}
                srtUrl={api.clipSrtUrl(projectId, clip.id)}
                onChange={setSubtitleDraft}
                onSeek={(t) => player.current?.seek(t)}
                onSave={saveSubtitles}
                onReset={resetSubtitles}
              />
            ) : (
              <p className="text-sm text-zinc-500">Carregando as legendas…</p>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
