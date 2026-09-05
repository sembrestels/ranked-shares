import json
import os
import unittest

from noir.poseidon2 import P, hash, permutation

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vectors", "noir", "poseidon2.json")


class Poseidon2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(VECTORS) as f:
            cls.vectors = json.load(f)

    def test_permutation_matches_bbjs(self):
        for case in self.vectors["permutation"]:
            state = [int(x, 16) for x in case["input"]]
            expected = [int(x, 16) for x in case["output"]]
            self.assertEqual(permutation(state), expected)

    def test_hash_matches_bbjs(self):
        for case in self.vectors["hash"]:
            inputs = [int(x, 16) for x in case["input"]]
            self.assertEqual(hash(inputs), int(case["output"], 16))

    def test_hash_depends_on_length(self):
        # The capacity element carries the length, so [1, 0] and [1] differ.
        self.assertNotEqual(hash([1]), hash([1, 0]))

    def test_outputs_are_reduced(self):
        self.assertLess(hash([P - 1, P - 1, P - 1, P - 1]), P)


if __name__ == "__main__":
    unittest.main()
