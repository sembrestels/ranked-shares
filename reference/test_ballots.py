import unittest

from ballots import pack, unpack, validate


class BallotsTest(unittest.TestCase):
    def test_validate_accepts_competition_rankings(self):
        self.assertTrue(validate([1, 2, 3, 0], 4))
        self.assertTrue(validate([1, 2, 2, 4], 4))
        self.assertTrue(validate([0, 0, 0, 0], 4))
        self.assertTrue(validate([2, 1, 0, 0], 4))

    def test_validate_rejects_gaps_length_and_range(self):
        self.assertFalse(validate([1, 3, 0, 0], 4))  # gap
        self.assertFalse(validate([2, 2, 0, 0], 4))  # no rank 1
        self.assertFalse(validate([1, 2, 3], 4))  # length
        self.assertFalse(validate([1, 2, 3, 5], 4))  # > m
        self.assertFalse(validate([4, 4, 4, 4], 4))
        self.assertFalse(validate([1, 2, 3, -1], 4))

    def test_pack_unpack_round_trip(self):
        ranks = [1, 2, 2, 4]
        self.assertEqual(pack(ranks), 0x04020201)
        self.assertEqual(unpack(pack(ranks), 4), ranks)
        self.assertIsNone(unpack(1 << 32, 4))
        self.assertIsNone(unpack(0x0300, 4))  # rank 3 without ranks 1 and 2

    def test_sealed_reexports(self):
        from noir import sealed

        self.assertIs(sealed.validate, validate)
        self.assertIs(sealed.pack, pack)
        self.assertIs(sealed.unpack, unpack)


if __name__ == "__main__":
    unittest.main()
