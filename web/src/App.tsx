import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { OpRunnerProvider } from "./components/OpRunner";
import { ErrorBox, ago } from "./components/ui";
import { loginUrl, logout, workerConfigured } from "./lib/api";
import { usePrivate, usePublic, useSession } from "./lib/data";

/** [path, label, hotkey]. `g` then the key jumps there, Linear-style. */
const PUBLIC_TABS = [
  ["/", "Сводка", "s"],
  ["/mods", "Моды", "m"],
  ["/graph", "Граф", "g"],
  ["/flavors", "Флейворы", "f"],
] as const;

const ADMIN_TABS = [
  ["/updates", "Обновления", "u"],
  ["/import", "Импорт", "i"],
  ["/lint", "Линтер", "l"],
  ["/history", "Журнал", "j"],
  ["/settings", "Настройки", "n"],
] as const;

/** `g` arms, the next key navigates. Ignored while typing in a field. */
function useGotoKeys(map: Record<string, string>) {
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (armed) {
        setArmed(false);
        const to = map[event.key.toLowerCase()];
        if (to) {
          event.preventDefault();
          navigate(to);
        }
        return;
      }
      if (event.key === "g") setArmed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, map, navigate]);

  // The armed state is worth showing: an invisible mode is a trap.
  return armed;
}

function Rail({
  to,
  label,
  hotkey,
  badge,
  armed,
}: {
  to: string;
  label: string;
  hotkey: string;
  badge?: number;
  armed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group flex items-center gap-2 rounded-sm px-2 py-1.5 text-base transition-colors duration-[--dur-fast] ${
          isActive ? "bg-raised text-ink" : "text-muted hover:bg-raised/50 hover:text-ink"
        }`
      }
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="font-mono text-2xs text-danger">{badge}</span> : null}
      <kbd
        aria-hidden
        className={`font-mono text-2xs transition-colors duration-[--dur-fast] ${
          armed ? "text-accent" : "text-faint/70 group-hover:text-faint"
        }`}
      >
        {hotkey}
      </kbd>
    </NavLink>
  );
}

export default function App() {
  const session = useSession();
  const publicData = usePublic();
  const privateData = usePrivate();
  const admin = Boolean(session.data);

  const tabs = admin ? [...PUBLIC_TABS, ...ADMIN_TABS] : PUBLIC_TABS;
  const armed = useGotoKeys(Object.fromEntries(tabs.map(([to, , key]) => [key, to])));
  const problems = privateData.data?.lint.filter((f) => f.level === "error").length ?? 0;
  const pack = publicData.data?.pack;

  return (
    <OpRunnerProvider>
      <div className="grid h-screen grid-cols-[13rem_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-edge bg-surface">
          <div className="px-3 py-4">
            <p className="text-md leading-tight font-semibold tracking-[-0.01em] text-ink">MCKSP</p>
            <p className="text-xs text-muted">Seventh Season</p>
            <p className="mt-1.5 font-mono text-2xs leading-relaxed text-faint">
              {pack ? (
                <>
                  {pack.version}
                  <br />
                  {pack.mc} · {pack.loader} {pack.loader_version}
                </>
              ) : (
                "модпак"
              )}
            </p>
          </div>

          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {PUBLIC_TABS.map(([to, label, key]) => (
              <Rail key={to} to={to} label={label} hotkey={key} armed={armed} />
            ))}
            {admin && (
              <>
                <hr className="mx-2 my-2 border-edge" />
                {ADMIN_TABS.map(([to, label, key]) => (
                  <Rail
                    key={to}
                    to={to}
                    label={label}
                    hotkey={key}
                    armed={armed}
                    badge={to === "/lint" ? problems : undefined}
                  />
                ))}
              </>
            )}
          </nav>

          <div className="space-y-1.5 border-t border-edge px-3 py-3 text-2xs text-faint">
            {armed && (
              <p className="text-accent">
                <span className="font-mono">g</span> — куда?
              </p>
            )}
            {publicData.data && <p>анализ {ago(publicData.data.generated_at)}</p>}
            {admin ? (
              <p className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-muted">{session.data?.login}</span>
                <button
                  className="ml-auto shrink-0 underline decoration-edge-strong underline-offset-2 transition-colors duration-[--dur-fast] hover:text-ink"
                  onClick={() => void logout().then(() => window.location.reload())}
                >
                  выйти
                </button>
              </p>
            ) : workerConfigured() ? (
              <a
                className="text-accent underline decoration-accent-dim underline-offset-2 transition-colors duration-[--dur-fast] hover:text-accent-strong"
                href={loginUrl()}
              >
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
              className="shrink-0 border-b border-warn-dim bg-warn/10 px-6 py-1.5 text-xs text-warn"
            >
              {notice}
            </p>
          ))}
          {publicData.isError && (
            <div className="shrink-0 px-6 pt-4">
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
