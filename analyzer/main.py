"""Analyzer entry point: pack on disk -> admin-data/*.json.

All the heavy lifting happens here so the browser only has to draw. One run
parses every jar, resolves the dependency graph, asks Modrinth/CurseForge what
is newer, and decides which of those updates the pack can actually accept.

Downloads are cached by the hash packwiz already stores, so a run with an
unchanged pack fetches no jars at all.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import graph as G
import sources
from jarmeta import JarMeta, parse_jar

ANALYZER_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = ANALYZER_DIR.parent / "admin-data"
DOWNLOAD_WORKERS = 6  # polite towards Modrinth's 300 req/min and CurseForge


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# -- cache -----------------------------------------------------------------


@dataclass
class CachedJar:
    meta: JarMeta
    size_bytes: int


class JarCache:
    """`admin-data/jar-meta/<algo>-<hash>.json`, committed to the repo.

    Not `actions/cache`: that gets evicted, and re-running the whole first pass
    costs 20 minutes of downloads every time it does.
    """

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.hits = self.misses = 0

    def _path(self, key: str) -> Path:
        return self.root / f"{re.sub(r'[^A-Za-z0-9._-]', '_', key)}.json"

    def get(self, key: str) -> CachedJar | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        self.hits += 1
        return CachedJar(JarMeta.from_dict(data["meta"]), int(data.get("size_bytes", 0)))

    def put(self, key: str, entry: CachedJar) -> None:
        self.misses += 1
        self._path(key).write_text(
            json.dumps(
                {"size_bytes": entry.size_bytes, "meta": entry.meta.to_dict()},
                indent=1,
                ensure_ascii=False,
            ),
            "utf-8",
        )


# -- git dates -------------------------------------------------------------


def git_dates(pack_root: Path) -> dict[str, tuple[str | None, str | None]]:
    """(date_added, date_updated) per metafile, from one `git log` pass.

    Needs `fetch-depth: 0`; a shallow clone silently reports wrong dates.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(pack_root), "log", "--format=%aI", "--name-only",
             "--diff-filter=AM", "--", "mods"],
            capture_output=True, text=True, check=True, encoding="utf-8",
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        log(f"warning: git dates unavailable: {exc}")
        return {}

    dates: dict[str, tuple[str | None, str | None]] = {}
    current: str | None = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        if line[0].isdigit() and "T" in line and "/" not in line:
            current = line
            continue
        if not line.startswith("mods/") or not line.endswith(".pw.toml"):
            continue
        slug = line[len("mods/"):].removesuffix(".pw.toml")
        updated = dates.get(slug, (None, None))[1] or current  # log is newest-first
        dates[slug] = (current, updated)  # last write wins = oldest commit = added
    return dates


OP_TRAILER = re.compile(r"^Op-Id:\s*(\S+)$", re.M)
OP_KIND = re.compile(r"^Op:\s*(\S+)$", re.M)


def git_history(pack_root: Path, limit: int = 200) -> list[dict]:
    """Operation journal, read back from the machine-readable commit trailers."""
    sep = "\x1e"
    try:
        out = subprocess.run(
            ["git", "-C", str(pack_root), "log", f"-{limit}",
             f"--format=%H%x1f%aI%x1f%s%x1f%b{sep}"],
            capture_output=True, text=True, check=True, encoding="utf-8",
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return []

    entries, reverted = [], set()
    for record in out.split(sep):
        parts = record.strip().split("\x1f")
        if len(parts) < 4:
            continue
        sha, date, subject, body = parts[0], parts[1], parts[2], parts[3]
        op_id = OP_TRAILER.search(body)
        if not op_id:
            continue
        kind = OP_KIND.search(body)
        if kind and kind.group(1) == "revert":
            reverted.update(re.findall(r"\b[0-9a-f]{7,40}\b", subject))
        entries.append(
            {
                "sha": sha,
                "op_id": op_id.group(1),
                "op": kind.group(1) if kind else "unknown",
                "title": subject,
                "date": date,
                "reverted": False,
            }
        )
    for e in entries:
        if any(e["sha"].startswith(r) or r.startswith(e["sha"][:7]) for r in reverted):
            e["reverted"] = True
    return entries


# -- unsup -----------------------------------------------------------------


def unsup_flavors(unsup: dict) -> tuple[dict[str, list[str]], list[dict]]:
    """metafile slug -> flavor ids, plus the group list for the public payload."""
    per_slug: dict[str, list[str]] = {}
    for slug, entry in (unsup.get("metafile") or {}).items():
        per_slug[slug] = list(entry.get("flavors") or [])

    counts: dict[str, int] = {}
    for flavors in per_slug.values():
        for f in flavors:
            counts[f] = counts.get(f, 0) + 1

    groups = []
    for gid, spec in (unsup.get("flavor_groups") or {}).items():
        groups.append(
            {
                "id": gid,
                "name": spec.get("name", gid),
                "description": spec.get("description", ""),
                "side": spec.get("side", "client"),
                "choices": [
                    {
                        "id": c.get("id", ""),
                        "name": c.get("name", ""),
                        "mod_count": counts.get(c.get("id", ""), 0),
                    }
                    for c in (spec.get("choices") or [])
                ],
            }
        )
    return per_slug, sorted(groups, key=lambda g: g["id"])


# -- jar collection --------------------------------------------------------


def collect_jars(
    pack: sources.Pack, client: sources.Client, cache: JarCache
) -> tuple[dict[str, JarMeta], dict[str, int]]:
    metas: dict[str, JarMeta] = {}
    sizes: dict[str, int] = {}

    def work(mf: sources.Metafile) -> tuple[str, CachedJar]:
        cached = cache.get(mf.cache_key)
        if cached:
            return mf.slug, cached
        log(f"  fetching {mf.slug}")
        try:
            blob = client.fetch_jar(mf)
        except Exception as exc:  # noqa: BLE001 - one bad mod must not kill the run
            meta = JarMeta()
            meta.fail(f"{mf.slug}: download failed: {exc}")
            return mf.slug, CachedJar(meta, 0)
        entry = CachedJar(parse_jar(blob, mf.filename or mf.slug), len(blob))
        cache.put(mf.cache_key, entry)
        return mf.slug, entry

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        for slug, entry in pool.map(work, pack.metafiles):
            metas[slug] = entry.meta
            sizes[slug] = entry.size_bytes
    return metas, sizes


# -- update candidates -----------------------------------------------------


def find_candidates(
    pack: sources.Pack, client: sources.Client, cache: JarCache
) -> dict[str, G.Candidate]:
    """Ask both APIs what is newer, then parse the candidate jar for its real version.

    The release string on Modrinth regularly disagrees with the version inside
    `mods.toml`, and dependency ranges are written against the latter.
    """
    candidates: dict[str, G.Candidate] = {}

    def work(mf: sources.Metafile) -> tuple[str, G.Candidate | None]:
        try:
            if mf.source == "modrinth" and mf.project_id:
                latest = client.modrinth_latest(mf.project_id, pack.minecraft, pack.loader)
                if not latest or latest.get("id") == mf.version_id:
                    return mf.slug, None
                files = latest.get("files") or []
                primary = next((f for f in files if f.get("primary")), files[0] if files else {})
                hashes = primary.get("hashes") or {}
                key = f"sha1-{hashes['sha1']}" if hashes.get("sha1") else f"mr-{latest['id']}"
                ref = {"source": "modrinth", "version_id": latest["id"],
                       "project_id": mf.project_id, "url": primary.get("url")}
                published = latest.get("date_published")
                url, size = primary.get("url"), int(primary.get("size") or 0)
            elif mf.source == "curseforge" and mf.project_id:
                latest = client.curseforge_latest(mf.project_id, pack.minecraft)
                if not latest or int(latest.get("id", 0)) == (mf.file_id or 0):
                    return mf.slug, None
                sha1 = next(
                    (h["value"] for h in (latest.get("hashes") or []) if h.get("algo") == 1), None
                )
                key = f"sha1-{sha1}" if sha1 else f"cf-{latest['id']}"
                ref = {"source": "curseforge", "file_id": latest["id"],
                       "project_id": mf.project_id}
                published = latest.get("fileDate")
                url = latest.get("downloadUrl") or sources.cf_cdn_url(
                    int(latest["id"]), latest.get("fileName", "")
                )
                size = int(latest.get("fileLength") or 0)
            else:
                return mf.slug, None
        except Exception as exc:  # noqa: BLE001
            log(f"  update check failed for {mf.slug}: {exc}")
            return mf.slug, None

        cached = cache.get(key)
        if cached is None:
            log(f"  fetching candidate {mf.slug}")
            try:
                blob = client.get(url).content if url else b""
                cached = CachedJar(parse_jar(blob, f"{mf.slug}-candidate"), len(blob) or size)
                cache.put(key, cached)
            except Exception as exc:  # noqa: BLE001
                log(f"  candidate download failed for {mf.slug}: {exc}")
                return mf.slug, None

        primary_mods = [m for m in cached.meta.mods if not m.embedded]
        version = next((m.version for m in primary_mods if m.version), None)
        return mf.slug, G.Candidate(
            slug=mf.slug, version=version, ref=ref, published_at=published, mods=primary_mods
        )

    targets = [mf for mf in pack.metafiles if mf.has_update_source]
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        for slug, cand in pool.map(work, targets):
            if cand:
                candidates[slug] = cand
    return candidates


# -- lint ------------------------------------------------------------------


def lint(
    pack: sources.Pack,
    g: G.Graph,
    metas: dict[str, JarMeta],
    flavors: dict[str, list[str]],
    client: sources.Client,
) -> list[dict]:
    findings = list(g.warnings)

    by_filename: dict[str, list[str]] = {}
    for mf in pack.metafiles:
        by_filename.setdefault(mf.filename, []).append(mf.slug)
    for filename, slugs in by_filename.items():
        if len(slugs) > 1:
            findings.append(
                {"level": "error", "code": "duplicate_filename", "slug": slugs[0],
                 "message": f"filename {filename!r} is claimed by {', '.join(slugs)}"}
            )

    known = {mf.slug for mf in pack.metafiles}
    for slug in flavors:
        if slug not in known:
            findings.append(
                {"level": "error", "code": "unsup_orphan", "slug": slug,
                 "message": "unsup.toml references a metafile that does not exist"}
            )

    for mf in pack.metafiles:
        if not mf.has_update_source:
            findings.append(
                {"level": "info", "code": "no_update_source", "slug": mf.slug,
                 "message": "no [update] block: this mod will never be offered an update"}
            )

    for slug, meta in metas.items():
        if meta.status == "failed":
            findings.append(
                {"level": "warning", "code": "unparsed", "slug": slug,
                 "message": "; ".join(meta.notes) or "jar could not be parsed"}
            )

    findings.extend(_lint_sides(pack, g, client))
    findings.extend(_lint_flavor_escapes(g, flavors))
    return findings


def _lint_sides(pack: sources.Pack, g: G.Graph, client: sources.Client) -> list[dict]:
    """`side` in the pack against what Modrinth says the mod supports.

    A mismatch here is what took the server down before (Sodium, Coastal Waves),
    so it is an error, not a note.
    """
    ids = [mf.project_id for mf in pack.metafiles if mf.source == "modrinth" and mf.project_id]
    if not ids:
        return []
    try:
        projects = client.modrinth_projects(ids)
    except Exception as exc:  # noqa: BLE001
        log(f"warning: side lint skipped: {exc}")
        return []

    out = []
    for mf in pack.metafiles:
        project = projects.get(mf.project_id or "")
        if not project:
            continue
        client_side, server_side = project.get("client_side"), project.get("server_side")
        if mf.side in ("both", "server") and server_side == "unsupported":
            out.append(
                {"level": "error", "code": "side_conflict", "slug": mf.slug,
                 "message": f"Modrinth: server_side unsupported, pack has side = {mf.side!r}"}
            )
        if mf.side in ("both", "client") and client_side == "unsupported":
            out.append(
                {"level": "error", "code": "side_conflict", "slug": mf.slug,
                 "message": f"Modrinth: client_side unsupported, pack has side = {mf.side!r}"}
            )
    return out


def _lint_flavor_escapes(g: G.Graph, flavors: dict[str, list[str]]) -> list[dict]:
    """A mod in a flavor group whose hard dependency can be switched off with it."""
    out = []
    for e in g.edges:
        if e.type != "required" or not e.to:
            continue
        own, dep = set(flavors.get(e.from_, ())), set(flavors.get(e.to, ()))
        if own and not dep and g.nodes[e.to].embedded:
            continue
        if own and dep and not (own & dep):
            out.append(
                {"level": "warning", "code": "flavor_escape", "slug": e.from_,
                 "message": f"needs {e.to!r}, which sits in a different flavor group: "
                            "turning that group off breaks the pack"}
            )
    return out


# -- build sizes -----------------------------------------------------------


def build_sizes(g: G.Graph, flavors: dict[str, list[str]], unsup: dict) -> dict:
    """Download weight per install choice. TLauncher players notice these numbers."""
    size = {s: n.size_bytes for s, n in g.nodes.items() if not n.embedded}
    full = sum(size.values())
    optional = {s for s, f in flavors.items() if f}
    per_group = {}
    for gid, spec in (unsup.get("flavor_groups") or {}).items():
        ids = {c.get("id") for c in (spec.get("choices") or [])}
        members = [s for s, f in flavors.items() if ids & set(f)]
        per_group[gid] = sum(size.get(s, 0) for s in members)
    return {
        "full": full,
        "minimal": full - sum(size.get(s, 0) for s in optional),
        "without": {gid: full - n for gid, n in sorted(per_group.items())},
    }


# -- assembly --------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run(pack_root: Path, out_dir: Path, skip_updates: bool = False) -> int:
    pack = sources.load_pack(pack_root)
    log(f"pack {pack.name} {pack.version}: {len(pack.metafiles)} metafiles")

    unsup = sources.load_unsup(pack_root / "unsup.toml")
    flavors, flavor_groups = unsup_flavors(unsup)
    dates = git_dates(pack_root)

    cache = JarCache(out_dir / "jar-meta")
    if not os.environ.get("CF_API_KEY") and any(m.source == "curseforge" for m in pack.metafiles):
        log("warning: CF_API_KEY is unset; CurseForge downloads will 401 and those mods "
            "will land in unparsed.json")

    with sources.Client() as client:
        metas, sizes = collect_jars(pack, client, cache)
        log(f"jars: {cache.hits} cached, {cache.misses} downloaded")

        overrides_path = ANALYZER_DIR / "overrides.toml"
        overrides = tomllib.loads(overrides_path.read_text("utf-8")) if overrides_path.exists() else {}
        G.apply_overrides(metas, overrides)

        nodes = {}
        for mf in pack.metafiles:
            meta = metas.get(mf.slug, JarMeta())
            primary = [m for m in meta.mods if not m.embedded]
            added, updated = dates.get(mf.slug, (None, None))
            nodes[mf.slug] = G.Node(
                slug=mf.slug,
                name=mf.name or mf.slug,
                filename=mf.filename,
                side=mf.side,
                source=mf.source,
                project_id=mf.project_id,
                version=next((m.version for m in primary if m.version), None),
                size_bytes=sizes.get(mf.slug, 0),
                flavors=flavors.get(mf.slug, []),
                date_added=added,
                date_updated=updated,
                parse_status=meta.status,
            )

        g = G.build(nodes, metas)
        G.check_platform(g, {"minecraft": pack.minecraft, pack.loader: pack.loader_version})
        log(f"graph: {len(g.nodes)} nodes, {len(g.edges)} edges")

        candidates = {} if skip_updates else find_candidates(pack, client, cache)
        updates = G.evaluate_updates(g, candidates)
        update_sets = G.compute_update_sets(g, updates)
        frozen = {mf.slug for mf in pack.metafiles if not mf.has_update_source}
        G.assign_statuses(g, updates, frozen)
        log(f"updates: {len(updates)} available, {sum(1 for u in updates if u.status=='blocked')} blocked")

        findings = lint(pack, g, metas, flavors, client)

    generated_at = now_iso()

    # Surfaced verbatim as a banner in the panel. Data, not markup, so the
    # warning disappears on the next run once the key is in place.
    notices: list[str] = []
    cf_count = sum(1 for mf in pack.metafiles if mf.source == "curseforge")
    if cf_count and not client.cf_api_key:
        notices.append(
            f"CF_API_KEY не задан: {cf_count} модов с CurseForge не разобраны, "
            "граф и вес сборки неполные"
        )

    public = {
        "generated_at": generated_at,
        "notices": notices,
        "pack": {
            "version": pack.version,
            "mc": pack.minecraft,
            "loader": pack.loader,
            "loader_version": pack.loader_version,
        },
        "mods": [
            {
                "slug": n.slug,
                "name": n.name,
                "filename": n.filename,
                "side": n.side,
                "source": n.source,
                "project_id": n.project_id,
                "version": n.version,
                "mod_ids": n.mod_ids,
                "size_bytes": n.size_bytes,
                "flavors": n.flavors,
                "role": n.role,
                "cluster": n.cluster,
                "embedded": n.embedded,
                "owner": n.owner,
                "date_added": n.date_added,
                "date_updated": n.date_updated,
                "parse_status": n.parse_status,
                "status": n.status,
            }
            for n in sorted(g.nodes.values(), key=lambda n: n.slug)
        ],
        "edges": [e.to_dict() for e in g.edges],
        "flavor_groups": flavor_groups,
        "build_sizes": build_sizes(g, flavors, unsup),
    }

    unparsed = [
        {"slug": slug, "level": "failed" if meta.status == "failed" else "warning",
         "reason": "; ".join(meta.notes)}
        for slug, meta in sorted(metas.items())
        if meta.status != "ok"
    ]

    private = {
        "generated_at": generated_at,
        "updates": [u.to_dict() for u in updates],
        "update_sets": update_sets,
        "lint": findings,
        "history": git_history(pack_root),
        "unparsed": unparsed,
        "platform": [
            {"slug": p.slug, "mod_id": p.mod_id, "version_range": p.version_range,
             "satisfied": p.satisfied}
            for p in g.platform
            if not p.satisfied
        ],
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in (("public.json", public), ("private.json", private),
                          ("unparsed.json", unparsed)):
        (out_dir / name).write_text(
            json.dumps(payload, indent=1, ensure_ascii=False) + "\n", "utf-8"
        )
    log(f"wrote {out_dir}: {len(public['mods'])} mods, {len(unparsed)} unparsed, "
        f"{len(findings)} lint findings")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pack", type=Path, default=Path("pack"), help="checkout of the pack repo")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="admin-data directory")
    ap.add_argument("--skip-updates", action="store_true",
                    help="graph only, no Modrinth/CurseForge update queries")
    args = ap.parse_args()
    if not (args.pack / "pack.toml").exists():
        log(f"error: {args.pack} is not a packwiz pack (no pack.toml)")
        return 2
    try:
        return run(args.pack.resolve(), args.out.resolve(), args.skip_updates)
    except sources.CurseForgeAuthError as exc:
        log(f"error: {exc}")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
