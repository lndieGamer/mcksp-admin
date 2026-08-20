import { useMemo, useState } from "react";

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
  bytes,
  plural,
} from "../components/ui";
import { indexOf, usePublic, useSession } from "../lib/data";
import type { Mod } from "../lib/types";

export default function Flavors() {
  const publicData = usePublic();
  const session = useSession();
  const runner = useRunner();
  const admin = Boolean(session.data);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);

  const index = useMemo(
    () => (publicData.data ? indexOf(publicData.data) : null),
    [publicData.data],
  );

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
        <pre className="rounded-sm bg-canvas p-2 font-mono text-2xs">
          -flavors = [{mod.flavors.map((f) => `"${f}"`).join(", ")}]{"\n"}+
          {draft.length
            ? `flavors = [${draft.map((f) => `"${f}"`).join(", ")}]`
            : "(запись удаляется)"}
        </pre>
        <p className="text-faint">Счётчики в названиях галочек пересчитаются автоматически.</p>
      </div>,
    );
    setEditing(null);
  };

  return (
    <Page>
      <PageTitle
        count={`${publicData.data.flavor_groups.length} ${plural(
          publicData.data.flavor_groups.length,
          "группа",
          "группы",
          "групп",
        )} · ${optional.length} необязательных`}
      >
        флейворы
      </PageTitle>

      {escapes.length > 0 && (
        <Band title="зависимости уходят за пределы группы">
          <p className="max-w-[70ch] text-xs text-faint">
            У unsup нет зависимостей между группами: библиотека ставится, если включён хотя бы один
            её потребитель (семантика ИЛИ). Здесь потребитель и его обязательная зависимость не
            делят ни одной галочки — при отключении группы пак сломается.
          </p>
          <ul>
            {escapes.map(({ from, to }, index) => (
              <li key={index} className="rule py-1.5 text-sm text-warn">
                <span className="font-mono text-xs">{from.slug}</span>{" "}
                <span className="text-faint">[{from.flavors.join(", ")}]</span> требует{" "}
                <span className="font-mono text-xs">{to.slug}</span>{" "}
                <span className="text-faint">[{to.flavors.join(", ")}]</span>
              </li>
            ))}
          </ul>
        </Band>
      )}

      <Band title="группы">
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
          {publicData.data.flavor_groups.map((group) => (
            <section key={group.id} className="border-t border-edge pt-2.5">
              <h3 className="text-base font-medium text-ink">{group.name}</h3>
              <p className="mt-0.5 max-w-[52ch] text-xs text-faint">{group.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.choices.map((choice) => (
                  <Tag key={choice.id} tone={choice.mod_count > 0 ? "accent" : "neutral"}>
                    {choice.name} · {choice.mod_count}
                  </Tag>
                ))}
              </div>
              <ul className="mt-2 space-y-0.5 font-mono text-xs text-faint">
                {mods
                  .filter((m) => m.flavors.some((f) => group.choices.some((c) => c.id === f)))
                  .map((m) => (
                    <li key={m.slug}>{m.slug}</li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </Band>

      <Band title="матрица «мод × флейвор»" count={optional.length}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-edge-strong">
                <Th className="w-[280px]">мод</Th>
                <Th>галочки (ИЛИ)</Th>
                <Th align="right" className="w-[88px]">
                  размер
                </Th>
                {admin && <Th className="w-[150px]" />}
              </tr>
            </thead>
            <tbody>
              {optional.map((mod) => (
                <tr key={mod.slug} className="align-top hover:bg-raised/45 [&>td]:rule">
                  <td className="px-2 py-1.5">
                    <span className="text-base text-ink">{mod.name}</span>
                    <br />
                    <span className="font-mono text-xs text-faint">{mod.slug}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {editing === mod.slug ? (
                      <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-auto">
                        {allChoices.map((choice) => (
                          <label key={choice} className="flex items-center gap-1 text-xs">
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
                      <span className="font-mono text-xs text-muted">{mod.flavors.join(", ")}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-faint">
                    {bytes(mod.size_bytes)}
                  </td>
                  {admin && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {editing === mod.slug ? (
                        <div className="flex justify-end gap-1.5">
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
      </Band>

      <Band title="вне групп" count={`${ungrouped.length} — ставятся всегда`}>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-faint">
          {ungrouped.map((mod) => (
            <span key={mod.slug}>{mod.slug}</span>
          ))}
        </div>
      </Band>
    </Page>
  );
}
