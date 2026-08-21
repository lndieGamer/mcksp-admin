"""Read mod identity and dependencies out of a NeoForge jar.

A jar is a plain ZIP and everything we need sits in it as text, so there is no
decompilation here: `zipfile` plus `tomllib` covers the whole job.

Four cases the handoff calls out, all handled automatically:

1. ``version="${file.jarVersion}"`` -- resolved from ``META-INF/MANIFEST.MF``.
2. Jar-in-Jar (``META-INF/jarjar/*.jar``) -- recursed into; those mods are
   marked ``embedded`` because they satisfy dependencies without being pack
   entries of their own.
3. One jar declaring several ``[[mods]]`` -- kept as a list, never collapsed.
4. Pseudo-mods (``minecraft``, ``neoforge``, ...) -- flagged so the caller can
   keep them out of the mod graph while still version-checking them.
"""

from __future__ import annotations

import io
import re
import tomllib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

MODS_TOML_PATHS = ("META-INF/neoforge.mods.toml", "META-INF/mods.toml")
JARJAR_DIR = "META-INF/jarjar/"
MAX_JARJAR_DEPTH = 3

# Not mods of the pack: the loader/runtime layer. Version-checked, not graphed.
PLATFORM_IDS = frozenset(
    {"minecraft", "neoforge", "forge", "java", "mcp", "fml", "javafml", "lowcodefml"}
)

_PLACEHOLDER_RE = re.compile(r"\$\{([^}]*)\}")


@dataclass(frozen=True)
class Dependency:
    mod_id: str
    type: str = "required"
    version_range: str = ""
    side: str = "BOTH"
    ordering: str = "NONE"

    @property
    def required(self) -> bool:
        return self.type == "required"

    @property
    def platform(self) -> bool:
        return self.mod_id.lower() in PLATFORM_IDS


@dataclass
class ModEntry:
    mod_id: str
    version: str | None = None
    display_name: str | None = None
    embedded: bool = False
    dependencies: list[Dependency] = field(default_factory=list)

    @property
    def platform(self) -> bool:
        return self.mod_id.lower() in PLATFORM_IDS


@dataclass
class JarMeta:
    mods: list[ModEntry] = field(default_factory=list)
    loader_version: str | None = None
    status: str = "ok"  # ok | warning | failed
    notes: list[str] = field(default_factory=list)

    def warn(self, note: str) -> None:
        self.notes.append(note)
        if self.status == "ok":
            self.status = "warning"

    def fail(self, note: str) -> None:
        self.notes.append(note)
        self.status = "failed"

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "notes": self.notes,
            "loader_version": self.loader_version,
            "mods": [
                {
                    "mod_id": m.mod_id,
                    "version": m.version,
                    "display_name": m.display_name,
                    "embedded": m.embedded,
                    "dependencies": [
                        {
                            "mod_id": d.mod_id,
                            "type": d.type,
                            "version_range": d.version_range,
                            "side": d.side,
                            "ordering": d.ordering,
                        }
                        for d in m.dependencies
                    ],
                }
                for m in self.mods
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "JarMeta":
        return cls(
            mods=[
                ModEntry(
                    mod_id=m["mod_id"],
                    version=m.get("version"),
                    display_name=m.get("display_name"),
                    embedded=m.get("embedded", False),
                    dependencies=[Dependency(**d) for d in m.get("dependencies", [])],
                )
                for m in data.get("mods", [])
            ],
            loader_version=data.get("loader_version"),
            status=data.get("status", "ok"),
            notes=list(data.get("notes", [])),
        )


def _read_manifest(zf: zipfile.ZipFile) -> dict[str, str]:
    """Parse MANIFEST.MF, joining the 72-column continuation lines."""
    try:
        raw = zf.read("META-INF/MANIFEST.MF").decode("utf-8", "replace")
    except KeyError:
        return {}
    attrs: dict[str, str] = {}
    key: str | None = None
    for line in raw.splitlines():
        if line.startswith(" ") and key:  # continuation of the previous value
            attrs[key] += line[1:]
        elif ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            attrs[key] = value.strip()
        else:
            key = None
    return attrs


def _resolve_placeholders(value: str, manifest: dict[str, str]) -> str | None:
    """Expand `${file.jarVersion}`-style placeholders; None if any stays unresolved."""
    unresolved = False

    def sub(match: re.Match[str]) -> str:
        nonlocal unresolved
        name = match.group(1)
        # `file.jarVersion` is by far the most common, but any `file.X` maps to
        # a manifest attribute; NeoForge reads them from the main section.
        candidates = [
            "Implementation-Version" if name == "file.jarVersion" else None,
            name.rsplit(".", 1)[-1],
            name,
        ]
        for c in candidates:
            if c and manifest.get(c):
                return manifest[c]
        unresolved = True
        return match.group(0)

    result = _PLACEHOLDER_RE.sub(sub, value)
    return None if unresolved else result


def _load_mods_toml(zf: zipfile.ZipFile) -> tuple[dict | None, str | None]:
    for path in MODS_TOML_PATHS:
        try:
            raw = zf.read(path)
        except KeyError:
            continue
        try:
            return tomllib.loads(raw.decode("utf-8-sig", "replace")), path
        except tomllib.TOMLDecodeError as exc:
            raise ValueError(f"{path}: {exc}") from exc
    return None, None


def _dependencies_for(data: dict, mod_id: str) -> list[Dependency]:
    table = data.get("dependencies")
    if not isinstance(table, dict):
        return []
    # Key is the owning modId; match case-insensitively, real packs are sloppy.
    entries = None
    for key, value in table.items():
        if key.lower() == mod_id.lower():
            entries = value
            break
    if not isinstance(entries, list):
        return []
    out = []
    for e in entries:
        if not isinstance(e, dict) or not e.get("modId"):
            continue
        dep_type = e.get("type")
        if not dep_type:
            # Pre-1.19 spelling.
            dep_type = "required" if e.get("mandatory", True) else "optional"
        out.append(
            Dependency(
                mod_id=str(e["modId"]),
                type=str(dep_type).lower(),
                version_range=str(e.get("versionRange", "")),
                side=str(e.get("side", "BOTH")).upper(),
                ordering=str(e.get("ordering", "NONE")).upper(),
            )
        )
    return out


def _parse_zip(zf: zipfile.ZipFile, meta: JarMeta, *, embedded: bool, depth: int, label: str) -> None:
    broken = False
    try:
        data, path = _load_mods_toml(zf)
    except ValueError as exc:
        data, broken = None, True
        if embedded:
            meta.warn(f"{label}: {exc}")
        else:
            meta.fail(f"{label}: {exc}")
    if data:
        manifest = _read_manifest(zf)
        if not embedded:
            meta.loader_version = data.get("loaderVersion") or meta.loader_version
        declared = data.get("mods")
        if not isinstance(declared, list) or not declared:
            meta.warn(f"{label}: {path} declares no [[mods]]")
            declared = []
        for entry in declared:
            if not isinstance(entry, dict) or not entry.get("modId"):
                continue
            mod_id = str(entry["modId"])
            version = entry.get("version")
            version = str(version) if version is not None else None
            if version and "${" in version:
                resolved = _resolve_placeholders(version, manifest)
                if resolved is None:
                    meta.warn(f"{label}/{mod_id}: version placeholder {version!r} unresolved")
                version = resolved
            meta.mods.append(
                ModEntry(
                    mod_id=mod_id,
                    version=version,
                    display_name=(str(entry["displayName"]) if entry.get("displayName") else None),
                    embedded=embedded,
                    dependencies=_dependencies_for(data, mod_id),
                )
            )
    elif not embedded and not broken:
        meta.fail(f"{label}: no {' or '.join(MODS_TOML_PATHS)}")

    if depth >= MAX_JARJAR_DEPTH:
        return
    for name in zf.namelist():
        if not (name.startswith(JARJAR_DIR) and name.lower().endswith(".jar")):
            continue
        if "/" in name[len(JARJAR_DIR):]:  # only the flat jarjar dir, no cycles through subtrees
            continue
        try:
            nested = zf.read(name)
        except (KeyError, zipfile.BadZipFile, RuntimeError) as exc:
            meta.warn(f"{label}: cannot read nested {name}: {exc}")
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(nested)) as nzf:
                _parse_zip(nzf, meta, embedded=True, depth=depth + 1, label=f"{label}!{name}")
        except zipfile.BadZipFile as exc:
            meta.warn(f"{label}: nested {name} is not a zip: {exc}")


def parse_jar(source: str | Path | bytes, label: str | None = None) -> JarMeta:
    """Parse a jar from a path or from bytes already in memory."""
    meta = JarMeta()
    name = label or (source if isinstance(source, (str, Path)) else "<bytes>")
    handle = io.BytesIO(source) if isinstance(source, bytes) else source
    try:
        with zipfile.ZipFile(handle) as zf:
            _parse_zip(zf, meta, embedded=False, depth=0, label=str(name))
    except zipfile.BadZipFile as exc:
        meta.fail(f"{name}: not a zip: {exc}")
    except OSError as exc:
        meta.fail(f"{name}: {exc}")
    if meta.status == "ok" and any(m.version is None for m in meta.mods if not m.embedded):
        meta.warn(f"{name}: some mods have no resolvable version")
    return meta
