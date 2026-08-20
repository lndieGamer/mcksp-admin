import { CircleCheck, CircleHelp, Lock, ShieldAlert, TriangleAlert, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

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
            {rows.map((finding, index) => (
              <div
                key={index}
                style={{ "--stagger-index": Math.min(index, 18) } as React.CSSProperties}
                className="rise grid grid-cols-[190px_250px_minmax(0,1fr)] items-baseline gap-x-4 px-4 py-2.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-raised/45"
              >
                <span>
                  <Tag tone={TONE[finding.level]}>{finding.code}</Tag>
                </span>
                <span className="truncate font-mono text-xs text-faint" title={finding.slug}>
                  {finding.slug}
                </span>
                <span className="text-xs text-muted">{finding.message}</span>
              </div>
            ))}
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
                <div
                  key={entry.slug}
                  className="grid grid-cols-[190px_250px_minmax(0,1fr)] items-baseline gap-x-4 px-4 py-2.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-raised/45"
                >
                  <span>
                    <Tag tone={entry.level === "failed" ? "danger" : "warn"}>{entry.level}</Tag>
                  </span>
                  <span className="truncate font-mono text-xs text-muted" title={entry.slug}>
                    {entry.slug}
                  </span>
                  <span className="text-xs text-faint">{entry.reason}</span>
                </div>
              ))}
            </Card>
          </>
        )}
      </Band>

      {privateData.data.platform.length > 0 && (
        <Band title="платформа не устраивает моды">
          <Card className="divide-y divide-edge/60 overflow-hidden">
            {privateData.data.platform.map((entry, index) => (
              <p key={index} className="px-4 py-2.5 text-xs text-danger">
                <span className="font-mono">{entry.slug}</span> требует {entry.mod_id}{" "}
                <span className="font-mono">{entry.version_range}</span>
              </p>
            ))}
          </Card>
        </Band>
      )}
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
