import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleHelp,
  Copy,
  Lock,
  Plus,
  ShieldAlert,
  SquareArrowOutUpRight,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  Band,
  Button,
  Card,
  Empty,
  Input,
  Loading,
  Page,
  PageTitle,
  Select,
  Tag,
  plural,
} from "../components/ui";
import { usePrivate, useSession } from "../lib/data";
import type { LintFinding, PrivateData } from "../lib/types";

type Unparsed = PrivateData["unparsed"][number];

/** overrides.toml живёт в этом же репозитории — правится там, не через воркер. */
const OVERRIDES_URL =
  "https://github.com/lndieGamer/mcksp-admin/edit/main/analyzer/overrides.toml";

const TONE: Record<LintFinding["level"], "danger" | "warn" | "neutral"> = {
  error: "danger",
  warning: "warn",
  info: "neutral",
};

/** Куда идти чинить. Список претензий без адреса — это не линтер, а жалоба. */
function fixFor(slug: string, code: string): { to: string; where: string } {
  const graph = { to: `/graph?focus=${encodeURIComponent(slug)}`, where: "граф" };
  // Встроенных в чужой jar библиотек в таблице модов нет — только в графе.
  if (slug.includes("::")) return graph;
  switch (code) {
    case "incompatible_present":
    case "missing_dependency":
    case "version_range_unsatisfied":
    case "duplicate_mod_id":
      return graph;
    case "flavor_escape":
    case "unsup_orphan":
      return { to: "/flavors", where: "флейворы" };
    default:
      return { to: `/mods?q=${encodeURIComponent(slug)}`, where: "моды" };
  }
}

const ROW =
  "grid grid-cols-[190px_250px_minmax(0,1fr)_74px] items-baseline gap-x-4 px-4 py-2.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-raised/45";

function Cells({
  tone,
  code,
  slug,
  message,
}: {
  tone: "danger" | "warn" | "neutral";
  code: string;
  slug: string;
  message: string;
}) {
  return (
    <>
      <span>
        <Tag tone={tone}>{code}</Tag>
      </span>
      <span className="truncate font-mono text-xs text-faint" title={slug}>
        {slug}
      </span>
      <span className="text-xs text-muted">{message}</span>
    </>
  );
}

function Goto({ where }: { where: string }) {
  return (
    <span className="flex items-center justify-end gap-1 text-2xs text-faint opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100">
      {where}
      <ArrowRight aria-hidden size={11} strokeWidth={2} />
    </span>
  );
}

export default function Lint() {
  const privateData = usePrivate();
  const session = useSession();
  const [level, setLevel] = useState("");
  const [code, setCode] = useState("");
  const [triage, setTriage] = useState<Unparsed | null>(null);

  const findings = privateData.data?.lint ?? [];
  const unparsedBySlug = useMemo(
    () => new Map((privateData.data?.unparsed ?? []).map((u) => [u.slug, u])),
    [privateData.data],
  );
  const codes = useMemo(() => [...new Set(findings.map((f) => f.code))].sort(), [findings]);
  const rows = findings.filter((f) => (!level || f.level === level) && (!code || f.code === code));

  if (!session.data) return <Empty icon={Lock}>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="отчёт линтера" />;
  if (!privateData.data) return <Empty icon={ShieldAlert}>private.json недоступен</Empty>;

  const counts = {
    error: findings.filter((f) => f.level === "error").length,
    warning: findings.filter((f) => f.level === "warning").length,
    info: findings.filter((f) => f.level === "info").length,
  };

  return (
    <Page>
      <PageTitle
        icon={ShieldAlert}
        actions={
          <>
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">уровень: любой</option>
              <option value="error">error</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
            </Select>
            <Select value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">код: любой</option>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </>
        }
      >
        что не так с паком
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-3">
        <Count
          index={0}
          icon={XCircle}
          tone={counts.error ? "text-danger" : "text-faint"}
          value={counts.error}
          label={plural(counts.error, "ошибка", "ошибки", "ошибок")}
        />
        <Count
          index={1}
          icon={TriangleAlert}
          tone={counts.warning ? "text-warn" : "text-faint"}
          value={counts.warning}
          label={plural(counts.warning, "предупреждение", "предупреждения", "предупреждений")}
        />
        <Count
          index={2}
          icon={CircleHelp}
          tone="text-faint"
          value={counts.info}
          label={plural(counts.info, "заметка", "заметки", "заметок")}
        />
      </div>

      <Band title="находки" count={rows.length}>
        {rows.length === 0 ? (
          <Empty icon={CircleCheck}>чисто — под текущие фильтры ничего не попало</Empty>
        ) : (
          <Card className="divide-y divide-edge/60 overflow-hidden">
            {rows.map((finding, index) => {
              const style = { "--stagger-index": Math.min(index, 18) } as React.CSSProperties;
              const cells = (
                <Cells
                  tone={TONE[finding.level]}
                  code={finding.code}
                  slug={finding.slug}
                  message={finding.message}
                />
              );
              // Нераспарсенный jar чинится не на другой странице, а руками в
              // overrides.toml — для него открывается разбор прямо здесь.
              const entry = unparsedBySlug.get(finding.slug);
              if (finding.code === "unparsed" && entry) {
                return (
                  <button
                    key={index}
                    type="button"
                    title="открыть: разбор"
                    style={style}
                    className={`rise group w-full cursor-pointer text-left ${ROW}`}
                    onClick={() => setTriage(entry)}
                  >
                    {cells}
                    <Goto where="разбор" />
                  </button>
                );
              }
              const fix = fixFor(finding.slug, finding.code);
              return (
                <Link
                  key={index}
                  to={fix.to}
                  title={`открыть: ${fix.where}`}
                  style={style}
                  className={`rise group ${ROW}`}
                >
                  {cells}
                  <Goto where={fix.where} />
                </Link>
              );
            })}
          </Card>
        )}
      </Band>

      <Band title="не разобрано" count={privateData.data.unparsed.length}>
        {privateData.data.unparsed.length === 0 ? (
          <Empty icon={CircleCheck}>всё разобралось</Empty>
        ) : (
          <>
            <p className="max-w-[74ch] text-xs text-faint">
              Спорное переносится в <code>analyzer/overrides.toml</code> — оттуда оно подмешивается
              в граф вручную.
            </p>
            <Card className="divide-y divide-edge/60 overflow-hidden">
              {privateData.data.unparsed.map((entry) => (
                <button
                  key={entry.slug}
                  type="button"
                  title="открыть: разбор"
                  className={`group w-full cursor-pointer text-left ${ROW}`}
                  onClick={() => setTriage(entry)}
                >
                  <Cells
                    tone={entry.level === "failed" ? "danger" : "warn"}
                    code={entry.level}
                    slug={entry.slug}
                    message={entry.reason}
                  />
                  <Goto where="разбор" />
                </button>
              ))}
            </Card>
          </>
        )}
      </Band>

      {triage && <Triage entry={triage} onClose={() => setTriage(null)} />}
    </Page>
  );
}

function Count({
  icon: Icon,
  tone,
  value,
  label,
  index,
}: {
  icon: typeof XCircle;
  tone: string;
  value: number;
  label: string;
  index: number;
}) {
  return (
    <div style={{ "--stagger-index": index } as React.CSSProperties}>
      <Card className="rise flex items-center gap-4 px-5 py-4">
        <Icon aria-hidden size={20} strokeWidth={1.75} className={`shrink-0 ${tone}`} />
        <p className="flex items-baseline gap-2">
          <span className={`font-display text-xl leading-none font-semibold ${tone}`}>{value}</span>
          <span className="text-xs text-faint">{label}</span>
        </p>
      </Card>
    </div>
  );
}

// -- разбор нераспарсенного jar ---------------------------------------------

interface Dep {
  mod_id: string;
  type: string;
  version_range: string;
}

/** `"Axiom-5.4.2-for-MC1.21.1.jar: no META-INF/..."` -> имя файла. */
function filenameOf(entry: Unparsed): string {
  const head = entry.reason.split(":")[0]?.trim() ?? "";
  return head.toLowerCase().endsWith(".jar") ? head : entry.slug;
}

/** Имя файла почти всегда начинается с modId, а версия идёт сразу за дефисом. */
const guessModId = (filename: string) => (filename.match(/^[A-Za-z_]\w*/)?.[0] ?? "").toLowerCase();
const guessVersion = (filename: string) => filename.match(/[-_](\d+(?:\.\d+)+)/)?.[1] ?? "";

const q = (value: string) => JSON.stringify(value);
const tomlKey = (slug: string) => (/^[A-Za-z0-9_-]+$/.test(slug) ? slug : q(slug));

function buildToml(slug: string, modIds: string, version: string, name: string, deps: Dep[]) {
  const ids = modIds
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const lines = [`[overrides.${tomlKey(slug)}]`];
  if (ids.length) lines.push(`mod_ids = [${ids.map(q).join(", ")}]`);
  if (version.trim()) lines.push(`version = ${q(version.trim())}`);
  if (name.trim()) lines.push(`name = ${q(name.trim())}`);
  for (const dep of deps) {
    if (!dep.mod_id.trim()) continue;
    lines.push(
      "",
      `[[overrides.${tomlKey(slug)}.dependencies]]`,
      `mod_id = ${q(dep.mod_id.trim())}`,
      `type = ${q(dep.type)}`,
      `version_range = ${q(dep.version_range.trim())}`,
    );
  }
  return lines.join("\n") + "\n";
}

const INPUT = "w-full min-w-0 font-mono";

function Triage({ entry, onClose }: { entry: Unparsed; onClose: () => void }) {
  const filename = filenameOf(entry);
  const [modIds, setModIds] = useState(() => guessModId(filename) || entry.slug);
  const [version, setVersion] = useState(() => guessVersion(filename));
  const [name, setName] = useState("");
  const [deps, setDeps] = useState<Dep[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toml = buildToml(entry.slug, modIds, version, name, deps);
  const patch = (index: number, part: Partial<Dep>) =>
    setDeps((current) => current.map((d, i) => (i === index ? { ...d, ...part } : d)));

  const copy = () => {
    void navigator.clipboard.writeText(toml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-center justify-center bg-canvas/75 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`разбор ${entry.slug}`}
        className="modal max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-edge-strong bg-surface shadow-[var(--shadow-e4)]"
      >
        <header className="flex items-center gap-3 border-b border-edge px-5 py-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-raised text-warn ring-1 ring-edge ring-inset">
            <TriangleAlert aria-hidden size={16} strokeWidth={1.75} />
          </span>
          <h2 className="text-md font-semibold text-ink">Разбор вручную</h2>
          <code className="min-w-0 truncate text-2xs text-faint">{entry.slug}</code>
          <button
            type="button"
            aria-label="закрыть"
            className="ml-auto grid size-7 shrink-0 cursor-pointer place-items-center rounded-xs text-faint transition-colors duration-[var(--dur)] hover:bg-raised hover:text-ink"
            onClick={onClose}
          >
            <X aria-hidden size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4 text-xs">
          <p className="text-faint">
            В jar нет <code>neoforge.mods.toml</code>, поэтому анализатору неизвестны ни modId, ни
            версия, ни зависимости — мод выпадает из графа целиком. Ниже собирается блок для{" "}
            <code>analyzer/overrides.toml</code>: оттуда он подмешивается в граф на следующем
            прогоне.
          </p>
          <p className="rounded-sm border border-edge bg-canvas/60 px-3 py-2 font-mono text-2xs text-muted">
            {entry.reason}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="block text-2xs text-faint">modId через запятую</span>
              <Input className={INPUT} value={modIds} onChange={(e) => setModIds(e.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-2xs text-faint">версия</span>
              <Input
                className={INPUT}
                value={version}
                placeholder="1.2.3"
                onChange={(e) => setVersion(e.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-2xs text-faint">имя (необязательно)</span>
              <Input
                className={INPUT}
                value={name}
                placeholder={entry.slug}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="text-2xs text-faint">зависимости</span>
              <Button
                icon={Plus}
                onClick={() =>
                  setDeps((current) => [
                    ...current,
                    { mod_id: "", type: "required", version_range: "" },
                  ])
                }
              >
                добавить
              </Button>
            </div>
            {deps.map((dep, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className={INPUT}
                  value={dep.mod_id}
                  placeholder="modId"
                  onChange={(e) => patch(index, { mod_id: e.target.value })}
                />
                <Select value={dep.type} onChange={(e) => patch(index, { type: e.target.value })}>
                  <option value="required">required</option>
                  <option value="optional">optional</option>
                  <option value="incompatible">incompatible</option>
                  <option value="discouraged">discouraged</option>
                </Select>
                <Input
                  className={INPUT}
                  value={dep.version_range}
                  placeholder="[1.21,)"
                  onChange={(e) => patch(index, { version_range: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="убрать зависимость"
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-xs text-faint transition-colors duration-[var(--dur)] hover:bg-raised hover:text-danger"
                  onClick={() => setDeps((current) => current.filter((_, i) => i !== index))}
                >
                  <X aria-hidden size={13} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <span className="block text-2xs text-faint">analyzer/overrides.toml</span>
            <pre className="overflow-auto rounded-sm bg-canvas p-3 font-mono text-2xs text-muted">
              {toml}
            </pre>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge px-5 py-4">
          <a
            className="mr-auto inline-flex items-center gap-1.5 text-xs text-accent transition-colors duration-[var(--dur)] hover:text-accent-strong"
            href={OVERRIDES_URL}
            target="_blank"
            rel="noreferrer"
          >
            открыть overrides.toml на GitHub
            <SquareArrowOutUpRight aria-hidden size={12} strokeWidth={2} />
          </a>
          <Button onClick={onClose}>закрыть</Button>
          <Button tone="primary" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? "скопировано" : "скопировать блок"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
