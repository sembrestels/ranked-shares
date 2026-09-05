import json
import os
import subprocess
import sys
import unittest

from pbear import replay_public
from profiles import PROFILES

HERE = os.path.dirname(os.path.abspath(__file__))


FIXTURES = (("test", "main"), ("test", "smallm"), ("test", "nosealed"), ("default", "main"))


def load(profile, scenario):
    with open(os.path.join(HERE, "vectors", f"fixture_{profile}_{scenario}.json")) as f:
        return json.load(f)


class FixtureTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        with open(os.path.join(HERE, "vectors", "fixture_test_main.json")) as f:
            before = f.read()
        subprocess.run([sys.executable, os.path.join(HERE, "tools", "make_fixture.py"), "--profile", "test"], check=True, cwd=os.path.dirname(HERE))
        with open(os.path.join(HERE, "vectors", "fixture_test_main.json")) as f:
            after = f.read()
        self.assertEqual(before, after)

    def test_test_fixture_exercises_chains(self):
        fx = load("test", "main")
        p = PROFILES["test"]
        self.assertGreater(fx["numBatches"], 1)
        self.assertGreater(len(fx["tallyProofs"]), 1)
        self.assertEqual(len(fx["ingestProofs"]), fx["numBatches"])
        self.assertEqual(fx["ingestProofs"][0]["stateIn"], "0x" + "0" * 64)
        self.assertEqual(fx["ingestProofs"][-1]["hOut"], fx["checkpoints"][-1])
        self.assertEqual(fx["tallyProofs"][-1]["done"], 1)
        self.assertEqual(fx["tallyProofs"][-1]["tHashOut"], fx["transcriptHash"])
        self.assertLessEqual(fx["sealedCount"], p.n_sealed_max)
        self.assertTrue(any(v["ciphertext"] is not None and v["sealedRanks"] is None for v in fx["voters"]), "an invalid ciphertext")

    def test_chain_of_states(self):
        for profile, scenario in FIXTURES:
            fx = load(profile, scenario)
            proofs = fx["ingestProofs"] + fx["tallyProofs"]
            for a, b in zip(proofs, proofs[1:]):
                self.assertEqual(a["stateOut"], b["stateIn"])

    def test_public_replay_passes(self):
        for profile, scenario in FIXTURES:
            fx = load(profile, scenario)
            public = [(int(v["directWeight"], 16), v["directRanks"]) for v in fx["voters"] if v["hasDirect"]]
            self.assertTrue(replay_public([int(c, 16) for c in fx["costs"]], public, fx["transcript"], int(fx["totalWeight"], 16)))

    def test_default_fixture_uses_default_profile(self):
        fx = load("default", "main")
        self.assertEqual(fx["profile"]["nSealedMax"], 256)
        self.assertEqual(len(fx["ingestProofs"]), fx["numBatches"])


if __name__ == "__main__":
    unittest.main()
