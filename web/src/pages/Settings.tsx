import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import { useRunner } from "../components/OpRunner";
import {
  Band,
  Button,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  PageTitle,
  bytes,
  stamp,
} from "../components/ui";
import { github, githubVoid } from "../lib/api";
import { usePublic, useSession } from "../lib/data";

interface Commit {
  sha: string;
  commit: { message: string; author: { date: string } };
  html_url: string;
}

export default function Settings() {
  const publicData = usePublic();
  const session = useSession();
  const runner = useRunner();
  const [version, setVersion] = useState("");
  const [analyzeState, setAnalyzeState] = useState<string | null>(null);

  const packCommits = useQuery({
    queryKey: ["pack-commits"],
    queryFn: () =>
      github<Commit[]>("/repos/lndieGamer/MCKSP-Seventh-Season/commits?per_page=5"),
    enabled: Boolean(session.data),
  });

  const adminRuns = useQuery({
    queryKey: ["admin-runs"],
    queryFn: () =>
      github<{ workflow_runs: { id: number; name: string; status: string; conclusion: string | null; updated_at: string; html_url: string }[] }>(
        "/repos/lndieGamer/mcksp-admin/actions/runs?per_page=8",
      ),
    enabled: Boolean(session.data),
    refetchInterval: 30_000,
  });

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;
  if (publicData.isLoading) return <Loading what="настройки" />;

  const sizes = publicData.data?.build_sizes;

  return (
    <Page>
      <PageTitle>настройки</PageTitle>
      <div className="grid gap-x-10 gap-y-7 lg:grid-cols-2">
      <Band title="вес сборок">
        {!sizes ? (
          <Empty>нет данных</Empty>
        ) : (
          <>
            <p className="mb-2 text-xs text-faint">
              Считается из размеров jar. Для аудитории на TLauncher это существенно.
            </p>
            <dl className="grid max-w-[440px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">полная</dt>
              <dd className="text-right font-mono text-ink">{bytes(sizes.full)}</dd>
              <dt className="text-muted">минимальная (все галочки сняты)</dt>
              <dd className="text-right font-mono text-muted">{bytes(sizes.minimal)}</dd>
              {Object.entries(sizes.without)
                .sort((a, b) => a[1] - b[1])
                .slice(0, 12)
                .map(([group, size]) => (
                  <Fragment key={group}>
                    <dt className="text-faint">без «{group}»</dt>
                    <dd className="text-right font-mono text-faint">{bytes(size)}</dd>
                  </Fragment>
                ))}
            </dl>
          </>
        )}
      </Band>

      <Band title="версия пака">
        <div className="flex items-end gap-2">
          <div>
            <p className="mb-1 text-xs text-faint">
              сейчас: <span className="font-mono">{publicData.data?.pack.version}</span>
            </p>
            <Input
              placeholder="1.6.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            tone="primary"
            disabled={!/^\d+\.\d+\.\d+/.test(version)}
            onClick={() =>
              runner.propose(
                { op: "set-pack-version", version },
                <p className="text-muted">
                  pack.toml: <code>version</code> {publicData.data?.pack.version} → {version}
                </p>,
              )
            }
          >
            изменить
          </Button>
        </div>
      </Band>

      <Band
        title="анализ"
        actions={
          <Button
            onClick={() => {
              setAnalyzeState("запускаю…");
              void githubVoid("/repos/lndieGamer/mcksp-admin/actions/workflows/analyze.yml/dispatches", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ref: "main" }),
              })
                .then(() => setAnalyzeState("запущен, обновите страницу через пару минут"))
                .catch((exc: unknown) =>
                  setAnalyzeState(exc instanceof Error ? exc.message : String(exc)),
                );
            }}
          >
            запустить analyze.yml
          </Button>
        }
      >
        <p className="text-sm text-faint">
          последний прогон: {stamp(publicData.data?.generated_at ?? null)}
        </p>
        {analyzeState && <p className="mt-1 text-sm text-accent">{analyzeState}</p>}
      </Band>

      <Band title="запуски панели">
        {adminRuns.isError && <ErrorBox error={adminRuns.error} />}
        {adminRuns.data && adminRuns.data.workflow_runs.length === 0 && (
          <p className="text-sm text-faint">панель ещё ничего не запускала</p>
        )}
        <ul className="space-y-1 text-sm">
          {(adminRuns.data?.workflow_runs ?? []).map((run) => (
            <li key={run.id} className="flex items-center gap-2">
              <span
                className={
                  run.conclusion === "success"
                    ? "text-accent"
                    : run.conclusion === "failure"
                      ? "text-danger"
                      : "text-accent"
                }
              >
                ●
              </span>
              <a className="text-muted hover:text-accent" href={run.html_url} target="_blank" rel="noreferrer">
                {run.name}
              </a>
              <span className="ml-auto text-faint">{stamp(run.updated_at)}</span>
            </li>
          ))}
        </ul>
      </Band>

      <Band title="последние коммиты в паке" className="lg:col-span-2">
        {packCommits.isError && <ErrorBox error={packCommits.error} />}
        {packCommits.data?.length === 0 && (
          <p className="text-sm text-faint">GitHub не отдал историю пака</p>
        )}
        <ul className="max-w-[1180px] space-y-1 text-sm">
          {(packCommits.data ?? []).map((commit) => (
            <li key={commit.sha} className="flex gap-2">
              <a
                className="font-mono text-faint hover:text-accent"
                href={commit.html_url}
                target="_blank"
                rel="noreferrer"
              >
                {commit.sha.slice(0, 7)}
              </a>
              <span className="text-muted">{commit.commit.message.split("\n")[0]}</span>
              <span className="ml-auto whitespace-nowrap text-faint">
                {stamp(commit.commit.author.date)}
              </span>
            </li>
          ))}
        </ul>
      </Band>
      </div>
    </Page>
  );
}
