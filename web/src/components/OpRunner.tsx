import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

/** These rewrite the pack or its history; the confirm button says so. */
const DESTRUCTIVE = new Set(["remove-mod", "revert"]);

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
  const confirmRef = useRef<HTMLDivElement>(null);

  // Escape closes, but never mid-flight: the workflow keeps running either way
  // and a vanished dialog would hide the outcome.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    const buttons = confirmRef.current?.querySelectorAll<HTMLButtonElement>("footer button");
    buttons?.[buttons.length - 1]?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy, close]);

  return (
    <RunnerContext.Provider value={{ propose, busy }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-canvas/80 p-4">
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-label={progress ? "ход операции" : "подтверждение операции"}
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-md border border-edge-strong bg-surface"
          >
            <header className="flex items-baseline gap-2 border-b border-edge px-4 py-3">
              <h2 className="text-lg font-medium text-ink">
                {progress ? "Операция" : "Что произойдёт"}
              </h2>
              <code className="text-2xs text-faint">{pending.operation.op}</code>
              {!progress && DESTRUCTIVE.has(pending.operation.op) && (
                <span className="ml-auto text-2xs text-danger">необратимо</span>
              )}
            </header>

            <div className="space-y-3 px-4 py-3 text-xs">
              {!progress && pending.preview}

              {progress && (
                <>
                  <p className="flex items-center gap-2 text-muted">
                    {busy && (
                      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
                    )}
                    {PHASE_LABEL[progress.phase]}
                  </p>
                  {progress.steps.length > 0 && (
                    <ol className="space-y-1">
                      {progress.steps.map((step, index) => (
                        <li
                          key={index}
                          className={`flex items-center gap-2 transition-colors duration-[--dur] ${
                            step.status === "in_progress" ? "text-ink" : ""
                          }`}
                        >
                          <span
                            className={
                              step.conclusion === "success"
                                ? "text-accent"
                                : step.conclusion === "failure"
                                  ? "text-danger"
                                  : step.status === "in_progress"
                                    ? "text-accent"
                                    : "text-faint"
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
                          <span className="text-muted">{step.name}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {progress.runUrl && (
                    <a
                      className="inline-block text-accent underline"
                      href={progress.runUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      открыть запуск и его summary на GitHub
                    </a>
                  )}
                </>
              )}

              {error && <p className="text-danger">{error}</p>}

              <details className="text-faint">
                <summary className="cursor-pointer">payload</summary>
                <pre className="mt-1 overflow-auto rounded bg-canvas p-2 text-2xs">
                  {JSON.stringify(pending.operation, null, 2)}
                </pre>
              </details>
            </div>

            <footer className="flex justify-end gap-2 border-t border-edge px-4 py-3">
              <Button onClick={close} disabled={busy}>
                {progress?.phase === "succeeded" || progress?.phase === "failed"
                  ? "закрыть"
                  : "отмена"}
              </Button>
              {!progress && (
                <Button
                  tone={DESTRUCTIVE.has(pending.operation.op) ? "danger" : "primary"}
                  onClick={() => void confirm()}
                >
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
