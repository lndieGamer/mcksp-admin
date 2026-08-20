"""The single write path into the pack repository.

Every mutation -- even flipping `side` on one mod -- goes through here, run by
`mutate.yml` under one `concurrency` group. Slower than talking to the repo
directly, and that is the trade: two concurrent operations would race on
`git push` and on `packwiz refresh`.

Real `packwiz` does the packwiz work; nothing here reimplements it in Python.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import tomledit

USER_AGENT = "lndieGamer/mcksp-admin/1.0 (github.com/lndieGamer/mcksp-admin)"
MODRINTH_API = "https://api.modrinth.com"
CURSEFORGE_API = "https://api.curseforge.com"
SIDES = ("both", "client", "server")


class OpError(RuntimeError):
    """Anything that should stop the run before it writes to the pack."""


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


_http_cache: dict[str, dict | list | None] = {}


def http_json(url: str, headers: dict[str, str] | None = None) -> dict | list | None:
    # Preflight runs twice per operation (baseline, then result); the second
    # pass must not re-ask Modrinth about the same 43 projects.
    if url in _http_cache:
        return _http_cache[url]
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            _http_cache[url] = json.load(response)
            return _http_cache[url]
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise OpError(f"GET {url} -> HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise OpError(f"GET {url} failed: {exc}") from exc


def cf_headers() -> dict[str, str]:
    key = os.environ.get("CF_API_KEY")
    if not key:
        raise OpError("CF_API_KEY is not set; CurseForge operations cannot run")
    return {"x-api-key": key}


# -- context ---------------------------------------------------------------


@dataclass
class Context:
    pack: Path
    admin_data: Path
    notes: list[str] = field(default_factory=list)

    def note(self, line: str) -> None:
        self.notes.append(line)
        log(f"  {line}")

    def metafile(self, slug: str) -> Path:
        path = self.pack / "mods" / f"{slug}.pw.toml"
        if not path.exists():
            raise OpError(f"no such mod in the pack: {slug}")
        return path

    @property
    def unsup(self) -> Path:
        return self.pack / "unsup.toml"

    def run(self, *args: str) -> str:
        result = subprocess.run(
            args, cwd=self.pack, capture_output=True, text=True, encoding="utf-8"
        )
        if result.returncode != 0:
            raise OpError(f"{' '.join(args)} failed: {(result.stderr or result.stdout).strip()}")
        return result.stdout

    def packwiz(self, *args: str) -> str:
        return self.run("packwiz", *args, "-y")

    def public_json(self) -> dict:
        path = self.admin_data / "public.json"
        return json.loads(path.read_text("utf-8")) if path.exists() else {"mods": [], "edges": []}

    def slugs(self) -> set[str]:
        return {p.name.removesuffix(".pw.toml") for p in (self.pack / "mods").glob("*.pw.toml")}


def write(path: Path, text: str) -> None:
    """Always LF, always exactly one trailing newline.

    Reading normalises line endings, so a file the old PowerShell scripts left
    with a CRLF tail gets normalised on its first edit -- one noisy diff, once,
    and clean one-line diffs from then on.
    """
    path.write_text(text.rstrip("\n") + "\n", "utf-8", newline="\n")


def apply_side(ctx: Context, slug: str, side: str) -> None:
    path = ctx.metafile(slug)
    write(path, tomledit.set_side(path.read_text("utf-8"), side))


def read_side(ctx: Context, slug: str) -> str:
    return str(tomllib.loads(ctx.metafile(slug).read_text("utf-8")).get("side", "both"))


def set_flavors(ctx: Context, slug: str, flavors: list[str]) -> None:
    text = ctx.unsup.read_text("utf-8")
    write(ctx.unsup, tomledit.refresh_flavor_counts(tomledit.set_flavors(text, slug, flavors)))


# -- Modrinth / CurseForge helpers -----------------------------------------


def modrinth_version_url(version_id: str) -> str:
    data = http_json(f"{MODRINTH_API}/v2/version/{version_id}")
    if not isinstance(data, dict):
        raise OpError(f"Modrinth has no version {version_id}")
    files = data.get("files") or []
    primary = next((f for f in files if f.get("primary")), files[0] if files else None)
    if not primary or not primary.get("url"):
        raise OpError(f"Modrinth version {version_id} has no downloadable file")
    return str(primary["url"])


def modrinth_side(project_id: str) -> str:
    """Derive `side` from what Modrinth says the mod supports."""
    project = http_json(f"{MODRINTH_API}/v2/project/{project_id}")
    if not isinstance(project, dict):
        return "both"
    client = project.get("client_side") != "unsupported"
    server = project.get("server_side") != "unsupported"
    if client and not server:
        return "client"
    if server and not client:
        return "server"
    return "both"


def add_modrinth_version(ctx: Context, version_id: str) -> None:
    """`packwiz modrinth add --version-id` trips over its own argument validation.

    The full CDN URL reaches the same `installVersionById` path and skips the
    loader-compatibility check, which is what Fabric-via-Sinytra mods need. The
    documented flag stays as a fallback in case the bug gets fixed upstream.
    """
    try:
        ctx.packwiz("modrinth", "add", modrinth_version_url(version_id))
    except OpError as exc:
        log(f"  CDN url route failed ({exc}); retrying with --version-id")
        ctx.packwiz("modrinth", "add", "--version-id", version_id)


# -- operations ------------------------------------------------------------


def op_set_side(ctx: Context, payload: dict) -> str:
    value = payload["value"]
    for slug in payload["targets"]:
        apply_side(ctx, slug, value)
        ctx.note(f"{slug}: side -> {value}")
    return f"set-side: {', '.join(payload['targets'])} -> {value}"


def op_set_flavors(ctx: Context, payload: dict) -> str:
    flavors = payload["flavors"]
    for slug in payload["targets"]:
        ctx.metafile(slug)  # refuse to reference a metafile that is not there
        set_flavors(ctx, slug, flavors)
        ctx.note(f"{slug}: flavors -> {flavors or '(removed)'}")
    joined = ", ".join(flavors) if flavors else "none"
    return f"set-flavors: {', '.join(payload['targets'])} -> {joined}"


def op_add_modrinth(ctx: Context, payload: dict) -> str:
    before = ctx.slugs()
    add_modrinth_version(ctx, payload["version_id"])
    added = sorted(ctx.slugs() - before)
    if not added:
        raise OpError("packwiz added no metafile")
    side = payload.get("side") or modrinth_side(payload.get("slug") or payload["version_id"])
    for slug in added:
        apply_side(ctx, slug, side)
        ctx.note(f"added {slug} from Modrinth, side = {side}")
    if payload.get("flavors"):
        for slug in added:
            set_flavors(ctx, slug, payload["flavors"])
    return f"add-modrinth: {', '.join(added)} ({side})"


def op_add_curseforge(ctx: Context, payload: dict) -> str:
    before = ctx.slugs()
    project_id, file_id = str(payload["project_id"]), str(payload["file_id"])
    cf_headers()  # fail early and clearly if the key is missing
    ctx.packwiz("curseforge", "add", "--addon-id", project_id, "--file-id", file_id)
    added = sorted(ctx.slugs() - before)
    if not added:
        raise OpError("packwiz added no metafile")
    side = payload.get("side", "both")
    for slug in added:
        apply_side(ctx, slug, side)
        ctx.note(f"added {slug} from CurseForge, side = {side}")
    if payload.get("flavors"):
        for slug in added:
            set_flavors(ctx, slug, payload["flavors"])
    return f"add-curseforge: {', '.join(added)} ({side})"


def op_add_url(ctx: Context, payload: dict) -> str:
    name = payload["name"]
    url = payload.get("url") or payload["release_asset_url"]
    # --force: packwiz otherwise refuses URLs it thinks it could handle itself,
    # and GitHub Releases links are exactly that case.
    ctx.packwiz("url", "add", name, url, "--force")
    side = payload.get("side", "both")
    slug = name if (ctx.pack / "mods" / f"{name}.pw.toml").exists() else None
    if slug is None:
        raise OpError(f"packwiz url add produced no mods/{name}.pw.toml")
    apply_side(ctx, slug, side)
    ctx.note(f"added {slug} from {url}, side = {side}")
    if payload.get("flavors"):
        set_flavors(ctx, slug, payload["flavors"])
    return f"add-url: {slug} ({side})"


def _update_one(ctx: Context, slug: str, ref: dict) -> None:
    """Re-add a mod at a new version, restoring what packwiz overwrites."""
    side = read_side(ctx, slug)
    flavors = tomledit.read_flavors(ctx.unsup.read_text("utf-8")).get(slug, [])
    if ref.get("source") == "modrinth":
        add_modrinth_version(ctx, str(ref["version_id"]))
    elif ref.get("source") == "curseforge":
        cf_headers()
        ctx.packwiz("curseforge", "add", "--addon-id", str(ref["project_id"]),
                    "--file-id", str(ref["file_id"]))
    else:
        raise OpError(f"{slug}: candidate_ref has no usable source: {ref}")
    apply_side(ctx, slug, side)
    if flavors:
        set_flavors(ctx, slug, flavors)
    ctx.note(f"{slug}: updated, side and flavors preserved")


def op_update_mod(ctx: Context, payload: dict) -> str:
    targets = payload["targets"]
    updates = {u["slug"]: u for u in _private(ctx).get("updates", [])}
    for slug in targets:
        ctx.metafile(slug)
        if payload.get("version_id"):
            ref = {"source": "modrinth", "version_id": payload["version_id"]}
        elif slug in updates:
            ref = updates[slug]["candidate_ref"]
        else:
            raise OpError(f"{slug}: no candidate known; run analyze first")
        _update_one(ctx, slug, ref)
    return f"update-mod: {', '.join(targets)}"


def op_update_set(ctx: Context, payload: dict) -> str:
    private = _private(ctx)
    sets = {s["id"]: s for s in private.get("update_sets", [])}
    target = sets.get(payload["set_id"])
    if target is None:
        raise OpError(f"no such update set: {payload['set_id']}")
    if target.get("missing"):
        raise OpError(
            f"update set {target['id']} is incomplete; still waiting on: "
            + ", ".join(target["missing"])
        )
    updates = {u["slug"]: u for u in private.get("updates", [])}
    for slug in target["members"]:
        if slug not in updates:
            raise OpError(f"{slug} is in the set but has no candidate")
    for slug in target["members"]:
        _update_one(ctx, slug, updates[slug]["candidate_ref"])
    return f"update-set: {target['id']} ({len(target['members'])} mods)"


def op_remove_mod(ctx: Context, payload: dict) -> str:
    targets = payload["targets"]
    for slug in targets:
        ctx.metafile(slug)
        ctx.packwiz("remove", slug)
        set_flavors(ctx, slug, [])
        ctx.note(f"removed {slug}")
    reason = payload.get("reason")
    return f"remove-mod: {', '.join(targets)}" + (f" ({reason})" if reason else "")


def op_set_pack_version(ctx: Context, payload: dict) -> str:
    path = ctx.pack / "pack.toml"
    write(path, tomledit.set_pack_version(path.read_text("utf-8"), payload["version"]))
    ctx.note(f"pack version -> {payload['version']}")
    return f"set-pack-version: {payload['version']}"


def op_revert(ctx: Context, payload: dict) -> str:
    sha = payload["sha"]
    ctx.run("git", "revert", "--no-commit", "--no-edit", sha)
    ctx.note(f"reverted {sha}")
    # Going through the same workflow and the same queue is the point: reverting
    # out of band could undo a commit that newer work already builds on.
    return f"revert: {sha[:12]}"


def _private(ctx: Context) -> dict:
    path = ctx.admin_data / "private.json"
    if not path.exists():
        raise OpError("admin-data/private.json is missing; run analyze first")
    return json.loads(path.read_text("utf-8"))


OPS = {
    "set-side": op_set_side,
    "set-flavors": op_set_flavors,
    "add-modrinth": op_add_modrinth,
    "add-curseforge": op_add_curseforge,
    "add-url": op_add_url,
    "add-jar": op_add_url,
    "update-mod": op_update_mod,
    "update-set": op_update_set,
    "remove-mod": op_remove_mod,
    "set-pack-version": op_set_pack_version,
    "revert": op_revert,
}

REQUIRED: dict[str, tuple[tuple[str, type], ...]] = {
    "set-side": (("targets", list), ("value", str)),
    "set-flavors": (("targets", list), ("flavors", list)),
    "add-modrinth": (("version_id", str),),
    "add-curseforge": (("project_id", (int, str)), ("file_id", (int, str))),
    "add-url": (("name", str), ("url", str)),
    "add-jar": (("name", str), ("release_asset_url", str)),
    "update-mod": (("targets", list),),
    "update-set": (("set_id", str),),
    "remove-mod": (("targets", list),),
    "set-pack-version": (("version", str),),
    "revert": (("sha", str),),
}

SLUG_RE = re.compile(r"^[A-Za-z0-9._+-]{1,120}$")


def validate(payload: dict) -> None:
    """Reject a bad request before a single file is touched."""
    op = payload.get("op")
    if op not in OPS:
        raise OpError(f"unknown op {op!r}; expected one of {', '.join(sorted(OPS))}")
    for key, kind in REQUIRED[op]:
        if key not in payload:
            raise OpError(f"{op}: missing required field {key!r}")
        if not isinstance(payload[key], kind):
            raise OpError(f"{op}: field {key!r} must be {kind}")
    for slug in payload.get("targets", []):
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            raise OpError(f"{op}: bad target {slug!r}")
    if op == "set-side" and payload["value"] not in SIDES:
        raise OpError(f"set-side: value must be one of {SIDES}")
    if op == "revert" and not re.fullmatch(r"[0-9a-fA-F]{7,40}", payload["sha"]):
        raise OpError("revert: sha must be a hex commit id")
    for url_key in ("url", "release_asset_url"):
        url = payload.get(url_key)
        if url is not None and not str(url).startswith("https://"):
            raise OpError(f"{op}: {url_key} must be an https URL")


# -- preflight -------------------------------------------------------------


def preflight(ctx: Context) -> list[str]:
    """The state of the pack, expressed as a list of problems.

    Called twice per operation -- once on the untouched checkout, once on the
    edited one -- and only the difference blocks. Failing on the absolute list
    would brick the panel: the pack already carries two long-standing side
    mismatches, and nothing would ever be committable again.
    """
    errors: list[str] = []
    metafiles = {}
    for path in sorted((ctx.pack / "mods").glob("*.pw.toml")):
        try:
            metafiles[path.name.removesuffix(".pw.toml")] = tomllib.loads(path.read_text("utf-8"))
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"{path.name}: not valid TOML after the edit: {exc}")
    if errors:
        return errors

    sides = {slug: str(data.get("side", "both")) for slug, data in metafiles.items()}

    by_filename: dict[str, list[str]] = {}
    for slug, data in metafiles.items():
        by_filename.setdefault(str(data.get("filename", "")), []).append(slug)
    for filename, slugs in sorted(by_filename.items()):
        if len(slugs) > 1:
            errors.append(f"duplicate filename {filename!r}: {', '.join(sorted(slugs))}")

    flavors: dict[str, list[str]] = {}
    if ctx.unsup.exists():
        try:
            flavors = tomledit.read_flavors(ctx.unsup.read_text("utf-8"))
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"unsup.toml: not valid TOML after the edit: {exc}")
    for slug in sorted(flavors):
        if slug not in metafiles:
            errors.append(f"unsup.toml references {slug!r}, which has no metafile")

    edges = [e for e in ctx.public_json().get("edges", []) if e.get("type") == "required"]
    for edge in edges:
        source, target = edge.get("from"), edge.get("to")
        if not target or target not in sides or source not in sides:
            continue
        if sides[source] in ("both", "server") and sides[target] == "client":
            errors.append(
                f"{source} (side={sides[source]}) requires {target}, which is client-only"
            )
        own, dependency = set(flavors.get(source, ())), set(flavors.get(target, ()))
        if own and dependency and not (own & dependency):
            errors.append(
                f"{source} requires {target}, but they share no flavor: turning "
                f"{target}'s group off would break the pack"
            )

    errors.extend(_preflight_modrinth_sides(metafiles, sides))
    return errors


def _preflight_modrinth_sides(metafiles: dict[str, dict], sides: dict[str, str]) -> list[str]:
    """`side` against what Modrinth reports. A block, not a warning.

    Exactly this mismatch took the server down before (Sodium, Coastal Waves).
    """
    ids = {}
    for slug, data in metafiles.items():
        mod_id = ((data.get("update") or {}).get("modrinth") or {}).get("mod-id")
        if mod_id:
            ids[slug] = str(mod_id)
    if not ids:
        return []

    projects: dict[str, dict] = {}
    unique = sorted(set(ids.values()))
    for start in range(0, len(unique), 100):
        chunk = unique[start : start + 100]
        payload = "%5B" + ",".join(f"%22{i}%22" for i in chunk) + "%5D"
        try:
            data = http_json(f"{MODRINTH_API}/v2/projects?ids={payload}")
        except OpError as exc:
            log(f"warning: Modrinth side check skipped: {exc}")
            return []
        for project in data if isinstance(data, list) else []:
            projects[project["id"]] = project

    errors = []
    for slug, mod_id in sorted(ids.items()):
        project = projects.get(mod_id)
        if not project:
            continue
        side = sides.get(slug, "both")
        if side in ("both", "server") and project.get("server_side") == "unsupported":
            errors.append(f"{slug}: Modrinth says server_side unsupported, pack has side={side}")
        if side in ("both", "client") and project.get("client_side") == "unsupported":
            errors.append(f"{slug}: Modrinth says client_side unsupported, pack has side={side}")
    return errors


# -- commit ----------------------------------------------------------------


def commit(ctx: Context, title: str, request_id: str, payload: dict) -> bool:
    if len(title) > 200:
        title = title[:197] + "..."
    message = (
        f"{title}\n\n"
        f"Op-Id: {request_id}\n"
        f"Op: {payload['op']}\n"
        f"Op-Payload: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n"
    )
    ctx.run("git", "add", "-A")
    staged = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ctx.pack, capture_output=True
    )
    if staged.returncode == 0:
        log("nothing changed; no commit")
        return False
    ctx.run("git", "commit", "-m", message)
    return True


def summary(path: str | None, title: str, ctx: Context, errors: list[str]) -> None:
    lines = [f"## {title}", ""]
    lines += [f"- {note}" for note in ctx.notes] or ["- (no changes)"]
    if errors:
        lines += ["", "### Preflight failed", ""] + [f"- {e}" for e in errors]
    text = "\n".join(lines) + "\n"
    print(text)
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--payload", required=True, help="JSON string, or @path to a file")
    parser.add_argument("--pack", type=Path, default=Path("pack"))
    parser.add_argument("--admin-data", type=Path, default=Path("admin-data"))
    parser.add_argument("--dry-run", action="store_true", help="edit and validate, do not commit")
    args = parser.parse_args()

    raw = (
        Path(args.payload[1:]).read_text("utf-8") if args.payload.startswith("@") else args.payload
    )
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    ctx = Context(pack=args.pack.resolve(), admin_data=args.admin_data.resolve())

    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise OpError("payload must be a JSON object")
        validate(payload)
    except (json.JSONDecodeError, OpError) as exc:
        # Nothing has been written yet, so there is nothing to roll back.
        summary(step_summary, "rejected", ctx, [str(exc)])
        return 2

    def rollback() -> None:
        ctx.run("git", "checkout", "--", ".")
        ctx.run("git", "clean", "-fd", "mods")

    baseline = set(preflight(ctx))
    if baseline:
        ctx.note(f"{len(baseline)} pre-existing lint problems, carried over unchanged")

    try:
        title = OPS[payload["op"]](ctx, payload)
    except OpError as exc:
        rollback()
        summary(step_summary, f"{payload['op']} failed", ctx, [str(exc)])
        return 1

    introduced = sorted(set(preflight(ctx)) - baseline)
    if introduced:
        rollback()
        summary(step_summary, f"{payload['op']} blocked by preflight", ctx, introduced)
        return 1

    try:
        ctx.packwiz("refresh")
    except OpError as exc:
        rollback()
        summary(step_summary, f"{payload['op']} failed at refresh", ctx, [str(exc)])
        return 1

    if args.dry_run:
        summary(step_summary, f"{title} (dry run)", ctx, [])
        return 0

    changed = commit(ctx, title, args.request_id, payload)
    summary(step_summary, title if changed else f"{title} (no-op)", ctx, [])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
