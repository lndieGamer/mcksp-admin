import { github, githubVoid } from "./api";
import type { Operation } from "./types";

const REPO = "/repos/lndieGamer/mcksp-admin";
const FIND_TIMEOUT_MS = 30_000;
const POLL_MS = 3_000;

export interface StepState {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface OpProgress {
  phase: "dispatching" | "searching" | "queued" | "running" | "succeeded" | "failed";
  runId?: number;
  runUrl?: string;
  steps: StepState[];
  message?: string;
}

interface RunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dispatch an operation and follow it to completion.
 *
 * `workflow_dispatch` does not return the id of the run it starts, so the run
 * is tagged with a UUID through `run-name` and found by that name afterwards.
 */
export async function runOperation(
  operation: Operation,
  onProgress: (progress: OpProgress) => void,
): Promise<OpProgress> {
  const requestId = crypto.randomUUID();
  let progress: OpProgress = { phase: "dispatching", steps: [] };
  const emit = (next: Partial<OpProgress>) => {
    progress = { ...progress, ...next };
    onProgress(progress);
  };
  emit({});

  await githubVoid(`${REPO}/actions/workflows/mutate.yml/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ref: "main",
      inputs: { request_id: requestId, payload: JSON.stringify(operation) },
    }),
  });

  emit({ phase: "searching" });
  const run = await findRun(requestId);
  if (!run) {
    emit({ phase: "failed", message: "run did not appear within 30 s" });
    return progress;
  }

  emit({ phase: run.status === "queued" ? "queued" : "running", runId: run.id, runUrl: run.html_url });
  return followRun(run.id, emit, progress);
}

async function findRun(requestId: string): Promise<RunSummary | null> {
  const deadline = Date.now() + FIND_TIMEOUT_MS;
  const wanted = `op-${requestId}`;
  while (Date.now() < deadline) {
    const data = await github<{ workflow_runs: RunSummary[] }>(
      `${REPO}/actions/runs?event=workflow_dispatch&per_page=20`,
    );
    const match = data.workflow_runs.find((run) => run.name === wanted);
    if (match) return match;
    await sleep(2000);
  }
  return null;
}

async function followRun(
  runId: number,
  emit: (next: Partial<OpProgress>) => void,
  progress: OpProgress,
): Promise<OpProgress> {
  for (;;) {
    const jobs = await github<{
      jobs: { status: string; steps?: StepState[] }[];
    }>(`${REPO}/actions/runs/${runId}/jobs`);
    const steps = jobs.jobs.flatMap((job) => job.steps ?? []);

    const run = await github<RunSummary>(`${REPO}/actions/runs/${runId}`);
    if (run.status === "completed") {
      emit({
        phase: run.conclusion === "success" ? "succeeded" : "failed",
        steps,
        message: run.conclusion ?? undefined,
      });
      return { ...progress, phase: run.conclusion === "success" ? "succeeded" : "failed", steps };
    }
    // Raw logs come back as a redirect to a zip, which is useless in a browser.
    // Step states plus the job summary the workflow writes are enough.
    emit({ phase: run.status === "queued" ? "queued" : "running", steps });
    await sleep(POLL_MS);
  }
}
