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


<<<<<<< HEAD
=======
class TestIncompatible(unittest.TestCase):
    """`type = "incompatible"` carries a range, and it is the whole point."""

    def build(self, version_range: str, present_version: str) -> graph.Graph:
        nodes = {"sable": node("sable"), "sodium": node("sodium", present_version)}
        metas = {
            "sable": meta(
                "sable",
                [Dependency(mod_id="sodium", type="incompatible", version_range=version_range)],
            ),
            "sodium": meta("sodium", []),
        }
        metas["sodium"].mods[0].version = present_version
        return graph.build(nodes, metas)

    def test_version_outside_the_range_is_not_a_conflict(self):
        g = self.build("(,0.8.12-alpha.2+mc1.21.1)", "0.8.13-beta.2+mc1.21.1")
        self.assertEqual(g.warnings, [])

    def test_version_inside_the_range_is_a_conflict(self):
        g = self.build("(,0.8.12-alpha.2+mc1.21.1)", "0.8.11+mc1.21.1")
        self.assertEqual([w["code"] for w in g.warnings], ["incompatible_present"])

    def test_empty_range_means_every_version(self):
        g = self.build("", "0.8.13-beta.2+mc1.21.1")
        self.assertEqual([w["code"] for w in g.warnings], ["incompatible_present"])


class TestSelfBundledJar(unittest.TestCase):
    def test_jarjar_copy_of_own_mod_id_makes_no_second_node(self):
        metas = {
            "sodium": JarMeta(
                mods=[
                    ModEntry(mod_id="sodium", version="0.8.13"),
                    ModEntry(mod_id="sodium", version="0.8.13", embedded=True),
                ]
            )
        }
        g = graph.build({"sodium": node("sodium", "0.8.13")}, metas)
        self.assertEqual(list(g.nodes), ["sodium"])
        self.assertEqual(g.provider_map["sodium"], "sodium")


class TestPlatform(unittest.TestCase):
    def check(self, mod_id: str, version_range: str, have: dict) -> list[dict]:
        g = graph.Graph()
        g.platform.append(
            graph.PlatformRequirement(
                slug="lodestone", mod_id=mod_id, version_range=version_range, satisfied=True
            )
        )
        graph.check_platform(g, have)
        return g.warnings

    def test_stale_minecraft_range_is_only_a_note(self):
        warnings = self.check("minecraft", "[1.21,1.21.1)", {"minecraft": "1.21.1"})
        self.assertEqual([w["level"] for w in warnings], ["info"])

    def test_loader_mismatch_stays_an_error(self):
        warnings = self.check("neoforge", "[21.1.238,)", {"neoforge": "21.1.100"})
        self.assertEqual([w["level"] for w in warnings], ["error"])


>>>>>>> 65ccf21ecb11dae523decff4402d6b18d97d375d
if __name__ == "__main__":
    unittest.main()
