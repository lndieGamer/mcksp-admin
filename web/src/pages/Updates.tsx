import { useRunner } from "../components/OpRunner";
import {
  Band,
  Button,
  Empty,
  Loading,
  Page,
  PageTitle,
  Tag,
  Th,
  day,
  plural,
} from "../components/ui";
import { usePrivate, usePublic, useSession } from "../lib/data";

export default function Updates() {
  const privateData = usePrivate();
  const publicData = usePublic();
  const session = useSession();
  const runner = useRunner();

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="обновления" />;
  if (!privateData.data) return <Empty>private.json недоступен</Empty>;

  const { updates, update_sets: sets } = privateData.data;
  const names = new Map((publicData.data?.mods ?? []).map((m) => [m.slug, m.name]));
  const inSets = new Set(sets.flatMap((s) => s.members));
  const loose = updates.filter((u) => !inSets.has(u.slug));

  return (
    <Page>
      <PageTitle count={
          updates.length
            ? `${updates.length} ${plural(updates.length, "кандидат", "кандидата", "кандидатов")}`
            : "нечего обновлять"
        }>
        обновления
      </PageTitle>

      {sets.map((set) => {
        const members = updates.filter((u) => set.members.includes(u.slug));
        const ready = set.status === "available";
        return (
          <Band
            key={set.id}
            count={`${set.members.length} ${plural(set.members.length, "мод", "мода", "модов")}`}
            title={
              <span className="flex flex-wrap items-baseline gap-2">
                набор «{set.id}»
                <Tag tone={ready ? "accent" : "warn"}>
                  {ready ? "можно обновить целиком" : "набор неполный"}
                </Tag>
              </span>
            }
            actions={
              <Button
                tone="primary"
                disabled={!ready}
                title={ready ? undefined : `ещё не вышли под новую версию: ${set.missing.join(", ")}`}
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
                ждём релиза: {set.missing.map((s) => names.get(s) ?? s).join(", ")}
              </p>
            )}
            <UpdateTable rows={members} names={names} />
          </Band>
        );
      })}

      <Band title="одиночные обновления" count={loose.length}>
        {loose.length === 0 ? <Empty>нет</Empty> : <UpdateTable rows={loose} names={names} />}
      </Band>
    </Page>
  );
}

function UpdateTable({
  rows,
  names,
}: {
  rows: import("../lib/types").Update[];
  names: Map<string, string>;
}) {
  const runner = useRunner();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-edge-strong">
            <Th className="w-[320px]">мод</Th>
            <Th className="w-[132px]">сейчас</Th>
            <Th className="w-[148px]">кандидат</Th>
            <Th className="w-[108px]">вышел</Th>
            <Th className="w-[112px]" />
            <Th>почему нельзя</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((update) => (
            <tr key={update.slug} className="h-9 hover:bg-raised/45 [&>td]:rule">
              <td className="px-2 text-base text-ink">{names.get(update.slug) ?? update.slug}</td>
              <td className="px-2 font-mono text-faint">{update.current_version ?? "—"}</td>
              <td className="px-2 font-mono text-accent">
                <span aria-hidden>▲ </span>
                {update.candidate_version}
              </td>
              <td className="px-2 font-mono text-faint">{day(update.published_at)}</td>
              <td className="px-2">
                <Button
                  disabled={update.status === "blocked"}
                  onClick={() =>
                    runner.propose(
                      { op: "update-mod", targets: [update.slug] },
                      <p className="text-muted">
                        {update.slug}: {update.current_version} → {update.candidate_version}. side и
                        флейворы сохраняются.
                      </p>,
                    )
                  }
                >
                  обновить
                </Button>
              </td>
              <td className="px-2 text-xs text-warn">
                {update.blocked_by.map((b) => `${b.slug} требует ${b.version_range}`).join("; ") ||
                  "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
