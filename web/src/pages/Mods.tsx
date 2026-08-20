import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Input,
  Loading,
  Panel,
  STATUS_CLASS,
  STATUS_GLYPH,
  STATUS_LABEL,
  Select,
  bytes,
  day,
} from "../components/ui";
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
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      className={`cursor-pointer px-2 py-2 text-left text-xs font-medium text-muted select-none hover:text-ink ${className}`}
      onClick={() => {
        if (sort === key) setDescending((d) => !d);
        else {
          setSort(key);
          setDescending(false);
        }
      }}
    >
      {label}
      {sort === key && <span className="ml-1 text-faint">{descending ? "▼" : "▲"}</span>}
    </th>
  );

  const bulkSide = (value: Side) => {
    const targets = [...selected];
    runner.propose(
      { op: "set-side", targets, value },
      <div className="space-y-2">
        <p className="text-muted">
          В {targets.length} метафайл(ах) строка <code>side</code> станет{" "}
          <code>side = &quot;{value}&quot;</code>:
        </p>
        <ul className="max-h-52 space-y-0.5 overflow-auto font-mono text-2xs text-muted">
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
            ref={search}
            placeholder="поиск по имени, slug, modId    /"
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
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={frozenOnly}
              onChange={(e) => setFrozenOnly(e.target.checked)}
            />
            без [update]
          </label>
          <span className="ml-auto text-xs text-faint">
            {rows.length} из {mods.length}
          </span>
        </div>

        {admin && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-canvas px-3 py-2">
            <span className="text-xs text-muted">выбрано {selected.size}:</span>
            <Button onClick={() => bulkSide("both")}>side → both</Button>
            <Button onClick={() => bulkSide("client")}>side → client</Button>
            <Button onClick={() => bulkSide("server")}>side → server</Button>
            <Button
              tone="danger"
              onClick={() =>
                runner.propose(
                  { op: "remove-mod", targets: [...selected] },
                  <p className="text-muted">
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
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="sticky top-[49px] z-10 border-y border-edge bg-surface">
              <tr>
                {admin && <th className="w-8 px-2 py-2" />}
                {header("status", "", "w-7 text-center")}
                {header("name", "мод")}
                {header("slug", "slug")}
                {header("source", "источник")}
                {header("side", "side")}
                <th className="px-2 py-1.5 text-left font-medium text-muted">флейворы</th>
                {header("version", "версия")}
                {header("size_bytes", "размер", "text-right")}
                {header("date_added", "добавлен")}
                {header("date_updated", "изменён")}
              </tr>
            </thead>
            <tbody>
              {rows.map((mod) => {
                const update = updates.get(mod.slug);
                return (
                  <tr
                    key={mod.slug}
                    className={`h-8 border-b border-edge/60 transition-colors duration-[--dur-fast] ${
                      selected.has(mod.slug) ? "bg-raised" : "hover:bg-raised/40"
                    }`}
                  >
                    {admin && (
                      <td className="px-2">
                        <input
                          type="checkbox"
                          checked={selected.has(mod.slug)}
                          onChange={() => toggle(mod.slug)}
                        />
                      </td>
                    )}
                    <td
                      className={`text-center ${STATUS_CLASS[mod.status]}`}
                      title={STATUS_LABEL[mod.status]}
                    >
                      <span aria-hidden className="text-2xs">
                        {STATUS_GLYPH[mod.status]}
                      </span>
                      <span className="sr-only">{STATUS_LABEL[mod.status]}</span>
                    </td>
                    <td className="px-2">
                      <Link className="text-ink hover:text-accent" to={`/graph?focus=${mod.slug}`}>
                        {mod.name}
                      </Link>
                    </td>
                    <td className="px-2 font-mono text-xs text-faint">{mod.slug}</td>
                    <td className="px-2 text-muted">{SOURCE_LABEL[mod.source]}</td>
                    <td className="px-2 font-mono text-xs text-muted">{mod.side}</td>
                    <td className="max-w-[200px] truncate px-2 text-xs text-faint" title={mod.flavors.join(", ")}>
                      {mod.flavors.join(", ") || "—"}
                    </td>
                    <td className="px-2 font-mono text-xs text-muted">
                      {mod.version ?? "—"}
                      {update && (
                        <span className="ml-1.5 text-accent">▲ {update.candidate_version}</span>
                      )}
                    </td>
                    <td className="px-2 text-right font-mono text-xs text-faint">{bytes(mod.size_bytes)}</td>
                    <td className="px-2 font-mono text-xs text-faint">{day(mod.date_added)}</td>
                    <td className="px-2 font-mono text-xs text-faint">{day(mod.date_updated)}</td>
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
