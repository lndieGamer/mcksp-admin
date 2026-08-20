"""Maven/Forge version comparison and version-range matching.

Nothing on PyPI implements Forge's `ComparableVersion` + `VersionRange` pair,
so this is a focused reimplementation: enough to decide whether a candidate
version satisfies a `versionRange` taken from `neoforge.mods.toml`.

Two rules carry most of the weight:

* a bare version (``1.0``, no brackets) is a *soft* requirement -- a
  recommendation, not a constraint. Reading it as ``==`` would block half the
  pack's updates for no reason.
* an unparsable or empty range constrains nothing. When in doubt we do not
  block; the caller reports the parse error separately.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Maven qualifier ordering. "" is the release qualifier: it outranks every
# pre-release marker but loses to "sp" (service pack).
_QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"]
_ALIASES = {
    "a": "alpha",
    "b": "beta",
    "m": "milestone",
    "cr": "rc",
    "ga": "",
    "final": "",
    "release": "",
}

# `.`, `-` and `_` separate; a digit run and a letter run are separate tokens.
_TOKEN_RE = re.compile(r"\d+|[^\d.\-_]+")

Token = int | str


def _tokenize(version: str) -> list[Token]:
    v = version.strip().lower()
    v = v.split("+", 1)[0]  # semver build metadata carries no precedence
    if v[:1] == "v" and v[1:2].isdigit():
        v = v[1:]
    return [int(t) if t.isdigit() else t for t in (m.group() for m in _TOKEN_RE.finditer(v))]


def _qualifier_key(q: str) -> str:
    q = _ALIASES.get(q, q)
    if q in _QUALIFIERS:
        return str(_QUALIFIERS.index(q))
    # Unknown qualifiers sort after every known one, then alphabetically.
    return f"{len(_QUALIFIERS)}-{q}"


def _null_like(other: Token) -> Token:
    """Padding for the shorter version: 0 against a number, release against a qualifier."""
    return 0 if isinstance(other, int) else ""


def _cmp_token(a: Token, b: Token) -> int:
    if isinstance(a, int) and isinstance(b, int):
        return (a > b) - (a < b)
    if isinstance(a, int):  # a number always outranks a qualifier
        return 1
    if isinstance(b, int):
        return -1
    ka, kb = _qualifier_key(a), _qualifier_key(b)
    return (ka > kb) - (ka < kb)


def compare(a: str, b: str) -> int:
    """Return -1/0/1 for a<b / a==b / a>b under Maven ComparableVersion rules."""
    ta, tb = _tokenize(a), _tokenize(b)
    for i in range(max(len(ta), len(tb))):
        x = ta[i] if i < len(ta) else _null_like(tb[i])
        y = tb[i] if i < len(tb) else _null_like(ta[i])
        c = _cmp_token(x, y)
        if c:
            return c
    return 0


def is_newer(candidate: str, current: str) -> bool:
    return compare(candidate, current) > 0


@dataclass(frozen=True)
class Restriction:
    """One bracketed interval. `None` bound means unbounded on that side."""

    lower: str | None = None
    lower_inclusive: bool = False
    upper: str | None = None
    upper_inclusive: bool = False

    def contains(self, version: str) -> bool:
        if self.lower is not None:
            c = compare(version, self.lower)
            if c < 0 or (c == 0 and not self.lower_inclusive):
                return False
        if self.upper is not None:
            c = compare(version, self.upper)
            if c > 0 or (c == 0 and not self.upper_inclusive):
                return False
        return True


@dataclass(frozen=True)
class VersionRange:
    spec: str
    restrictions: tuple[Restriction, ...] = ()
    soft: bool = True
    error: str | None = None

    def contains(self, version: str | None) -> bool:
        # A soft requirement, or a version we could not resolve, constrains nothing.
        if self.soft or not version:
            return True
        return any(r.contains(version) for r in self.restrictions)


def _split_top_level(spec: str) -> list[str]:
    parts: list[str] = []
    depth = start = 0
    for i, ch in enumerate(spec):
        if ch in "[(":
            depth += 1
        elif ch in "])":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(spec[start:i])
            start = i + 1
    parts.append(spec[start:])
    return [p.strip() for p in parts]


def _parse_restriction(part: str) -> Restriction | None:
    if len(part) < 3 or part[0] not in "[(" or part[-1] not in "])":
        return None
    lower_inclusive, upper_inclusive = part[0] == "[", part[-1] == "]"
    inner = part[1:-1]
    if "," not in inner:
        # `[1.0]` pins one version. `(1.0)` is meaningless.
        pinned = inner.strip()
        if not (lower_inclusive and upper_inclusive and pinned):
            return None
        return Restriction(pinned, True, pinned, True)
    lo, _, hi = inner.partition(",")
    lo, hi = lo.strip(), hi.strip()
    if lo and hi and compare(lo, hi) > 0:
        return None
    return Restriction(lo or None, lower_inclusive, hi or None, upper_inclusive)


def parse_range(spec: str | None) -> VersionRange:
    raw = (spec or "").strip()
    if not raw or raw[0] not in "[(":
        # Empty, or a bare version: soft requirement, satisfied by anything.
        return VersionRange(raw)
    restrictions: list[Restriction] = []
    for part in _split_top_level(raw):
        r = _parse_restriction(part)
        if r is None:
            return VersionRange(raw, error=f"unparsable version range: {spec!r}")
        restrictions.append(r)
    return VersionRange(raw, tuple(restrictions), soft=False)


def satisfies(version: str | None, spec: str | None) -> bool:
    return parse_range(spec).contains(version)
