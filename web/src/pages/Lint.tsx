import {
  ArrowRight,
  CircleCheck,
  CircleHelp,
  Lock,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  Band,
  Card,
  Empty,
  Loading,
  Page,
  PageTitle,
  Select,
  Tag,
  plural,
} from "../components/ui";
import { usePrivate, useSession } from "../lib/data";
import type { LintFinding } from "../lib/types";

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

  const findings = privateData.data?.lint ?? [];
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
              const fix = fixFor(finding.slug, finding.code);
              return (
                <Link
                  key={index}
                  to={fix.to}
                  title={`открыть: ${fix.where}`}
                  style={{ "--stagger-index": Math.min(index, 18) } as React.CSSProperties}
                  className={`rise group ${ROW}`}
                >
                  <span>
                    <Tag tone={TONE[finding.level]}>{finding.code}</Tag>
                  </span>
                  <span className="truncate font-mono text-xs text-faint" title={finding.slug}>
                    {finding.slug}
                  </span>
                  <span className="text-xs text-muted">{finding.message}</span>
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
                <Link
                  key={entry.slug}
                  to={`/mods?q=${encodeURIComponent(entry.slug)}`}
                  title="открыть: моды"
                  className={`group ${ROW}`}
                >
                  <span>
                    <Tag tone={entry.level === "failed" ? "danger" : "warn"}>{entry.level}</Tag>
                  </span>
                  <span className="truncate font-mono text-xs text-muted" title={entry.slug}>
                    {entry.slug}
                  </span>
                  <span className="text-xs text-faint">{entry.reason}</span>
                  <Goto where="моды" />
                </Link>
              ))}
            </Card>
          </>
        )}
      </Band>
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
