import { Download, Image as ImageIcon, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { api } from "../api/client";
import type { Clip, ClipFraming, ClipFramingMode, ClipSubtitles, Project } from "../api/types";
import { OUTPUT_SIZES } from "../lib/framing";
import { formatBytes, formatTimecode } from "../lib/format";
import LivePlayer, { type LivePlayerHandle } from "./LivePlayer";
import Notice from "./Notice";

export type PreviewTab = "live" | "frame" | "rendered";

export const FRAMING_LABEL: Record<ClipFramingMode, string> = {
  centro: "enquadramento central",
  rosto: "acompanhando o rosto",
  manual: "posição fixa",
};

interface TabsProps {
  project: Project;
  clip: Clip;
  subtitles: ClipSubtitles | null;
  framing: ClipFraming | null;
  /** Mensagem sobre o enquadramento (ex.: "Calculando o acompanhamento do rosto…"). */
  framingStatus?: string | null;
  initialTab?: PreviewTab;
  playerRef?: Ref<LivePlayerHandle>;
  onTimeChange?: (relative: number) => void;
  maxHeight?: string;
}

/** Abas de prévia de um corte: ao vivo no navegador, quadro exato do FFmpeg e vídeo gerado. */
export function ClipPreviewTabs({
  project,
  clip,
  subtitles,
  framing,
  framingStatus,
  initialTab = "live",
  playerRef,
  onTimeChange,
  maxHeight = "62vh",
}: TabsProps) {
  const [tab, setTab] = useState<PreviewTab>(initialTab);
  const [time, setTime] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [frameNonce, setFrameNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [frameError, setFrameError] = useState(false);
  const [renderedError, setRenderedError] = useState(false);
  const localPlayer = useRef<LivePlayerHandle>(null);
  const duration = clip.end - clip.start;
  const [defaultW, defaultH] = OUTPUT_SIZES[project.settings.aspect_ratio];
  const width = subtitles?.width ?? defaultW;
  const height = subtitles?.height ?? defaultH;
  const version = `${clip.updated_at}-${frameNonce}`;
  const frameUrl = useMemo(
    () => api.clipFrameUrl(project.id, clip.id, frameTime, version),
    [project.id, clip.id, frameTime, version],
  );

  useEffect(() => {
    setFrameLoading(true);
    setFrameError(false);
  }, [frameUrl]);

  const tabs: { key: PreviewTab; label: string }[] = [
    { key: "live", label: "Prévia ao vivo" },
    { key: "frame", label: "Quadro final (exato)" },
    ...(clip.render ? [{ key: "rendered" as PreviewTab, label: "Vídeo gerado" }] : []),
  ];

  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Tipo de prévia" className="flex flex-wrap gap-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              localPlayer.current?.pause();
              if (key === "frame") setFrameTime(Math.round(time * 10) / 10);
              setTab(key);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === key ? "bg-ink-700 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "live" && (
        <div className="grid gap-3">
          <LivePlayer
            ref={(handle) => {
              localPlayer.current = handle;
              if (typeof playerRef === "function") playerRef(handle);
              else if (playerRef) (playerRef as { current: LivePlayerHandle | null }).current = handle;
            }}
            sourceUrl={api.sourceUrl(project.id)}
            clipStart={clip.start}
            duration={duration}
            width={width}
            height={height}
            framing={framing}
            subtitles={subtitles}
            maxHeight={maxHeight}
            onTimeChange={(t) => {
              setTime(t);
              onTimeChange?.(t);
            }}
          />
          {framingStatus && (
            <p className="text-xs text-zinc-400" role="status">
              {framingStatus}
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Prévia no navegador com o mesmo recorte e a mesma legenda do vídeo final; pequenas diferenças de fonte podem
            ocorrer. A aba “Quadro final” mostra exatamente a imagem gerada pelo FFmpeg.
          </p>
        </div>
      )}

      {tab === "frame" && (
        <div className="grid gap-3">
          <div className="relative mx-auto overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${width} / ${height}`, height: maxHeight, maxWidth: "100%" }}>
            {!frameError && (
              <img
                key={frameUrl}
                src={frameUrl}
                alt={`Quadro final em ${formatTimecode(frameTime)}`}
                className="h-full w-full object-contain"
                onLoad={() => setFrameLoading(false)}
                onError={() => {
                  setFrameLoading(false);
                  setFrameError(true);
                }}
              />
            )}
            {frameLoading && !frameError && (
              <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">
                <span className="flex items-center gap-2">
                  <ImageIcon className="size-4 animate-pulse" aria-hidden /> Gerando o quadro com o FFmpeg…
                </span>
              </div>
            )}
          </div>
          {frameError && <Notice tone="error">Não foi possível gerar o quadro. Verifique o FFmpeg em Configurações.</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-400">Quadro em {formatTimecode(frameTime)} do corte</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, duration - 0.1)}
              step={0.5}
              value={frameTime}
              aria-label="Momento do quadro"
              onChange={(e) => setFrameTime(Number(e.target.value))}
              className="min-w-40 flex-1 accent-brand-400"
            />
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setFrameNonce((n) => n + 1)}>
              <RefreshCw className="size-3.5" aria-hidden /> Atualizar
            </button>
          </div>
        </div>
      )}

      {tab === "rendered" && clip.render && (
        <div className="grid gap-3">
          <video
            key={`${clip.render.filename}-${clip.render.created_at}`}
            src={api.exportPlayUrl(project.id, clip.render.filename)}
            onError={() => setRenderedError(true)}
            controls
            className="mx-auto rounded-xl bg-black"
            style={{ aspectRatio: `${clip.render.width} / ${clip.render.height}`, maxHeight, maxWidth: "100%" }}
          />
          {renderedError && (
            <Notice tone="warning">
              Este navegador não conseguiu reproduzir o MP4 (H.264). Baixe o arquivo para assistir — ele funciona no
              celular, no Windows e nas redes sociais.
            </Notice>
          )}
          {clip.render.stale && (
            <Notice tone="warning">
              Este vídeo foi gerado antes das últimas alterações no corte ou nas configurações. Gere novamente para
              atualizar.
            </Notice>
          )}
          {clip.render.notes.map((note) => (
            <Notice key={note} tone="info">
              {note}
            </Notice>
          ))}
          <a href={api.exportUrl(project.id, clip.render.filename)} download className="btn btn-primary justify-self-start">
            <Download className="size-4" aria-hidden /> Baixar MP4 ({formatBytes(clip.render.size_bytes)})
          </a>
        </div>
      )}
    </div>
  );
}

/** Texto de situação do enquadramento para mostrar abaixo da prévia. */
export function framingStatusText(requested: ClipFramingMode, framing: ClipFraming | null, loading: boolean): string | null {
  if (loading) return requested === "rosto" ? "Calculando o acompanhamento do rosto…" : "Calculando o enquadramento…";
  if (!framing) return null;
  if (framing.notes.length > 0) return framing.notes[0]!;
  if (requested === "rosto") return framing.mode === "rosto" ? "Acompanhamento do rosto aplicado à prévia." : "Enquadramento central.";
  return null;
}

interface Props {
  project: Project;
  clip: Clip;
  initialTab?: PreviewTab;
  onClose: () => void;
}

/** Janela de prévia rápida (painel de cortes). O editor completo usa as mesmas abas. */
export default function ClipPreview({ project, clip, initialTab = "live", onClose }: Props) {
  const [subtitles, setSubtitles] = useState<ClipSubtitles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [framing, setFraming] = useState<ClipFraming | null>(null);
  const [framingLoading, setFramingLoading] = useState(true);
  const settings = project.settings;
  const requested = clip.framing_override?.mode ?? settings.framing;

  useEffect(() => {
    let active = true;
    api
      .clipSubtitles(project.id, clip.id)
      .then((data) => active && setSubtitles(data))
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [project.id, clip.id]);

  // O recorte é calculado no servidor (o mesmo usado ao gerar o vídeo).
  useEffect(() => {
    let active = true;
    setFramingLoading(true);
    api
      .clipFraming(project.id, clip.id)
      .then((data) => active && setFraming(data))
      .catch(() => active && setFraming(null))
      .finally(() => active && setFramingLoading(false));
    return () => {
      active = false;
    };
  }, [project.id, clip.id, requested, settings.aspect_ratio]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [width, height] = OUTPUT_SIZES[settings.aspect_ratio];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Prévia: ${clip.title}`}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{clip.title}</h2>
            <p className="text-xs text-zinc-500">
              Formato {settings.aspect_ratio} · {width}×{height} · legenda “{subtitles?.template.label ?? settings.subtitle_style}” ·{" "}
              {FRAMING_LABEL[requested]}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Fechar prévia" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        {error && (
          <div className="mb-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <ClipPreviewTabs
          project={project}
          clip={clip}
          subtitles={subtitles}
          framing={framing}
          framingStatus={framingStatusText(requested, framing, framingLoading)}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
