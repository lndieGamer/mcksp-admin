import { Check, Pencil, Sparkles, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

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

  /** Мод сбегает из своей группы, когда его жёсткая зависимость живёт за другой
   *  галочкой. */
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
  if (!publicData.data) return <Empty icon={Sparkles}>данные ещё не опубликованы</Empty>;

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
        icon={Sparkles}
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
        <Card className="space-y-3 border-warn-dim px-5 py-4">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-warn">
            <TriangleAlert aria-hidden size={16} strokeWidth={1.75} />
            зависимости уходят за пределы группы
          </h2>
          <p className="max-w-[74ch] text-xs text-faint">
            У unsup нет зависимостей между группами: библиотека ставится, если включён хотя бы один
            её потребитель (семантика ИЛИ). Здесь потребитель и его обязательная зависимость не
            делят ни одной галочки — при отключении группы пак сломается.
          </p>
          <ul className="divide-y divide-edge/60">
            {escapes.map(({ from, to }, i) => (
              <li key={i} className="py-2 text-xs text-warn">
                <span className="font-mono">{from.slug}</span>{" "}
                <span className="text-faint">[{from.flavors.join(", ")}]</span> требует{" "}
                <span className="font-mono">{to.slug}</span>{" "}
                <span className="text-faint">[{to.flavors.join(", ")}]</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Band title="группы">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {publicData.data.flavor_groups.map((group, i) => {
            const members = mods.filter((m) =>
              m.flavors.some((f) => group.choices.some((c) => c.id === f)),
            );
            return (
              <div key={group.id} style={{ "--stagger-index": i } as React.CSSProperties}>
                <Card interactive className="rise h-full space-y-3 px-5 py-4">
                  <h3 className="text-sm font-semibold text-ink">{group.name}</h3>
                  <p className="max-w-[52ch] text-xs text-faint">{group.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.choices.map((choice) => (
                      <Tag key={choice.id} tone={choice.mod_count > 0 ? "accent" : "neutral"}>
                        {choice.name} · {choice.mod_count}
                      </Tag>
                    ))}
                  </div>
                  {members.length > 0 && (
                    <ul className="space-y-1 border-t border-edge/60 pt-3">
                      {members.map((mod) => (
                        <li key={mod.slug} className="flex items-center gap-2">
                          <ModIcon
                            slug={mod.slug}
                            projectId={mod.project_id}
                            source={mod.source}
                            size={18}
                          />
                          <span className="min-w-0 truncate font-mono text-2xs text-faint">
                            {mod.slug}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </Band>

      <Band title="матрица «мод × флейвор»" count={optional.length}>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-edge-strong">
                <Th className="w-[300px]">мод</Th>
                <Th>галочки (ИЛИ)</Th>
                <Th align="right" className="w-[96px]">
                  размер
                </Th>
                {admin && <Th className="w-[172px]" />}
              </tr>
            </thead>
            <tbody>
              {optional.map((mod) => (
                <tr
                  key={mod.slug}
                  className="align-top transition-colors duration-[var(--dur-fast)] hover:bg-raised/45 [&>td]:rule"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ModIcon
                        slug={mod.slug}
                        projectId={mod.project_id}
                        source={mod.source}
                        size={24}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs text-ink">{mod.name}</p>
                        <p className="truncate font-mono text-2xs text-faint">{mod.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {editing === mod.slug ? (
                      <div className="flex max-h-44 flex-wrap gap-x-4 gap-y-1.5 overflow-auto">
                        {allChoices.map((choice) => (
                          <label
                            key={choice}
                            className="flex cursor-pointer items-center gap-1.5 text-xs"
                          >
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
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-faint">
                    {bytes(mod.size_bytes)}
                  </td>
                  {admin && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {editing === mod.slug ? (
                        <div className="flex justify-end gap-2">
                          <Button tone="primary" icon={Check} onClick={() => save(mod)}>
                            сохранить
                          </Button>
                          <Button icon={X} onClick={() => setEditing(null)}>
                            отмена
                          </Button>
                        </div>
                      ) : (
                        <Button icon={Pencil} onClick={() => startEdit(mod)}>
                          править
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Band>

      <Band title="вне групп" count={`${ungrouped.length} — ставятся всегда`}>
        <div className="flex flex-wrap gap-2">
          {ungrouped.map((mod) => (
            <span
              key={mod.slug}
              className="flex items-center gap-2 rounded-sm border border-edge bg-surface/60 px-2.5 py-1.5"
            >
              <ModIcon slug={mod.slug} projectId={mod.project_id} source={mod.source} size={18} />
              <span className="font-mono text-2xs text-faint">{mod.slug}</span>
            </span>
          ))}
        </div>
      </Band>
    </Page>
  );
}
