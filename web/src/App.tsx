import {
  Boxes,
  Download,
  LayoutGrid,
  LogIn,
  LogOut,
  Network,
  ScrollText,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { OpRunnerProvider } from "./components/OpRunner";
import { ErrorBox, ago } from "./components/ui";
import { loginUrl, logout, workerConfigured } from "./lib/api";
import { usePrivate, usePublic, useSession } from "./lib/data";

type Tab = readonly [path: string, label: string, hotkey: string, icon: LucideIcon];

/** [path, label, hotkey, icon]. `g` then the key jumps there, Linear-style. */
const PUBLIC_TABS: readonly Tab[] = [
  ["/", "Сводка", "s", LayoutGrid],
  ["/mods", "Моды", "m", Boxes],
  ["/graph", "Граф", "g", Network],
  ["/flavors", "Флейворы", "f", Sparkles],
];

const ADMIN_TABS: readonly Tab[] = [
  ["/updates", "Обновления", "u", Download],
  ["/import", "Импорт", "i", Upload],
  ["/lint", "Линтер", "l", ShieldAlert],
  ["/history", "Журнал", "j", ScrollText],
  ["/settings", "Настройки", "n", SettingsIcon],
];

/** Single-key navigation. Ignored while typing in a field. */
function useHotkeys(map: Record<string, string>) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const to = map[event.key.toLowerCase()];
      if (to) {
        event.preventDefault();
        navigate(to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, navigate]);
}

function Rail({
  to,
  label,
  hotkey,
  icon: Icon,
  badge,
  index,
}: {
  to: string;
  label: string;
  hotkey: string;
  icon: LucideIcon;
  badge?: number;
  index: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={{ "--stagger-index": index } as React.CSSProperties}
      className={({ isActive }) =>
        `group rise relative flex h-11 items-center gap-3 rounded-sm px-3 text-sm transition-[background-color,color,box-shadow] duration-[var(--dur)] ease-quint ${
          isActive
            ? "bg-raised text-ink shadow-[var(--shadow-e1)]"
            : "text-muted hover:bg-raised/50 hover:text-ink"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Активная вкладка держит акцентную планку слева: она отрастает из
              центра, поэтому переход между вкладками читается как движение,
              а не как перекраска. */}
          <span
            aria-hidden
            className={`absolute top-1/2 left-0 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-[height,opacity] duration-[var(--dur-slow)] ease-spring ${
              isActive ? "h-5 opacity-100" : "h-0 opacity-0"
            }`}
          />
          <Icon
            aria-hidden
            size={17}
            strokeWidth={1.75}
            className={`shrink-0 transition-colors duration-[var(--dur)] ${
              isActive ? "text-accent" : "text-faint group-hover:text-muted"
            }`}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ? (
            <span className="rounded-xs bg-danger/15 px-1.5 py-0.5 font-mono text-2xs text-danger">
              {badge}
            </span>
          ) : null}
          <kbd
            aria-hidden
            className={`font-mono text-2xs transition-colors duration-[var(--dur-fast)] ${
              "text-faint/60 group-hover:text-faint"
            }`}
          >
            {hotkey}
          </kbd>
        </>
      )}
    </NavLink>
  );
}

export default function App() {
  const session = useSession();
  const publicData = usePublic();
  const privateData = usePrivate();
  const admin = Boolean(session.data);

  const tabs = admin ? [...PUBLIC_TABS, ...ADMIN_TABS] : PUBLIC_TABS;
  useHotkeys(Object.fromEntries(tabs.map(([to, , key]) => [key, to])));
  const problems = privateData.data?.lint.filter((f) => f.level === "error").length ?? 0;
  const pack = publicData.data?.pack;

  return (
    <OpRunnerProvider>
      <div aria-hidden className="ambient" />
      <div aria-hidden className="grain" />

      <div className="relative z-10 grid h-screen grid-cols-[15rem_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-edge bg-surface/95">
          <div className="px-5 py-6">
            <p className="font-display text-lg leading-none font-semibold tracking-[-0.02em] text-ink">
              MCKSP
            </p>
            <p className="mt-1.5 text-xs text-muted">Seventh Season</p>
            {pack && (
              <div className="fade-in mt-4 space-y-1 rounded-sm border border-edge bg-canvas/50 px-3 py-2.5 font-mono text-2xs text-faint">
                <p className="flex items-baseline justify-between gap-2">
                  <span>версия</span>
                  <span className="text-muted">{pack.version}</span>
                </p>
                <p className="flex items-baseline justify-between gap-2">
                  <span>{pack.loader}</span>
                  <span className="text-muted">{pack.mc}</span>
                </p>
              </div>
            )}
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {PUBLIC_TABS.map(([to, label, key, icon], i) => (
              <Rail key={to} to={to} label={label} hotkey={key} icon={icon} index={i} />
            ))}
            {admin && (
              <>
                <p className="px-3 pt-5 pb-2 font-mono text-2xs tracking-[0.14em] text-faint/70 uppercase">
                  админ
                </p>
                {ADMIN_TABS.map(([to, label, key, icon], i) => (
                  <Rail
                    key={to}
                    to={to}
                    label={label}
                    hotkey={key}
                    icon={icon}
                    index={PUBLIC_TABS.length + i}
                    badge={to === "/lint" ? problems : undefined}
                  />
                ))}
              </>
            )}
          </nav>

          <div className="space-y-2.5 border-t border-edge px-5 py-4 text-2xs text-faint">
            {publicData.data && (
              <p className="flex items-center gap-2">
                <span aria-hidden className="size-1.5 rounded-full bg-accent/70" />
                анализ {ago(publicData.data.generated_at)}
              </p>
            )}
            {admin ? (
              <p className="flex items-center gap-2">
                <span className="min-w-0 truncate text-muted">{session.data?.login}</span>
                <button
                  title="выйти"
                  className="ml-auto grid size-7 shrink-0 cursor-pointer place-items-center rounded-xs text-faint transition-colors duration-[var(--dur)] hover:bg-raised hover:text-ink"
                  onClick={() => void logout().then(() => window.location.reload())}
                >
                  <LogOut aria-hidden size={13} strokeWidth={1.75} />
                  <span className="sr-only">выйти</span>
                </button>
              </p>
            ) : workerConfigured() ? (
              <a
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-edge bg-raised/40 px-3 text-xs text-ink transition-[border-color,box-shadow] duration-[var(--dur)] hover:border-accent-dim hover:shadow-[var(--shadow-glow)]"
                href={loginUrl()}
              >
                <LogIn aria-hidden size={14} strokeWidth={1.75} />
                войти через GitHub
              </a>
            ) : (
              <p title="VITE_WORKER_URL не задан при сборке">публичный режим</p>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          {(publicData.data?.notices ?? []).map((notice) => (
            <p
              key={notice}
              className="fade-in flex shrink-0 items-center gap-2.5 border-b border-warn-dim bg-warn/10 px-8 py-2.5 text-xs text-warn"
            >
              <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="shrink-0" />
              {notice}
            </p>
          ))}
          {publicData.isError && (
            <div className="shrink-0 px-8 pt-5">
              <ErrorBox error={publicData.error} />
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </OpRunnerProvider>
  );
}
