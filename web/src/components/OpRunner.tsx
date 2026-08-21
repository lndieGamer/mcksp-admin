import {
  Check,
  Dot,
  LoaderCircle,
  Play,
  SquareArrowOutUpRight,
  TriangleAlert,
  X,
} from "lucide-react";
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
        <div className="scrim fixed inset-0 z-40 flex items-center justify-center bg-canvas/75 p-4 backdrop-blur-sm">
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-label={progress ? "ход операции" : "подтверждение операции"}
            className="modal max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-edge-strong bg-surface shadow-[var(--shadow-e4)]"
          >
            <header className="flex items-center gap-3 border-b border-edge px-5 py-4">
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-sm ring-1 ring-inset ${
                  DESTRUCTIVE.has(pending.operation.op)
                    ? "bg-danger/10 text-danger ring-danger-dim"
                    : "bg-raised text-accent ring-edge"
                }`}
              >
                {DESTRUCTIVE.has(pending.operation.op) ? (
                  <TriangleAlert aria-hidden size={16} strokeWidth={1.75} />
                ) : (
                  <Play aria-hidden size={15} strokeWidth={1.75} />
                )}
              </span>
              <h2 className="text-md font-semibold text-ink">
                {progress ? "Операция" : "Что произойдёт"}
              </h2>
              <code className="text-2xs text-faint">{pending.operation.op}</code>
              {!progress && DESTRUCTIVE.has(pending.operation.op) && (
                <span className="ml-auto rounded-xs bg-danger/10 px-2 py-0.5 text-2xs text-danger">
                  необратимо
                </span>
              )}
            </header>

            <div className="space-y-4 px-5 py-4 text-xs">
              {!progress && pending.preview}

              {progress && (
                <>
                  <p className="flex items-center gap-2.5 text-muted">
                    {busy && (
                      <span aria-hidden className="pulse-ring size-1.5 rounded-full bg-accent" />
                    )}
                    {PHASE_LABEL[progress.phase]}
                  </p>
                  {progress.steps.length > 0 && (
                    <ol className="space-y-1.5">
                      {progress.steps.map((step, index) => {
                        const StepIcon =
                          step.conclusion === "success"
                            ? Check
                            : step.conclusion === "failure"
                              ? X
                              : step.status === "in_progress"
                                ? LoaderCircle
                                : Dot;
                        const tone =
                          step.conclusion === "success"
                            ? "text-accent"
                            : step.conclusion === "failure"
                              ? "text-danger"
                              : step.status === "in_progress"
                                ? "text-accent"
                                : "text-faint";
                        return (
                          <li
                            key={index}
                            className={`flex items-center gap-2.5 transition-colors duration-[var(--dur)] ${
                              step.status === "in_progress" ? "text-ink" : ""
                            }`}
                          >
                            <StepIcon
                              aria-hidden
                              size={14}
                              strokeWidth={2}
                              className={`shrink-0 ${tone} ${
                                step.status === "in_progress" && !step.conclusion
                                  ? "animate-spin"
                                  : ""
                              }`}
                            />
                            <span className="text-muted">{step.name}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {progress.runUrl && (
                    <a
                      className="inline-flex items-center gap-1.5 text-accent transition-colors duration-[var(--dur)] hover:text-accent-strong"
                      href={progress.runUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      открыть запуск и его summary на GitHub
                      <SquareArrowOutUpRight aria-hidden size={12} strokeWidth={2} />
                    </a>
                  )}
                </>
              )}

              {error && <p className="text-danger">{error}</p>}

              <details className="text-faint">
                <summary className="cursor-pointer">payload</summary>
                <pre className="mt-2 overflow-auto rounded-sm bg-canvas p-3 text-2xs">
                  {JSON.stringify(pending.operation, null, 2)}
                </pre>
              </details>
            </div>

            <footer className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Button onClick={close} disabled={busy}>
                {progress?.phase === "succeeded" || progress?.phase === "failed"
                  ? "закрыть"
                  : "отмена"}
              </Button>
              {!progress && (
                <Button
                  tone={DESTRUCTIVE.has(pending.operation.op) ? "danger" : "primary"}
                  icon={Play}
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
