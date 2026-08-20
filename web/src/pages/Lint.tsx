import { useMemo, useState } from "react";

import { Empty, Loading, Panel, Select, Tag } from "../components/ui";
import { usePrivate, useSession } from "../lib/data";
import type { LintFinding } from "../lib/types";

const TONE: Record<LintFinding["level"], "red" | "amber" | "zinc"> = {
  error: "red",
  warning: "amber",
  info: "zinc",
};

export default function Lint() {
  const privateData = usePrivate();
  const session = useSession();
  const [level, setLevel] = useState("");
  const [code, setCode] = useState("");

  const findings = privateData.data?.lint ?? [];
  const codes = useMemo(() => [...new Set(findings.map((f) => f.code))].sort(), [findings]);
  const rows = findings.filter((f) => (!level || f.level === level) && (!code || f.code === code));

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="отчёт линтера" />;
  if (!privateData.data) return <Empty>private.json недоступен</Empty>;

  const counts = {
    error: findings.filter((f) => f.level === "error").length,
    warning: findings.filter((f) => f.level === "warning").length,
    info: findings.filter((f) => f.level === "info").length,
  };

  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            что не так с паком прямо сейчас
            <Tag tone="red">{counts.error} ошибок</Tag>
            <Tag tone="amber">{counts.warning} предупреждений</Tag>
            <Tag>{counts.info} заметок</Tag>
          </span>
        }
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
        {rows.length === 0 ? (
          <Empty>чисто</Empty>
        ) : (
          <ul className="space-y-1 text-xs">
            {rows.map((finding, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-2">
                <Tag tone={TONE[finding.level]}>{finding.code}</Tag>
                <span className="font-mono text-zinc-400">{finding.slug}</span>
                <span className="text-zinc-300">{finding.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`не разобрано · ${privateData.data.unparsed.length}`}>
        {privateData.data.unparsed.length === 0 ? (
          <Empty>всё разобралось</Empty>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-zinc-500">
              Спорное переносится в <code>analyzer/overrides.toml</code> — оттуда оно подмешивается
              в граф вручную.
            </p>
            <ul className="space-y-1 text-xs">
              {privateData.data.unparsed.map((entry) => (
                <li key={entry.slug} className="flex flex-wrap items-baseline gap-2">
                  <Tag tone={entry.level === "failed" ? "red" : "amber"}>{entry.level}</Tag>
                  <span className="font-mono text-zinc-400">{entry.slug}</span>
                  <span className="text-zinc-500">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {privateData.data.platform.length > 0 && (
        <Panel title="платформа не устраивает моды">
          <ul className="space-y-1 text-xs">
            {privateData.data.platform.map((entry, index) => (
              <li key={index} className="text-red-300">
                <span className="font-mono">{entry.slug}</span> требует {entry.mod_id}{" "}
                {entry.version_range}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
