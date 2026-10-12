import { Check, Circle, Loader2, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { Project } from "../api/types";

type StepState = "done" | "active" | "error" | "pending" | "unavailable";

interface Step {
  title: string;
  description: string;
  state: StepState;
}

/**
 * Etapas do fluxo de criação. As etapas ainda não implementadas são exibidas
 * como "disponível em breve" — nunca como concluídas.
 */
export function buildSteps(project: Project): Step[] {
  const { status, source, media, audio } = project;
  const importing = status === "importing";
  const problem = ["failed", "cancelled", "interrupted"].includes(status);
  const hasFile = source.filename !== null && !importing;
  const verified = source.sha256 !== null && status !== "validating";
  const extracting = status === "extracting_audio";

  const receivedState: StepState = hasFile ? "done" : importing ? "active" : problem ? "error" : "pending";
  const verifyState: StepState =
    status === "validating" ? "active" : verified ? "done" : problem && hasFile ? "error" : "pending";
  const mediaState: StepState = media ? "done" : extracting ? "active" : problem && verified ? "error" : "pending";
  const audioState: StepState = audio
    ? "done"
    : extracting && media
      ? "active"
      : problem && media
        ? "error"
        : "pending";
  const later = (title: string, description: string): Step => ({ title, description, state: "unavailable" });

  return [
    {
      title: source.kind === "link" ? "Importação do link" : "Envio do arquivo",
      description: hasFile ? "Vídeo armazenado localmente." : "Recebendo o vídeo.",
      state: receivedState,
    },
    { title: "Verificação do arquivo", description: "Formato, assinatura do contêiner e integridade (SHA-256).", state: verifyState },
    { title: "Leitura da mídia", description: "Duração, trilhas e codecs com FFprobe.", state: mediaState },
    { title: "Extração de áudio", description: "WAV mono 16 kHz com FFmpeg, pronto para transcrição.", state: audioState },
    later("Transcrição com timestamps", "faster-whisper local — Etapa 3."),
    later("Identificação de cortes", "Pontuação heurística explicável — Etapa 4."),
    later("Legendas e formato vertical", "Legendas sincronizadas e 9:16 — Etapa 5."),
    later("Edição e exportação MP4", "Editor de cortes — Etapa 6."),
  ];
}

const ICON: Record<StepState, ReactElement> = {
  done: <Check className="size-3.5" aria-hidden />,
  active: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
  error: <XCircle className="size-3.5" aria-hidden />,
  pending: <Circle className="size-3" aria-hidden />,
  unavailable: <Circle className="size-3" aria-hidden />,
};

const STYLE: Record<StepState, string> = {
  done: "bg-brand-400 text-ink-950",
  active: "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/50",
  error: "bg-red-500/20 text-red-300",
  pending: "bg-ink-700 text-zinc-500",
  unavailable: "bg-ink-800 text-zinc-600",
};

const STATE_LABEL: Record<StepState, string> = {
  done: "concluída",
  active: "em andamento",
  error: "não concluída",
  pending: "aguardando",
  unavailable: "disponível em breve",
};

export default function PipelineSteps({ project }: { project: Project }) {
  return (
    <ol className="grid gap-3">
      {buildSteps(project).map((step) => (
        <li key={step.title} className="flex gap-3" aria-label={`${step.title}: ${STATE_LABEL[step.state]}`}>
          <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${STYLE[step.state]}`}>{ICON[step.state]}</span>
          <div className="min-w-0">
            <p className={`text-sm font-medium ${step.state === "unavailable" ? "text-zinc-500" : "text-zinc-100"}`}>
              {step.title}
              {step.state === "unavailable" && (
                <span className="ml-2 inline-block rounded bg-ink-800 px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide whitespace-nowrap text-zinc-500 uppercase">
                  em breve
                </span>
              )}
            </p>
            <p className="text-xs text-zinc-500">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
