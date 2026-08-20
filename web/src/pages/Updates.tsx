import { ArrowRight, CircleCheck, Download, Lock } from "lucide-react";

import { useRunner } from "../components/OpRunner";
import {
  Band,
  Button,
  Card,
  Empty,
  Loading,
  ModIcon,
  Page,
  PageTitle,
  Tag,
  Th,
  day,
  plural,
} from "../components/ui";
import { usePrivate, usePublic, useSession } from "../lib/data";
import type { Mod, Update } from "../lib/types";

export default function Updates() {
  const privateData = usePrivate();
  const publicData = usePublic();
  const session = useSession();
  const runner = useRunner();

  if (!session.data) return <Empty icon={Lock}>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="обновления" />;
  if (!privateData.data) return <Empty icon={Download}>private.json недоступен</Empty>;

  const { updates, update_sets: sets } = privateData.data;
  const mods = new Map((publicData.data?.mods ?? []).map((m) => [m.slug, m]));
  const inSets = new Set(sets.flatMap((s) => s.members));
  const loose = updates.filter((u) => !inSets.has(u.slug));

  return (
    <Page>
      <PageTitle
        icon={Download}
        count={
          updates.length
            ? `${updates.length} ${plural(updates.length, "кандидат", "кандидата", "кандидатов")}`
            : "нечего обновлять"
        }
      >
        обновления
      </PageTitle>

      {updates.length === 0 && (
        <Card glow className="flex items-center gap-3 px-5 py-5">
          <CircleCheck aria-hidden size={20} strokeWidth={1.75} className="text-accent" />
          <p className="text-sm text-ink">Все моды на последних версиях.</p>
        </Card>
      )}

      {sets.map((set) => {
        const members = updates.filter((u) => set.members.includes(u.slug));
        const ready = set.status === "available";
        return (
          <Band
            key={set.id}
            count={`${set.members.length} ${plural(set.members.length, "мод", "мода", "модов")}`}
            title={
              <span className="flex flex-wrap items-center gap-2.5">
                набор «{set.id}»
                <Tag tone={ready ? "accent" : "warn"}>
                  {ready ? "можно обновить целиком" : "набор неполный"}
                </Tag>
              </span>
            }
            actions={
              <Button
                tone="primary"
                icon={Download}
                disabled={!ready}
                title={
                  ready ? undefined : `ещё не вышли под новую версию: ${set.missing.join(", ")}`
                }
                onClick={() =>
                  runner.propose(
                    { op: "update-set", set_id: set.id },
                    <p className="text-muted">
                      Будут обновлены {set.members.length} мод(ов) одной операцией; side и флейворы
                      каждого сохраняются.
                    </p>,
                  )
                }
              >
                обновить набор
              </Button>
            }
          >
            {set.missing.length > 0 && (
              <p className="text-xs text-warn">
                ждём релиза: {set.missing.map((s) => mods.get(s)?.name ?? s).join(", ")}
              </p>
            )}
            <UpdateTable rows={members} mods={mods} />
          </Band>
        );
      })}

      <Band title="одиночные обновления" count={loose.length}>
        {loose.length === 0 ? (
          <Empty icon={CircleCheck}>нет</Empty>
        ) : (
          <UpdateTable rows={loose} mods={mods} />
        )}
      </Band>
    </Page>
  );
}

function UpdateTable({ rows, mods }: { rows: Update[]; mods: Map<string, Mod> }) {
  const runner = useRunner();
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[940px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-edge-strong">
            <Th className="w-[320px]">мод</Th>
            <Th className="w-[240px]">версия</Th>
            <Th className="w-[116px]">вышел</Th>
            <Th className="w-[136px]" />
            <Th>почему нельзя</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((update, i) => {
            const mod = mods.get(update.slug);
            return (
              <tr
                key={update.slug}
                style={{ "--stagger-index": i } as React.CSSProperties}
                className="rise h-14 transition-colors duration-[var(--dur-fast)] hover:bg-raised/45 [&>td]:rule"
              >
                <td className="px-3">
                  <div className="flex items-center gap-2.5">
                    <ModIcon
                      slug={update.slug}
                      projectId={mod?.project_id}
                      source={mod?.source}
                      size={26}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{mod?.name ?? update.slug}</p>
                      <p className="truncate font-mono text-2xs text-faint">{update.slug}</p>
                    </div>
                  </div>
                </td>
                {/* Обе версии в одной ячейке: «было → стало» читается как одно
                    утверждение, а разнесённое по колонкам — как два числа. */}
                <td className="px-3">
                  <span className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-faint">{update.current_version ?? "—"}</span>
                    <ArrowRight aria-hidden size={12} strokeWidth={2} className="text-edge-strong" />
                    <span className="text-accent">{update.candidate_version}</span>
                  </span>
                </td>
                <td className="px-3 font-mono text-xs text-faint">{day(update.published_at)}</td>
                <td className="px-3">
                  <Button
                    icon={update.status === "blocked" ? Lock : Download}
                    disabled={update.status === "blocked"}
                    onClick={() =>
                      runner.propose(
                        { op: "update-mod", targets: [update.slug] },
                        <p className="text-muted">
                          {update.slug}: {update.current_version} → {update.candidate_version}. side
                          и флейворы сохраняются.
                        </p>,
                      )
                    }
                  >
                    обновить
                  </Button>
                </td>
                <td className="px-3 text-2xs text-warn">
                  {update.blocked_by.map((b) => `${b.slug} требует ${b.version_range}`).join("; ") ||
                    "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
