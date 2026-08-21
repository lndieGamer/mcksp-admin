/** Раскладка графа через ELK layered.
 *
 *  Силовая раскладка (fcose) на этом паке обречена: `create` держит 51 связь,
 *  пружины стягивают его соседей в один ком, и любое ребро через ком даёт
 *  пересечение. Layered решает другую задачу — расставляет узлы по слоям и
 *  явно минимизирует число пересечений перестановкой внутри слоя (LAYER_SWEEP),
 *  а рёбра ведёт по ортогональным каналам между слоями.
 *
 *  ponytail: ELK крутится в основном потоке (elk.bundled). На 90 узлах это
 *  ~150мс, скачок заметен только при раскрытии большого семейства. Если станет
 *  мешать — у elkjs есть elk-worker.js, менять придётся только эту функцию. */

import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

import { CLUSTER_PREFIX, ISLAND_PREFIX, type GraphEdge, type GraphNode } from "./graph";

const elk = new ELK();

/** Заголовок контейнера рисуется поверх его области, поэтому сверху нужен
 *  отступ, которого нет с трёх других сторон. */
const CONTAINER_PADDING = "[top=52,left=20,bottom=20,right=20]";

const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  // Рёбра между узлами из разных контейнеров объявлены на корне; без этого ELK
  // считает контейнер чёрным ящиком и ведёт стрелку в его край.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.thoroughness": "40",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
  // Пучок стрелок в один и тот же узел сливается в общий ствол с развилкой на
  // подходе. Для хаба с 51 входом это разница между расчёской и деревом.
  "elk.layered.mergeEdges": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": "128",
  "elk.layered.spacing.edgeNodeBetweenLayers": "32",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
  "elk.spacing.nodeNode": "40",
  "elk.spacing.edgeNode": "28",
  "elk.spacing.edgeEdge": "14",
  // Несвязанные куски — отдельные компоненты; без разделения ELK вкладывает их
  // друг в друга и острова одиночек садятся поверх основного дерева.
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "96",
  // Пак состоит в основном из мелких несвязанных кусков. Без пропорции ELK
  // складывает их в одну высокую колонку, и поле уезжает за нижний край экрана
  // вместо того, чтобы расстелиться по ширине монитора.
  "elk.aspectRatio": "1.8",
};

const CLUSTER_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.padding": CONTAINER_PADDING,
  "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
};

const ISLAND_OPTIONS: Record<string, string> = {
  // Одиночкам не нужны слои — им нужна плотная плитка с читаемой пропорцией.
  "elk.algorithm": "rectpacking",
  "elk.aspectRatio": "2.4",
  "elk.padding": CONTAINER_PADDING,
  "elk.spacing.nodeNode": "12",
};

export interface Placed {
  positions: Map<string, { x: number; y: number }>;
  /** Размер контейнеров ELK считает сам — он зависит от содержимого. */
  sizes: Map<string, { width: number; height: number }>;
  /** id ребра → ломаная в координатах полотна. */
  routes: Map<string, { x: number; y: number }[]>;
  bounds: { width: number; height: number };
}

export async function layout(nodes: GraphNode[], edges: GraphEdge[]): Promise<Placed> {
  const byParent = new Map<string | null, GraphNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parent);
    if (list) list.push(node);
    else byParent.set(node.parent, [node]);
  }

  const toElk = (node: GraphNode): ElkNode => {
    const children = byParent.get(node.id) ?? [];
    if (children.length === 0) {
      return { id: node.id, width: node.width, height: node.height };
    }
    return {
      id: node.id,
      layoutOptions: node.id.startsWith(ISLAND_PREFIX) ? ISLAND_OPTIONS : CLUSTER_OPTIONS,
      children: children.map(toElk),
    };
  };

  const graph: ElkNode = {
    id: "root",
    layoutOptions: ROOT_OPTIONS,
    children: (byParent.get(null) ?? []).map(toElk),
    edges: edges.map<ElkExtendedEdge>((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { width: number; height: number }>();
  const routes = new Map<string, { x: number; y: number }[]>();

  // React Flow ждёт позицию ребёнка относительно родителя — ровно в том виде,
  // в каком её отдаёт ELK. Рёбрам, наоборот, нужны абсолютные координаты, а их
  // ELK кладёт относительно контейнера, где объявлено ребро (у нас — корень).
  const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
    for (const child of node.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
      sizes.set(child.id, { width: child.width ?? 0, height: child.height ?? 0 });
      walk(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0));
    }
    for (const edge of (node.edges ?? []) as ElkExtendedEdge[]) {
      const section = edge.sections?.[0];
      if (!section) continue;
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      routes.set(
        edge.id,
        points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY })),
      );
    }
  };
  walk(result, 0, 0);

  return {
    positions,
    sizes,
    routes,
    bounds: { width: result.width ?? 0, height: result.height ?? 0 },
  };
}

export const isCluster = (id: string) => id.startsWith(CLUSTER_PREFIX);
export const isIsland = (id: string) => id.startsWith(ISLAND_PREFIX);
export const clusterIdOf = (id: string) => id.slice(CLUSTER_PREFIX.length);
