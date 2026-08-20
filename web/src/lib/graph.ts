/** Построение отображаемой модели графа из данных анализатора.
 *
 *  Модуль намеренно чистый: ни React, ни ELK, ни React Flow. Вся боль графа —
 *  свёртка кластеров, слияние параллельных рёбер, острова одиночек, обход в
 *  глубину для подсветки — живёт здесь и проверяется в graph.check.mjs.
 *
 *  Числа, вокруг которых всё построено (пак Seventh Season, 214 модов):
 *  один хаб `create` держит 51 связь, 79 модов лежат в 8 семействах, 57 модов
 *  не связаны ни с чем. Свёрнутые семейства убирают 94 ребра из 200 — именно
 *  они и рисовали паутину. */

import type { Edge, Mod, PublicData, Side } from "./types";

export const NODE_W = 216;
export const NODE_H = 68;
export const CLUSTER_W = 252;
export const CLUSTER_H = 96;
export const CHIP_W = 156;
export const CHIP_H = 40;

export const CLUSTER_PREFIX = "cluster:";
export const ISLAND_PREFIX = "island:";

export interface GraphNode {
  id: string;
  kind: "mod" | "cluster" | "chip" | "island";
  /** id родительского контейнера: раскрытого семейства или острова. */
  parent: string | null;
  width: number;
  height: number;
  mod: Mod | null;
  /** Для kind === "cluster" | "island". */
  group: { id: string; label: string; members: Mod[] } | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  required: boolean;
  satisfied: boolean;
  /** Сколько исходных зависимостей схлопнулось в это ребро. */
  count: number;
  raw: Edge[];
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** slug → id узла, который его сейчас представляет (он сам или семейство). */
  containerOf: Map<string, string>;
  /** Сколько модов скрыто внутри свёрнутых семейств. */
  collapsedCount: number;
  islands: { side: Side; count: number }[];
}

export interface GraphFilters {
  side: Side | "";
  flavor: string;
  requiredOnly: boolean;
  showIsolated: boolean;
}

export const EMPTY_FILTERS: GraphFilters = {
  side: "",
  flavor: "",
  requiredOnly: false,
  showIsolated: true,
};

const SIDE_ISLAND_LABEL: Record<Side, string> = {
  both: "самостоятельные · клиент и сервер",
  client: "самостоятельные · только клиент",
  server: "самостоятельные · только сервер",
};

/** Имя семейства берётся у его ядра. Кластер `create::flywheel` назван по jar,
 *  вшитому в другой мод, — там ядра-мода в паке нет, остаётся сам id. */
function clusterLabel(id: string, members: Mod[]): string {
  const core = members.find((mod) => mod.slug === id) ?? members.find((mod) => mod.role === "core");
  return core?.name ?? id.split("::").pop() ?? id;
}

/** Моды без единой связи. Считается по полному набору рёбер, до фильтров:
 *  иначе мод «становился» одиночкой из-за снятой галочки и уезжал на остров. */
export function isolatedSlugs(data: PublicData): Set<string> {
  const linked = new Set<string>();
  for (const edge of data.edges) {
    if (!edge.to) continue;
    linked.add(edge.from);
    linked.add(edge.to);
  }
  return new Set(data.mods.filter((mod) => !linked.has(mod.slug)).map((mod) => mod.slug));
}

export function clustersOf(data: PublicData): Map<string, Mod[]> {
  const clusters = new Map<string, Mod[]>();
  for (const mod of data.mods) {
    if (!mod.cluster) continue;
    const members = clusters.get(mod.cluster);
    if (members) members.push(mod);
    else clusters.set(mod.cluster, [mod]);
  }
  // Семейство из одного мода — не семейство: сворачивать нечего.
  for (const [id, members] of clusters) if (members.length < 2) clusters.delete(id);
  return clusters;
}

export function buildModel(
  data: PublicData,
  filters: GraphFilters,
  expanded: ReadonlySet<string>,
): GraphModel {
  const clusters = clustersOf(data);
  const isolated = isolatedSlugs(data);

  const passes = (mod: Mod) =>
    (!filters.side || mod.side === filters.side) &&
    (!filters.flavor || mod.flavors.includes(filters.flavor));

  const visible = new Map<string, Mod>();
  for (const mod of data.mods) if (passes(mod)) visible.set(mod.slug, mod);

  const nodes: GraphNode[] = [];
  const containerOf = new Map<string, string>();
  let collapsedCount = 0;

  // 1. Семейства. Свёрнутое — один узел, раскрытое — контейнер с детьми.
  for (const [id, members] of clusters) {
    const shown = members.filter((mod) => visible.has(mod.slug));
    if (shown.length === 0) continue;
    const containerId = `${CLUSTER_PREFIX}${id}`;
    const group = { id, label: clusterLabel(id, members), members: shown };

    if (expanded.has(id)) {
      nodes.push({
        id: containerId,
        kind: "cluster",
        parent: null,
        width: CLUSTER_W,
        height: CLUSTER_H,
        mod: null,
        group,
      });
      for (const mod of shown) {
        containerOf.set(mod.slug, mod.slug);
        nodes.push({
          id: mod.slug,
          kind: "mod",
          parent: containerId,
          width: NODE_W,
          height: NODE_H,
          mod,
          group: null,
        });
      }
    } else {
      collapsedCount += shown.length;
      for (const mod of shown) containerOf.set(mod.slug, containerId);
      nodes.push({
        id: containerId,
        kind: "cluster",
        parent: null,
        width: CLUSTER_W,
        height: CLUSTER_H,
        mod: null,
        group,
      });
    }
  }

  // 2. Моды вне семейств: связанные — на поле, одиночки — на острова по side.
  const islandMembers = new Map<Side, Mod[]>();
  for (const mod of visible.values()) {
    if (containerOf.has(mod.slug)) continue;
    if (isolated.has(mod.slug)) {
      if (!filters.showIsolated) continue;
      const list = islandMembers.get(mod.side);
      if (list) list.push(mod);
      else islandMembers.set(mod.side, [mod]);
      continue;
    }
    containerOf.set(mod.slug, mod.slug);
    nodes.push({
      id: mod.slug,
      kind: "mod",
      parent: null,
      width: NODE_W,
      height: NODE_H,
      mod,
      group: null,
    });
  }

  // 3. Острова. Флейворы для группировки не годятся: у 46 из 57 одиночек их
  //    нет вообще, а у остальных — по одному персональному `<slug>_on`. Side —
  //    единственный признак, который у одиночек реально различается, и он же
  //    несёт цвет узла, так что остров читается как «зона одного цвета».
  const islands: { side: Side; count: number }[] = [];
  for (const side of ["both", "client", "server"] as const) {
    const members = islandMembers.get(side);
    if (!members?.length) continue;
    const islandId = `${ISLAND_PREFIX}${side}`;
    islands.push({ side, count: members.length });
    nodes.push({
      id: islandId,
      kind: "island",
      parent: null,
      width: CHIP_W,
      height: CHIP_H,
      mod: null,
      group: { id: side, label: SIDE_ISLAND_LABEL[side], members },
    });
    for (const mod of members) {
      containerOf.set(mod.slug, mod.slug);
      nodes.push({
        id: mod.slug,
        kind: "chip",
        parent: islandId,
        width: CHIP_W,
        height: CHIP_H,
        mod,
        group: null,
      });
    }
  }

  // 4. Рёбра. Оба конца проецируются на свои контейнеры; связь внутри одного
  //    свёрнутого семейства исчезает (94 из 200 — это и есть та самая паутина),
  //    параллельные связи между двумя контейнерами сливаются в одну с счётчиком.
  const present = new Set(nodes.map((node) => node.id));
  const merged = new Map<string, GraphEdge>();
  for (const edge of data.edges) {
    if (!edge.to) continue;
    if (filters.requiredOnly && edge.type !== "required") continue;
    const source = containerOf.get(edge.from);
    const target = containerOf.get(edge.to);
    if (!source || !target || source === target) continue;
    if (!present.has(source) || !present.has(target)) continue;

    const id = `${source}→${target}`;
    const existing = merged.get(id);
    if (existing) {
      existing.count += 1;
      existing.raw.push(edge);
      existing.required ||= edge.type === "required";
      existing.satisfied &&= edge.satisfied;
    } else {
      merged.set(id, {
        id,
        source,
        target,
        required: edge.type === "required",
        satisfied: edge.satisfied,
        count: 1,
        raw: [edge],
      });
    }
  }

  return { nodes, edges: [...merged.values()], containerOf, collapsedCount, islands };
}

/** Все узлы, до которых можно дойти из `root` по стрелкам в обе стороны, не
 *  глубже `depth`. Используется и для режима фокуса, и для подсветки цепочки
 *  при наведении — это один и тот же вопрос «что связано с этим». */
export function reachable(
  edges: readonly GraphEdge[],
  root: string,
  depth: number,
): { nodes: Set<string>; edges: Set<string> } {
  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    (out.get(edge.source) ?? out.set(edge.source, []).get(edge.source)!).push(edge);
    (inc.get(edge.target) ?? inc.set(edge.target, []).get(edge.target)!).push(edge);
  }

  const nodes = new Set([root]);
  const touched = new Set<string>();
  let frontier = [root];
  for (let step = 0; step < depth && frontier.length > 0; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of out.get(id) ?? []) {
        touched.add(edge.id);
        if (!nodes.has(edge.target)) {
          nodes.add(edge.target);
          next.push(edge.target);
        }
      }
      for (const edge of inc.get(id) ?? []) {
        touched.add(edge.id);
        if (!nodes.has(edge.source)) {
          nodes.add(edge.source);
          next.push(edge.source);
        }
      }
    }
    frontier = next;
  }
  return { nodes, edges: touched };
}

/** Сузить модель до окрестности узла. Дети раскрытых семейств тянут за собой
 *  контейнер, иначе React Flow получит сироту с parentId в пустоту. */
export function focusModel(model: GraphModel, root: string, depth: number): GraphModel {
  const { nodes, edges } = reachable(model.edges, root, depth);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  for (const id of [...nodes]) {
    const parent = byId.get(id)?.parent;
    if (parent) nodes.add(parent);
  }
  return {
    ...model,
    nodes: model.nodes.filter((node) => nodes.has(node.id)),
    edges: model.edges.filter((edge) => edges.has(edge.id)),
  };
}
