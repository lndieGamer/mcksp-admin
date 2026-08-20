"""Turn parsed jars into a dependency graph, roles, clusters and update verdicts.

The graph node is the *packwiz metafile*, never the modId: one jar can declare
several modIds, so `provider_map` (modId -> slug) is many-to-one and is the only
way an edge ever resolves.

Jar-in-Jar libraries that no metafile provides become their own nodes marked
`embedded`. Without them a bundled library reads as a missing dependency.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from jarmeta import PLATFORM_IDS, Dependency, JarMeta, ModEntry
from mavenrange import compare, parse_range

# Precedence when several apply: the most alarming one wins.
STATUS_ORDER = ["unknown", "broken", "update_blocked", "frozen", "update_safe", "current"]


@dataclass
class Node:
    slug: str
    name: str
    filename: str = ""
    side: str = "both"
    source: str = "url"
    project_id: str | None = None
    version: str | None = None
    mod_ids: list[str] = field(default_factory=list)
    size_bytes: int = 0
    flavors: list[str] = field(default_factory=list)
    role: str = "mod"
    cluster: str | None = None
    embedded: bool = False
    owner: str | None = None  # for embedded nodes: the metafile that bundles them
    date_added: str | None = None
    date_updated: str | None = None
    parse_status: str = "ok"
    status: str = "current"


@dataclass
class Edge:
    from_: str
    to: str | None  # None: nothing in the pack provides this modId
    to_mod_id: str
    type: str
    version_range: str
    satisfied: bool

    def to_dict(self) -> dict:
        return {
            "from": self.from_,
            "to": self.to,
            "to_mod_id": self.to_mod_id,
            "type": self.type,
            "version_range": self.version_range,
            "satisfied": self.satisfied,
        }


@dataclass
class PlatformRequirement:
    slug: str
    mod_id: str
    version_range: str
    satisfied: bool


@dataclass
class Candidate:
    """An available newer release, before we know whether it is allowed."""

    slug: str
    version: str | None
    ref: dict
    published_at: str | None = None
    mods: list[ModEntry] = field(default_factory=list)


@dataclass
class Graph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    provider_map: dict[str, str] = field(default_factory=dict)
    platform: list[PlatformRequirement] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)

    def incoming_required(self, slug: str) -> list[Edge]:
        return [e for e in self.edges if e.to == slug and e.type == "required"]

    def outgoing_required(self, slug: str) -> list[Edge]:
        return [e for e in self.edges if e.from_ == slug and e.type == "required"]


def apply_overrides(metas: dict[str, JarMeta], overrides: dict) -> None:
    """Fold `analyzer/overrides.toml` into parsed metadata, by metafile slug."""
    for slug, spec in (overrides.get("overrides") or {}).items():
        meta = metas.setdefault(slug, JarMeta(status="ok"))
        mod_ids = spec.get("mod_ids") or ([slug] if not meta.mods else [])
        deps = [
            Dependency(
                mod_id=str(d["mod_id"]),
                type=str(d.get("type", "required")).lower(),
                version_range=str(d.get("version_range", "")),
                side=str(d.get("side", "BOTH")).upper(),
            )
            for d in (spec.get("dependencies") or [])
            if d.get("mod_id")
        ]
        if mod_ids:
            meta.mods = [
                ModEntry(
                    mod_id=mid,
                    version=spec.get("version"),
                    display_name=spec.get("name"),
                    dependencies=deps if i == 0 else [],
                )
                for i, mid in enumerate(mod_ids)
            ]
        else:
            for mod in meta.mods:
                if spec.get("version"):
                    mod.version = spec["version"]
                if deps:
                    mod.dependencies = deps
        meta.status = "ok"
        meta.notes.append("overridden by analyzer/overrides.toml")
        if spec.get("role"):
            meta.notes.append(f"role={spec['role']}")


def build(nodes: dict[str, Node], metas: dict[str, JarMeta]) -> Graph:
    g = Graph(nodes=nodes)
    _register_providers(g, metas)
    _add_embedded_nodes(g, metas)
    _add_edges(g, metas)
    _assign_roles(g)
    _assign_clusters(g)
    return g


def _register_providers(g: Graph, metas: dict[str, JarMeta]) -> None:
    # Pack metafiles claim their modIds first; bundled copies only fill gaps.
    for pass_embedded in (False, True):
        for slug, meta in metas.items():
            if slug not in g.nodes:
                continue
            for mod in meta.mods:
                if mod.embedded != pass_embedded or mod.platform:
                    continue
                key = mod.mod_id.lower()
                if key in g.provider_map:
                    if not pass_embedded and g.provider_map[key] != slug:
                        g.warnings.append(
                            {
                                "level": "warning",
                                "code": "duplicate_mod_id",
                                "slug": slug,
                                "message": f"modId {mod.mod_id!r} also provided by "
                                f"{g.provider_map[key]!r}",
                            }
                        )
                    continue
                g.provider_map[key] = slug
                if not pass_embedded:
                    g.nodes[slug].mod_ids.append(mod.mod_id)


def _add_embedded_nodes(g: Graph, metas: dict[str, JarMeta]) -> None:
    """Give every bundled library its own node so edges into it resolve."""
    for slug, meta in metas.items():
        owner = g.nodes.get(slug)
        if owner is None:
            continue
        for mod in meta.mods:
            if not mod.embedded or mod.platform:
                continue
            key = mod.mod_id.lower()
            if g.provider_map.get(key) != slug:
                continue  # a real metafile provides it; the bundled copy is redundant
            node_slug = f"{slug}::{mod.mod_id}"
            g.provider_map[key] = node_slug
            g.nodes[node_slug] = Node(
                slug=node_slug,
                name=mod.display_name or mod.mod_id,
                side=owner.side,
                source=owner.source,
                version=mod.version,
                mod_ids=[mod.mod_id],
                flavors=list(owner.flavors),
                embedded=True,
                owner=slug,
                parse_status=meta.status,
            )


def _node_for_entry(g: Graph, slug: str, mod: ModEntry) -> str | None:
    if not mod.embedded:
        return slug
    return g.provider_map.get(mod.mod_id.lower())


def _add_edges(g: Graph, metas: dict[str, JarMeta]) -> None:
    seen: set[tuple[str, str, str]] = set()
    for slug, meta in metas.items():
        if slug not in g.nodes:
            continue
        for mod in meta.mods:
            from_slug = _node_for_entry(g, slug, mod)
            if from_slug is None or from_slug not in g.nodes:
                continue
            for dep in mod.dependencies:
                if dep.platform:
                    _record_platform(g, from_slug, dep)
                    continue
                key = (from_slug, dep.mod_id.lower(), dep.type)
                if key in seen:
                    continue
                seen.add(key)
                target = g.provider_map.get(dep.mod_id.lower())
                if target == from_slug:
                    continue  # a jar depending on a modId it provides itself
                if dep.type == "incompatible":
                    if target:
                        g.warnings.append(
                            {
                                "level": "error",
                                "code": "incompatible_present",
                                "slug": from_slug,
                                "message": f"{from_slug} declares {dep.mod_id!r} incompatible, "
                                f"but {target!r} provides it",
                            }
                        )
                    continue
                if target is None and not dep.required:
                    # An optional dependency the pack does not have is a non-event:
                    # the mod runs fine without it. Keeping the edge only fills the
                    # dependency panel with modIds nobody intends to add. Optional
                    # deps that ARE in the pack stay, version range and all.
                    continue
                target_version = g.nodes[target].version if target else None
                satisfied = bool(target) and parse_range(dep.version_range).contains(target_version)
                g.edges.append(
                    Edge(
                        from_=from_slug,
                        to=target,
                        to_mod_id=dep.mod_id,
                        type=dep.type,
                        version_range=dep.version_range,
                        satisfied=satisfied,
                    )
                )
                if target is None and dep.required:
                    g.warnings.append(
                        {
                            "level": "warning",
                            "code": "missing_dependency",
                            "slug": from_slug,
                            "message": f"required modId {dep.mod_id!r} is in neither the pack "
                            "nor any jarjar bundle",
                        }
                    )
                elif target and not satisfied and dep.required:
                    g.warnings.append(
                        {
                            "level": "error",
                            "code": "version_range_unsatisfied",
                            "slug": from_slug,
                            "message": f"needs {dep.mod_id} {dep.version_range}, pack has "
                            f"{target_version}",
                        }
                    )


def _record_platform(g: Graph, slug: str, dep: Dependency) -> None:
    g.platform.append(
        PlatformRequirement(slug=slug, mod_id=dep.mod_id, version_range=dep.version_range, satisfied=True)
    )


def check_platform(g: Graph, versions: dict[str, str]) -> None:
    """Resolve the platform layer against the pack's own minecraft/neoforge versions."""
    for req in g.platform:
        have = versions.get(req.mod_id.lower())
        req.satisfied = parse_range(req.version_range).contains(have) if have else True
        if not req.satisfied:
            g.warnings.append(
                {
                    "level": "error",
                    "code": "platform_unsatisfied",
                    "slug": req.slug,
                    "message": f"needs {req.mod_id} {req.version_range}, pack has {have}",
                }
            )


def _assign_roles(g: Graph) -> None:
    indeg = {s: len(g.incoming_required(s)) for s in g.nodes}
    outdeg = {s: len([e for e in g.outgoing_required(s) if e.to]) for s in g.nodes}
    for slug, node in g.nodes.items():
        i, o = indeg[slug], outdeg[slug]
        if i == 0 and o == 0:
            node.role = "standalone"
        elif i >= 3:
            node.role = "core"
        elif i >= 1 and o == 0:
            node.role = "library"
        elif any(e.to and indeg[e.to] >= 3 for e in g.outgoing_required(slug)):
            node.role = "addon"
        else:
            node.role = "mod"


def _assign_clusters(g: Graph) -> None:
    """Group by transitive closure from core nodes: the Create ecosystem, Jade's, ..."""
    cores = [s for s, n in g.nodes.items() if n.role == "core"]
    if not cores:
        return
    indeg = {s: len(g.incoming_required(s)) for s in g.nodes}
    # A node may reach several cores; the most depended-upon one wins.
    for core in sorted(cores, key=lambda s: indeg[s]):
        for slug in _dependents_of(g, core):
            g.nodes[slug].cluster = core
        g.nodes[core].cluster = core


def _dependents_of(g: Graph, core: str) -> set[str]:
    """Everything that reaches `core` through required edges."""
    reverse: dict[str, list[str]] = {}
    for e in g.edges:
        if e.type == "required" and e.to:
            reverse.setdefault(e.to, []).append(e.from_)
    seen, stack = set(), [core]
    while stack:
        cur = stack.pop()
        for dependent in reverse.get(cur, ()):
            if dependent not in seen:
                seen.add(dependent)
                stack.append(dependent)
    return seen


# -- update verdicts -------------------------------------------------------


@dataclass
class Blocker:
    slug: str
    version_range: str

    def to_dict(self) -> dict:
        return {"slug": self.slug, "version_range": self.version_range}


@dataclass
class Update:
    slug: str
    current_version: str | None
    candidate_version: str | None
    candidate_ref: dict
    published_at: str | None
    status: str  # safe | blocked
    blocked_by: list[Blocker] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "slug": self.slug,
            "current_version": self.current_version,
            "candidate_version": self.candidate_version,
            "candidate_ref": self.candidate_ref,
            "published_at": self.published_at,
            "status": self.status,
            "blocked_by": [b.to_dict() for b in self.blocked_by],
        }


def blockers_for(g: Graph, slug: str, candidate_version: str | None) -> list[Blocker]:
    """Who refuses `slug` at `candidate_version`, and with which range."""
    if not candidate_version:
        return []
    out = []
    for e in g.edges:
        if e.to != slug or e.type != "required":
            continue
        if not parse_range(e.version_range).contains(candidate_version):
            out.append(Blocker(slug=e.from_, version_range=e.version_range))
    return out


def evaluate_updates(g: Graph, candidates: dict[str, Candidate]) -> list[Update]:
    updates = []
    for slug, cand in candidates.items():
        node = g.nodes.get(slug)
        if node is None or not cand.version:
            continue
        if node.version and compare(cand.version, node.version) <= 0:
            continue
        blockers = blockers_for(g, slug, cand.version)
        updates.append(
            Update(
                slug=slug,
                current_version=node.version,
                candidate_version=cand.version,
                candidate_ref=cand.ref,
                published_at=cand.published_at,
                status="blocked" if blockers else "safe",
                blocked_by=blockers,
            )
        )
    return sorted(updates, key=lambda u: u.slug)


def compute_update_sets(g: Graph, updates: list[Update]) -> list[dict]:
    """Connected components of blocked updates: mods that only move together.

    An edge joins two updates when one is blocked by the other, so a component
    is exactly the set the panel offers as "update the whole Create cluster".
    """
    by_slug = {u.slug: u for u in updates}
    parent = {u.slug: u.slug for u in updates}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    missing: dict[str, set[str]] = {}
    for u in updates:
        for b in u.blocked_by:
            if b.slug in by_slug:
                union(u.slug, b.slug)
            else:
                # Nothing new released for the blocker: the set cannot complete yet.
                missing.setdefault(u.slug, set()).add(b.slug)

    groups: dict[str, list[str]] = {}
    for slug in parent:
        groups.setdefault(find(slug), []).append(slug)

    out = []
    for root, members in sorted(groups.items()):
        if len(members) == 1 and by_slug[members[0]].status == "safe":
            continue  # a lone safe update is not a "set"
        blocked_out = sorted({m for s in members for m in missing.get(s, ())})
        node = g.nodes.get(root)
        out.append(
            {
                "id": (node.cluster or root) if node else root,
                "members": sorted(members),
                "status": "partially_available" if blocked_out else "available",
                "missing": blocked_out,
            }
        )
    return out


def assign_statuses(g: Graph, updates: list[Update], frozen: set[str]) -> None:
    by_slug = {u.slug: u for u in updates}
    broken = {
        e.from_ for e in g.edges if e.type == "required" and (e.to is None or not e.satisfied)
    }
    for slug, node in g.nodes.items():
        if node.parse_status == "failed":
            node.status = "unknown"
        elif slug in broken:
            node.status = "broken"
        elif slug in by_slug:
            node.status = "update_blocked" if by_slug[slug].status == "blocked" else "update_safe"
        elif slug in frozen:
            node.status = "frozen"
        else:
            node.status = "current"
