import { NavLink, Outlet } from "react-router-dom";

import { OpRunnerProvider } from "./components/OpRunner";
import { ErrorBox, stamp } from "./components/ui";
import { loginUrl, logout, workerConfigured } from "./lib/api";
import { usePrivate, usePublic, useSession } from "./lib/data";

const PUBLIC_TABS = [
  ["/mods", "Моды"],
  ["/graph", "Граф"],
  ["/flavors", "Флейворы"],
] as const;

const ADMIN_TABS = [
  ["/updates", "Обновления"],
  ["/import", "Импорт"],
  ["/lint", "Линтер"],
  ["/history", "Журнал"],
  ["/settings", "Настройки"],
] as const;

export default function App() {
  const session = useSession();
  const publicData = usePublic();
  const privateData = usePrivate();
  const admin = Boolean(session.data);

  const tabs = admin ? [...PUBLIC_TABS, ...ADMIN_TABS] : PUBLIC_TABS;
  const problems = privateData.data?.lint.filter((f) => f.level === "error").length ?? 0;

  return (
    <OpRunnerProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-[--color-edge] bg-[--color-ink]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="mr-2">
              <h1 className="text-sm font-semibold text-zinc-100">MCKSP Seventh Season</h1>
              <p className="text-[11px] text-zinc-500">
                {publicData.data
                  ? `v${publicData.data.pack.version} · ${publicData.data.pack.mc} · ${publicData.data.pack.loader} ${publicData.data.pack.loader_version}`
                  : "модпак"}
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-1">
              {tabs.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `rounded px-2.5 py-1.5 text-xs transition ${
                      isActive
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`
                  }
                >
                  {label}
                  {to === "/lint" && problems > 0 && (
                    <span className="ml-1.5 rounded bg-red-500/20 px-1 text-[10px] text-red-300">
                      {problems}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
              {publicData.data && <span>анализ: {stamp(publicData.data.generated_at)}</span>}
              {admin ? (
                <>
                  <span className="text-zinc-300">{session.data?.login}</span>
                  <button
                    className="text-zinc-400 underline hover:text-zinc-200"
                    onClick={() => void logout().then(() => window.location.reload())}
                  >
                    выйти
                  </button>
                </>
              ) : workerConfigured() ? (
                <a className="text-sky-400 underline" href={loginUrl()}>
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
            className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200"
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
