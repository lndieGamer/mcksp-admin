import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_FILTERS, buildModel, focusModel, isolatedSlugs, reachable } from "../src/lib/graph.ts";
import type { Edge, Mod, PublicData } from "../src/lib/types.ts";

function mod(slug: string, extra: Partial<Mod> = {}): Mod {
  return {
    slug,
    name: slug,
    filename: `${slug}.jar`,
    side: "both",
    source: "modrinth",
    project_id: null,
    version: "1.0",
    mod_ids: [slug],
    size_bytes: 1,
    flavors: [],
    role: "mod",
    cluster: null,
    embedded: false,
    owner: null,
    date_added: null,
    date_updated: null,
    parse_status: "ok",
    status: "current",
    ...extra,
  };
}

function edge(from: string, to: string | null, extra: Partial<Edge> = {}): Edge {
  return { from, to, to_mod_id: to ?? "missing", type: "required", version_range: "*", satisfied: true, ...extra };
}

/** Уменьшенная копия реального пака: семейство из ядра и двух аддонов, внешний
 *  потребитель семейства, библиотека под ним и один мод без связей. */
function fixture(): PublicData {
  return {
    generated_at: "2026-01-01T00:00:00Z",
    pack: { version: "1", mc: "1.21.1", loader: "neoforge", loader_version: "21" },
    mods: [
      mod("core", { cluster: "core", role: "core" }),
      mod("addon-a", { cluster: "core", role: "addon" }),
      mod("addon-b", { cluster: "core", role: "addon" }),
      mod("outsider"),
      mod("lib", { role: "library" }),
      mod("lonely", { side: "client" }),
    ],
    edges: [
      edge("addon-a", "core"),
      edge("addon-b", "core"),
      edge("outsider", "core"),
      edge("outsider", "addon-a", { type: "optional" }),
      edge("core", "lib"),
      edge("nowhere", null),
    ],
    flavor_groups: [],
    build_sizes: { full: 0, minimal: 0, without: {} },
  };
}

test("одиночки считаются по полному набору рёбер", () => {
  assert.deepEqual([...isolatedSlugs(fixture())], ["lonely"]);
});

test("свёрнутое семейство прячет свои внутренние рёбра и сливает внешние", () => {
  const model = buildModel(fixture(), EMPTY_FILTERS, new Set());

  // Три мода семейства превратились в один узел.
  assert.equal(model.collapsedCount, 3);
  assert.ok(model.nodes.some((node) => node.id === "cluster:core"));
  assert.ok(!model.nodes.some((node) => node.id === "addon-a"));

  // addon-a → core и addon-b → core схлопнулись внутрь пачки и исчезли;
  // две связи outsider → семейство слились в одну с count 2.
  const ids = model.edges.map((e) => e.id).sort();
  assert.deepEqual(ids, ["cluster:core→lib", "outsider→cluster:core"]);
  assert.equal(model.edges.find((e) => e.id === "outsider→cluster:core")?.count, 2);

  // Одиночка уехал на остров своего side и утащил контейнер.
  assert.deepEqual(model.islands, [{ side: "client", count: 1 }]);
  assert.equal(model.nodes.find((node) => node.id === "lonely")?.parent, "island:client");
});

test("раскрытие семейства возвращает внутренние связи", () => {
  const model = buildModel(fixture(), EMPTY_FILTERS, new Set(["core"]));
  assert.equal(model.collapsedCount, 0);
  assert.equal(model.nodes.find((node) => node.id === "addon-a")?.parent, "cluster:core");
  assert.ok(model.edges.some((e) => e.id === "addon-a→core"));
  assert.ok(model.edges.some((e) => e.id === "outsider→addon-a"));
});

test("фильтр обязательных рёбер убирает optional", () => {
  const model = buildModel(
    fixture(),
    { ...EMPTY_FILTERS, requiredOnly: true },
    new Set(["core"]),
  );
  assert.ok(!model.edges.some((e) => e.id === "outsider→addon-a"));
});

test("одиночки скрываются вместе со своим островом", () => {
  const model = buildModel(fixture(), { ...EMPTY_FILTERS, showIsolated: false }, new Set());
  assert.equal(model.islands.length, 0);
  assert.ok(!model.nodes.some((node) => node.id.startsWith("island:")));
});

test("обход идёт в обе стороны и упирается в заданную глубину", () => {
  const model = buildModel(fixture(), EMPTY_FILTERS, new Set(["core"]));

  const one = reachable(model.edges, "core", 1);
  assert.deepEqual([...one.nodes].sort(), ["addon-a", "addon-b", "core", "lib", "outsider"].sort());

  // От lib один шаг достаёт только core, два — всех, кто зависит от core.
  assert.deepEqual([...reachable(model.edges, "lib", 1).nodes].sort(), ["core", "lib"]);
  assert.ok(reachable(model.edges, "lib", 2).nodes.has("outsider"));
});

test("режим фокуса тащит за собой контейнер ребёнка", () => {
  const model = buildModel(fixture(), EMPTY_FILTERS, new Set(["core"]));
  const focused = focusModel(model, "addon-a", 1);
  const ids = focused.nodes.map((node) => node.id);
  assert.ok(ids.includes("addon-a"));
  assert.ok(ids.includes("cluster:core"), "родительская рамка обязана остаться");
  assert.ok(!ids.includes("lib"), "два шага дальше глубины 1");
});
