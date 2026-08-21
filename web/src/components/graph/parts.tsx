/** Узлы и рёбра графа. Всё, что React Flow рисует на полотне.
 *
 *  Узел — обычный HTML, а не фигура на canvas: только так в него помещаются
 *  иконка мода с CDN, бейдж статуса, чип side и подсветка через CSS. Цена —
 *  фиксированный размер коробки, который должен совпадать с тем, что ушло в
 *  ELK (константы живут в lib/graph.ts).
 *
 *  Всё в этом файле обёрнуто в memo и не держит в пропсах ничего, что меняется
 *  на каждый кадр: полотно с двумя сотнями узлов перерисовывается только когда
 *  меняется раскладка, а не когда ездит мышь. */

import {
  Handle,
  Position,
  useStore,
  type Edge as RFEdge,
  type EdgeProps,
  type Node as RFNode,
  type NodeProps,
} from "@xyflow/react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { memo, useMemo } from "react";

import type { Mod, Side } from "../../lib/types";
import { ModIcon, SIDE_HEX, STATUS_CLASS, STATUS_ICON, STATUS_LABEL } from "../ui";
import { useLit } from "./highlight";

/** Уровни детализации. Коробка узла не меняется — меняется её содержимое:
 *  вдали имя набирается крупно, чтобы пережить масштабирование полотна, вблизи
 *  появляются версия, side и статус. */
const LOD_NEAR = 1.05;
const LOD_MID = 0.55;

export interface ModNodeData extends Record<string, unknown> {
  mod: Mod;
  degree: number;
  isFocused: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  members: Mod[];
  expanded: boolean;
  tone: Side | null;
}

export interface OrthoEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  required: boolean;
  satisfied: boolean;
  count: number;
}

export type ModNodeType = RFNode<ModNodeData, "mod">;
export type ChipNodeType = RFNode<ModNodeData, "chip">;
export type ClusterNodeType = RFNode<GroupNodeData, "cluster">;
export type IslandNodeType = RFNode<GroupNodeData, "island">;
export type OrthoEdgeType = RFEdge<OrthoEdgeData, "ortho">;

/** Селектор отдаёт номер ступени, а не сам зум: иначе каждый щелчок колеса
 *  перерисовывал бы все узлы, хотя картинка меняется только на трёх границах. */
function useLod(): 0 | 1 | 2 {
  return useStore((state) => {
    const zoom = state.transform[2];
    return zoom < LOD_MID ? 0 : zoom < LOD_NEAR ? 1 : 2;
  });
}

/** Незримые точки причаливания. Маршрут рисует ELK, но без хендлов React Flow
 *  отказывается связывать узлы вообще. */
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </>
  );
}

export const ModNode = memo(function ModNode({ id, data }: NodeProps<ModNodeType>) {
  const lod = useLod();
  const lit = useLit(id, "nodes");
  const { mod, degree, isFocused } = data;
  const StatusIcon = STATUS_ICON[mod.status];
  const accent = SIDE_HEX[mod.side];
  const raised = lit || isFocused;

  return (
    <div
      data-lit={lit || undefined}
      className={`node-card relative h-full w-full rounded-md border bg-gradient-to-b from-surface to-canvas/80 ${
        isFocused ? "border-accent" : lit ? "border-edge-strong" : "border-edge"
      }`}
      style={{
        // Тень — статичное значение без перехода: анимировать box-shadow на
        // двух сотнях узлов означает полный repaint слоя каждый кадр.
        boxShadow: raised
          ? `0 0 0 1px ${accent}55, 0 8px 28px -10px ${accent}80, var(--shadow-e2)`
          : "var(--shadow-e2)",
      }}
    >
      {/* Цвет узла несёт side. Планка слева, а не заливка: заливка цветом на
          214 узлах превращает поле в витраж и убивает читаемость имени. */}
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full"
        style={{ background: accent }}
      />

      {lod === 0 ? (
        <div className="flex h-full items-center gap-2 pr-3 pl-4">
          <span className="truncate text-[15px] leading-tight font-semibold text-ink">
            {mod.name}
          </span>
        </div>
      ) : (
        <div className="flex h-full items-center gap-2.5 pr-3 pl-4">
          <ModIcon slug={mod.slug} projectId={mod.project_id} source={mod.source} size={30} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-xs leading-tight font-medium text-ink">{mod.name}</span>
            {lod === 2 ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] leading-none text-faint">
                <span className="truncate">{mod.version ?? "—"}</span>
                {degree > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{degree} св.</span>
                  </>
                )}
              </span>
            ) : (
              <span className="font-mono text-[10px] leading-none text-faint">{mod.side}</span>
            )}
          </div>
          <StatusIcon
            aria-label={STATUS_LABEL[mod.status]}
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 ${STATUS_CLASS[mod.status]}`}
          />
        </div>
      )}
      <Ports />
    </div>
  );
});

/** Свёрнутое семейство: одна коробка вместо 43. Раскрытое — рамка-контейнер,
 *  внутри которой ELK разложил детей. */
export const ClusterNode = memo(function ClusterNode({ id, data }: NodeProps<ClusterNodeType>) {
  const lit = useLit(id, "nodes");
  const { label, members, expanded } = data;
  const preview = useMemo(() => members.slice(0, 5), [members]);

  if (expanded) {
    return (
      <div
        data-lit={lit || undefined}
        className="node-card h-full w-full rounded-lg border border-dashed border-edge-strong bg-raised/15"
      >
        <div className="flex items-center gap-2 px-4 pt-3.5">
          <ChevronDown aria-hidden size={14} strokeWidth={2} className="text-accent" />
          <span className="font-display text-xs font-semibold tracking-[-0.01em] text-ink">
            {label}
          </span>
          <span className="font-mono text-[10px] text-faint">{members.length}</span>
        </div>
        <Ports />
      </div>
    );
  }

  return (
    <div
      data-lit={lit || undefined}
      className={`node-card group relative h-full w-full cursor-pointer rounded-lg border bg-gradient-to-b from-raised to-surface hover:border-accent-dim ${
        lit ? "border-edge-strong" : "border-edge"
      }`}
      style={{ boxShadow: "var(--shadow-e3)" }}
    >
      {/* Стопка: свёрнутое семейство выглядит как пачка карточек, а не как
          ещё один одинокий прямоугольник. */}
      <span
        aria-hidden
        className="absolute inset-x-3 -bottom-1.5 h-1.5 rounded-b-lg border-x border-b border-edge bg-surface/80"
      />
      <span
        aria-hidden
        className="absolute inset-x-5 -bottom-3 h-1.5 rounded-b-lg border-x border-b border-edge/70 bg-surface/60"
      />

      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate font-display text-xs font-semibold text-ink">
            {label}
          </span>
          <ChevronRight
            aria-hidden
            size={14}
            strokeWidth={2}
            className="shrink-0 text-faint transition-transform duration-[var(--dur)] group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="flex -space-x-2">
            {preview.map((mod) => (
              <ModIcon
                key={mod.slug}
                slug={mod.slug}
                projectId={mod.project_id}
                source={mod.source}
                size={22}
              />
            ))}
          </span>
          <span className="font-mono text-[10px] text-faint">
            {members.length}
            {members.length > 5 ? ` · +${members.length - 5}` : ""}
          </span>
        </div>
      </div>
      <Ports />
    </div>
  );
});

/** Остров одиночек: рамка вокруг плитки чипов. */
export const IslandNode = memo(function IslandNode({ id, data }: NodeProps<IslandNodeType>) {
  const lit = useLit(id, "nodes");
  const { label, members, tone } = data;
  const accent = tone ? SIDE_HEX[tone] : "#3a4545";
  return (
    <div
      data-lit={lit || undefined}
      className="node-card h-full w-full rounded-lg border border-dashed bg-canvas/40"
      style={{ borderColor: `${accent}44` }}
    >
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <span aria-hidden className="size-2 rounded-full" style={{ background: accent }} />
        <span className="text-2xs text-muted">{label}</span>
        <span className="font-mono text-[10px] text-faint">{members.length}</span>
      </div>
      <Ports />
    </div>
  );
});

/** Одиночка внутри острова: связей нет, значит нет и повода тратить место —
 *  имя, точка side и статус, только если он не «актуален». */
export const ChipNode = memo(function ChipNode({ id, data }: NodeProps<ChipNodeType>) {
  const lit = useLit(id, "nodes");
  const { mod, isFocused } = data;
  const accent = SIDE_HEX[mod.side];
  const StatusIcon = STATUS_ICON[mod.status];
  return (
    <div
      data-lit={lit || undefined}
      className={`node-card flex h-full w-full cursor-pointer items-center gap-2 rounded-sm border bg-surface/80 px-2.5 hover:border-edge-strong ${
        isFocused ? "border-accent" : "border-edge"
      }`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: accent }} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{mod.name}</span>
      {mod.status !== "current" && (
        <StatusIcon
          aria-label={STATUS_LABEL[mod.status]}
          size={12}
          strokeWidth={1.75}
          className={`shrink-0 ${STATUS_CLASS[mod.status]}`}
        />
      )}
      <Ports />
    </div>
  );
});

/** Ортогональное ребро по маршруту ELK. Углы скругляются радиусом, который
 *  ужимается под короткое колено, иначе дуга съедает сам поворот. */
export function orthoPath(points: { x: number; y: number }[], radius = 12): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y) || 1;
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y) || 1;
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const enter = {
      x: corner.x - ((corner.x - previous.x) / inLength) * r,
      y: corner.y - ((corner.y - previous.y) / inLength) * r,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r,
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export const OrthoEdge = memo(function OrthoEdge({
  id,
  data,
  markerEnd,
}: EdgeProps<OrthoEdgeType>) {
  const lit = useLit(id, "edges");
  const points = data?.points;
  // Строка пути зависит только от маршрута ELK, а не от подсветки: пересчитывать
  // её на каждое наведение — сотня проходов по ломаным впустую.
  const path = useMemo(() => (points?.length ? orthoPath(points) : ""), [points]);
  if (!path || !data) return null;

  const { required, satisfied, count } = data;
  const color = satisfied
    ? lit
      ? "var(--color-accent)"
      : // Линия — это данные, а не разделитель, поэтому берёт цвет текстового
        // токена: --edge-strong даёт к фону 1.9:1 и рёбра просто исчезают.
        "var(--color-faint)"
    : "var(--color-danger)";
  const middle = points![Math.floor(points!.length / 2)];

  return (
    <g data-lit={lit || undefined}>
      {/* Широкая невидимая дорожка: попасть курсором в линию толщиной 1.25px
          нереально, а наведение на ребро должно работать. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        id={id}
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={lit ? 2 : 1.25}
        strokeLinecap="round"
        strokeDasharray={required ? undefined : "5 5"}
        markerEnd={markerEnd}
      />
      {/* Слитые связи: одна линия вместо пучка, число — сколько их схлопнулось. */}
      {count > 1 && (
        <text
          x={middle.x}
          y={middle.y - 6}
          textAnchor="middle"
          className="fill-faint font-mono"
          style={{ fontSize: 9 }}
        >
          {count}
        </text>
      )}
    </g>
  );
});
