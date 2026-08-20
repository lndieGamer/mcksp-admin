import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useRunner } from "../components/OpRunner";
import {
  Button,
  Empty,
  Loading,
  Page,
  PageTitle,
  Pill,
  PALETTE_HEX,
  STATUS_FILL,
  STATUS_GLYPH,
  STATUS_HEX,
  STATUS_LABEL,
  Select,
  bytes,
} from "../components/ui";
import { indexOf, usePrivate, usePublic, useSession } from "../lib/data";
import type { ModStatus, Role, Side } from "../lib/types";

cytoscape.use(fcose);

/** Role is carried by the outline, so every shape gets a size that still reads
 *  as that shape at 100%: a diamond needs square room, a library pill does not. */
const ROLE: Record<Role, { shape: string; w: number; h: number }> = {
  core: { shape: "hexagon", w: 40, h: 36 },
  addon: { shape: "round-rectangle", w: 42, h: 26 },
  library: { shape: "ellipse", w: 32, h: 24 },
  standalone: { shape: "diamond", w: 36, h: 36 },
  mod: { shape: "round-rectangle", w: 42, h: 26 },
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

  const [side, setSide] = useState("");
  const [flavor, setFlavor] = useState("");
  const [requiredOnly, setRequiredOnly] = useState(false);
  // On by default: 160 of the 200 mods depend on nothing, and fcose tiles them
  // into a grid that swallows the ~40 nodes with arrows -- and pushes the fit
  // zoom so far out that no label survives. The checkbox brings them back.
  const [hideIsolated, setHideIsolated] = useState(true);
  const [hideLibraries, setHideLibraries] = useState(false);

  const index = useMemo(
    () => (publicData.data ? indexOf(publicData.data) : null),
    [publicData.data],
  );
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
      .map((mod) => {
        const role = ROLE[mod.role] ?? ROLE.mod;
        return {
          data: {
            id: mod.slug,
            label: `${STATUS_GLYPH[mod.status]} ${mod.name}`,
            color: STATUS_HEX[mod.status],
            fill: STATUS_FILL[mod.status],
            shape: role.shape,
            w: role.w,
            h: role.h,
            border: mod.embedded ? "dashed" : "solid",
          },
        };
      });
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
      minZoom: 0.15,
      maxZoom: 3,
      style: [
        {
          selector: "node",
          style: {
            // A solid blend beats `background-opacity` on a saturated hex: the
            // alpha composite muddies every status into the same brown-grey.
            "background-color": "data(fill)",
            "border-color": "data(color)",
            // Whole pixels only. 1.5 lands on a half-pixel of the canvas and
            // renders as a soft two-pixel smear, which is what reads as "thick".
            "border-width": 1,
            "border-style": "data(border)" as unknown as cytoscape.Css.LineStyle,
            shape: "data(shape)" as unknown as cytoscape.Css.NodeShape,
            width: "data(w)",
            height: "data(h)",
            label: "data(label)",
            color: PALETTE_HEX.muted,
            // The label sits under the node instead of inside it. Inside, any
            // name longer than the shape spilled across its own outline.
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 5,
            "font-family": "IBM Plex Sans, sans-serif",
            "font-size": 12,
            "text-max-width": "150px",
            "text-wrap": "ellipsis",
            // Cytoscape bakes node and label into one bitmap per zoom level, so
            // an 11px label at 0.5x is rendered at 5px and then smeared. Below
            // the threshold the name is dropped instead of turned to mush.
            "min-zoomed-font-size": 8,
            // Names overlap edges and each other once the layout is dense; the
            // canvas-coloured outline keeps each one legible without a plate.
            "text-outline-color": PALETTE_HEX.canvas,
            "text-outline-width": 2,
            "text-outline-opacity": 1,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-color": PALETTE_HEX.accent,
            "border-width": 2,
            "background-color": PALETTE_HEX.raised,
            color: PALETTE_HEX.ink,
            "font-weight": 500,
            "z-index": 10,
          },
        },
        {
          selector: "node:active",
          style: { "overlay-color": PALETTE_HEX.accent, "overlay-opacity": 0.12 },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            opacity: 0.8,
            "line-color": "data(color)",
            "line-style": "data(style)" as unknown as cytoscape.Css.LineStyle,
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            "curve-style": "bezier",
          },
        },
      ],
      layout: {
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
      } as never,
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
  }, [elements]);

  // The canvas lives in a flex row, so a window resize changes its box without
  // changing the window's own layout the renderer watches.
  useEffect(() => {
    const box = container.current;
    if (!box) return;
    const observer = new ResizeObserver(() => cy.current?.resize());
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

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
  const nodeCount = elements.filter((e) => !("source" in e.data)).length;
  const edgeCount = elements.length - nodeCount;

  return (
    <Page scroll={false}>
      <PageTitle count={`${nodeCount} узлов · ${edgeCount} связей`}>граф</PageTitle>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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

          <div
            ref={container}
            className="min-h-[320px] flex-1 rounded-md border border-edge bg-canvas"
          />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
            {(Object.keys(STATUS_HEX) as ModStatus[]).map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span aria-hidden style={{ color: STATUS_HEX[status] }}>
                  {STATUS_GLYPH[status]}
                </span>
                {STATUS_LABEL[status]}
              </span>
            ))}
            <span className="text-faint">
              форма — роль · пунктирная рамка — вшит через jarjar · пунктирное ребро — optional
            </span>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-edge pl-4">
          {!selected ? (
            <p className="text-sm text-faint">
              Кликните по узлу, чтобы увидеть зависимости в обе стороны.
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5 border-b border-edge pb-3">
                <h2 className="text-lg font-medium text-ink">{selected.name}</h2>
                <Pill status={selected.status} />
              </div>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <Fact label="slug" mono>
                  {selected.slug}
                </Fact>
                <Fact label="modId" mono>
                  {selected.mod_ids.join(", ") || "—"}
                </Fact>
                <Fact label="версия" mono>
                  {selected.version ?? "—"}
                </Fact>
                <Fact label="роль">{selected.role}</Fact>
                <Fact label="кластер">{selected.cluster ?? "—"}</Fact>
                <Fact label="side" mono>
                  {selected.side}
                </Fact>
                <Fact label="размер" mono>
                  {bytes(selected.size_bytes)}
                </Fact>
                {selected.embedded && (
                  <Fact label="вшит в" mono>
                    {selected.owner}
                  </Fact>
                )}
              </dl>

              {update?.status === "blocked" && (
                <div className="rounded-sm border border-warn-dim bg-warn/10 p-2.5">
                  <p className="text-xs text-warn">
                    Обновление до {update.candidate_version} блокируют:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {update.blocked_by.map((blocker) => (
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
                  // Packwiz names a metafile after the project slug of the day, so
                  // Moonlight Lib still lives in `selene.pw.toml`. Showing the slug
                  // here made its dependents look like they wanted a foreign lib.
                  label: edge.to
                    ? (index.bySlug.get(edge.to)?.name ?? edge.to)
                    : `${edge.to_mod_id} (нет в паке)`,
                  meta: `${edge.type} ${edge.version_range}`,
                  broken: !edge.satisfied,
                  go: edge.to ? () => setParams({ focus: edge.to as string }) : undefined,
                }))}
              />

              <Links
                title={`нужен для (${incoming.length})`}
                items={incoming.map((edge) => ({
                  key: edge.from,
                  label: index.bySlug.get(edge.from)?.name ?? edge.from,
                  meta: `${edge.type} ${edge.version_range}`,
                  broken: false,
                  go: () => setParams({ focus: edge.from }),
                }))}
              />

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
        </aside>
      </div>
    </Page>
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
      <dt className="text-faint">{label}</dt>
      <dd className={`min-w-0 break-words text-muted ${mono ? "font-mono text-xs" : ""}`}>
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
  items: {
    key: string;
    label: string;
    meta: string;
    broken: boolean;
    go?: () => void;
  }[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-faint">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-faint">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={`${item.key}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
              {item.go ? (
                <button
                  className={`text-left font-mono text-xs underline decoration-transparent underline-offset-2 transition-colors duration-[--dur-fast] hover:decoration-accent-dim ${
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
              <span className="font-mono text-2xs text-faint">{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
