import { ArrowLeft, AudioLines, FolderX, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import type { ClipSettings, Project } from "../api/types";
import ClipSettingsForm from "../components/ClipSettingsForm";
import EmptyState from "../components/EmptyState";
import JobProgress from "../components/JobProgress";
import MediaDetails from "../components/MediaDetails";
import Notice from "../components/Notice";
import PipelineSteps from "../components/PipelineSteps";
import ClipsPanel from "../components/ClipsPanel";
import StatusBadge from "../components/StatusBadge";
import TranscriptPanel from "../components/TranscriptPanel";
import { usePolling } from "../hooks/usePolling";
import { CONTAINER_LABEL, formatBytes, formatDateTime } from "../lib/format";
import { canRetry, hasActiveJob, hasPlayableSource, needsAudioExtraction } from "../lib/projects";

function TitleEditor({ project, onSaved, onError }: { project: Project; onSaved: (p: Project) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.title);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{project.title}</h1>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Editar título"
          onClick={() => {
            setValue(project.title);
            setEditing(true);
          }}
        >
          <Pencil className="size-4" />
        </button>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      onError("O título não pode ficar vazio.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await api.updateProject(project.id, { title: value.trim() }));
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        className="input max-w-xl flex-1 text-lg font-semibold"
        aria-label="Título do projeto"
        maxLength={200}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Salvando…" : "Salvar"}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
        Cancelar
      </button>
    </form>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-200">{children}</dd>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  // A chave recria a página ao navegar entre projetos, reiniciando estado e atualização periódica.
  return <ProjectDetail key={projectId} projectId={projectId} />;
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [settings, setSettings] = useState<ClipSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Fim da pré-visualização de um corte: o vídeo pausa sozinho ao chegar nele.
  const previewEnd = useRef<number | null>(null);

  const { data: project, error, loading, setData, refresh } = usePolling(
    () => api.getProject(projectId),
    (current) => (current && hasActiveJob(current) ? 1000 : null),
  );

  // Inicializa o formulário quando o projeto é carregado, sem sobrescrever edições nas atualizações periódicas.
  const loadedSettings = project?.settings ?? null;
  useEffect(() => {
    if (loadedSettings) setSettings((current) => current ?? loadedSettings);
  }, [loadedSettings]);

  if (loading && !project) return <p className="text-sm text-zinc-500">Carregando…</p>;
  if (!project) {
    return (
      <EmptyState
        icon={FolderX}
        title="Projeto não encontrado"
        action={
          <Link to="/projetos" className="btn btn-primary">
            Ver meus projetos
          </Link>
        }
      >
        {error ?? "Este projeto não existe ou foi excluído."}
      </EmptyState>
    );
  }

  const showError = (text: string) => setMessage({ tone: "error", text });

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    previewEnd.current = null;
    video.currentTime = seconds;
    setCurrentTime(seconds);
    video.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };

  const preview = (start: number, end: number) => {
    const video = videoRef.current;
    if (!video) return;
    seek(start);
    previewEnd.current = end;
    void video.play()?.catch(() => undefined);
  };
  const settingsDirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(project.settings);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateProject(project.id, { settings });
      setData(updated);
      setSettings(updated.settings);
      setMessage({ tone: "success", text: "Configurações dos cortes salvas." });
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setData(await api.retryJob(project.id));
      void refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Excluir o projeto “${project.title}” e todos os arquivos dele? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      navigate("/projetos");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) navigate("/projetos");
      else showError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/projetos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="size-4" aria-hidden /> Meus projetos
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TitleEditor
            key={project.id}
            project={project}
            onSaved={(p) => {
              setData(p);
              setMessage(null);
            }}
            onError={showError}
          />
          <StatusBadge status={project.status} />
        </div>
        <div className="flex gap-2">
          {canRetry(project) && (
            <button type="button" className="btn btn-secondary" onClick={retry} disabled={busy}>
              <RotateCcw className="size-4" aria-hidden /> Tentar novamente
            </button>
          )}
          {needsAudioExtraction(project) && (
            <button type="button" className="btn btn-primary" onClick={retry} disabled={busy}>
              <AudioLines className="size-4" aria-hidden /> Extrair áudio
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            <Trash2 className="size-4" aria-hidden /> Excluir
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-3">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {project.error && project.status !== "ready" && <Notice tone="error">{project.error}</Notice>}
        {project.warnings.map((warning) => (
          <Notice key={warning} tone="warning">
            {warning}
          </Notice>
        ))}
        {project.status === "ready" && project.clips && (
          <Notice tone="success">
            Cortes sugeridos. Revise, ajuste e aprove os melhores trechos. A geração das legendas e do formato vertical chega
            na próxima etapa do desenvolvimento.
          </Notice>
        )}
        {project.status === "ready" && project.transcript && !project.clips && (
          <Notice tone="info">
            Vídeo transcrito. Clique em <strong>Sugerir cortes</strong> para encontrar os melhores trechos.
          </Notice>
        )}
        {project.status === "ready" && project.audio && !project.transcript && (
          <Notice tone="info">
            Áudio extraído e pronto para transcrição. Clique em <strong>Transcrever agora</strong> no painel de transcrição.
          </Notice>
        )}
        {needsAudioExtraction(project) && (
          <Notice tone="info">
            Este projeto foi criado antes da extração de áudio. Clique em <strong>Extrair áudio</strong> para prepará-lo.
          </Notice>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          <section className="card overflow-hidden">
            {hasPlayableSource(project) ? (
              <video
                ref={videoRef}
                key={project.source.filename}
                onTimeUpdate={(e) => {
                  const time = e.currentTarget.currentTime;
                  setCurrentTime(time);
                  if (previewEnd.current !== null && time >= previewEnd.current) {
                    e.currentTarget.pause();
                    previewEnd.current = null;
                  }
                }}
                className="aspect-video w-full bg-black"
                src={api.sourceUrl(project.id)}
                poster={api.thumbnailUrl(project) ?? undefined}
                controls
                preload="metadata"
                onError={() => setVideoError(true)}
              >
                Seu navegador não consegue reproduzir este vídeo.
              </video>
            ) : (
              <div className="grid aspect-video place-items-center bg-ink-850 text-sm text-zinc-500">
                {project.status === "importing" ? "O vídeo está sendo importado…" : "Vídeo indisponível."}
              </div>
            )}
            {videoError && (
              <p className="border-t border-ink-700 px-4 py-3 text-xs text-amber-300">
                O navegador não consegue reproduzir este vídeo
                {project.media?.video ? ` (codec ${project.media.video.codec.toUpperCase()})` : ""}. Isso não afeta o
                processamento: os cortes serão gerados em MP4 compatível.
              </p>
            )}
            {hasActiveJob(project) && (
              <div className="border-t border-ink-700 p-4">
                <JobProgress project={project} onChange={setData} onError={showError} />
              </div>
            )}
          </section>

          <ClipsPanel
            project={project}
            currentTime={currentTime}
            onPreview={preview}
            onProjectChange={(p) => {
              setData(p);
              void refresh();
            }}
            onError={showError}
          />

          <TranscriptPanel
            project={project}
            currentTime={currentTime}
            onSeek={seek}
            onProjectChange={(p) => {
              setData(p);
              void refresh();
            }}
            onError={showError}
          />

          <MediaDetails project={project} />

          <section className="card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Configurações dos cortes</h2>
              <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={!settingsDirty || savingSettings}>
                <Save className="size-4" aria-hidden />
                {savingSettings ? "Salvando…" : "Salvar configurações"}
              </button>
            </div>
            {settings && <ClipSettingsForm value={settings} onChange={setSettings} idPrefix="project" />}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">Etapas</h2>
            <PipelineSteps project={project} />
          </section>
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Arquivo de origem</h2>
            <dl className="divide-y divide-ink-700">
              <Detail label="Nome">{project.source.original_name}</Detail>
              <Detail label="Origem">{project.source.kind === "link" ? "Link autorizado" : "Envio de arquivo"}</Detail>
              {project.source.url && (
                <Detail label="Link">
                  <a href={project.source.url} target="_blank" rel="noreferrer noopener" className="text-brand-400 hover:underline">
                    {project.source.url}
                  </a>
                </Detail>
              )}
              <Detail label="Tamanho">{formatBytes(project.source.size_bytes)}</Detail>
              <Detail label="Contêiner">{project.source.container ? CONTAINER_LABEL[project.source.container] ?? project.source.container : "—"}</Detail>
              <Detail label="SHA-256">
                <span className="font-mono text-xs">{project.source.sha256 ?? "—"}</span>
              </Detail>
              <Detail label="Criado em">{formatDateTime(project.created_at)}</Detail>
              <Detail label="Atualizado">{formatDateTime(project.updated_at)}</Detail>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
