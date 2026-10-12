import { CheckCircle2, CloudDownload } from "lucide-react";
import type { TranscriptionSettings, WhisperComputeType, WhisperModelOption } from "../api/types";
import { formatBytes } from "../lib/format";

interface Props {
  value: TranscriptionSettings;
  models: WhisperModelOption[];
  onChange: (value: TranscriptionSettings) => void;
}

const COMPUTE_LABELS: Record<WhisperComputeType, string> = {
  auto: "Automático (int8 na CPU, float16 na GPU)",
  int8: "int8 — mais leve",
  int8_float16: "int8_float16 — GPU com pouca memória",
  float16: "float16 — GPU",
  float32: "float32 — máxima precisão numérica, mais lento",
};

export default function TranscriptionSettingsForm({ value, models, onChange }: Props) {
  const set = <K extends keyof TranscriptionSettings>(key: K, next: TranscriptionSettings[K]) => onChange({ ...value, [key]: next });
  const usingCustomDir = Boolean(value.model_dir);

  return (
    <div className="grid gap-6">
      <div>
        <span className="label">Modelo</span>
        <div role="radiogroup" aria-label="Modelo de transcrição" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => {
            const checked = value.model === model.name;
            return (
              <button
                key={model.name}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={usingCustomDir}
                onClick={() => set("model", model.name)}
                className={[
                  "rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40",
                  checked ? "border-brand-400 bg-brand-400/10" : "border-ink-600 bg-ink-850 hover:border-ink-500",
                ].join(" ")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${checked ? "text-brand-200" : "text-zinc-100"}`}>{model.label}</span>
                  {model.installed ? (
                    <span className="flex items-center gap-1 text-[11px] text-brand-300">
                      <CheckCircle2 className="size-3.5" aria-hidden /> baixado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <CloudDownload className="size-3.5" aria-hidden /> {formatBytes(model.size_mb * 1024 * 1024)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">{model.description}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          O modelo é baixado uma única vez, na primeira transcrição, e depois funciona sem internet.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="whisper-dir">Pasta de um modelo próprio (opcional)</label>
        <input
          id="whisper-dir"
          className="input font-mono"
          placeholder="C:\\Modelos\\faster-whisper-small"
          value={value.model_dir ?? ""}
          onChange={(e) => set("model_dir", e.target.value || null)}
        />
        <p className="mt-1.5 text-xs text-zinc-500">
          Use para trabalhar totalmente offline: informe uma pasta com <code className="font-mono">model.bin</code>,{" "}
          <code className="font-mono">config.json</code> e <code className="font-mono">tokenizer.json</code> de um modelo
          faster-whisper. Quando preenchido, substitui o modelo da lista.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="whisper-device">Processador</label>
          <select id="whisper-device" className="input" value={value.device} onChange={(e) => set("device", e.target.value as TranscriptionSettings["device"])}>
            <option value="cpu">CPU (funciona em qualquer computador)</option>
            <option value="cuda">GPU NVIDIA (CUDA)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="whisper-compute">Precisão numérica</label>
          <select
            id="whisper-compute"
            className="input"
            value={value.compute_type}
            onChange={(e) => set("compute_type", e.target.value as WhisperComputeType)}
          >
            {(Object.keys(COMPUTE_LABELS) as WhisperComputeType[]).map((key) => (
              <option key={key} value={key}>
                {COMPUTE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="whisper-beam">Beam size: {value.beam_size}</label>
          <input
            id="whisper-beam"
            type="range"
            min={1}
            max={10}
            value={value.beam_size}
            onChange={(e) => set("beam_size", Number(e.target.value))}
            className="w-full accent-brand-400"
          />
          <p className="mt-1 text-xs text-zinc-500">Maior = mais preciso e mais lento. Padrão: 5.</p>
        </div>
      </div>

      <div className="grid gap-3">
        {(
          [
            ["auto_transcribe", "Transcrever automaticamente após extrair o áudio"],
            ["vad_filter", "Ignorar trechos sem fala (filtro de voz/VAD) — mais rápido e evita textos inventados no silêncio"],
            ["allow_download", "Permitir baixar modelos da internet (Hugging Face) quando não estiverem instalados"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-300">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-400" checked={value[key]} onChange={(e) => set(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>

      {value.device === "cuda" && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/90">
          Para usar a GPU no Windows é preciso ter uma placa NVIDIA com drivers atualizados e as bibliotecas cuBLAS e cuDNN
          (CUDA 12) instaladas. Se a transcrição falhar ao carregar o modelo, volte para CPU.
        </p>
      )}
    </div>
  );
}
