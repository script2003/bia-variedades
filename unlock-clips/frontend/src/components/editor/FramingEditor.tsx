import { Crosshair, Save, Undo2 } from "lucide-react";
import type { AspectRatio, ClipFramingMode, FramingMode, FramingOverride } from "../../api/types";
import { cropSize, manualCrop } from "../../lib/framing";

interface Props {
  aspect: AspectRatio;
  projectDefault: FramingMode;
  sourceWidth: number;
  sourceHeight: number;
  value: FramingOverride | null;
  saved: FramingOverride | null;
  faceAvailable: boolean;
  saving: boolean;
  onChange: (value: FramingOverride | null) => void;
  onSave: () => void;
}

const MODE_LABEL: Record<ClipFramingMode, string> = {
  centro: "Central",
  rosto: "Acompanhar o rosto",
  manual: "Posição fixa (manual)",
};

const MODE_HINT: Record<ClipFramingMode, string> = {
  centro: "Recorte fixo no meio do quadro.",
  rosto: "Detecta o rosto principal e move o recorte suavemente.",
  manual: "Você escolhe a posição do recorte e o zoom.",
};

export function sameFraming(a: FramingOverride | null, b: FramingOverride | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** Escolha do enquadramento de um corte, com posição e zoom ajustáveis no modo manual. */
export default function FramingEditor({
  aspect,
  projectDefault,
  sourceWidth,
  sourceHeight,
  value,
  saved,
  faceAvailable,
  saving,
  onChange,
  onSave,
}: Props) {
  const dirty = !sameFraming(value, saved);
  const manual = value?.mode === "manual" ? value : null;
  const [baseW, baseH] = cropSize(sourceWidth, sourceHeight, aspect);
  const crop = manual ? manualCrop(sourceWidth, sourceHeight, aspect, manual) : null;
  const freeX = crop ? sourceWidth - crop.width > 0 : sourceWidth - baseW > 0;
  const freeY = crop ? sourceHeight - crop.height > 0 : sourceHeight - baseH > 0;

  const choose = (mode: ClipFramingMode | "padrao") => {
    if (mode === "padrao") onChange(null);
    else if (mode === "manual") onChange({ mode, x: manual?.x ?? 0.5, y: manual?.y ?? 0.5, zoom: manual?.zoom ?? 1 });
    else onChange({ mode, x: 0.5, y: 0.5, zoom: 1 });
  };
  const set = (field: "x" | "y" | "zoom", next: number) => manual && onChange({ ...manual, [field]: next });

  const options: { key: ClipFramingMode | "padrao"; label: string; hint: string; disabled?: boolean }[] = [
    {
      key: "padrao",
      label: `Padrão do projeto (${MODE_LABEL[projectDefault].toLowerCase()})`,
      hint: "Segue a configuração de enquadramento do projeto.",
    },
    ...(["centro", "rosto", "manual"] as ClipFramingMode[]).map((mode) => ({
      key: mode,
      label: MODE_LABEL[mode],
      hint: mode === "rosto" && !faceAvailable ? "Detecção de rostos indisponível neste computador." : MODE_HINT[mode],
      disabled: mode === "rosto" && !faceAvailable,
    })),
  ];
  const selected = value ? value.mode : "padrao";

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Modo de enquadramento</legend>
        {options.map((option) => (
          <label
            key={option.key}
            className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
              selected === option.key ? "border-brand-400/60 bg-brand-400/5" : "border-ink-700 hover:border-ink-500"
            } ${option.disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="framing-mode"
              className="mt-1 accent-brand-400"
              checked={selected === option.key}
              disabled={option.disabled}
              onChange={() => choose(option.key)}
            />
            <span>
              <span className="block font-medium text-zinc-100">{option.label}</span>
              <span className="block text-xs text-zinc-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {manual && (
        <div className="grid gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3">
          <div>
            <label className="label flex justify-between" htmlFor="framing-x">
              <span>Posição horizontal</span>
              <span className="font-mono text-zinc-400">{percent(manual.x)}</span>
            </label>
            <input
              id="framing-x"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={manual.x}
              disabled={!freeX}
              onChange={(e) => set("x", Number(e.target.value))}
              className="w-full accent-brand-400"
            />
          </div>
          <div>
            <label className="label flex justify-between" htmlFor="framing-y">
              <span>Posição vertical</span>
              <span className="font-mono text-zinc-400">{percent(manual.y)}</span>
            </label>
            <input
              id="framing-y"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={manual.y}
              disabled={!freeY}
              onChange={(e) => set("y", Number(e.target.value))}
              className="w-full accent-brand-400"
            />
          </div>
          <div>
            <label className="label flex justify-between" htmlFor="framing-zoom">
              <span>Zoom</span>
              <span className="font-mono text-zinc-400">{manual.zoom.toFixed(2).replace(".", ",")}×</span>
            </label>
            <input
              id="framing-zoom"
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={manual.zoom}
              onChange={(e) => set("zoom", Number(e.target.value))}
              className="w-full accent-brand-400"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              Recorte de {crop?.width}×{crop?.height} px do vídeo original ({sourceWidth}×{sourceHeight}).
            </span>
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onChange({ ...manual, x: 0.5, y: 0.5 })}>
              <Crosshair className="size-3.5" aria-hidden /> Centralizar
            </button>
          </div>
          {crop && crop.width * 2.5 < (aspect === "16:9" ? 1920 : 1080) && (
            <p className="text-xs text-amber-300">Zoom alto: a imagem será muito ampliada e pode ficar desfocada.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-amber-300">Alteração não salva — já aparece na prévia ao vivo.</span>}
        <button type="button" className="btn btn-secondary" onClick={() => onChange(saved)} disabled={!dirty || saving}>
          <Undo2 className="size-4" aria-hidden /> Desfazer
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!dirty || saving}>
          <Save className="size-4" aria-hidden /> {saving ? "Salvando…" : "Salvar enquadramento"}
        </button>
      </div>
    </div>
  );
}
