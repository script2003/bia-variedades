import { FileVideo, Link2, Sparkles, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AppSettings, ClipSettings } from "../api/types";
import { UploadCancelled, uploadVideo, type UploadProgress } from "../api/upload";
import { ACCEPT_ATTRIBUTE, ALLOWED_VIDEO_EXTENSIONS, validateLink, validateVideoFile } from "../lib/files";
import { formatBytes, formatPercent } from "../lib/format";
import ClipSettingsForm from "./ClipSettingsForm";
import Notice from "./Notice";
import ProgressBar from "./ProgressBar";

type Mode = "file" | "link";

interface Props {
  /** Exibe as configurações de corte do novo projeto (página "Criar cortes"). */
  showSettings?: boolean;
}

export default function NewProjectPanel({ showSettings = false }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [clipSettings, setClipSettings] = useState<ClipSettings | null>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getSettings()
      .then((settings) => {
        if (!active) return;
        setAppSettings(settings);
        setClipSettings(settings.clip_defaults);
      })
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  const pickFile = (candidate: File | undefined | null) => {
    if (!candidate) return;
    const problem = validateVideoFile(candidate, appSettings?.max_upload_size_mb ?? null);
    setError(problem);
    setFile(problem ? null : candidate);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) pickFile(event.dataTransfer.files?.[0]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const settings = showSettings && clipSettings ? clipSettings : undefined;

    if (mode === "file") {
      if (!file) {
        setError("Selecione um arquivo de vídeo para analisar.");
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setProgress({ loaded: 0, total: file.size, fraction: 0 });
      try {
        const project = await uploadVideo({ file, title, settings, onProgress: setProgress, signal: controller.signal });
        navigate(`/projetos/${project.id}`);
      } catch (err) {
        if (!(err instanceof UploadCancelled)) setError(err instanceof Error ? err.message : String(err));
      } finally {
        abortRef.current = null;
        setBusy(false);
        setProgress(null);
      }
      return;
    }

    const linkProblem = validateLink(url);
    if (linkProblem) {
      setError(linkProblem);
      return;
    }
    if (!rightsConfirmed) {
      setError("Confirme que você tem autorização para usar este conteúdo.");
      return;
    }
    setBusy(true);
    try {
      const project = await api.importFromLink({ url: url.trim(), title: title.trim() || undefined, rights_confirmed: true, settings });
      navigate(`/projetos/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tabClass = (tab: Mode) =>
    [
      "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
      mode === tab ? "bg-ink-700 text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
    ].join(" ");

  const domains = appSettings?.allowed_link_domains ?? [];

  return (
    <form onSubmit={submit} className="card grid gap-5 p-5 sm:p-6" aria-label="Novo projeto">
      <div role="tablist" aria-label="Origem do vídeo" className="flex gap-1 rounded-xl bg-ink-850 p-1">
        <button type="button" role="tab" aria-selected={mode === "file"} className={tabClass("file")} onClick={() => !busy && setMode("file")}>
          <UploadCloud className="size-4" aria-hidden /> Enviar arquivo
        </button>
        <button type="button" role="tab" aria-selected={mode === "link"} className={tabClass("link")} onClick={() => !busy && setMode("link")}>
          <Link2 className="size-4" aria-hidden /> Usar link
        </button>
      </div>

      {mode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
            dragging ? "border-brand-400 bg-brand-400/5" : "border-ink-600 bg-ink-850/60",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            aria-label="Arquivo de vídeo"
            data-testid="file-input"
            disabled={busy}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="flex w-full max-w-md items-center gap-3 rounded-xl bg-ink-800 px-4 py-3 text-left">
              <FileVideo className="size-6 shrink-0 text-brand-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{file.name}</p>
                <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
              </div>
              {!busy && (
                <button type="button" className="btn btn-ghost" aria-label="Remover arquivo" onClick={() => setFile(null)}>
                  <X className="size-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              <UploadCloud className="mb-3 size-10 text-zinc-500" aria-hidden />
              <p className="font-semibold">Arraste o vídeo para cá</p>
              <p className="mt-1 text-sm text-zinc-500">
                {ALLOWED_VIDEO_EXTENSIONS.join(", ")}
                {appSettings && ` · até ${formatBytes(appSettings.max_upload_size_mb * 1024 * 1024)}`}
              </p>
              <button type="button" className="btn btn-secondary mt-4" onClick={() => inputRef.current?.click()} disabled={busy}>
                Escolher arquivo
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <div>
            <label className="label" htmlFor="link-url">Link direto do vídeo</label>
            <input
              id="link-url"
              type="url"
              inputMode="url"
              className="input"
              placeholder="https://arquivos.seudominio.com.br/podcast-ep12.mp4"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              {domains.length > 0
                ? `Domínios autorizados: ${domains.join(", ")}.`
                : "Nenhum domínio autorizado ainda. Cadastre as fontes que você tem direito de usar em Configurações."}{" "}
              Aceita links diretos para arquivos de vídeo; páginas web, streaming e conteúdo com DRM não são suportados.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-brand-400"
              checked={rightsConfirmed}
              disabled={busy}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
            />
            Confirmo que tenho autorização para baixar, editar e publicar este conteúdo.
          </label>
        </div>
      )}

      <div>
        <label className="label" htmlFor="project-title">Título do projeto (opcional)</label>
        <input
          id="project-title"
          className="input"
          maxLength={200}
          placeholder="Ex.: Podcast Inovação — episódio 12"
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {showSettings && clipSettings && (
        <fieldset className="grid gap-4 border-t border-ink-700 pt-5">
          <legend className="mb-4 text-sm font-semibold text-zinc-200">Configurações dos cortes</legend>
          <ClipSettingsForm value={clipSettings} onChange={setClipSettings} disabled={busy} idPrefix="new" />
        </fieldset>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {progress && (
        <div className="grid gap-2">
          <div className="flex justify-between text-sm text-zinc-400">
            <span>
              Enviando {formatBytes(progress.loaded)} de {formatBytes(progress.total)}
            </span>
            <span className="font-mono tabular-nums">{formatPercent(progress.fraction)}</span>
          </div>
          <ProgressBar value={progress.fraction} label="Progresso do envio" />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {progress && (
          <button type="button" className="btn btn-secondary" onClick={() => abortRef.current?.abort()}>
            Cancelar envio
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !appSettings}>
          <Sparkles className="size-4" aria-hidden />
          {busy ? (mode === "file" ? "Enviando…" : "Iniciando importação…") : "Analisar vídeo"}
        </button>
      </div>
    </form>
  );
}
