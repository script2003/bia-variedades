import { Download, Image as ImageIcon, Pause, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { Clip, ClipFraming, ClipSubtitles, Project, SubtitleCue } from "../api/types";
import { formatBytes, formatTimecode } from "../lib/format";
import Notice from "./Notice";

type Tab = "live" | "frame" | "rendered";

interface Props {
  project: Project;
  clip: Clip;
  initialTab?: Tab;
  onClose: () => void;
}

/** Índice do bloco de legenda visível no instante `t` (segundos desde o início do corte). */
export function activeCueIndex(cues: SubtitleCue[], t: number): number {
  return cues.findIndex((cue) => t >= cue.start && t < cue.end);
}

/** Índice (na ordem do bloco) da palavra sendo falada; antes da 1ª palavra, destaca a 1ª. */
export function activeWordIndex(cue: SubtitleCue, t: number): number {
  const words = cue.lines.flat();
  let index = 0;
  words.forEach((word, k) => {
    if (t >= word.start) index = k;
  });
  return index;
}

/** Posição horizontal do recorte no instante `t` (interpolação linear entre os pontos-chave). */
export function cropXAt(framing: ClipFraming, t: number): number {
  const keys = framing.keyframes;
  if (keys.length === 0) return framing.x;
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, x1] = keys[k]!;
    if (t <= t1) {
      const [t0, x0] = keys[k - 1]!;
      return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return keys[keys.length - 1]![1];
}

/** `object-position` que reproduz no navegador o mesmo recorte do FFmpeg (com `object-fit: cover`). */
export function objectPosition(framing: ClipFraming | null, t: number): string {
  if (!framing) return "50% 50%";
  const freeX = framing.source_width - framing.crop_width;
  const freeY = framing.source_height - framing.crop_height;
  const px = freeX > 0 ? (cropXAt(framing, t) / freeX) * 100 : 50;
  const py = freeY > 0 ? (framing.y / freeY) * 100 : 50;
  return `${px.toFixed(2)}% ${py.toFixed(2)}%`;
}

function outlineShadow(width: number, color: string): string {
  if (width <= 0) return "";
  const steps = 12;
  return Array.from({ length: steps }, (_, k) => {
    const angle = (2 * Math.PI * k) / steps;
    return `${(Math.cos(angle) * width).toFixed(2)}px ${(Math.sin(angle) * width).toFixed(2)}px 0 ${color}`;
  }).join(", ");
}

function hexToRgba(hex: string, opacity: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Desenha a legenda em HTML com as mesmas medidas do arquivo ASS (escala = largura exibida / largura real). */
export function SubtitleOverlay({ subtitles, time, scale }: { subtitles: ClipSubtitles; time: number; scale: number }) {
  const index = activeCueIndex(subtitles.cues, time);
  if (index < 0) return null;
  const cue = subtitles.cues[index]!;
  const { template } = subtitles;
  const unit = (Math.min(subtitles.width, subtitles.height) / 1080) * scale;
  const outline = template.outline * unit;
  const shadows = [outlineShadow(template.box ? 0 : outline, template.outline_color)];
  if (template.shadow > 0) shadows.push(`${template.shadow * unit * 1.5}px ${template.shadow * unit * 1.5}px ${template.shadow * unit}px rgba(0,0,0,0.6)`);
  const container: CSSProperties = {
    position: "absolute",
    left: subtitles.margin_h * scale,
    right: subtitles.margin_h * scale,
    textAlign: "center",
    pointerEvents: "none",
    ...(subtitles.alignment === 2
      ? { bottom: subtitles.margin_v * scale }
      : subtitles.alignment === 8
        ? { top: subtitles.margin_v * scale }
        : { top: "50%", transform: "translateY(-50%)" }),
  };
  const text: CSSProperties = {
    fontFamily: `${template.font}, "Liberation Sans", Helvetica, sans-serif`,
    fontSize: subtitles.font_size * scale,
    fontWeight: template.bold ? 700 : 400,
    lineHeight: 1.18,
    color: template.primary,
    textShadow: shadows.filter(Boolean).join(", ") || undefined,
    ...(template.box
      ? {
          background: hexToRgba(template.box_color, template.box_opacity),
          padding: `0 ${outline}px`,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }
      : {}),
  };
  const current = subtitles.highlight ? activeWordIndex(cue, time) : -1;
  let position = 0;
  return (
    <div style={container} data-testid="subtitle-overlay">
      {cue.lines.map((line, lineIndex) => (
        <div key={lineIndex}>
          <span style={text}>
            {line.map((word, k) => {
              const isCurrent = position++ === current;
              return (
                <span key={k}>
                  {k > 0 && " "}
                  <span
                    data-current={isCurrent || undefined}
                    style={
                      isCurrent
                        ? {
                            color: template.highlight,
                            display: "inline-block",
                            transform: `scale(${template.highlight_scale / 100})`,
                            // compensa o aumento para não "engolir" os espaços vizinhos
                            marginInline: `${((template.highlight_scale - 100) / 100) * 1.5}em`,
                          }
                        : undefined
                    }
                  >
                    {word.text}
                  </span>
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ClipPreview({ project, clip, initialTab = "live", onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [subtitles, setSubtitles] = useState<ClipSubtitles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [boxWidth, setBoxWidth] = useState(270);
  const [frameTime, setFrameTime] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [frameError, setFrameError] = useState(false);
  const [framing, setFraming] = useState<ClipFraming | null>(null);
  const [framingLoading, setFramingLoading] = useState(false);
  const [renderedError, setRenderedError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const duration = clip.end - clip.start;
  const settings = project.settings;

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

  // O enquadramento por rosto é calculado no servidor (o mesmo usado ao gerar o vídeo).
  useEffect(() => {
    if (settings.framing !== "rosto") return;
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
  }, [project.id, clip.id, settings.framing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [tab, subtitles]);

  const width = subtitles?.width ?? (settings.aspect_ratio === "16:9" ? 1920 : 1080);
  const height = subtitles?.height ?? (settings.aspect_ratio === "9:16" ? 1920 : 1080);
  const frameUrl = useMemo(() => api.clipFrameUrl(project.id, clip.id, frameTime), [project.id, clip.id, frameTime]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play()?.catch(() => setVideoError(true));
    else video.pause();
  };

  const seek = (relative: number) => {
    const video = videoRef.current;
    setTime(relative);
    if (video) video.currentTime = clip.start + relative;
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "live", label: "Prévia ao vivo" },
    { key: "frame", label: "Quadro final (exato)" },
    ...(clip.render ? [{ key: "rendered" as Tab, label: "Vídeo gerado" }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Prévia: ${clip.title}`}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{clip.title}</h2>
            <p className="text-xs text-zinc-500">
              Formato {settings.aspect_ratio} · {width}×{height} · legenda “{subtitles?.template.label ?? settings.subtitle_style}” ·{" "}
              {settings.framing === "rosto" ? "acompanhando o rosto" : "enquadramento central"}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Fechar prévia" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>

        <div role="tablist" aria-label="Tipo de prévia" className="mb-4 flex flex-wrap gap-1">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                videoRef.current?.pause();
                if (key === "frame") {
                  setFrameTime(Math.round(time * 10) / 10);
                  setFrameLoading(true);
                  setFrameError(false);
                }
                setTab(key);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === key ? "bg-ink-700 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {tab === "live" && (
          <div className="grid gap-3">
            <div
              ref={boxRef}
              className="relative mx-auto w-full overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: `${width} / ${height}`, maxHeight: "62vh", maxWidth: `calc(62vh * ${width / height})` }}
            >
              <video
                ref={videoRef}
                src={api.sourceUrl(project.id)}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: objectPosition(framing, time) }}
                preload="auto"
                playsInline
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = clip.start;
                }}
                onTimeUpdate={(e) => {
                  const relative = e.currentTarget.currentTime - clip.start;
                  if (relative >= duration) {
                    e.currentTarget.currentTime = clip.start; // repete o corte
                    setTime(0);
                  } else {
                    setTime(Math.max(0, relative));
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setVideoError(true)}
              />
              {subtitles && <SubtitleOverlay subtitles={subtitles} time={time} scale={boxWidth / width} />}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-secondary px-3" onClick={toggle} aria-label={playing ? "Pausar" : "Reproduzir"}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={time}
                aria-label="Posição no corte"
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 accent-brand-400"
              />
              <span className="font-mono text-xs text-zinc-400 tabular-nums">
                {formatTimecode(time)} / {formatTimecode(duration)}
              </span>
            </div>
            {videoError && (
              <Notice tone="warning">
                O navegador não consegue reproduzir o vídeo original. Use a aba “Quadro final” para ver o resultado.
              </Notice>
            )}
            {settings.framing === "rosto" && (
              <p className="text-xs text-zinc-400" role="status">
                {framingLoading
                  ? "Calculando o acompanhamento do rosto…"
                  : framing?.mode === "rosto"
                    ? "Acompanhamento do rosto aplicado à prévia."
                    : (framing?.notes[0] ?? "Enquadramento central.")}
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
            <div className="relative mx-auto overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${width} / ${height}`, height: "62vh", maxWidth: "100%" }}>
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
                onChange={(e) => {
                  setFrameTime(Number(e.target.value));
                  setFrameLoading(true);
                  setFrameError(false);
                }}
                className="min-w-40 flex-1 accent-brand-400"
              />
              <button
                type="button"
                className="btn btn-secondary px-3 py-1.5 text-xs"
                onClick={() => {
                  setFrameTime((t) => t + 0.001);
                  setFrameLoading(true);
                  setFrameError(false);
                }}
              >
                <RefreshCw className="size-3.5" aria-hidden /> Atualizar
              </button>
            </div>
          </div>
        )}

        {tab === "rendered" && clip.render && (
          <div className="grid gap-3">
            <video
              src={api.exportUrl(project.id, clip.render.filename)}
              onError={() => setRenderedError(true)}
              controls
              className="mx-auto rounded-xl bg-black"
              style={{ aspectRatio: `${clip.render.width} / ${clip.render.height}`, maxHeight: "62vh", maxWidth: "100%" }}
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
    </div>
  );
}
