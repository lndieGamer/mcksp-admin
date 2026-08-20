import { useMemo, useState } from "react";

import { useRunner } from "../components/OpRunner";
import { Button, Empty, Loading, Panel, Tag, bytes } from "../components/ui";
import { indexOf, usePublic, useSession } from "../lib/data";
import type { Mod } from "../lib/types";

export default function Flavors() {
  const publicData = usePublic();
  const session = useSession();
  const runner = useRunner();
  const admin = Boolean(session.data);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);

  const index = useMemo(() => (publicData.data ? indexOf(publicData.data) : null), [publicData.data]);

  const mods = useMemo(
    () => (publicData.data?.mods ?? []).filter((m) => !m.embedded),
    [publicData.data],
  );
  const allChoices = useMemo(
    () => (publicData.data?.flavor_groups ?? []).flatMap((g) => g.choices.map((c) => c.id)),
    [publicData.data],
  );

  /** A mod escapes its group when a hard dependency lives behind a different checkbox. */
  const escapes = useMemo(() => {
    if (!publicData.data || !index) return [];
    const out: { from: Mod; to: Mod }[] = [];
    for (const edge of publicData.data.edges) {
      if (edge.type !== "required" || !edge.to) continue;
      const from = index.bySlug.get(edge.from);
      const to = index.bySlug.get(edge.to);
      if (!from || !to || to.embedded) continue;
      if (from.flavors.length === 0 || to.flavors.length === 0) continue;
      if (!from.flavors.some((f) => to.flavors.includes(f))) out.push({ from, to });
    }
    return out;
  }, [publicData.data, index]);

  if (publicData.isLoading) return <Loading what="флейворы" />;
  if (!publicData.data) return <Empty>данные ещё не опубликованы</Empty>;

  const ungrouped = mods.filter((m) => m.flavors.length === 0);
  const optional = mods.filter((m) => m.flavors.length > 0);

  const startEdit = (mod: Mod) => {
    setEditing(mod.slug);
    setDraft(mod.flavors);
  };

  const save = (mod: Mod) => {
    runner.propose(
      { op: "set-flavors", targets: [mod.slug], flavors: draft },
      <div className="space-y-1 text-muted">
        <p>
          unsup.toml, блок <code>[metafile.&quot;{mod.slug}&quot;]</code>:
        </p>
        <pre className="rounded bg-canvas p-2 font-mono text-2xs">
          -flavors = [{mod.flavors.map((f) => `"${f}"`).join(", ")}]{"\n"}+
          {draft.length ? `flavors = [${draft.map((f) => `"${f}"`).join(", ")}]` : "(запись удаляется)"}
        </pre>
        <p className="text-faint">Счётчики в названиях галочек пересчитаются автоматически.</p>
      </div>,
    );
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      {escapes.length > 0 && (
        <Panel title="зависимости уходят за пределы группы">
          <p className="mb-2 text-2xs text-faint">
            У unsup нет зависимостей между группами: библиотека ставится, если включён хотя бы один
            её потребитель (семантика ИЛИ). Здесь потребитель и его обязательная зависимость не
            делят ни одной галочки — при отключении группы пак сломается.
          </p>
          <ul className="space-y-1 text-xs">
            {escapes.map(({ from, to }, index) => (
              <li key={index} className="text-warn">
                <span className="font-mono">{from.slug}</span> [{from.flavors.join(", ")}] требует{" "}
                <span className="font-mono">{to.slug}</span> [{to.flavors.join(", ")}]
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`группы · ${publicData.data.flavor_groups.length}`}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {publicData.data.flavor_groups.map((group) => (
            <div key={group.id} className="rounded border border-edge p-3">
              <h3 className="text-xs font-medium text-ink">{group.name}</h3>
              <p className="mt-0.5 text-2xs text-faint">{group.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.choices.map((choice) => (
                  <Tag key={choice.id} tone={choice.mod_count > 0 ? "accent" : "neutral"}>
                    {choice.name} · {choice.mod_count}
                  </Tag>
                ))}
              </div>
              <ul className="mt-2 space-y-0.5 text-2xs text-faint">
                {mods
                  .filter((m) => m.flavors.some((f) => group.choices.some((c) => c.id === f)))
                  .map((m) => (
                    <li key={m.slug} className="font-mono">
                      {m.slug}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`матрица «мод × флейвор» · ${optional.length} необязательных`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-b border-edge text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">мод</th>
                <th className="px-2 py-1.5 text-left font-medium">галочки (ИЛИ)</th>
                <th className="px-2 py-1.5 text-right font-medium">размер</th>
                {admin && <th className="w-px px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {optional.map((mod) => (
                <tr key={mod.slug} className="border-b border-edge/50 align-top">
                  <td className="px-2 py-1.5">
                    <span className="text-ink">{mod.name}</span>
                    <br />
                    <span className="font-mono text-2xs text-faint">{mod.slug}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {editing === mod.slug ? (
                      <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-auto">
                        {allChoices.map((choice) => (
                          <label key={choice} className="flex items-center gap-1 text-2xs">
                            <input
                              type="checkbox"
                              checked={draft.includes(choice)}
                              onChange={(e) =>
                                setDraft((current) =>
                                  e.target.checked
                                    ? [...current, choice]
                                    : current.filter((c) => c !== choice),
                                )
                              }
                            />
                            <span className="font-mono text-muted">{choice}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-muted">{mod.flavors.join(", ")}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-faint">{bytes(mod.size_bytes)}</td>
                  {admin && (
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {editing === mod.slug ? (
                        <div className="flex gap-1.5">
                          <Button tone="primary" onClick={() => save(mod)}>
                            сохранить
                          </Button>
                          <Button onClick={() => setEditing(null)}>отмена</Button>
                        </div>
                      ) : (
                        <Button onClick={() => startEdit(mod)}>править</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`вне групп · ${ungrouped.length} — ставятся всегда`}>
        <div className="flex flex-wrap gap-1.5 text-2xs">
          {ungrouped.map((mod) => (
            <span key={mod.slug} className="rounded bg-canvas px-1.5 py-0.5 font-mono text-faint">
              {mod.slug}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
