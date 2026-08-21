import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mavenrange import compare, is_newer, parse_range, satisfies  # noqa: E402


class TestCompare(unittest.TestCase):
    def assertOrder(self, lo, hi):
        self.assertEqual(compare(lo, hi), -1, f"{lo} should be < {hi}")
        self.assertEqual(compare(hi, lo), 1, f"{hi} should be > {lo}")

    def assertSame(self, a, b):
        self.assertEqual(compare(a, b), 0, f"{a} should == {b}")

    def test_numeric_segments(self):
        self.assertOrder("1.0", "1.1")
        self.assertOrder("1.9", "1.10")
        self.assertOrder("1.0", "1.0.1")
        self.assertOrder("6.0.9", "6.0.10")

    def test_trailing_zero_padding(self):
        self.assertSame("1.0", "1")
        self.assertSame("1.0.0", "1.0")
        self.assertSame("1.0.0", "1")

    def test_dash_starts_a_sub_list(self):
        # Maven's own comment on IntegerItem.compareTo(ListItem) is "1.1 > 1-1":
        # a `-` group ranks below a plain number in the same slot.
        self.assertOrder("1.0-1", "1.0.1")
        self.assertSame("1_0", "1.0")

    def test_mc_prefixed_version_beats_shorter_mc_prefix(self):
        # Amendments asks for moonlight [1.21-2.29.19,); the pack ships
        # 1.21.1-3.3.2. Flattening the two groups compared 1 against 2 and
        # called the newer library too old.
        self.assertOrder("1.21-2.29.19", "1.21.1-3.3.2")
        self.assertTrue(satisfies("1.21.1-3.3.2", "[1.21-2.29.19,)"))
        self.assertTrue(satisfies("1.21.1-3.3.2", "[1.21-3.2.3,)"))
        self.assertFalse(satisfies("1.21.1-3.1.0", "[1.21.1-3.2.3,)"))

    def test_qualifier_ordering(self):
        self.assertOrder("1.0-alpha", "1.0-beta")
        self.assertOrder("1.0-beta", "1.0-milestone")
        self.assertOrder("1.0-milestone", "1.0-rc")
        self.assertOrder("1.0-rc", "1.0-snapshot")
        self.assertOrder("1.0-snapshot", "1.0")
        self.assertOrder("1.0", "1.0-sp")

    def test_qualifier_aliases(self):
        self.assertSame("1.0-a", "1.0-alpha")
        self.assertSame("1.0-cr", "1.0-rc")
        self.assertSame("1.0-ga", "1.0")
        self.assertSame("1.0-final", "1.0")

    def test_unknown_qualifier_sorts_after_release(self):
        self.assertOrder("0.5.1", "0.5.1.f")
        self.assertOrder("0.5.1.e", "0.5.1.f")

    def test_number_outranks_qualifier(self):
        self.assertOrder("1.0-alpha", "1.0-1")

    def test_build_metadata_ignored(self):
        self.assertSame("1.0.0+build.7", "1.0.0")
        self.assertSame("6.0.10+mc1.21.1", "6.0.10")

    def test_leading_v_stripped(self):
        self.assertSame("v1.2.3", "1.2.3")

    def test_case_insensitive(self):
        self.assertSame("1.0-RC", "1.0-rc")

    def test_mc_prefixed_mod_versions(self):
        self.assertOrder("1.21.1-6.0.10", "1.21.1-6.1.0")
        self.assertOrder("1.21.1-6.0.10", "1.21.1-6.0.11")
        self.assertSame("1.21.1-6.0.10", "1.21.1-6.0.10")

    def test_empty_version(self):
        self.assertOrder("", "1.0")
        self.assertSame("", "0")

    def test_is_newer(self):
        self.assertTrue(is_newer("6.1.0", "6.0.10"))
        self.assertFalse(is_newer("6.0.10", "6.0.10"))
        self.assertFalse(is_newer("6.0.9", "6.0.10"))


class TestRanges(unittest.TestCase):
    def test_half_open(self):
        self.assertTrue(satisfies("6.0.10", "[6.0.0,6.1.0)"))
        self.assertTrue(satisfies("6.0.0", "[6.0.0,6.1.0)"))
        self.assertFalse(satisfies("6.1.0", "[6.0.0,6.1.0)"))
        self.assertFalse(satisfies("5.9.9", "[6.0.0,6.1.0)"))

    def test_open_upper(self):
        self.assertTrue(satisfies("21.1.248", "[21,)"))
        self.assertTrue(satisfies("21", "[21,)"))
        self.assertFalse(satisfies("20.9", "[21,)"))

    def test_open_lower(self):
        self.assertTrue(satisfies("1.9", "(,2.0]"))
        self.assertTrue(satisfies("2.0", "(,2.0]"))
        self.assertFalse(satisfies("2.0.1", "(,2.0]"))

    def test_exclusive_bounds(self):
        self.assertFalse(satisfies("1.0", "(1.0,2.0)"))
        self.assertFalse(satisfies("2.0", "(1.0,2.0)"))
        self.assertTrue(satisfies("1.5", "(1.0,2.0)"))

    def test_pinned(self):
        self.assertTrue(satisfies("1.0", "[1.0]"))
        self.assertTrue(satisfies("1.0.0", "[1.0]"))  # equal under Maven padding
        self.assertFalse(satisfies("1.0.1", "[1.0]"))

    def test_union(self):
        spec = "[1.0,2.0),[3.0,)"
        self.assertTrue(satisfies("1.5", spec))
        self.assertFalse(satisfies("2.5", spec))
        self.assertTrue(satisfies("3.1", spec))
        self.assertEqual(len(parse_range(spec).restrictions), 2)

    def test_bare_version_is_soft(self):
        r = parse_range("1.0")
        self.assertTrue(r.soft)
        self.assertIsNone(r.error)
        self.assertTrue(satisfies("0.1", "1.0"))
        self.assertTrue(satisfies("99.0", "1.0"))

    def test_empty_range(self):
        for spec in (None, "", "   "):
            r = parse_range(spec)
            self.assertTrue(r.soft)
            self.assertIsNone(r.error)
            self.assertTrue(r.contains("1.0"))

    def test_garbage_range_reports_error_but_blocks_nothing(self):
        for spec in ("[abc", "[1.0,2.0", "(1.0)", "[]", "[1.0,2.0)),"):
            r = parse_range(spec)
            self.assertIsNotNone(r.error, f"{spec!r} should report a parse error")
            self.assertTrue(r.contains("1.0"), f"{spec!r} should not block")

    def test_inverted_bounds_are_rejected(self):
        self.assertIsNotNone(parse_range("[2.0,1.0]").error)

    def test_unresolved_version_never_blocks(self):
        self.assertTrue(parse_range("[6.0.0,6.1.0)").contains(None))
        self.assertTrue(parse_range("[6.0.0,6.1.0)").contains(""))

    def test_whitespace_tolerated(self):
        self.assertTrue(satisfies("1.5", "[ 1.0 , 2.0 )"))

    def test_real_pack_ranges(self):
        self.assertTrue(satisfies("6.0.10", "[6.0.0,6.1.0)"))
        self.assertFalse(satisfies("6.1.0", "[6.0.0,6.1.0)"))
        self.assertTrue(satisfies("21.1.248", "[21.1.0,)"))
        self.assertTrue(satisfies("1.21.1", "[1.21.1]"))


if __name__ == "__main__":
    unittest.main()
