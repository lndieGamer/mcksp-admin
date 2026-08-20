import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Input,
  Loading,
  Page,
  PageTitle,
  STATUS_CLASS,
  STATUS_GLYPH,
  STATUS_LABEL,
  Select,
  Th,
  bytes,
  day,
} from "../components/ui";
import { usePrivate, usePublic, useSession } from "../lib/data";
import type { Mod, Side } from "../lib/types";

type SortKey =
  | "name"
  | "slug"
  | "source"
  | "side"
  | "version"
  | "date_added"
  | "date_updated"
  | "status"
  | "size_bytes";

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
      if (
        needle &&
        !`${mod.name} ${mod.slug} ${mod.mod_ids.join(" ")}`.toLowerCase().includes(needle)
      )
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

  const sortBy = (key: SortKey) => () => {
    if (sort === key) setDescending((d) => !d);
    else {
      setSort(key);
      setDescending(false);
    }
  };
  const dir = (key: SortKey) => (sort === key ? (descending ? "desc" : "asc") : false);

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

  const filtered = rows.length !== mods.length;

  return (
    <Page scroll={false}>
      <div className="space-y-3">
        <PageTitle count={filtered ? `${rows.length} из ${mods.length}` : mods.length}>
          моды
        </PageTitle>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={search}
            placeholder="имя, slug, modId"
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
          {filtered && (
            <button
              className="text-xs text-faint underline decoration-edge-strong underline-offset-2 transition-colors duration-[--dur-fast] hover:text-ink"
              onClick={() => {
                setQuery("");
                setSource("");
                setSide("");
                setFlavor("");
                setStatus("");
                setFrozenOnly(false);
              }}
            >
              сбросить
            </button>
          )}
        </div>

        {admin && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-accent-dim bg-accent/5 px-3 py-2">
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
            <Button className="ml-auto" onClick={() => setSelected(new Set())}>
              снять выделение
            </Button>
          </div>
        )}
      </div>

      {/* The table owns the remaining height, so only the rows move and the head
          pins to the top of this scroller -- there is no offset to keep in step
          with the chrome above it. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Fixed layout with one flexible column: the name is what the eye scans,
            so it takes the slack and everything else keeps a stable rhythm. The
            minimum leaves the name ~300px before the scroller takes over. */}
        <table className="w-full min-w-[1280px] table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            {admin && <col className="w-8" />}
            <col className="w-7" />
            <col />
            <col className="w-[160px]" />
            <col className="w-[100px]" />
            <col className="w-[64px]" />
            <col className="w-[152px]" />
            <col className="w-[196px]" />
            <col className="w-[84px]" />
            <col className="w-[92px]" />
            <col className="w-[92px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-edge-strong [&>th]:bg-canvas [&>th]:pt-1">
              {admin && <Th />}
              <Th align="center" onClick={sortBy("status")} sorted={dir("status")} />
              <Th onClick={sortBy("name")} sorted={dir("name")}>
                мод
              </Th>
              <Th onClick={sortBy("slug")} sorted={dir("slug")}>
                slug
              </Th>
              <Th onClick={sortBy("source")} sorted={dir("source")}>
                источник
              </Th>
              <Th onClick={sortBy("side")} sorted={dir("side")}>
                side
              </Th>
              <Th>флейворы</Th>
              <Th onClick={sortBy("version")} sorted={dir("version")}>
                версия
              </Th>
              <Th align="right" onClick={sortBy("size_bytes")} sorted={dir("size_bytes")}>
                размер
              </Th>
              <Th onClick={sortBy("date_added")} sorted={dir("date_added")}>
                добавлен
              </Th>
              <Th onClick={sortBy("date_updated")} sorted={dir("date_updated")}>
                изменён
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((mod) => {
              const update = updates.get(mod.slug);
              const picked = selected.has(mod.slug);
              return (
                <tr
                  key={mod.slug}
                  className={`h-8 leading-[1.25] transition-colors duration-[--dur-fast] [&>td]:rule ${
                    picked ? "bg-raised" : "hover:bg-raised/45"
                  }`}
                >
                  {admin && (
                    <td className="px-2">
                      <input
                        type="checkbox"
                        aria-label={`выбрать ${mod.name}`}
                        checked={picked}
                        onChange={() => toggle(mod.slug)}
                      />
                    </td>
                  )}
                  <td
                    className={`text-center ${STATUS_CLASS[mod.status]}`}
                    title={STATUS_LABEL[mod.status]}
                  >
                    {/* The status marks are not in IBM Plex Sans; without an
                        explicit line-height the fallback symbol font's metrics
                        push every row five pixels taller than the 32px grid. */}
                    <span aria-hidden className="inline-block leading-none">
                      {STATUS_GLYPH[mod.status]}
                    </span>
                    <span className="sr-only">{STATUS_LABEL[mod.status]}</span>
                  </td>
                  <td className="truncate px-2">
                    <Link
                      className="text-base text-ink decoration-accent-dim underline-offset-2 hover:text-accent hover:underline"
                      to={`/graph?focus=${mod.slug}`}
                      title={mod.name}
                    >
                      {mod.name}
                    </Link>
                  </td>
                  <td className="truncate px-2 font-mono text-muted" title={mod.slug}>
                    {mod.slug}
                  </td>
                  <td className="px-2 text-muted">{SOURCE_LABEL[mod.source]}</td>
                  <td className="px-2 font-mono text-muted">{mod.side}</td>
                  <td
                    className="truncate px-2 text-faint"
                    title={mod.flavors.join(", ") || undefined}
                  >
                    {mod.flavors.join(", ") || "—"}
                  </td>
                  <td className="truncate px-2 font-mono text-muted">
                    {mod.version ?? "—"}
                    {update && (
                      <span className="ml-2 text-accent">
                        <span aria-hidden>▲ </span>
                        {update.candidate_version}
                      </span>
                    )}
                  </td>
                  <td className="px-2 text-right font-mono text-faint">{bytes(mod.size_bytes)}</td>
                  <td className="px-2 font-mono text-faint">{day(mod.date_added)}</td>
                  <td className="px-2 font-mono text-faint">{day(mod.date_updated)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>ничего не подошло под фильтры — попробуйте сбросить их</Empty>}
      </div>
    </Page>
  );
}
