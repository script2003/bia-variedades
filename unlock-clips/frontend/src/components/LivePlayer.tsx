import { Pause, Play } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import type { ClipFraming, ClipSubtitles } from "../api/types";
import { cropRectAt, videoCropStyle } from "../lib/framing";
import { formatTimecode } from "../lib/format";
import { activeCueIndex, activeWordIndex } from "../lib/subtitles";
import Notice from "./Notice";

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

export interface LivePlayerHandle {
  /** Vai para `relative` segundos desde o início do corte. */
  seek: (relative: number) => void;
  pause: () => void;
}

interface Props {
  sourceUrl: string;
  clipStart: number;
  duration: number;
  /** Tamanho do vídeo final (ex.: 1080×1920). */
  width: number;
  height: number;
  framing: ClipFraming | null;
  subtitles: ClipSubtitles | null;
  maxHeight?: string;
  onTimeChange?: (relative: number) => void;
  ref?: Ref<LivePlayerHandle>;
}

/**
 * Reproduz o trecho do vídeo original com o mesmo recorte e a mesma legenda do vídeo final,
 * sem precisar gerar o MP4 (o corte se repete ao chegar no fim).
 */
export default function LivePlayer({
  sourceUrl,
  clipStart,
  duration,
  width,
  height,
  framing,
  subtitles,
  maxHeight = "62vh",
  onTimeChange,
  ref,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [boxWidth, setBoxWidth] = useState(270);

  const update = (relative: number) => {
    setTime(relative);
    onTimeChange?.(relative);
  };

  const seek = (relative: number) => {
    const target = Math.min(Math.max(relative, 0), Math.max(duration - 0.05, 0));
    update(target);
    if (videoRef.current) videoRef.current.currentTime = clipStart + target;
  };

  useImperativeHandle(ref, () => ({ seek, pause: () => videoRef.current?.pause() }));

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // O corte mudou (ex.: novo início): volta ao começo dele.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState > 0) video.currentTime = clipStart;
    setTime(0);
  }, [clipStart]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play()?.catch(() => setVideoError(true));
    else video.pause();
  };

  const cropStyle: CSSProperties = framing
    ? videoCropStyle(cropRectAt(framing, time), framing.source_width, framing.source_height, boxWidth)
    : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };

  return (
    <div className="grid gap-3">
      <div
        ref={boxRef}
        className="relative mx-auto w-full overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: `${width} / ${height}`, maxHeight, maxWidth: `calc(${maxHeight} * ${width / height})` }}
        data-testid="live-player"
      >
        <video
          ref={videoRef}
          src={sourceUrl}
          style={cropStyle}
          preload="auto"
          playsInline
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = clipStart + time;
          }}
          onTimeUpdate={(e) => {
            const relative = e.currentTarget.currentTime - clipStart;
            if (relative >= duration) {
              e.currentTarget.currentTime = clipStart; // repete o corte
              update(0);
            } else {
              update(Math.max(0, relative));
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
    </div>
  );
}
