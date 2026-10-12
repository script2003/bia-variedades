import { Film, FolderOpen, LayoutDashboard, Scissors, Settings, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/criar", label: "Criar cortes", icon: Scissors },
  { to: "/projetos", label: "Meus projetos", icon: FolderOpen },
  { to: "/exportados", label: "Vídeos exportados", icon: Film },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-8 px-4 py-6">
      <div className="px-2">
        <Logo />
      </div>
      <nav aria-label="Menu principal" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive
                  ? "bg-brand-400/10 text-brand-300 ring-1 ring-brand-400/30"
                  : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100",
              ].join(" ")
            }
          >
            <Icon className="size-4.5 shrink-0" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <p className="mt-auto px-3 text-xs leading-relaxed text-zinc-600">
        Processamento local. Utilize apenas conteúdos que você tem autorização para editar e publicar.
      </p>
    </div>
  );
}
