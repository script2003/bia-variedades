import type { ClipSettings } from "../api/types";
import {
  ASPECT_OPTIONS,
  DURATION_OPTIONS,
  FRAMING_OPTIONS,
  LANGUAGE_OPTIONS,
  SUBTITLE_POSITION_OPTIONS,
  SUBTITLE_STYLE_OPTIONS,
  type Option,
} from "../lib/options";

interface Props {
  value: ClipSettings;
  onChange: (value: ClipSettings) => void;
  disabled?: boolean;
  idPrefix?: string;
}

function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={[
              "rounded-lg border px-2 py-2 text-left text-sm transition disabled:opacity-50",
              checked
                ? "border-brand-400 bg-brand-400/10 text-brand-200"
                : "border-ink-600 bg-ink-850 text-zinc-300 hover:border-ink-500",
            ].join(" ")}
          >
            <span className="block font-semibold">{option.label}</span>
            {option.hint && <span className="mt-0.5 block truncate text-xs text-zinc-500">{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function ClipSettingsForm({ value, onChange, disabled, idPrefix = "clip" }: Props) {
  const set = <K extends keyof ClipSettings>(key: K, next: ClipSettings[K]) => onChange({ ...value, [key]: next });
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <span className="label">Duração dos cortes</span>
          <Segmented name="Duração dos cortes" options={DURATION_OPTIONS} value={value.duration} onChange={(v) => set("duration", v)} disabled={disabled} />
        </div>
        <div>
          <span className="label">Formato</span>
          <Segmented name="Formato" options={ASPECT_OPTIONS} value={value.aspect_ratio} onChange={(v) => set("aspect_ratio", v)} disabled={disabled} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <label className="label" htmlFor={id("language")}>Idioma das legendas</label>
          <select id={id("language")} className="input" value={value.subtitle_language} disabled={disabled} onChange={(e) => set("subtitle_language", e.target.value)}>
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("style")}>Estilo das legendas</label>
          <select id={id("style")} className="input" value={value.subtitle_style} disabled={disabled} onChange={(e) => set("subtitle_style", e.target.value as ClipSettings["subtitle_style"])}>
            {SUBTITLE_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("position")}>Posição do texto</label>
          <select id={id("position")} className="input" value={value.subtitle_position} disabled={disabled} onChange={(e) => set("subtitle_position", e.target.value as ClipSettings["subtitle_position"])}>
            {SUBTITLE_POSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <label className="label" htmlFor={id("font")}>Tamanho do texto: {value.subtitle_font_size}px</label>
          <input
            id={id("font")}
            type="range"
            min={24}
            max={160}
            step={2}
            value={value.subtitle_font_size}
            disabled={disabled}
            onChange={(e) => set("subtitle_font_size", Number(e.target.value))}
            className="w-full accent-brand-400"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("max")}>Máximo de cortes sugeridos</label>
          <input
            id={id("max")}
            type="number"
            min={1}
            max={50}
            className="input"
            value={value.max_clips}
            disabled={disabled}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n)) set("max_clips", Math.min(50, Math.max(1, n)));
            }}
          />
        </div>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="size-4 accent-brand-400"
              checked={value.highlight_current_word}
              disabled={disabled}
              onChange={(e) => set("highlight_current_word", e.target.checked)}
            />
            Destacar a palavra falada
          </label>
        </div>
      </div>

      <div>
        <span className="label">Enquadramento</span>
        <Segmented name="Enquadramento" options={FRAMING_OPTIONS} value={value.framing} onChange={(v) => set("framing", v)} disabled={disabled} />
      </div>
    </div>
  );
}
