import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import graph  # noqa: E402
from jarmeta import Dependency, JarMeta, ModEntry  # noqa: E402


def node(slug: str, version: str = "1.0.0") -> graph.Node:
    return graph.Node(slug=slug, name=slug, version=version)


def meta(mod_id: str, deps: list[Dependency]) -> JarMeta:
    return JarMeta(mods=[ModEntry(mod_id=mod_id, version="1.0.0", dependencies=deps)])


class TestOptionalEdges(unittest.TestCase):
    def build(self, deps: list[Dependency], present: list[str] = ()) -> graph.Graph:
        nodes = {"cbc": node("cbc")} | {s: node(s) for s in present}
        metas = {"cbc": meta("cbc", deps)} | {s: meta(s, []) for s in present}
        return graph.build(nodes, metas)

    def test_absent_optional_is_dropped(self):
        g = self.build([Dependency(mod_id="jei", type="optional", version_range="[19,)")])
        self.assertEqual(g.edges, [])

    def test_present_optional_is_kept(self):
        g = self.build(
            [Dependency(mod_id="jei", type="optional", version_range="[1,)")], present=["jei"]
        )
        self.assertEqual([(e.to, e.type, e.satisfied) for e in g.edges], [("jei", "optional", True)])

    def test_present_optional_with_bad_range_still_shows_as_broken(self):
        g = self.build(
            [Dependency(mod_id="jei", type="optional", version_range="[19,)")], present=["jei"]
        )
        self.assertEqual([(e.to, e.satisfied) for e in g.edges], [("jei", False)])

    def test_absent_required_is_kept_and_warned(self):
        g = self.build([Dependency(mod_id="create", type="required", version_range="[6,)")])
        self.assertEqual([(e.to, e.to_mod_id, e.satisfied) for e in g.edges], [(None, "create", False)])
        self.assertEqual([w["code"] for w in g.warnings], ["missing_dependency"])


if __name__ == "__main__":
    unittest.main()
