import { formatPercent } from "../lib/format";

/** Barra de progresso. `value = null` exibe animação indeterminada. */
export default function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  const percent = value === null ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label ?? "Progresso"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={value === null ? "Em andamento" : formatPercent(value)}
      className="relative h-2 w-full overflow-hidden rounded-full bg-ink-700"
    >
      {value === null ? (
        <div className="absolute inset-y-0 w-1/3 animate-indeterminate rounded-full bg-brand-400" />
      ) : (
        <div className="h-full rounded-full bg-brand-400 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      )}
    </div>
  );
}
