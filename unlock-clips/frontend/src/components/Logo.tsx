import { LockOpen } from "lucide-react";

export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-400 text-ink-950 shadow-[0_0_24px_-4px] shadow-brand-400/60">
        <LockOpen className="size-5" strokeWidth={2.5} aria-hidden />
      </span>
      {!compact && (
        <span className="text-lg leading-none font-black tracking-tight">
          UNLOCK <span className="text-brand-400">CLIPS</span>
        </span>
      )}
    </div>
  );
}
