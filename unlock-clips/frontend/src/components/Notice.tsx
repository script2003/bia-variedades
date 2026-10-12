import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "error";

const STYLES: Record<Tone, string> = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  success: "border-brand-400/30 bg-brand-400/10 text-brand-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
};

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export default function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${STYLES[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
