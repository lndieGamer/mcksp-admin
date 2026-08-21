import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarmeta import PLATFORM_IDS, parse_jar  # noqa: E402


def make_jar(files: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


CBC_TOML = """\
modLoader="javafml"
loaderVersion="[21,)"

[[mods]]
modId="createbigcannons"
version="5.9.1"
displayName="Create: Big Cannons"

[[dependencies.createbigcannons]]
modId="create"
type="required"
versionRange="[6.0.0,6.1.0)"
ordering="AFTER"
side="BOTH"

[[dependencies.createbigcannons]]
modId="minecraft"
type="required"
versionRange="[1.21.1]"

[[dependencies.createbigcannons]]
modId="jei"
type="optional"
versionRange="[19,)"
"""


class TestJarMeta(unittest.TestCase):
    def test_basic_mod_and_dependencies(self):
        meta = parse_jar(make_jar({"META-INF/neoforge.mods.toml": CBC_TOML}), "cbc.jar")
        self.assertEqual(meta.status, "ok", meta.notes)
        self.assertEqual(meta.loader_version, "[21,)")
        self.assertEqual(len(meta.mods), 1)
        mod = meta.mods[0]
        self.assertEqual(mod.mod_id, "createbigcannons")
        self.assertEqual(mod.version, "5.9.1")
        self.assertEqual(mod.display_name, "Create: Big Cannons")
        self.assertFalse(mod.embedded)

        by_id = {d.mod_id: d for d in mod.dependencies}
        self.assertEqual(set(by_id), {"create", "minecraft", "jei"})
        self.assertTrue(by_id["create"].required)
        self.assertEqual(by_id["create"].version_range, "[6.0.0,6.1.0)")
        self.assertFalse(by_id["jei"].required)
        self.assertTrue(by_id["minecraft"].platform)
        self.assertFalse(by_id["create"].platform)

    def test_case_1_jar_version_placeholder(self):
        toml = '[[mods]]\nmodId="somemod"\nversion="${file.jarVersion}"\n'
        manifest = "Manifest-Version: 1.0\r\nImplementation-Version: 1.4.2\r\n\r\n"
        meta = parse_jar(
            make_jar({"META-INF/neoforge.mods.toml": toml, "META-INF/MANIFEST.MF": manifest})
        )
        self.assertEqual(meta.status, "ok", meta.notes)
        self.assertEqual(meta.mods[0].version, "1.4.2")

    def test_placeholder_with_manifest_continuation_line(self):
        toml = '[[mods]]\nmodId="somemod"\nversion="${file.jarVersion}"\n'
        # MANIFEST wraps at 72 columns; the continuation starts with one space.
        manifest = "Implementation-Version: 1.4.2-really-quite-a-long-vers\r\n ion-string\r\n"
        meta = parse_jar(
            make_jar({"META-INF/neoforge.mods.toml": toml, "META-INF/MANIFEST.MF": manifest})
        )
        self.assertEqual(meta.mods[0].version, "1.4.2-really-quite-a-long-version-string")

    def test_unresolvable_placeholder_warns_and_yields_none(self):
        toml = '[[mods]]\nmodId="somemod"\nversion="${file.jarVersion}"\n'
        meta = parse_jar(make_jar({"META-INF/neoforge.mods.toml": toml}), "weird.jar")
        self.assertEqual(meta.status, "warning")
        self.assertIsNone(meta.mods[0].version)
        self.assertTrue(any("placeholder" in n for n in meta.notes), meta.notes)

    def test_case_2_jar_in_jar_is_recursed_and_marked_embedded(self):
        inner = make_jar(
            {"META-INF/neoforge.mods.toml": '[[mods]]\nmodId="prismlib"\nversion="1.0.9"\n'}
        )
        outer = make_jar(
            {
                "META-INF/neoforge.mods.toml": '[[mods]]\nmodId="outer"\nversion="2.0"\n',
                "META-INF/jarjar/prismlib-1.0.9.jar": inner,
                "META-INF/jarjar/metadata.json": "{}",
            }
        )
        meta = parse_jar(outer, "outer.jar")
        self.assertEqual(meta.status, "ok", meta.notes)
        by_id = {m.mod_id: m for m in meta.mods}
        self.assertEqual(set(by_id), {"outer", "prismlib"})
        self.assertFalse(by_id["outer"].embedded)
        self.assertTrue(by_id["prismlib"].embedded)
        self.assertEqual(by_id["prismlib"].version, "1.0.9")

    def test_jar_in_jar_nests_two_deep(self):
        deepest = make_jar({"META-INF/neoforge.mods.toml": '[[mods]]\nmodId="deep"\nversion="3"\n'})
        middle = make_jar(
            {
                "META-INF/neoforge.mods.toml": '[[mods]]\nmodId="mid"\nversion="2"\n',
                "META-INF/jarjar/deep.jar": deepest,
            }
        )
        outer = make_jar(
            {
                "META-INF/neoforge.mods.toml": '[[mods]]\nmodId="top"\nversion="1"\n',
                "META-INF/jarjar/mid.jar": middle,
            }
        )
        meta = parse_jar(outer)
        self.assertEqual({m.mod_id for m in meta.mods}, {"top", "mid", "deep"})

    def test_case_3_one_jar_several_mod_ids(self):
        toml = (
            '[[mods]]\nmodId="alpha"\nversion="1.0"\n'
            '[[mods]]\nmodId="beta"\nversion="1.0"\n'
            '[[dependencies.beta]]\nmodId="create"\ntype="required"\nversionRange="[6.0,)"\n'
        )
        meta = parse_jar(make_jar({"META-INF/neoforge.mods.toml": toml}))
        self.assertEqual([m.mod_id for m in meta.mods], ["alpha", "beta"])
        self.assertEqual(meta.mods[0].dependencies, [])
        self.assertEqual(meta.mods[1].dependencies[0].mod_id, "create")

    def test_case_4_platform_ids_are_flagged(self):
        self.assertIn("minecraft", PLATFORM_IDS)
        self.assertIn("neoforge", PLATFORM_IDS)
        self.assertIn("java", PLATFORM_IDS)

    def test_legacy_mods_toml_fallback_and_mandatory_flag(self):
        toml = (
            '[[mods]]\nmodId="oldmod"\nversion="0.1"\n'
            '[[dependencies.oldmod]]\nmodId="forge"\nmandatory=true\nversionRange="[47,)"\n'
            '[[dependencies.oldmod]]\nmodId="jei"\nmandatory=false\n'
        )
        meta = parse_jar(make_jar({"META-INF/mods.toml": toml}))
        self.assertEqual(meta.status, "ok", meta.notes)
        deps = {d.mod_id: d for d in meta.mods[0].dependencies}
        self.assertTrue(deps["forge"].required)
        self.assertFalse(deps["jei"].required)

    def test_resource_pack_jar_fails_cleanly(self):
        meta = parse_jar(make_jar({"pack.mcmeta": "{}"}), "resources.jar")
        self.assertEqual(meta.status, "failed")
        self.assertEqual(meta.mods, [])
        self.assertTrue(any("no META-INF" in n for n in meta.notes), meta.notes)

    def test_malformed_toml_fails_with_the_toml_error(self):
        meta = parse_jar(make_jar({"META-INF/neoforge.mods.toml": "[[mods]\nmodId="}), "bad.jar")
        self.assertEqual(meta.status, "failed")
        self.assertTrue(any("neoforge.mods.toml" in n for n in meta.notes), meta.notes)

    def test_not_a_zip(self):
        meta = parse_jar(b"this is not a jar at all", "junk.jar")
        self.assertEqual(meta.status, "failed")

    def test_broken_nested_jar_only_warns(self):
        outer = make_jar(
            {
                "META-INF/neoforge.mods.toml": '[[mods]]\nmodId="top"\nversion="1"\n',
                "META-INF/jarjar/broken.jar": b"not a zip",
            }
        )
        meta = parse_jar(outer, "outer.jar")
        self.assertEqual(meta.status, "warning")
        self.assertEqual([m.mod_id for m in meta.mods], ["top"])

    def test_roundtrip_through_cache_dict(self):
        from jarmeta import JarMeta

        meta = parse_jar(make_jar({"META-INF/neoforge.mods.toml": CBC_TOML}), "cbc.jar")
        clone = JarMeta.from_dict(meta.to_dict())
        self.assertEqual(clone.to_dict(), meta.to_dict())
        self.assertEqual(clone.mods[0].dependencies[0].mod_id, "create")


if __name__ == "__main__":
    unittest.main()
