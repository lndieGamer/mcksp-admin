import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import { Button, Empty, Input, Loading, Panel, Pill, Select, bytes, day } from "../components/ui";
import { usePrivate, usePublic, useSession } from "../lib/data";
import type { Mod, Side } from "../lib/types";

type SortKey = "name" | "slug" | "source" | "side" | "version" | "date_added" | "date_updated" | "status" | "size_bytes";

const SOURCE_LABEL: Record<Mod["source"], string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  url: "URL",
};

export default function Mods() {
  const publicData = usePublic();
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();
  const admin = Boolean(session.data);

  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [side, setSide] = useState("");
  const [flavor, setFlavor] = useState("");
  const [status, setStatus] = useState("");
  const [frozenOnly, setFrozenOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mods = useMemo(
    () => (publicData.data?.mods ?? []).filter((mod) => !mod.embedded),
    [publicData.data],
  );

  const flavorIds = useMemo(() => {
    const all = new Set<string>();
    for (const mod of mods) for (const id of mod.flavors) all.add(id);
    return [...all].sort();
  }, [mods]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = mods.filter((mod) => {
      if (needle && !`${mod.name} ${mod.slug} ${mod.mod_ids.join(" ")}`.toLowerCase().includes(needle))
        return false;
      if (source && mod.source !== source) return false;
      if (side && mod.side !== side) return false;
      if (flavor && !mod.flavors.includes(flavor)) return false;
      if (status && mod.status !== status) return false;
      if (frozenOnly && mod.source !== "url") return false;
      return true;
    });
    const direction = descending ? -1 : 1;
    return filtered.sort((a, b) => {
      const left = a[sort] ?? "";
      const right = b[sort] ?? "";
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), "ru") * direction;
    });
  }, [mods, query, source, side, flavor, status, frozenOnly, sort, descending]);

  const updates = useMemo(
    () => new Map((privateData.data?.updates ?? []).map((u) => [u.slug, u])),
    [privateData.data],
  );

  const toggle = (slug: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  const header = (key: SortKey, label: string, className = "") => (
    <th
      className={`cursor-pointer select-none px-2 py-1.5 text-left font-medium text-zinc-400 hover:text-zinc-200 ${className}`}
      onClick={() => {
        if (sort === key) setDescending((d) => !d);
        else {
          setSort(key);
          setDescending(false);
        }
      }}
    >
      {label}
      {sort === key && <span className="ml-1 text-zinc-600">{descending ? "▼" : "▲"}</span>}
    </th>
  );

  const bulkSide = (value: Side) => {
    const targets = [...selected];
    runner.propose(
      { op: "set-side", targets, value },
      <div className="space-y-2">
        <p className="text-zinc-300">
          В {targets.length} метафайл(ах) строка <code>side</code> станет{" "}
          <code>side = &quot;{value}&quot;</code>:
        </p>
        <ul className="max-h-52 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-400">
          {targets.map((slug) => (
            <li key={slug}>
              mods/{slug}.pw.toml — было {mods.find((m) => m.slug === slug)?.side} → {value}
            </li>
          ))}
        </ul>
      </div>,
    );
  };

  if (publicData.isLoading) return <Loading what="список модов" />;
  if (!publicData.data) return <Empty>данные ещё не опубликованы</Empty>;

  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Input
            placeholder="поиск по имени, slug, modId"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64"
          />
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">источник: любой</option>
            <option value="modrinth">Modrinth</option>
            <option value="curseforge">CurseForge</option>
            <option value="url">URL</option>
          </Select>
          <Select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="">side: любой</option>
            <option value="both">both</option>
            <option value="client">client</option>
            <option value="server">server</option>
          </Select>
          <Select value={flavor} onChange={(e) => setFlavor(e.target.value)}>
            <option value="">флейвор: любой</option>
            {flavorIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">статус: любой</option>
            <option value="current">актуален</option>
            <option value="update_safe">есть обновление</option>
            <option value="update_blocked">заблокировано</option>
            <option value="broken">сломан</option>
            <option value="frozen">без обновлений</option>
            <option value="unknown">не разобран</option>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={frozenOnly}
              onChange={(e) => setFrozenOnly(e.target.checked)}
            />
            без [update]
          </label>
          <span className="ml-auto text-xs text-zinc-500">
            {rows.length} из {mods.length}
          </span>
        </div>

        {admin && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[--color-edge] bg-black/20 px-3 py-2">
            <span className="text-xs text-zinc-400">выбрано {selected.size}:</span>
            <Button onClick={() => bulkSide("both")}>side → both</Button>
            <Button onClick={() => bulkSide("client")}>side → client</Button>
            <Button onClick={() => bulkSide("server")}>side → server</Button>
            <Button
              tone="danger"
              onClick={() =>
                runner.propose(
                  { op: "remove-mod", targets: [...selected] },
                  <p className="text-zinc-300">
                    Будут удалены метафайлы и записи в unsup.toml: {[...selected].join(", ")}
                  </p>,
                )
              }
            >
              удалить
            </Button>
            <Button onClick={() => setSelected(new Set())}>снять выделение</Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="border-y border-[--color-edge] bg-black/20">
              <tr>
                {admin && <th className="w-8 px-2 py-1.5" />}
                {header("name", "мод")}
                {header("slug", "slug")}
                {header("source", "источник")}
                {header("side", "side")}
                <th className="px-2 py-1.5 text-left font-medium text-zinc-400">флейворы</th>
                {header("version", "версия")}
                {header("size_bytes", "размер", "text-right")}
                {header("date_added", "добавлен")}
                {header("date_updated", "изменён")}
                {header("status", "статус")}
              </tr>
            </thead>
            <tbody>
              {rows.map((mod) => {
                const update = updates.get(mod.slug);
                return (
                  <tr key={mod.slug} className="border-b border-[--color-edge]/50 hover:bg-white/[0.02]">
                    {admin && (
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(mod.slug)}
                          onChange={() => toggle(mod.slug)}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <Link className="text-zinc-100 hover:text-sky-300" to={`/graph?focus=${mod.slug}`}>
                        {mod.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-zinc-500">{mod.slug}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{SOURCE_LABEL[mod.source]}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{mod.side}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-zinc-500" title={mod.flavors.join(", ")}>
                      {mod.flavors.join(", ") || "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-zinc-300">
                      {mod.version ?? "—"}
                      {update && (
                        <span className="ml-1.5 text-sky-400">→ {update.candidate_version}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-zinc-500">{bytes(mod.size_bytes)}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{day(mod.date_added)}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{day(mod.date_updated)}</td>
                    <td className="px-2 py-1.5">
                      <Pill status={mod.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>ничего не подошло под фильтры</Empty>}
        </div>
      </Panel>
    </div>
  );
}
