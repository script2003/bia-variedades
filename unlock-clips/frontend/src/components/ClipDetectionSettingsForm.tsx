import type { ClipDetectionSettings, ScoringCriterion } from "../api/types";

interface Props {
  value: ClipDetectionSettings;
  criteria: ScoringCriterion[];
  onChange: (value: ClipDetectionSettings) => void;
}

export default function ClipDetectionSettingsForm({ value, criteria, onChange }: Props) {
  const total = criteria.reduce((sum, c) => sum + (value.weights[c.key] ?? 0), 0);
  const setWeight = (key: string, weight: number) => onChange({ ...value, weights: { ...value.weights, [key]: weight } });
  const restore = () => onChange({ ...value, weights: Object.fromEntries(criteria.map((c) => [c.key, c.default_weight])) });

  return (
    <div className="grid gap-5">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-brand-400"
          checked={value.auto_detect}
          onChange={(e) => onChange({ ...value, auto_detect: e.target.checked })}
        />
        Sugerir cortes automaticamente depois da transcrição
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Peso de cada critério na pontuação</span>
          <button type="button" className="text-xs text-brand-400 hover:text-brand-300" onClick={restore}>
            Restaurar padrões
          </button>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {criteria.map((criterion) => {
            const weight = value.weights[criterion.key] ?? 0;
            const share = total > 0 ? Math.round((weight / total) * 100) : 0;
            return (
              <li key={criterion.key} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`weight-${criterion.key}`} className="text-sm font-medium text-zinc-200">
                    {criterion.label}
                  </label>
                  <span className="font-mono text-xs text-zinc-500 tabular-nums">
                    {weight} · {share}%
                  </span>
                </div>
                <input
                  id={`weight-${criterion.key}`}
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={weight}
                  onChange={(e) => setWeight(criterion.key, Number(e.target.value))}
                  className="w-full accent-brand-400"
                />
                <p className="text-xs text-zinc-500">{criterion.description}</p>
              </li>
            );
          })}
        </ul>
        {total === 0 && <p className="mt-2 text-xs text-red-300">Pelo menos um critério precisa ter peso maior que zero.</p>}
        <p className="mt-2 text-xs text-zinc-500">
          Os pesos valem para as próximas sugestões. Para aplicar a um projeto existente, use “Gerar novamente” no painel de
          cortes.
        </p>
      </div>
    </div>
  );
}
