import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { OpRunnerProvider } from "./components/OpRunner";
import { ErrorBox, Kbd, ago } from "./components/ui";
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
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-edge bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
            <div className="mr-1">
              <h1 className="text-base font-semibold text-ink">MCKSP Seventh Season</h1>
              <p className="font-mono text-2xs text-faint">
                {pack
                  ? `${pack.version} · ${pack.mc} · ${pack.loader} ${pack.loader_version}`
                  : "модпак"}
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-0.5">
              {tabs.map(([to, label, key], i) => (
                <span key={to} className="flex items-center">
                  {i === PUBLIC_TABS.length && (
                    <span aria-hidden className="mx-2 h-4 w-px bg-edge" />
                  )}
                  <NavLink
                    to={to}
                    end={to === "/"}
                    title={`g ${key}`}
                    className={({ isActive }) =>
                      `rounded-sm px-2.5 py-1.5 text-xs transition-colors duration-[--dur-fast] ${
                        isActive
                          ? "bg-raised text-ink"
                          : "text-muted hover:bg-raised/60 hover:text-ink"
                      }`
                    }
                  >
                    {label}
                    {to === "/lint" && problems > 0 && (
                      <span className="ml-1.5 font-mono text-2xs text-danger">{problems}</span>
                    )}
                  </NavLink>
                </span>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3 text-2xs text-faint">
              {armed && (
                <span className="text-accent">
                  <Kbd>g</Kbd> …
                </span>
              )}
              {publicData.data && <span>анализ {ago(publicData.data.generated_at)}</span>}
              {admin ? (
                <>
                  <span className="text-muted">{session.data?.login}</span>
                  <button
                    className="text-faint underline decoration-edge-strong underline-offset-2 transition-colors duration-[--dur-fast] hover:text-ink"
                    onClick={() => void logout().then(() => window.location.reload())}
                  >
                    выйти
                  </button>
                </>
              ) : workerConfigured() ? (
                <a
                  className="text-accent underline decoration-accent-dim underline-offset-2 transition-colors duration-[--dur-fast] hover:text-accent-strong"
                  href={loginUrl()}
                >
                  войти через GitHub
                </a>
              ) : (
                <span title="VITE_WORKER_URL не задан при сборке">публичный режим</span>
              )}
            </div>
          </div>
        </header>

        {(publicData.data?.notices ?? []).map((notice) => (
          <div
            key={notice}
            className="border-b border-warn-dim bg-warn/10 px-4 py-1.5 text-center text-xs text-warn"
          >
            {notice}
          </div>
        ))}

        <main className="mx-auto max-w-[1600px] p-4">
          {publicData.isError && <ErrorBox error={publicData.error} />}
          <Outlet />
        </main>
      </div>
    </OpRunnerProvider>
  );
}
