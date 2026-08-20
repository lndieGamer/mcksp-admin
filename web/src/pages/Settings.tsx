import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleX,
  HardDrive,
  Lock,
  Play,
  Settings as SettingsIcon,
  SquareArrowOutUpRight,
  Tag as TagIcon,
} from "lucide-react";
import { useState } from "react";

import { useRunner } from "../components/OpRunner";
import {
  Band,
  Button,
  Card,
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

interface Run {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  updated_at: string;
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
    queryFn: () => github<Commit[]>("/repos/lndieGamer/MCKSP-Seventh-Season/commits?per_page=5"),
    enabled: Boolean(session.data),
  });

  const adminRuns = useQuery({
    queryKey: ["admin-runs"],
    queryFn: () =>
      github<{ workflow_runs: Run[] }>("/repos/lndieGamer/mcksp-admin/actions/runs?per_page=8"),
    enabled: Boolean(session.data),
    refetchInterval: 30_000,
  });

  if (!session.data) return <Empty icon={Lock}>раздел доступен только администратору</Empty>;
  if (publicData.isLoading) return <Loading what="настройки" />;

  const sizes = publicData.data?.build_sizes;
  // Самая тяжёлая группа задаёт масштаб полосок: сравнивать нужно группы между
  // собой, а не каждую с полной сборкой, где разница теряется.
  const without = Object.entries(sizes?.without ?? {}).sort((a, b) => a[1] - b[1]);
  const heaviest = sizes ? Math.max(sizes.full, ...without.map(([, size]) => size)) : 0;

  return (
    <Page>
      <PageTitle icon={SettingsIcon}>настройки</PageTitle>

      <div className="grid gap-6 lg:grid-cols-2">
        <Band title="вес сборок" className="lg:col-span-2">
          {!sizes ? (
            <Empty icon={HardDrive}>нет данных</Empty>
          ) : (
            <Card className="space-y-4 px-5 py-5">
              <p className="max-w-[74ch] text-xs text-faint">
                Считается из размеров jar. Для аудитории на TLauncher это существенно.
              </p>
              <ul className="space-y-2.5">
                <SizeRow label="полная" value={sizes.full} max={heaviest} tone="ink" />
                <SizeRow
                  label="минимальная (все галочки сняты)"
                  value={sizes.minimal}
                  max={heaviest}
                  tone="accent"
                />
                {without.slice(0, 12).map(([group, size]) => (
                  <SizeRow key={group} label={`без «${group}»`} value={size} max={heaviest} />
                ))}
              </ul>
            </Card>
          )}
        </Band>

        <Band title="версия пака">
          <Card className="space-y-3 px-5 py-5">
            <p className="text-xs text-faint">
              сейчас: <span className="font-mono text-muted">{publicData.data?.pack.version}</span>
            </p>
            <div className="flex items-end gap-2.5">
              <Input
                placeholder="1.6.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-44"
              />
              <Button
                tone="primary"
                icon={TagIcon}
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
          </Card>
        </Band>

        <Band
          title="анализ"
          actions={
            <Button
              icon={Play}
              onClick={() => {
                setAnalyzeState("запускаю…");
                void githubVoid(
                  "/repos/lndieGamer/mcksp-admin/actions/workflows/analyze.yml/dispatches",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ ref: "main" }),
                  },
                )
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
          <Card className="space-y-2 px-5 py-5">
            <p className="text-xs text-faint">
              последний прогон:{" "}
              <span className="font-mono text-muted">
                {stamp(publicData.data?.generated_at ?? null)}
              </span>
            </p>
            {analyzeState && <p className="fade-in text-xs text-accent">{analyzeState}</p>}
          </Card>
        </Band>

        <Band title="запуски панели">
          {adminRuns.isError && <ErrorBox error={adminRuns.error} />}
          <Card className="divide-y divide-edge/60 overflow-hidden">
            {adminRuns.data?.workflow_runs.length === 0 && (
              <p className="px-5 py-4 text-xs text-faint">панель ещё ничего не запускала</p>
            )}
            {(adminRuns.data?.workflow_runs ?? []).map((run) => {
              const done = run.conclusion === "success";
              const failed = run.conclusion === "failure";
              return (
                <a
                  key={run.id}
                  href={run.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 px-5 py-3 text-xs transition-colors duration-[var(--dur-fast)] hover:bg-raised/45"
                >
                  {done ? (
                    <CircleCheck aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
                  ) : failed ? (
                    <CircleX aria-hidden size={14} strokeWidth={1.75} className="text-danger" />
                  ) : (
                    <span aria-hidden className="pulse-ring size-1.5 rounded-full bg-accent" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted">{run.name}</span>
                  <span className="shrink-0 font-mono text-2xs text-faint">
                    {stamp(run.updated_at)}
                  </span>
                </a>
              );
            })}
          </Card>
        </Band>

        <Band title="последние коммиты в паке" className="lg:col-span-2">
          {packCommits.isError && <ErrorBox error={packCommits.error} />}
          <Card className="divide-y divide-edge/60 overflow-hidden">
            {packCommits.data?.length === 0 && (
              <p className="px-5 py-4 text-xs text-faint">GitHub не отдал историю пака</p>
            )}
            {(packCommits.data ?? []).map((commit) => (
              <a
                key={commit.sha}
                href={commit.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-5 py-3 text-xs transition-colors duration-[var(--dur-fast)] hover:bg-raised/45"
              >
                <span className="shrink-0 font-mono text-faint">{commit.sha.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {commit.commit.message.split("\n")[0]}
                </span>
                <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-faint">
                  {stamp(commit.commit.author.date)}
                </span>
                <SquareArrowOutUpRight
                  aria-hidden
                  size={12}
                  strokeWidth={2}
                  className="shrink-0 text-faint"
                />
              </a>
            ))}
          </Card>
        </Band>
      </div>
    </Page>
  );
}

/** Строка веса с полоской. Число справа читают, полоску — сравнивают. */
function SizeRow({
  label,
  value,
  max,
  tone = "faint",
}: {
  label: string;
  value: number;
  max: number;
  tone?: "ink" | "accent" | "faint";
}) {
  const color =
    tone === "ink"
      ? "var(--color-edge-strong)"
      : tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-accent-dim)";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_140px_92px] items-center gap-4">
      <span
        className={`truncate text-xs ${tone === "faint" ? "text-faint" : "text-muted"}`}
        title={label}
      >
        {label}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-raised">
        <span
          className="block h-full rounded-full transition-[width] duration-[var(--dur-slower)] ease-quint"
          style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }}
        />
      </span>
      <span className="text-right font-mono text-xs text-muted">{bytes(value)}</span>
    </li>
  );
}
