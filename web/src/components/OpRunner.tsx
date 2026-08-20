import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { useInvalidateData } from "../lib/data";
import { runOperation, type OpProgress } from "../lib/ops";
import type { Operation } from "../lib/types";
import { Button } from "./ui";

interface Runner {
  /** Show the diff preview, then dispatch on confirm. */
  propose: (operation: Operation, preview: ReactNode) => void;
  busy: boolean;
}

const RunnerContext = createContext<Runner | null>(null);

export function useRunner(): Runner {
  const runner = useContext(RunnerContext);
  if (!runner) throw new Error("useRunner outside OpRunnerProvider");
  return runner;
}

const PHASE_LABEL: Record<OpProgress["phase"], string> = {
  dispatching: "отправляю запрос",
  searching: "ищу запуск по run-name",
  queued: "в очереди (concurrency держит операцию)",
  running: "выполняется",
  succeeded: "готово",
  failed: "не прошло",
};

export function OpRunnerProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ operation: Operation; preview: ReactNode } | null>(null);
  const [progress, setProgress] = useState<OpProgress | null>(null);
  const invalidate = useInvalidateData();
  const [error, setError] = useState<string | null>(null);

  const propose = useCallback((operation: Operation, preview: ReactNode) => {
    setError(null);
    setProgress(null);
    setPending({ operation, preview });
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    try {
      const final = await runOperation(pending.operation, setProgress);
      if (final.phase === "succeeded") invalidate();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }, [pending, invalidate]);

  const close = useCallback(() => {
    setPending(null);
    setProgress(null);
    setError(null);
  }, []);

  const busy = progress !== null && progress.phase !== "succeeded" && progress.phase !== "failed";

  return (
    <RunnerContext.Provider value={{ propose, busy }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-[--color-edge] bg-[--color-panel] shadow-2xl">
            <header className="border-b border-[--color-edge] px-4 py-3">
              <h2 className="text-sm font-medium text-zinc-100">
                {progress ? "Операция" : "Подтверждение"}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{pending.operation.op}</p>
            </header>

            <div className="space-y-3 px-4 py-3 text-xs">
              {!progress && pending.preview}

              {progress && (
                <>
                  <p className="text-zinc-300">{PHASE_LABEL[progress.phase]}</p>
                  {progress.steps.length > 0 && (
                    <ol className="space-y-1">
                      {progress.steps.map((step, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <span
                            className={
                              step.conclusion === "success"
                                ? "text-emerald-400"
                                : step.conclusion === "failure"
                                  ? "text-red-400"
                                  : step.status === "in_progress"
                                    ? "text-sky-400"
                                    : "text-zinc-600"
                            }
                          >
                            {step.conclusion === "success"
                              ? "✓"
                              : step.conclusion === "failure"
                                ? "✕"
                                : step.status === "in_progress"
                                  ? "•"
                                  : "·"}
                          </span>
                          <span className="text-zinc-400">{step.name}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {progress.runUrl && (
                    <a
                      className="inline-block text-sky-400 underline"
                      href={progress.runUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      открыть запуск и его summary на GitHub
                    </a>
                  )}
                </>
              )}

              {error && <p className="text-red-400">{error}</p>}

              <details className="text-zinc-500">
                <summary className="cursor-pointer">payload</summary>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[11px]">
                  {JSON.stringify(pending.operation, null, 2)}
                </pre>
              </details>
            </div>

            <footer className="flex justify-end gap-2 border-t border-[--color-edge] px-4 py-3">
              <Button onClick={close} disabled={busy}>
                {progress?.phase === "succeeded" || progress?.phase === "failed"
                  ? "закрыть"
                  : "отмена"}
              </Button>
              {!progress && (
                <Button tone="primary" onClick={() => void confirm()}>
                  выполнить
                </Button>
              )}
            </footer>
          </div>
        </div>
      )}
    </RunnerContext.Provider>
  );
}
