"""Line-level edits to packwiz metafiles and `unsup.toml`.

Deliberately *not* a TOML round-trip. Loading these files into a structure and
serialising them back reorders keys, drops the comment headers `unsup.toml`
depends on, and reformats values -- every commit would read as a full rewrite
and the history would become useless. The owner's PowerShell scripts already do
line replacement; this keeps that property.

Reading is a different matter: that goes through `tomllib`.
"""

from __future__ import annotations

import re
import tomllib

SIDE_RE = re.compile(r'(?m)^side\s*=\s*".*?"[ \t]*$')
FILENAME_RE = re.compile(r"(?m)^filename\s*=\s*.*$")
VERSION_RE = re.compile(r'(?m)^version\s*=\s*".*?"[ \t]*$')
FLAVORS_RE = re.compile(r"(?m)^flavors\s*=\s*\[.*?\][ \t]*$")
METAFILE_HEADER_RE = re.compile(r'(?m)^\[metafile\."(?P<slug>[^"]+)"\][ \t]*$')
CHOICE_HEADER_RE = re.compile(r'(?m)^\[\[flavor_groups\."(?P<group>[^"]+)"\.choices\]\][ \t]*$')
COUNT_SUFFIX_RE = re.compile(r"\s*\(\d+\s+мод(?:а|ов)?\)\s*$")


class EditError(ValueError):
    """The file did not look the way the edit needs it to look."""


def _root_table(text: str) -> tuple[str, str]:
    """Split off the leading key/value block, before the first `[section]`."""
    match = re.search(r"(?m)^\[", text)
    return (text, "") if match is None else (text[: match.start()], text[match.start() :])


def set_side(text: str, value: str) -> str:
    """Replace `side` in a metafile, or insert it right after `filename`."""
    if value not in ("both", "client", "server"):
        raise EditError(f"side must be both/client/server, got {value!r}")
    head, tail = _root_table(text)
    if SIDE_RE.search(head):
        return SIDE_RE.sub(f'side = "{value}"', head, count=1) + tail
    match = FILENAME_RE.search(head)
    if not match:
        raise EditError("metafile has neither `side` nor `filename`")
    return head[: match.end()] + f'\nside = "{value}"' + head[match.end() :] + tail


def set_pack_version(text: str, version: str) -> str:
    head, tail = _root_table(text)
    if not VERSION_RE.search(head):
        raise EditError("pack.toml has no top-level `version`")
    return VERSION_RE.sub(f'version = "{version}"', head, count=1) + tail


def read_flavors(text: str) -> dict[str, list[str]]:
    """metafile slug -> flavor ids. Reading is safe to do with a real parser."""
    data = tomllib.loads(text)
    return {slug: list(entry.get("flavors") or []) for slug, entry in (data.get("metafile") or {}).items()}


def _format_flavors(flavors: list[str]) -> str:
    return "flavors = [" + ", ".join(f'"{f}"' for f in flavors) + "]"


def _block_bounds(text: str, start: int) -> int:
    """End offset of the `[metafile."x"]` block that starts at `start`."""
    next_header = re.compile(r"(?m)^\[").search(text, start + 1)
    end = next_header.start() if next_header else len(text)
    # Give back the blank lines that separate this block from the next header.
    while end > start and text[end - 1] == "\n" and text[end - 2 : end - 1] == "\n":
        end -= 1
    return end


def set_flavors(text: str, slug: str, flavors: list[str]) -> str:
    """Set, create or (with an empty list) delete a `[metafile."<slug>"]` entry."""
    for match in METAFILE_HEADER_RE.finditer(text):
        if match.group("slug") != slug:
            continue
        end = _block_bounds(text, match.start())
        if not flavors:
            trailing = end
            while text[trailing : trailing + 1] == "\n":
                trailing += 1
            return text[: match.start()] + text[trailing:]
        block = text[match.start() : end]
        if FLAVORS_RE.search(block):
            block = FLAVORS_RE.sub(_format_flavors(flavors), block, count=1)
        else:
            block = block.rstrip("\n") + "\n" + _format_flavors(flavors) + "\n"
        return text[: match.start()] + block + text[end:]

    if not flavors:
        return text
    return _insert_metafile(text, slug, flavors)


def _insert_metafile(text: str, slug: str, flavors: list[str]) -> str:
    """Insert alphabetically into the first run of `[metafile.*]` entries.

    Keeping to the first run leaves the hand-written comment headers -- and the
    library section below them -- exactly where the owner put them.
    """
    entry = f'[metafile."{slug}"]\n' + _format_flavors(flavors) + "\n\n"
    headers = list(METAFILE_HEADER_RE.finditer(text))
    if not headers:
        return text.rstrip("\n") + "\n\n" + entry.rstrip("\n") + "\n"

    run = [headers[0]]
    for previous, current in zip(headers, headers[1:]):
        between = text[previous.end() : current.start()]
        if re.search(r"(?m)^\[(?!metafile\.)", between) or between.count("\n\n") > 1:
            break
        run.append(current)

    for match in run:
        if match.group("slug") > slug:
            return text[: match.start()] + entry + text[match.start() :]
    end = _block_bounds(text, run[-1].start())
    return text[:end].rstrip("\n") + "\n\n" + entry.rstrip("\n") + "\n" + text[end:]


def _plural_ru(count: int) -> str:
    if 11 <= count % 100 <= 14:
        return "модов"
    return {1: "мод", 2: "мода", 3: "мода", 4: "мода"}.get(count % 10, "модов")


def refresh_flavor_counts(text: str) -> str:
    """Recompute the `(8 модов)` counters in choice names.

    Only names that already carry a counter are touched; the rest keep whatever
    the owner wrote. Left to hand-maintenance these drift apart sooner or later.
    """
    counts: dict[str, int] = {}
    for flavors in read_flavors(text).values():
        for flavor in flavors:
            counts[flavor] = counts.get(flavor, 0) + 1

    out, cursor = [], 0
    for header in CHOICE_HEADER_RE.finditer(text):
        end = _block_bounds(text, header.start())
        block = text[header.start() : end]
        choice_id = re.search(r'(?m)^id\s*=\s*"([^"]+)"', block)
        name = re.search(r'(?m)^name\s*=\s*"([^"]*)"[ \t]*$', block)
        if choice_id and name and COUNT_SUFFIX_RE.search(name.group(1)):
            count = counts.get(choice_id.group(1), 0)
            base = COUNT_SUFFIX_RE.sub("", name.group(1))
            replacement = f'name = "{base} ({count} {_plural_ru(count)})"'
            block = block[: name.start()] + replacement + block[name.end() :]
        out.append(text[cursor : header.start()])
        out.append(block)
        cursor = end
    out.append(text[cursor:])
    return "".join(out)
