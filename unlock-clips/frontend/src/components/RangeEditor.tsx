import { useState, type FormEvent } from "react";
import type { Clip } from "../api/types";
import { formatTimecode, parseTimecode } from "../lib/format";
import Notice from "./Notice";

/** Formulário de início e fim de um corte (com ajuste fino de ±0,5 s e "usar tempo atual"). */
export default function RangeEditor({
  clip,
  currentTime,
  onSave,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  clip: Clip;
  currentTime: number;
  onSave: (start: number, end: number) => Promise<void>;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [startText, setStartText] = useState(formatTimecode(clip.start));
  const [endText, setEndText] = useState(formatTimecode(clip.end));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nudge = (which: "start" | "end", delta: number) => {
    const [text, set] = which === "start" ? [startText, setStartText] : [endText, setEndText];
    const value = parseTimecode(text);
    if (value !== null) set(formatTimecode(Math.max(0, value + delta)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const start = parseTimecode(startText);
    const end = parseTimecode(endText);
    if (start === null || end === null) {
      setError("Use o formato minutos:segundos, por exemplo 1:23.5.");
      return;
    }
    if (end - start < 1) {
      setError("O fim precisa ser pelo menos 1 segundo depois do início.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(start, end);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (which: "start" | "end", label: string, value: string, set: (v: string) => void) => (
    <div>
      <label className="label" htmlFor={`${clip.id}-${which}`}>
        {label}
      </label>
      <div className="flex gap-1">
        <button type="button" className="btn btn-secondary px-2" aria-label={`${label}: −0,5 s`} onClick={() => nudge(which, -0.5)}>
          −
        </button>
        <input
          id={`${clip.id}-${which}`}
          className="input w-28 text-center font-mono"
          value={value}
          onChange={(e) => set(e.target.value)}
        />
        <button type="button" className="btn btn-secondary px-2" aria-label={`${label}: +0,5 s`} onClick={() => nudge(which, 0.5)}>
          +
        </button>
      </div>
      <button type="button" className="mt-1 text-xs text-brand-400 hover:text-brand-300" onClick={() => set(formatTimecode(currentTime))}>
        Usar tempo atual do vídeo ({formatTimecode(currentTime)})
      </button>
    </div>
  );

  const start = parseTimecode(startText);
  const end = parseTimecode(endText);

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3" aria-label="Ajustar início e fim">
      <div className="flex flex-wrap gap-4">
        {field("start", "Início", startText, setStartText)}
        {field("end", "Fim", endText, setEndText)}
        <div className="self-center text-sm text-zinc-400">
          Duração: {start !== null && end !== null && end > start ? `${(end - start).toFixed(1).replace(".", ",")} s` : "—"}
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Os limites são ajustados para não cortar palavras, e a pontuação é recalculada para o novo trecho.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Recalculando…" : "Salvar e recalcular"}
        </button>
      </div>
    </form>
  );
}
