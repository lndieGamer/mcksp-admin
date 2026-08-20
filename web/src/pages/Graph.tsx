import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Loading,
  Panel,
  Pill,
  PALETTE_HEX,
  STATUS_GLYPH,
  STATUS_HEX,
  STATUS_LABEL,
  Select,
  bytes,
} from "../components/ui";
import { indexOf, usePrivate, usePublic, useSession } from "../lib/data";
import type { ModStatus, Role, Side } from "../lib/types";

cytoscape.use(fcose);
cytoscape.use(dagre);

const SHAPE: Record<Role, string> = {
  core: "hexagon",
  addon: "round-rectangle",
  library: "ellipse",
  standalone: "diamond",
  mod: "round-rectangle",
};

export default function Graph() {
  const publicData = usePublic();
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();
  const admin = Boolean(session.data);

  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");

  // useSearchParams hands back a new setter identity whenever the location
  // changes, so listing it in the effect deps rebuilt cytoscape -- and relaid
  // out the graph -- on every click. The ref keeps the handler stable.
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  const [layout, setLayout] = useState<"fcose" | "dagre">("fcose");
  const [side, setSide] = useState("");
  const [flavor, setFlavor] = useState("");
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [hideLibraries, setHideLibraries] = useState(false);

  const index = useMemo(() => (publicData.data ? indexOf(publicData.data) : null), [publicData.data]);
  const selected = focus && index ? (index.bySlug.get(focus) ?? null) : null;

  const flavorIds = useMemo(() => {
    const all = new Set<string>();
    for (const mod of publicData.data?.mods ?? []) for (const id of mod.flavors) all.add(id);
    return [...all].sort();
  }, [publicData.data]);

  const elements = useMemo(() => {
    if (!publicData.data) return [];
    const visible = new Set(
      publicData.data.mods
        .filter((mod) => (!side || mod.side === side) && (!flavor || mod.flavors.includes(flavor)))
        .filter((mod) => !(hideLibraries && mod.role === "library"))
        .map((mod) => mod.slug),
    );
    const nodes = publicData.data.mods
      .filter((mod) => visible.has(mod.slug))
      .map((mod) => ({
        data: {
          id: mod.slug,
          label: `${STATUS_GLYPH[mod.status]} ${mod.name}`,
          color: STATUS_HEX[mod.status],
          shape: SHAPE[mod.role] ?? "round-rectangle",
          border: mod.embedded ? "dashed" : "solid",
        },
      }));
    const edges = publicData.data.edges
      .filter((edge) => edge.to && visible.has(edge.from) && visible.has(edge.to))
      .filter((edge) => !requiredOnly || edge.type === "required")
      .map((edge, i) => ({
        data: {
          id: `e${i}`,
          source: edge.from,
          target: edge.to as string,
          style: edge.type === "required" ? "solid" : "dashed",
          color: edge.satisfied ? PALETTE_HEX.edgeStrong : PALETTE_HEX.danger,
        },
      }));
    if (!hideIsolated) return [...nodes, ...edges];
    // Most of the pack depends on nothing. Dropping those frees the layout to
    // spread the ~30 nodes that actually have arrows, which is where crossings
    // come from in the first place.
    const linked = new Set(edges.flatMap((e) => [e.data.source, e.data.target]));
    return [...nodes.filter((n) => linked.has(n.data.id)), ...edges];
  }, [publicData.data, side, flavor, requiredOnly, hideLibraries, hideIsolated]);

  useEffect(() => {
    if (!container.current || elements.length === 0) return;
    const instance = cytoscape({
      container: container.current,
      elements,
      // Twice the default. Cytoscape warns about any value but 1; the graph
      // spans ~200 nodes, and the calibrated step makes crossing it a chore.
      wheelSensitivity: 2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            "background-opacity": 0.22,
            "border-color": "data(color)",
            "border-width": 1.5,
            "border-style": "data(border)" as unknown as cytoscape.Css.LineStyle,
            shape: "data(shape)" as unknown as cytoscape.Css.NodeShape,
            label: "data(label)",
            color: PALETTE_HEX.ink,
            "font-size": 8,
            "text-valign": "center",
            "text-max-width": "90px",
            "text-wrap": "ellipsis",
            width: 78,
            height: 26,
          },
        },
        {
          selector: "node:selected",
          style: { "border-width": 3, "background-opacity": 0.45, color: "#fff" },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "data(color)",
            "line-style": "data(style)" as unknown as cytoscape.Css.LineStyle,
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.6,
            "curve-style": "bezier",
          },
        },
      ],
      layout:
        layout === "fcose"
          ? ({
              name: "fcose",
              quality: "proof",
              randomize: true,
              numIter: 6000,
              nodeSeparation: 120,
              idealEdgeLength: 110,
              // Push unrelated nodes far apart and let edges stay short: long
              // edges over a crowded field are what tangles.
              nodeRepulsion: 12000,
              edgeElasticity: 0.25,
              gravityRange: 2.5,
              nodeDimensionsIncludeLabels: true,
              packComponents: true,
              tile: true,
            } as never)
          : ({
              name: "dagre",
              rankDir: "BT",
              nodeSep: 34,
              edgeSep: 14,
              rankSep: 90,
              // network-simplex spends longer ordering ranks than the cheaper
              // rankers, and ordering is exactly what decides crossings.
              ranker: "network-simplex",
              acyclicer: "greedy",
              nodeDimensionsIncludeLabels: true,
            } as never),
    });
    instance.on("tap", "node", (event) => setParamsRef.current({ focus: event.target.id() }));
    instance.on("tap", (event) => {
      if (event.target === instance) setParamsRef.current({});
    });
    cy.current = instance;
    return () => {
      instance.destroy();
      cy.current = null;
    };
  }, [elements, layout]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance || !focus) return;
    const node = instance.getElementById(focus);
    if (node.nonempty()) {
      instance.elements().unselect();
      node.select();
      instance.animate({ center: { eles: node }, zoom: 1.1 }, { duration: 250 });
    }
  }, [focus, elements]);

  if (publicData.isLoading) return <Loading what="граф" />;
  if (!publicData.data || !index) return <Empty>данные ещё не опубликованы</Empty>;

  const update = privateData.data?.updates.find((u) => u.slug === focus);
  const incoming = focus ? (index.incoming.get(focus) ?? []) : [];
  const outgoing = focus ? (index.outgoing.get(focus) ?? []) : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge p-3">
          <Select value={layout} onChange={(e) => setLayout(e.target.value as "fcose" | "dagre")}>
            <option value="fcose">кластеры (fcose)</option>
            <option value="dagre">дерево (dagre)</option>
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
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={requiredOnly}
              onChange={(e) => setRequiredOnly(e.target.checked)}
            />
            только обязательные рёбра
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={hideIsolated}
              onChange={(e) => setHideIsolated(e.target.checked)}
            />
            только связанные
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={hideLibraries}
              onChange={(e) => setHideLibraries(e.target.checked)}
            />
            скрыть библиотеки
          </label>
        </div>

        <div ref={container} className="h-[calc(100vh-210px)] min-h-[480px] w-full bg-canvas" />

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-edge px-3 py-2 text-2xs text-faint">
          {(Object.keys(STATUS_HEX) as ModStatus[]).map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span aria-hidden style={{ color: STATUS_HEX[status] }}>
                {STATUS_GLYPH[status]}
              </span>
              {STATUS_LABEL[status]}
            </span>
          ))}
          <span>форма — роль · пунктирная рамка — вшит через jarjar · пунктирное ребро — optional</span>
        </div>
      </Panel>

      <Panel title={selected ? selected.name : "Узел"}>
        {!selected ? (
          <p className="text-xs text-faint">Кликните по узлу, чтобы увидеть детали.</p>
        ) : (
          <div className="space-y-3 text-xs">
            <Pill status={selected.status} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
              <dt>slug</dt>
              <dd className="font-mono text-muted">{selected.slug}</dd>
              <dt>modId</dt>
              <dd className="font-mono text-muted">{selected.mod_ids.join(", ") || "—"}</dd>
              <dt>версия</dt>
              <dd className="font-mono text-muted">{selected.version ?? "—"}</dd>
              <dt>роль</dt>
              <dd className="text-muted">{selected.role}</dd>
              <dt>кластер</dt>
              <dd className="text-muted">{selected.cluster ?? "—"}</dd>
              <dt>side</dt>
              <dd className="text-muted">{selected.side}</dd>
              <dt>размер</dt>
              <dd className="text-muted">{bytes(selected.size_bytes)}</dd>
              {selected.embedded && (
                <>
                  <dt>вшит в</dt>
                  <dd className="font-mono text-muted">{selected.owner}</dd>
                </>
              )}
            </dl>

            {update?.status === "blocked" && (
              <div className="rounded border border-warn-dim bg-warn/10 p-2">
                <p className="text-warn">
                  Обновление до {update.candidate_version} блокируют:
                </p>
                <ul className="mt-1 space-y-0.5 text-warn">
                  {update.blocked_by.map((blocker) => (
                    <li key={blocker.slug} className="font-mono text-2xs">
                      {blocker.slug} требует {blocker.version_range}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1 text-faint">зависит от ({outgoing.length})</p>
              <ul className="space-y-0.5">
                {outgoing.map((edge, i) => (
                  <li key={i} className={edge.satisfied ? "text-muted" : "text-danger"}>
                    <button
                      className="font-mono hover:text-accent"
                      onClick={() => edge.to && setParams({ focus: edge.to })}
                    >
                      {edge.to ?? `${edge.to_mod_id} (нет в паке)`}
                    </button>{" "}
                    <span className="text-faint">
                      {edge.type} {edge.version_range}
                    </span>
                  </li>
                ))}
                {outgoing.length === 0 && <li className="text-faint">—</li>}
              </ul>
            </div>

            <div>
              <p className="mb-1 text-faint">нужен для ({incoming.length})</p>
              <ul className="space-y-0.5">
                {incoming.map((edge, i) => (
                  <li key={i} className="text-muted">
                    <button
                      className="font-mono hover:text-accent"
                      onClick={() => setParams({ focus: edge.from })}
                    >
                      {edge.from}
                    </button>{" "}
                    <span className="text-faint">
                      {edge.type} {edge.version_range}
                    </span>
                  </li>
                ))}
                {incoming.length === 0 && <li className="text-faint">—</li>}
              </ul>
            </div>

            {admin && !selected.embedded && (
              <div className="flex flex-wrap gap-1.5 border-t border-edge pt-3">
                {(["both", "client", "server"] as Side[])
                  .filter((value) => value !== selected.side)
                  .map((value) => (
                    <Button
                      key={value}
                      onClick={() =>
                        runner.propose(
                          { op: "set-side", targets: [selected.slug], value },
                          <p className="text-muted">
                            mods/{selected.slug}.pw.toml: <code>side</code> {selected.side} →{" "}
                            {value}
                          </p>,
                        )
                      }
                    >
                      side → {value}
                    </Button>
                  ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
