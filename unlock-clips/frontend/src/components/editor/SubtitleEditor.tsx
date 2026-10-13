import { Clock, Download, Eye, EyeOff, RotateCcw, Save, Undo2 } from "lucide-react";
import { useState } from "react";
import type { EditableCue } from "../../api/types";
import { formatTimecode, parseTimecode } from "../../lib/format";
import Notice from "../Notice";

interface Props {
  /** Blocos salvos (como vieram do servidor). */
  saved: EditableCue[];
  draft: EditableCue[];
  /** O corte usa legendas editadas (no servidor). */
  edited: boolean;
  clipStart: number;
  clipEnd: number;
  /** Tempo atual da prévia, relativo ao início do corte. */
  currentTime: number;
  saving: boolean;
  srtUrl: string;
  onChange: (draft: EditableCue[]) => void;
  onSeek: (relative: number) => void;
  onSave: () => void;
  onReset: () => void;
}

const key = (cue: EditableCue) => [cue.start, cue.end, cue.text.trim(), cue.hidden];

export function subtitlesDirty(saved: EditableCue[], draft: EditableCue[]): boolean {
  return JSON.stringify(saved.map(key)) !== JSON.stringify(draft.map(key));
}

/** Problemas que impedem salvar (tempos fora do corte ou sobrepostos). */
export function validateDraft(draft: EditableCue[], clipStart: number, clipEnd: number): string | null {
  for (let k = 0; k < draft.length; k++) {
    const cue = draft[k]!;
    if (cue.end - cue.start < 0.1) return `A legenda ${k + 1} precisa durar pelo menos 0,1 s.`;
    if (cue.start < clipStart - 0.01 || cue.end > clipEnd + 0.01) return `A legenda ${k + 1} está fora do trecho do corte.`;
    const next = draft[k + 1];
    if (next && next.start < cue.end - 0.001) return `As legendas ${k + 1} e ${k + 2} se sobrepõem. Ajuste os tempos.`;
  }
  return null;
}

function TimeField({
  label,
  value,
  clipStart,
  onCommit,
}: {
  label: string;
  value: number;
  clipStart: number;
  onCommit: (absolute: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? formatTimecode(value - clipStart);
  const commit = () => {
    if (text === null) return;
    const parsed = parseTimecode(text);
    if (parsed !== null) onCommit(Math.round((clipStart + parsed) * 1000) / 1000);
    setText(null);
  };
  return (
    <input
      aria-label={label}
      className="input w-20 px-2 py-1 text-center font-mono text-xs"
      value={shown}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Edição das legendas de um corte: texto, visibilidade e (opcionalmente) tempos de cada bloco. */
export default function SubtitleEditor({
  saved,
  draft,
  edited,
  clipStart,
  clipEnd,
  currentTime,
  saving,
  srtUrl,
  onChange,
  onSeek,
  onSave,
  onReset,
}: Props) {
  const [showTimes, setShowTimes] = useState(false);
  const dirty = subtitlesDirty(saved, draft);
  const problem = validateDraft(draft, clipStart, clipEnd);
  const now = clipStart + currentTime;

  const update = (index: number, change: Partial<EditableCue>) =>
    onChange(draft.map((cue, k) => (k === index ? { ...cue, ...change } : cue)));

  if (draft.length === 0) {
    return <p className="text-sm text-zinc-500">Não há fala transcrita neste trecho: o vídeo será gerado sem legendas.</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          {draft.length} bloco(s) · clique no horário para ouvir o trecho. O texto segue o modelo de legenda do projeto (caixa-alta,
          cores e quebra de linhas).
        </span>
        <button
          type="button"
          className="btn btn-ghost ml-auto px-2 py-1 text-xs"
          aria-pressed={showTimes}
          onClick={() => setShowTimes(!showTimes)}
        >
          <Clock className="size-3.5" aria-hidden /> {showTimes ? "Ocultar tempos" : "Editar tempos"}
        </button>
      </div>

      <ol className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1" aria-label="Blocos de legenda">
        {draft.map((cue, index) => {
          const active = now >= cue.start && now < cue.end;
          const original = saved[index];
          const changed = original ? JSON.stringify(key(original)) !== JSON.stringify(key(cue)) : true;
          return (
            <li
              key={`${index}-${cue.start}`}
              className={`grid gap-2 rounded-xl border p-2.5 ${active ? "border-brand-400/60 bg-brand-400/5" : "border-ink-700 bg-ink-850/60"} ${
                cue.hidden ? "opacity-60" : ""
              }`}
              aria-label={`Legenda ${index + 1}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 tabular-nums hover:bg-ink-700 hover:text-zinc-100"
                  onClick={() => onSeek(cue.start - clipStart)}
                  aria-label={`Ouvir a legenda ${index + 1}`}
                >
                  {formatTimecode(cue.start - clipStart)} → {formatTimecode(cue.end - clipStart)}
                </button>
                {showTimes && (
                  <span className="flex items-center gap-1">
                    <TimeField label={`Início da legenda ${index + 1}`} value={cue.start} clipStart={clipStart} onCommit={(v) => update(index, { start: v })} />
                    <span className="text-zinc-600">→</span>
                    <TimeField label={`Fim da legenda ${index + 1}`} value={cue.end} clipStart={clipStart} onCommit={(v) => update(index, { end: v })} />
                  </span>
                )}
                {(changed || cue.edited) && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    {changed ? "alterada" : "editada"}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost ml-auto px-1.5 py-1"
                  aria-label={cue.hidden ? `Mostrar a legenda ${index + 1}` : `Ocultar a legenda ${index + 1}`}
                  aria-pressed={cue.hidden}
                  title={cue.hidden ? "Mostrar no vídeo" : "Ocultar no vídeo"}
                  onClick={() => update(index, { hidden: !cue.hidden })}
                >
                  {cue.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <textarea
                className="input min-h-0 resize-y py-1.5 text-sm"
                rows={2}
                maxLength={400}
                aria-label={`Texto da legenda ${index + 1}`}
                value={cue.text}
                onChange={(e) => update(index, { text: e.target.value })}
              />
            </li>
          );
        })}
      </ol>

      {problem && <Notice tone="error">{problem}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <a href={srtUrl} download className="btn btn-ghost px-3 py-1.5 text-xs">
          <Download className="size-3.5" aria-hidden /> Baixar .srt
        </a>
        {edited && (
          <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={onReset} disabled={saving}>
            <RotateCcw className="size-3.5" aria-hidden /> Voltar às legendas automáticas
          </button>
        )}
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => onChange(saved)} disabled={!dirty || saving}>
            <Undo2 className="size-4" aria-hidden /> Desfazer
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!dirty || saving || problem !== null}>
            <Save className="size-4" aria-hidden /> {saving ? "Salvando…" : "Salvar legendas"}
          </button>
        </span>
      </div>
    </div>
  );
}
