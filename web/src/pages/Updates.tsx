import { useRunner } from "../components/OpRunner";
import { Button, Empty, Loading, Panel, Tag, day } from "../components/ui";
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
    <div className="space-y-3">
      {sets.map((set) => {
        const members = updates.filter((u) => set.members.includes(u.slug));
        const ready = set.status === "available";
        return (
          <Panel
            key={set.id}
            title={
              <span className="flex items-center gap-2">
                набор «{set.id}» · {set.members.length} модов
                <Tag tone={ready ? "emerald" : "amber"}>
                  {ready ? "можно обновить целиком" : "набор неполный"}
                </Tag>
              </span>
            }
            actions={
              <Button
                tone="primary"
                disabled={!ready}
                title={
                  ready
                    ? undefined
                    : `ещё не вышли под новую версию: ${set.missing.join(", ")}`
                }
                onClick={() =>
                  runner.propose(
                    { op: "update-set", set_id: set.id },
                    <p className="text-zinc-300">
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
              <p className="mb-2 text-xs text-amber-300">
                ждём релиза: {set.missing.map((s) => names.get(s) ?? s).join(", ")}
              </p>
            )}
            <UpdateTable rows={members} names={names} />
          </Panel>
        );
      })}

      <Panel title={`одиночные обновления · ${loose.length}`}>
        {loose.length === 0 ? <Empty>нет</Empty> : <UpdateTable rows={loose} names={names} />}
      </Panel>
    </div>
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
      <table className="w-full min-w-[760px] text-xs">
        <thead className="border-b border-[--color-edge] text-zinc-400">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">мод</th>
            <th className="px-2 py-1.5 text-left font-medium">сейчас</th>
            <th className="px-2 py-1.5 text-left font-medium">кандидат</th>
            <th className="px-2 py-1.5 text-left font-medium">вышел</th>
            <th className="px-2 py-1.5 text-left font-medium">почему нельзя</th>
            <th className="w-px px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((update) => (
            <tr key={update.slug} className="border-b border-[--color-edge]/50">
              <td className="px-2 py-1.5 text-zinc-200">{names.get(update.slug) ?? update.slug}</td>
              <td className="px-2 py-1.5 font-mono text-zinc-500">{update.current_version ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-sky-300">{update.candidate_version}</td>
              <td className="px-2 py-1.5 text-zinc-500">{day(update.published_at)}</td>
              <td className="px-2 py-1.5 text-amber-300">
                {update.blocked_by
                  .map((b) => `${b.slug} требует ${b.version_range}`)
                  .join("; ") || "—"}
              </td>
              <td className="px-2 py-1.5">
                <Button
                  disabled={update.status === "blocked"}
                  onClick={() =>
                    runner.propose(
                      { op: "update-mod", targets: [update.slug] },
                      <p className="text-zinc-300">
                        {update.slug}: {update.current_version} → {update.candidate_version}. side и
                        флейворы сохраняются.
                      </p>,
                    )
                  }
                >
                  обновить
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
