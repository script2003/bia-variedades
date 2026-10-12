import { AudioLines } from "lucide-react";
import { api } from "../api/client";
import type { MediaInfo, Project } from "../api/types";
import { formatBitrate, formatBytes, formatDuration } from "../lib/format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right break-words text-zinc-200">{value}</dd>
    </div>
  );
}

export function describeVideo(media: MediaInfo): string {
  const video = media.video;
  if (!video) return "Sem trilha de vídeo";
  const rotated = Math.abs(video.rotation) % 180 === 90;
  const [w, h] = rotated ? [video.height, video.width] : [video.width, video.height];
  const orientation = h > w ? "vertical" : h === w ? "quadrado" : "horizontal";
  const fps = video.fps ? ` · ${video.fps.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} fps` : "";
  return `${w}×${h} (${orientation}) · ${video.codec.toUpperCase()}${fps}`;
}

export function describeAudioStreams(media: MediaInfo): string {
  if (media.audio_streams.length === 0) return "Nenhuma";
  return media.audio_streams
    .map((a) => {
      const parts = [a.codec.toUpperCase()];
      if (a.sample_rate) parts.push(`${(a.sample_rate / 1000).toLocaleString("pt-BR")} kHz`);
      if (a.channels) parts.push(a.channels === 1 ? "mono" : a.channels === 2 ? "estéreo" : `${a.channels} canais`);
      if (a.language && a.language !== "und") parts.push(a.language);
      return parts.join(" ");
    })
    .join("; ");
}

/** Informações lidas pelo FFprobe e o áudio extraído pelo FFmpeg. */
export default function MediaDetails({ project }: { project: Project }) {
  const { media, audio } = project;
  if (!media) return null;

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-3 text-lg font-semibold">Mídia</h2>
      <dl className="divide-y divide-ink-700">
        <Row label="Duração" value={formatDuration(media.duration_seconds)} />
        <Row label="Vídeo" value={describeVideo(media)} />
        <Row label={media.audio_streams.length > 1 ? "Trilhas de áudio" : "Trilha de áudio"} value={describeAudioStreams(media)} />
        <Row label="Taxa de bits" value={formatBitrate(media.bit_rate)} />
      </dl>

      {audio && (
        <div className="mt-5 rounded-xl border border-ink-700 bg-ink-850 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AudioLines className="size-4 text-brand-400" aria-hidden />
            <h3 className="text-sm font-semibold">Áudio extraído para transcrição</h3>
          </div>
          <audio controls preload="none" src={api.audioUrl(project)} className="w-full" aria-label="Áudio extraído">
            Seu navegador não consegue reproduzir o áudio.
          </audio>
          <p className="mt-2 text-xs text-zinc-500">
            WAV PCM 16 bits · mono · {(audio.sample_rate / 1000).toLocaleString("pt-BR")} kHz ·{" "}
            {formatDuration(audio.duration_seconds)} · {formatBytes(audio.size_bytes)}
          </p>
        </div>
      )}
    </section>
  );
}
