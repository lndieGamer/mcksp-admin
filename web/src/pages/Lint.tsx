import { useMemo, useState } from "react";

import { Band, Empty, Loading, Page, PageTitle, Select, Tag, plural } from "../components/ui";
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

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="отчёт линтера" />;
  if (!privateData.data) return <Empty>private.json недоступен</Empty>;

  const counts = {
    error: findings.filter((f) => f.level === "error").length,
    warning: findings.filter((f) => f.level === "warning").length,
    info: findings.filter((f) => f.level === "info").length,
  };

  return (
    <Page>
      <PageTitle
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

      <p className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className={counts.error ? "text-danger" : "text-faint"}>
          <span aria-hidden>✕ </span>
          {counts.error} {plural(counts.error, "ошибка", "ошибки", "ошибок")}
        </span>
        <span className={counts.warning ? "text-warn" : "text-faint"}>
          <span aria-hidden>■ </span>
          {counts.warning}{" "}
          {plural(counts.warning, "предупреждение", "предупреждения", "предупреждений")}
        </span>
        <span className="text-faint">
          <span aria-hidden>◇ </span>
          {counts.info} {plural(counts.info, "заметка", "заметки", "заметок")}
        </span>
      </p>

      <Band title="находки" count={rows.length}>
        {rows.length === 0 ? (
          <Empty>чисто — под текущие фильтры ничего не попало</Empty>
        ) : (
          <ul className="max-w-[1180px]">
            {rows.map((finding, index) => (
              <li
                key={index}
                className="rule grid grid-cols-[170px_230px_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm hover:bg-raised/45"
              >
                <span>
                  <Tag tone={TONE[finding.level]}>{finding.code}</Tag>
                </span>
                <span className="truncate font-mono text-xs text-faint" title={finding.slug}>
                  {finding.slug}
                </span>
                <span className="text-muted">{finding.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Band>

      <Band title="не разобрано" count={privateData.data.unparsed.length}>
        {privateData.data.unparsed.length === 0 ? (
          <Empty>всё разобралось</Empty>
        ) : (
          <>
            <p className="max-w-[70ch] text-xs text-faint">
              Спорное переносится в <code>analyzer/overrides.toml</code> — оттуда оно подмешивается в
              граф вручную.
            </p>
            <ul className="max-w-[1180px]">
              {privateData.data.unparsed.map((entry) => (
                <li
                  key={entry.slug}
                  className="rule grid grid-cols-[170px_230px_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm hover:bg-raised/45"
                >
                  <span>
                    <Tag tone={entry.level === "failed" ? "danger" : "warn"}>{entry.level}</Tag>
                  </span>
                  <span className="truncate font-mono text-xs text-muted" title={entry.slug}>
                    {entry.slug}
                  </span>
                  <span className="text-faint">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Band>

      {privateData.data.platform.length > 0 && (
        <Band title="платформа не устраивает моды">
          <ul>
            {privateData.data.platform.map((entry, index) => (
              <li key={index} className="rule py-1.5 text-sm text-danger">
                <span className="font-mono text-xs">{entry.slug}</span> требует {entry.mod_id}{" "}
                <span className="font-mono text-xs">{entry.version_range}</span>
              </li>
            ))}
          </ul>
        </Band>
      )}
    </Page>
  );
}
