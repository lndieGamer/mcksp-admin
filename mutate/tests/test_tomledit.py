import sys
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tomledit import (  # noqa: E402
    EditError,
    read_flavors,
    refresh_flavor_counts,
    set_flavors,
    set_pack_version,
    set_side,
)

METAFILE = '''name = "Sodium"
filename = "sodium-neoforge-0.6.13.jar"
side = "client"

[download]
url = "https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar"
hash-format = "sha512"
hash = "deadbeef"

[update]
[update.modrinth]
mod-id = "AANobbMI"
version = "xPYbAPfz"
'''

UNSUP = '''# unsup: галочка на каждый клиентский мод.

[flavor_groups."graphics"]
name = "Тяжёлая графика"
side = "client"

[[flavor_groups."graphics".choices]]
id = "graphics_on"
name = "Включить (2 мода)"

[[flavor_groups."graphics".choices]]
id = "graphics_off"
name = "Отключить"

# ---- привязка модов к галочкам ----

[metafile."ambientsounds"]
flavors = ["ambientsounds_on"]

[metafile."irisshaders"]
flavors = ["graphics_on"]

[metafile."sodium"]
flavors = ["graphics_on", "sodium_on"]

# ---- библиотеки: своей галочки нет ----

[metafile."iceberg"]
flavors = ["legendary-tooltips_on"]
'''


class TestSide(unittest.TestCase):
    def test_replaces_in_place_and_touches_nothing_else(self):
        out = set_side(METAFILE, "both")
        self.assertIn('side = "both"', out)
        self.assertNotIn('side = "client"', out)
        self.assertEqual(out.replace('side = "both"', 'side = "client"'), METAFILE)
        self.assertEqual(tomllib.loads(out)["side"], "both")

    def test_is_idempotent(self):
        self.assertEqual(set_side(set_side(METAFILE, "server"), "server"), set_side(METAFILE, "server"))

    def test_inserts_after_filename_when_absent(self):
        source = METAFILE.replace('side = "client"\n', "")
        out = set_side(source, "server")
        lines = out.splitlines()
        self.assertEqual(lines[lines.index('filename = "sodium-neoforge-0.6.13.jar"') + 1],
                         'side = "server"')
        self.assertEqual(tomllib.loads(out)["side"], "server")

    def test_ignores_a_side_key_inside_a_later_section(self):
        source = 'name = "x"\nfilename = "x.jar"\n\n[option]\nside = "nonsense"\n'
        out = set_side(source, "client")
        self.assertEqual(tomllib.loads(out)["side"], "client")
        self.assertEqual(tomllib.loads(out)["option"]["side"], "nonsense")

    def test_rejects_a_bogus_value(self):
        with self.assertRaises(EditError):
            set_side(METAFILE, "clientside")


class TestPackVersion(unittest.TestCase):
    def test_replaces_top_level_version_only(self):
        pack = 'name = "MCKSP"\nversion = "1.0.0"\n\n[versions]\nminecraft = "1.21.1"\n'
        out = set_pack_version(pack, "1.6.0")
        data = tomllib.loads(out)
        self.assertEqual(data["version"], "1.6.0")
        self.assertEqual(data["versions"]["minecraft"], "1.21.1")

    def test_raises_when_there_is_no_version(self):
        with self.assertRaises(EditError):
            set_pack_version('name = "MCKSP"\n', "1.0.0")


class TestFlavors(unittest.TestCase):
    def test_read(self):
        self.assertEqual(
            read_flavors(UNSUP)["sodium"], ["graphics_on", "sodium_on"]
        )

    def test_replace_keeps_the_comment_headers(self):
        out = set_flavors(UNSUP, "sodium", ["graphics_off"])
        self.assertEqual(read_flavors(out)["sodium"], ["graphics_off"])
        self.assertIn("# ---- привязка модов к галочкам ----", out)
        self.assertIn("# ---- библиотеки: своей галочки нет ----", out)
        self.assertEqual(read_flavors(out)["iceberg"], ["legendary-tooltips_on"])

    def test_delete_removes_exactly_one_block(self):
        out = set_flavors(UNSUP, "irisshaders", [])
        flavors = read_flavors(out)
        self.assertNotIn("irisshaders", flavors)
        self.assertEqual(set(flavors), {"ambientsounds", "sodium", "iceberg"})
        self.assertNotIn("irisshaders", out)
        self.assertIn("# ---- библиотеки: своей галочки нет ----", out)

    def test_delete_of_a_missing_entry_is_a_no_op(self):
        self.assertEqual(set_flavors(UNSUP, "not-here", []), UNSUP)

    def test_insert_lands_alphabetically_in_the_first_run(self):
        out = set_flavors(UNSUP, "entityculling", ["entityculling_on"])
        self.assertEqual(read_flavors(out)["entityculling"], ["entityculling_on"])
        slugs = [
            line.split('"')[1]
            for line in out.splitlines()
            if line.startswith("[metafile.")
        ]
        self.assertEqual(slugs, ["ambientsounds", "entityculling", "irisshaders", "sodium", "iceberg"])

    def test_insert_after_the_last_of_the_first_run(self):
        out = set_flavors(UNSUP, "zzz-last", ["zzz_on"])
        slugs = [
            line.split('"')[1]
            for line in out.splitlines()
            if line.startswith("[metafile.")
        ]
        self.assertEqual(slugs, ["ambientsounds", "irisshaders", "sodium", "zzz-last", "iceberg"])
        self.assertIn("# ---- библиотеки: своей галочки нет ----", out)

    def test_every_edit_leaves_valid_toml(self):
        for out in (
            set_flavors(UNSUP, "sodium", ["a", "b"]),
            set_flavors(UNSUP, "sodium", []),
            set_flavors(UNSUP, "brand-new", ["x"]),
            set_flavors(UNSUP, "iceberg", []),
        ):
            tomllib.loads(out)


class TestCounters(unittest.TestCase):
    def test_recount_after_a_change(self):
        self.assertIn('name = "Включить (2 мода)"', UNSUP)
        out = refresh_flavor_counts(set_flavors(UNSUP, "sodium", ["sodium_on"]))
        self.assertIn('name = "Включить (1 мод)"', out)

    def test_names_without_a_counter_are_left_alone(self):
        out = refresh_flavor_counts(UNSUP)
        self.assertIn('name = "Отключить"', out)
        self.assertIn('name = "Тяжёлая графика"', out)

    def test_zero_uses_the_plural(self):
        out = refresh_flavor_counts(set_flavors(set_flavors(UNSUP, "sodium", []), "irisshaders", []))
        self.assertIn('name = "Включить (0 модов)"', out)

    def test_is_idempotent(self):
        once = refresh_flavor_counts(UNSUP)
        self.assertEqual(refresh_flavor_counts(once), once)


class TestAgainstTheRealPack(unittest.TestCase):
    """Runs only when a pack checkout is present next to the repo."""

    def setUp(self):
        candidates = [
            Path(__file__).resolve().parents[2] / "pack" / "unsup.toml",
            Path("pack/unsup.toml"),
        ]
        self.path = next((p for p in candidates if p.exists()), None)
        if self.path is None:
            self.skipTest("no pack checkout")

    def test_edits_keep_the_file_parseable_and_local(self):
        original = self.path.read_text("utf-8")
        before = read_flavors(original)
        self.assertIn("sodium", before)

        out = set_flavors(original, "sodium", ["sodium_on"])
        after = read_flavors(out)
        self.assertEqual(after["sodium"], ["sodium_on"])
        self.assertEqual(
            {k: v for k, v in after.items() if k != "sodium"},
            {k: v for k, v in before.items() if k != "sodium"},
        )
        # The whole flavor_groups half must come through untouched.
        self.assertEqual(
            tomllib.loads(out)["flavor_groups"], tomllib.loads(original)["flavor_groups"]
        )

    def test_delete_then_insert_restores_the_entry(self):
        original = self.path.read_text("utf-8")
        wanted = read_flavors(original)["ambientsounds"]
        out = set_flavors(set_flavors(original, "ambientsounds", []), "ambientsounds", wanted)
        self.assertEqual(read_flavors(out), read_flavors(original))


if __name__ == "__main__":
    unittest.main()
