import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as RFEdge,
  type EdgeTypes,
  type Node as RFNode,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  ChipNode,
  ClusterNode,
  IslandNode,
  ModNode,
  OrthoEdge,
  type NodeState,
} from "../components/graph/parts";
import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Loading,
  ModIcon,
  Page,
  PageTitle,
  SIDE_HEX,
  SIDE_LABEL,
  Segmented,
  Select,
  StatusMark,
  bytes,
} from "../components/ui";
import {
  CLUSTER_PREFIX,
  EMPTY_FILTERS,
  buildModel,
  clustersOf,
  focusModel,
  reachable,
  type GraphFilters,
  type GraphModel,
} from "../lib/graph";
import { clusterIdOf, isCluster, isIsland, layout, type Placed } from "../lib/layout";
import { indexOf, usePrivate, usePublic, useSession } from "../lib/data";
import type { Mod, Side } from "../lib/types";

const nodeTypes: NodeTypes = {
  mod: ModNode,
  cluster: ClusterNode,
  island: IslandNode,
  chip: ChipNode,
} as NodeTypes;

const edgeTypes: EdgeTypes = { ortho: OrthoEdge } as EdgeTypes;

export default function GraphPage() {
  return (
    <ReactFlowProvider>
      <Graph />
    </ReactFlowProvider>
  );
}

function Graph() {
  const publicData = usePublic();
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();
  const flow = useReactFlow();
  const admin = Boolean(session.data);

  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  const [filters, setFilters] = useState<GraphFilters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [isolate, setIsolate] = useState<{ root: string; depth: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Результат раскладки держится вместе с моделью, для которой он посчитан:
  // между сменой модели и приходом новых координат на экране живёт прошлая
  // раскладка, и всё, что зависит от «свежести», обязано это различать.
  const [placed, setPlaced] = useState<{ data: Placed; forModel: GraphModel } | null>(null);
  const [laying, setLaying] = useState(false);
  const [refit, setRefit] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const index = useMemo(
    () => (publicData.data ? indexOf(publicData.data) : null),
    [publicData.data],
  );
  const clusters = useMemo(
    () => (publicData.data ? clustersOf(publicData.data) : new Map()),
    [publicData.data],
  );

  const model = useMemo(() => {
    if (!publicData.data) return null;
    const full = buildModel(publicData.data, filters, expanded);
    if (!isolate) return full;
    const root = full.containerOf.get(isolate.root) ?? isolate.root;
    return focusModel(full, root, isolate.depth);
  }, [publicData.data, filters, expanded, isolate]);

  // Раскладка асинхронная: пока ELK считает, на полотне остаётся предыдущая
  // картинка, а не пустота. `stale` гасит ответ расчёта, который пользователь
  // успел отменить следующим кликом.
  useEffect(() => {
    if (!model || model.nodes.length === 0) {
      setPlaced(null);
      return;
    }
    let stale = false;
    setLaying(true);
    void layout(model.nodes, model.edges)
      .then((result) => {
        if (!stale) setPlaced({ data: result, forModel: model });
      })
      .finally(() => {
        if (!stale) setLaying(false);
      });
    return () => {
      stale = true;
    };
  }, [model]);

  // На полотне живёт та модель, для которой уже есть координаты. Новая модель
  // без раскладки нарисовалась бы стопкой в точке (0,0), поэтому пока ELK
  // считает, показывается предыдущая — целиком и согласованно.
  const view = placed?.forModel ?? null;

  // Подсветка цепочки: наведение важнее выбора, выбор важнее покоя. Три шага
  // в обе стороны — дальше связь перестаёт что-либо объяснять.
  const lit = useMemo(() => {
    if (!view) return null;
    const anchor = hovered ?? (focus ? (view.containerOf.get(focus) ?? focus) : null);
    if (!anchor) return null;
    // Раскрытие семейства уносит с поля тот самый узел, на котором стоял
    // курсор: mouseleave по исчезнувшему узлу не приходит, и без этой проверки
    // якорем оставался призрак, а весь граф так и висел приглушённым.
    if (!view.nodes.some((node) => node.id === anchor)) return null;
    return reachable(view.edges, anchor, 3);
  }, [view, hovered, focus]);

  const degrees = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of view?.edges ?? []) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + edge.count);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + edge.count);
    }
    return counts;
  }, [view]);

  const nodes = useMemo<RFNode[]>(() => {
    if (!view || !placed) return [];
    const focusedContainer = focus ? (view.containerOf.get(focus) ?? focus) : null;
    return view.nodes.map((node) => {
      const position = placed.data.positions.get(node.id) ?? { x: 0, y: 0 };
      const size = placed.data.sizes.get(node.id) ?? { width: node.width, height: node.height };
      const state: NodeState = !lit ? "normal" : lit.nodes.has(node.id) ? "lit" : "dimmed";
      const shared = {
        id: node.id,
        position,
        parentId: node.parent ?? undefined,
        draggable: false,
        selectable: true,
        style: { width: size.width, height: size.height },
        width: size.width,
        height: size.height,
        // Контейнер не должен перехватывать клики у своих детей.
        selected: node.id === focusedContainer,
      };
      if (node.kind === "cluster" || node.kind === "island") {
        return {
          ...shared,
          type: node.kind,
          zIndex: 0,
          data: {
            label: node.group?.label ?? node.id,
            members: node.group?.members ?? [],
            expanded: node.kind === "cluster" && expanded.has(clusterIdOf(node.id)),
            state,
            tone: node.kind === "island" ? (node.group?.id as Side) : null,
          },
        } as RFNode;
      }
      return {
        ...shared,
        type: node.kind,
        zIndex: 1,
        data: {
          mod: node.mod as Mod,
          state,
          degree: degrees.get(node.id) ?? 0,
          isFocused: node.mod?.slug === focus,
        },
      } as RFNode;
    });
  }, [view, placed, lit, expanded, focus, degrees]);

  const edges = useMemo<RFEdge[]>(() => {
    if (!view || !placed) return [];
    return view.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "ortho",
      markerEnd: edge.satisfied ? "url(#arrow)" : "url(#arrow-danger)",
      data: {
        points: placed.data.routes.get(edge.id) ?? [],
        required: edge.required,
        satisfied: edge.satisfied,
        count: edge.count,
        state: !lit ? "normal" : lit.edges.has(edge.id) ? "lit" : "dimmed",
      },
    }));
  }, [view, placed, lit]);

  const flyTo = useCallback(
    (id: string) => {
      window.requestAnimationFrame(() => {
        void flow.fitView({ nodes: [{ id }], duration: 520, maxZoom: 1.25, padding: 0.45 });
      });
    },
    [flow],
  );

  const toggleCluster = useCallback((id: string) => {
    setHovered(null);
    // Раскрытие переставляет весь граф: камера, оставшаяся на старых
    // координатах, показывает случайный угол поля. Запоминаем, к чему вернуться
    // после того, как ELK досчитает.
    setRefit(`${CLUSTER_PREFIX}${id}`);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Открыть мод: если он спрятан в свёрнутом семействе — сначала раскрыть его,
   *  иначе перелёт улетит в контейнер и пользователь не поймёт, куда попал. */
  const reveal = useCallback(
    (slug: string) => {
      const mod = index?.bySlug.get(slug);
      if (mod?.cluster && clusters.has(mod.cluster)) {
        setExpanded((current) =>
          current.has(mod.cluster as string) ? current : new Set([...current, mod.cluster as string]),
        );
      }
      setParamsRef.current({ focus: slug });
      setQuery("");
    },
    [clusters, index],
  );

  useEffect(() => {
    if (focus && placed?.data.positions.has(focus)) flyTo(focus);
  }, [focus, placed, flyTo]);

  // Возврат камеры к тому, что раскрыли или свернули. Отдельным кадром:
  // React Flow должен сначала смонтировать узлы новой раскладки.
  useEffect(() => {
    if (!refit) return;
    // Ждать появления узла бесполезно: id свёрнутой пачки есть и в предыдущей
    // раскладке, поэтому камера уезжала на её старое место за миг до того, как
    // ELK досчитает новое. Ждать надо именно совпадения модели на экране с
    // текущей — то есть прихода координат для этого клика.
    if (view !== model) return;
    const all = refit === "*";
    if (!all && !nodes.some((node) => node.id === refit)) return;
    setRefit(null);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        void flow.fitView(
          all
            ? { duration: 520, minZoom: 0.55, maxZoom: 1, padding: 0.16 }
            : { nodes: [{ id: refit }], duration: 520, maxZoom: 0.85, padding: 0.25 },
        );
      }),
    );
  }, [refit, nodes, view, model, flow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (document.activeElement === searchRef.current) {
          setQuery("");
          searchRef.current?.blur();
        } else if (isolate) {
          setIsolate(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolate]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2 || !publicData.data) return [];
    return publicData.data.mods
      .filter(
        (mod) =>
          mod.name.toLowerCase().includes(needle) || mod.slug.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, publicData.data]);

  if (publicData.isLoading) return <Loading what="граф" />;
  if (!publicData.data || !index || !model) {
    return <Empty icon={Network}>данные ещё не опубликованы</Empty>;
  }

  const selected = focus ? (index.bySlug.get(focus) ?? null) : null;
  const flavorIds = [...new Set(publicData.data.mods.flatMap((mod) => mod.flavors))].sort();
  const shown = view ?? model;
  const shownNodes = shown.nodes.filter((node) => node.kind === "mod" || node.kind === "chip")
    .length;

  return (
    <Page scroll={false}>
      <PageTitle
        icon={Network}
        count={
          <>
            {shownNodes} на поле · {shown.collapsedCount} в семействах · {shown.edges.length} связей
          </>
        }
        actions={
          <>
            {isolate && (
              <Button icon={RotateCcw} onClick={() => setIsolate(null)}>
                весь граф
              </Button>
            )}
            <Button
              icon={expanded.size ? ChevronsDownUp : ChevronsUpDown}
              onClick={() => {
                setHovered(null);
                setRefit("*");
                setExpanded((current) => (current.size ? new Set() : new Set(clusters.keys())));
              }}
            >
              {expanded.size ? "свернуть семейства" : "раскрыть семейства"}
            </Button>
          </>
        }
      >
        граф
      </PageTitle>

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search
                aria-hidden
                size={14}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="найти мод…"
                className="h-10 w-64 rounded-sm border border-edge bg-canvas/70 pr-14 pl-9 text-xs text-ink transition-[border-color,box-shadow] duration-[var(--dur)] placeholder:text-faint hover:border-edge-strong focus:border-accent focus:shadow-[var(--shadow-glow)] focus:outline-none"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-xs border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
                ⌃K
              </kbd>
              {matches.length > 0 && (
                <ul className="lit fade-in absolute top-12 left-0 z-30 w-80 overflow-hidden rounded-md border border-edge bg-surface py-1">
                  {matches.map((mod, i) => (
                    <li key={mod.slug}>
                      <button
                        style={{ "--stagger-index": i } as React.CSSProperties}
                        onClick={() => reveal(mod.slug)}
                        className="rise flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-raised"
                      >
                        <ModIcon
                          slug={mod.slug}
                          projectId={mod.project_id}
                          source={mod.source}
                          size={22}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">{mod.name}</span>
                        <span className="font-mono text-[10px] text-faint">{mod.side}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Select
              value={filters.side}
              onChange={(event) =>
                setFilters((f) => ({ ...f, side: event.target.value as Side | "" }))
              }
            >
              <option value="">side: любой</option>
              <option value="both">both</option>
              <option value="client">client</option>
              <option value="server">server</option>
            </Select>
            <Select
              value={filters.flavor}
              onChange={(event) => setFilters((f) => ({ ...f, flavor: event.target.value }))}
            >
              <option value="">флейвор: любой</option>
              {flavorIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>

            <Segmented
              label="какие рёбра показывать"
              value={filters.requiredOnly ? "required" : "all"}
              onChange={(value) => setFilters((f) => ({ ...f, requiredOnly: value === "required" }))}
              options={[
                { value: "all", label: "все связи" },
                { value: "required", label: "обязательные" },
              ]}
            />
            <Segmented
              label="одиночки"
              value={filters.showIsolated ? "show" : "hide"}
              onChange={(value) => setFilters((f) => ({ ...f, showIsolated: value === "show" }))}
              options={[
                { value: "show", label: "с одиночками" },
                { value: "hide", label: "только связанные" },
              ]}
            />

            {isolate && (
              <Segmented
                label="глубина фокуса"
                value={String(isolate.depth)}
                onChange={(value) => setIsolate({ ...isolate, depth: Number(value) })}
                options={[
                  { value: "1", label: "1 шаг" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                ]}
              />
            )}
          </div>

          <div className="lit relative min-h-[360px] flex-1 overflow-hidden rounded-md border border-edge bg-canvas/60">
            <ArrowDefs />
            {laying && (
              <span className="fade-in absolute top-3 right-3 z-20 flex items-center gap-2 rounded-sm border border-edge bg-surface/90 px-2.5 py-1.5 font-mono text-[10px] text-faint backdrop-blur">
                <span className="pulse-ring size-1.5 rounded-full bg-accent" />
                раскладка…
              </span>
            )}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              minZoom={0.15}
              maxZoom={2.2}
              fitView
              // Без нижней границы «вписать» на 135 узлах уводит масштаб к 0.3,
              // где не читается даже крупная подпись дальнего уровня детализации.
              // Лучше показать часть поля в читаемом виде, чем всё в нечитаемом.
              fitViewOptions={{ padding: 0.16, minZoom: 0.55, maxZoom: 1 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: false }}
              onNodeMouseEnter={(_, node) => setHovered(node.id)}
              onNodeMouseLeave={() => setHovered(null)}
              onNodeClick={(_, node) => {
                // По рамке раскрытого семейства кликают, чтобы свернуть его
                // обратно: дети лежат поверх рамки и свои клики забирают сами.
                if (isCluster(node.id)) {
                  toggleCluster(clusterIdOf(node.id));
                  return;
                }
                if (isIsland(node.id)) return;
                setParamsRef.current({ focus: node.id });
              }}
              onNodeDoubleClick={(_, node) => {
                if (!isCluster(node.id) && !isIsland(node.id)) {
                  setIsolate({ root: node.id, depth: 2 });
                }
              }}
              onPaneClick={() => setParamsRef.current({})}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={28}
                size={1}
                color="var(--color-edge-strong)"
              />
            </ReactFlow>

            <div className="absolute bottom-3 left-3 z-20 flex gap-1.5">
              <CanvasButton title="приблизить" onClick={() => void flow.zoomIn({ duration: 180 })}>
                <Plus aria-hidden size={14} strokeWidth={2} />
              </CanvasButton>
              <CanvasButton title="отдалить" onClick={() => void flow.zoomOut({ duration: 180 })}>
                <Minus aria-hidden size={14} strokeWidth={2} />
              </CanvasButton>
              <CanvasButton
                title="вписать в экран"
                onClick={() => void flow.fitView({ duration: 400, padding: 0.16 })}
              >
                <Maximize2 aria-hidden size={13} strokeWidth={2} />
              </CanvasButton>
            </div>
          </div>

          <Legend islands={shown.islands} />
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-edge pl-5">
          {!selected ? (
            <Hint collapsed={clusters.size - expanded.size} hidden={shown.collapsedCount} />
          ) : (
            <Details
              mod={selected}
              index={index}
              admin={admin}
              blocked={privateData.data?.updates.find((u) => u.slug === focus)}
              onGo={(slug) => reveal(slug)}
              onIsolate={() => setIsolate({ root: selected.slug, depth: 2 })}
              onSide={(value) =>
                runner.propose(
                  { op: "set-side", targets: [selected.slug], value },
                  <p className="text-muted">
                    mods/{selected.slug}.pw.toml: <code>side</code> {selected.side} → {value}
                  </p>,
                )
              }
            />
          )}
        </aside>
      </div>
    </Page>
  );
}

function CanvasButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid size-9 cursor-pointer place-items-center rounded-sm border border-edge bg-surface/90 text-muted backdrop-blur transition-[color,border-color,background-color] duration-[var(--dur)] hover:border-edge-strong hover:bg-raised hover:text-ink"
    >
      {children}
      <span className="sr-only">{title}</span>
    </button>
  );
}

function Hint({ collapsed, hidden }: { collapsed: number; hidden: number }) {
  return (
    <div className="space-y-4 pt-2 text-xs text-faint">
      <p className="text-sm text-muted">
        {collapsed > 0
          ? `Свёрнуто семейств: ${collapsed}, внутри них ${hidden} модов. Клик по пачке раскрывает её.`
          : "Все семейства раскрыты. Клик по рамке семейства сворачивает его обратно."}
      </p>
      <ul className="space-y-2">
        <Shortcut keys="клик">по узлу — карточка справа</Shortcut>
        <Shortcut keys="двойной клик">— оставить на поле только его окрестность</Shortcut>
        <Shortcut keys="наведение">— подсветить цепочку зависимостей</Shortcut>
        <Shortcut keys="⌃K">— поиск с перелётом к моду</Shortcut>
        <Shortcut keys="Esc">— выйти из режима фокуса</Shortcut>
      </ul>
    </div>
  );
}

function Shortcut({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="shrink-0 rounded-xs border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
        {keys}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Legend({ islands }: { islands: { side: Side; count: number }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs text-faint">
      {(["both", "client", "server"] as Side[]).map((side) => (
        <span key={side} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3 w-[3px] rounded-full"
            style={{ background: SIDE_HEX[side] }}
          />
          {SIDE_LABEL[side]}
        </span>
      ))}
      <span className="text-faint/80">сплошное ребро — required · пунктир — optional</span>
      <span className="text-faint/80">красное ребро — зависимость не удовлетворена</span>
      {islands.length > 0 && (
        <span className="text-faint/80">
          острова — {islands.reduce((sum, island) => sum + island.count, 0)} модов без связей
        </span>
      )}
    </div>
  );
}

/** Маркеры стрелок объявлены один раз на документ: ссылка url(#id) из любого
 *  svg на полотне резолвится глобально. */
function ArrowDefs() {
  return (
    <svg aria-hidden className="pointer-events-none absolute size-0">
      <defs>
        {[
          ["arrow", "var(--color-faint)"],
          ["arrow-danger", "var(--color-danger)"],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function Details({
  mod,
  index,
  admin,
  blocked,
  onGo,
  onIsolate,
  onSide,
}: {
  mod: Mod;
  index: ReturnType<typeof indexOf>;
  admin: boolean;
  blocked: { status: string; candidate_version: string | null; blocked_by: { slug: string; version_range: string }[] } | undefined;
  onGo: (slug: string) => void;
  onIsolate: () => void;
  onSide: (side: Side) => void;
}) {
  const incoming = index.incoming.get(mod.slug) ?? [];
  const outgoing = index.outgoing.get(mod.slug) ?? [];

  return (
    <div className="fade-in space-y-5 pb-4 text-sm">
      <div className="flex items-start gap-3 border-b border-edge pb-4">
        <ModIcon slug={mod.slug} projectId={mod.project_id} source={mod.source} size={44} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="text-md leading-tight font-semibold text-ink">{mod.name}</h2>
          <StatusMark status={mod.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button icon={Crosshair} onClick={onIsolate}>
          окрестность
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <Fact label="slug" mono>
          {mod.slug}
        </Fact>
        <Fact label="modId" mono>
          {mod.mod_ids.join(", ") || "—"}
        </Fact>
        <Fact label="версия" mono>
          {mod.version ?? "—"}
        </Fact>
        <Fact label="роль">{mod.role}</Fact>
        <Fact label="семейство">{mod.cluster ?? "—"}</Fact>
        <Fact label="side" mono>
          {mod.side}
        </Fact>
        <Fact label="размер" mono>
          {bytes(mod.size_bytes)}
        </Fact>
        {mod.embedded && (
          <Fact label="вшит в" mono>
            {mod.owner}
          </Fact>
        )}
      </dl>

      {blocked?.status === "blocked" && (
        <div className="rounded-sm border border-warn-dim bg-warn/10 p-3">
          <p className="text-xs text-warn">Обновление до {blocked.candidate_version} блокируют:</p>
          <ul className="mt-1.5 space-y-1">
            {blocked.blocked_by.map((blocker) => (
              <li key={blocker.slug} className="font-mono text-xs text-warn">
                {blocker.slug} требует {blocker.version_range}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Links
        title={`зависит от (${outgoing.length})`}
        items={outgoing.map((edge) => ({
          key: edge.to ?? edge.to_mod_id,
          // Packwiz называет метафайл по slug'у проекта на день добавления, и
          // Moonlight Lib до сих пор лежит в `selene.pw.toml`. Показ slug'а тут
          // делал вид, будто зависимость смотрит на чужую библиотеку.
          label: edge.to
            ? (index.bySlug.get(edge.to)?.name ?? edge.to)
            : `${edge.to_mod_id} (нет в паке)`,
          meta: `${edge.type} ${edge.version_range}`,
          broken: !edge.satisfied,
          go: edge.to ? () => onGo(edge.to as string) : undefined,
        }))}
      />

      <Links
        title={`нужен для (${incoming.length})`}
        items={incoming.map((edge) => ({
          key: edge.from,
          label: index.bySlug.get(edge.from)?.name ?? edge.from,
          meta: `${edge.type} ${edge.version_range}`,
          broken: false,
          go: () => onGo(edge.from),
        }))}
      />

      {admin && !mod.embedded && (
        <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
          {(["both", "client", "server"] as Side[])
            .filter((value) => value !== mod.side)
            .map((value) => (
              <Button key={value} onClick={() => onSide(value)}>
                side → {value}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={`min-w-0 text-xs break-words text-muted ${mono ? "font-mono" : ""}`}>
        {children}
      </dd>
    </>
  );
}

function Links({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; meta: string; broken: boolean; go?: () => void }[];
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-2xs tracking-[0.1em] text-faint uppercase">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-faint">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li
              key={`${item.key}-${i}`}
              style={{ "--stagger-index": i } as React.CSSProperties}
              className="rise flex flex-wrap items-baseline gap-x-2"
            >
              {item.go ? (
                <button
                  className={`cursor-pointer text-left font-mono text-xs underline decoration-transparent underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:decoration-accent-dim ${
                    item.broken ? "text-danger" : "text-muted hover:text-accent"
                  }`}
                  onClick={item.go}
                >
                  {item.label}
                </button>
              ) : (
                <span className={`font-mono text-xs ${item.broken ? "text-danger" : "text-muted"}`}>
                  {item.label}
                </span>
              )}
              <span className="font-mono text-[10px] text-faint">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
