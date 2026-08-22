import { Boxes, ChevronDown, CircleArrowUp, Filter, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Input,
  Loading,
  ModIcon,
  Page,
  PageTitle,
  STATUS_LABEL,
  Select,
  SideMark,
  StatusMark,
  Tag,
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

/** Въезд строк ставится только на первый экран: на 214 строках задержка в
 *  26мс на позицию превратилась бы в семисекундный занавес. */
const STAGGER_ROWS = 18;

export default function Mods() {
  const publicData = usePublic();
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();
  const admin = Boolean(session.data);

  // `/mods?q=<slug>` — так линтер приводит сюда прямо к своей находке.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [source, setSource] = useState("");
  const [side, setSide] = useState("");
  const [flavor, setFlavor] = useState("");
  const [status, setStatus] = useState("");
  const [frozenOnly, setFrozenOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);
  // Меню side висит на координатах ячейки, по которой кликнули.
  const [menu, setMenu] = useState<{ mod: Mod; x: number; y: number } | null>(null);
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

  const sortBy = (key: SortKey) => () => {
    if (sort === key) setDescending((d) => !d);
    else {
      setSort(key);
      setDescending(false);
    }
  };
  const dir = (key: SortKey) => (sort === key ? (descending ? "desc" : "asc") : false);

  const changeSide = (mod: Mod, value: Side) => {
    setMenu(null);
    runner.propose(
      { op: "set-side", targets: [mod.slug], value },
      <p className="text-muted">
        В <code>mods/{mod.slug}.pw.toml</code> строка <code>side</code> станет{" "}
        <code>side = &quot;{value}&quot;</code> — было <code>{mod.side}</code>.
      </p>,
    );
  };

  const removeMod = (mod: Mod) => {
    setMenu(null);
    runner.propose(
      { op: "remove-mod", targets: [mod.slug] },
      <p className="text-muted">
        Будут удалены метафайл <code>mods/{mod.slug}.pw.toml</code> и запись в{" "}
        <code>unsup.toml</code>.
      </p>,
    );
  };

  if (publicData.isLoading) return <Loading what="список модов" />;
  if (!publicData.data) return <Empty icon={Boxes}>данные ещё не опубликованы</Empty>;

  const filtered = rows.length !== mods.length;

  return (
    <Page scroll={false}>
      <div className="space-y-4">
        <PageTitle
          icon={Boxes}
          count={filtered ? `${rows.length} из ${mods.length}` : mods.length}
        >
          моды
        </PageTitle>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            ref={search}
            placeholder="имя, slug, modId — или нажмите /"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-72"
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
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_LABEL[key]}
              </option>
            ))}
          </Select>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-edge bg-canvas/70 px-3 text-xs text-muted transition-colors duration-[var(--dur)] hover:border-edge-strong hover:text-ink">
            <input
              type="checkbox"
              checked={frozenOnly}
              onChange={(e) => setFrozenOnly(e.target.checked)}
            />
            без [update]
          </label>
          {filtered && (
            <Button
              icon={X}
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
            </Button>
          )}
        </div>
      </div>

      {/* Таблица забирает остаток высоты: двигаются только строки, а шапка
          липнет к верху этого же скроллера — offset под хром держать не надо. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Фиксированная раскладка с одной гибкой колонкой: имя — то, что глаз
            сканирует, оно и забирает люфт, остальные держат ритм. */}
        <table className="w-full min-w-[1320px] table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col />
            <col className="w-[168px]" />
            <col className="w-[112px]" />
            <col className="w-[76px]" />
            <col className="w-[160px]" />
            <col className="w-[204px]" />
            <col className="w-[92px]" />
            <col className="w-[116px]" />
            <col className="w-[116px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-edge-strong [&>th]:bg-canvas [&>th]:pt-2">
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
            {rows.map((mod, i) => {
              const update = updates.get(mod.slug);
              return (
                <tr
                  key={mod.slug}
                  style={
                    i < STAGGER_ROWS ? ({ "--stagger-index": i } as React.CSSProperties) : undefined
                  }
                  className={`h-11 transition-colors duration-[var(--dur-fast)] [&>td]:rule ${
                    i < STAGGER_ROWS ? "rise" : ""
                  } ${menu?.mod.slug === mod.slug ? "bg-raised" : "hover:bg-raised/45"}`}
                >
                  <td className="px-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusMark status={mod.status} label={false} size={13} />
                      <ModIcon
                        slug={mod.slug}
                        projectId={mod.project_id}
                        source={mod.source}
                        size={24}
                      />
                      <Link
                        className="min-w-0 flex-1 truncate text-sm text-ink decoration-accent-dim underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:text-accent hover:underline"
                        to={`/graph?focus=${mod.slug}`}
                        title={mod.name}
                      >
                        {mod.name}
                      </Link>
                    </div>
                  </td>
                  <td className="truncate px-3 font-mono text-xs text-muted" title={mod.slug}>
                    {mod.slug}
                  </td>
                  <td className="px-3 text-xs text-muted">{SOURCE_LABEL[mod.source]}</td>
                  <td className="px-3">
                    {admin ? (
                      <button
                        type="button"
                        aria-haspopup="menu"
                        title="сменить side"
                        className="group/side -mx-1.5 flex cursor-pointer items-center gap-1 rounded-xs px-1.5 py-1 transition-colors duration-[var(--dur-fast)] hover:bg-raised"
                        onClick={(event) => {
                          const box = event.currentTarget.getBoundingClientRect();
                          setMenu({
                            mod,
                            x: box.left,
                            // Нижние строки таблицы иначе открывали бы меню за
                            // краем окна.
                            y: Math.min(box.bottom + 6, window.innerHeight - 190),
                          });
                        }}
                      >
                        <SideMark side={mod.side} label />
                        <ChevronDown
                          aria-hidden
                          size={12}
                          strokeWidth={2}
                          className="shrink-0 text-faint transition-colors duration-[var(--dur-fast)] group-hover/side:text-muted"
                        />
                      </button>
                    ) : (
                      <SideMark side={mod.side} label />
                    )}
                  </td>
                  {/* Плашка внутри ячейки должна усекаться сама: `truncate` на
                      td режет текст, но не саму плашку, и она вылезала за
                      колонку в соседнюю. */}
                  <td className="px-3 text-xs text-faint" title={mod.flavors.join(", ") || undefined}>
                    {mod.flavors.length ? (
                      <Tag>
                        <span className="block max-w-[128px] truncate">
                          {mod.flavors.join(", ")}
                        </span>
                      </Tag>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="truncate px-3 font-mono text-xs text-muted">
                    {mod.version ?? "—"}
                    {update && (
                      <span className="ml-2 inline-flex items-center gap-1 text-accent">
                        <CircleArrowUp aria-hidden size={11} strokeWidth={2} />
                        {update.candidate_version}
                      </span>
                    )}
                  </td>
                  <td className="px-3 text-right font-mono text-xs text-faint">
                    {bytes(mod.size_bytes)}
                  </td>
                  <td className="px-3 font-mono text-xs text-faint">{day(mod.date_added)}</td>
                  <td className="px-3 font-mono text-xs text-faint">{day(mod.date_updated)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty icon={Filter}>ничего не подошло под фильтры — попробуйте сбросить их</Empty>
        )}
      </div>

      {menu && (
        <SideMenu
          state={menu}
          onClose={() => setMenu(null)}
          onPick={(value) => changeSide(menu.mod, value)}
          onRemove={() => removeMod(menu.mod)}
        />
      )}
    </Page>
  );
}

/** Меню side поверх ячейки.
 *
 *  Портал в body, а не absolute внутри ячейки: таблица живёт в `overflow-auto`,
 *  и меню у нижних строк обрезалось бы её краем. */
function SideMenu({
  state,
  onClose,
  onPick,
  onRemove,
}: {
  state: { mod: Mod; x: number; y: number };
  onClose: () => void;
  onPick: (value: Side) => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        role="menu"
        aria-label={`side для ${state.mod.name}`}
        onClick={(event) => event.stopPropagation()}
        style={{ left: state.x, top: state.y }}
        className="fade-in fixed w-56 overflow-hidden rounded-md border border-edge-strong bg-surface py-1 shadow-[var(--shadow-e4)]"
      >
        <p className="truncate px-3 py-1.5 font-mono text-2xs text-faint">{state.mod.slug}</p>
        {(["both", "client", "server"] as const).map((value) => (
          <button
            key={value}
            role="menuitem"
            type="button"
            disabled={value === state.mod.side}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors duration-[var(--dur-fast)] hover:bg-raised disabled:cursor-default disabled:bg-transparent"
            onClick={() => onPick(value)}
          >
            <SideMark side={value} label />
            {value === state.mod.side && (
              <span className="ml-auto text-2xs text-faint">сейчас</span>
            )}
          </button>
        ))}
        <button
          role="menuitem"
          type="button"
          className="mt-1 flex w-full cursor-pointer items-center gap-2.5 border-t border-edge px-3 py-2 text-left text-xs text-danger transition-colors duration-[var(--dur-fast)] hover:bg-danger/10"
          onClick={onRemove}
        >
          <Trash2 aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
          удалить мод
        </button>
      </div>
    </div>,
    document.body,
  );
}
