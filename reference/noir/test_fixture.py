import json
import os
import tempfile
import unittest

from pbear import NONE, replay_public
from noir.profiles import PROFILES
from noir.tools import make_fixture

HERE = os.path.dirname(os.path.abspath(__file__))

# Every fixture committed under reference/vectors/noir/, as (profile, scenario).
FIXTURES = (("test", "main"), ("test", "smallm"), ("test", "nosealed"), ("default", "main"))
ZERO = "0x" + "0" * 64


def path_of(profile, scenario, directory=None):
    return os.path.join(directory or os.path.join(os.path.dirname(HERE), "vectors", "noir"), f"fixture_{profile}_{scenario}.json")


def load(profile, scenario):
    with open(path_of(profile, scenario)) as f:
        return json.load(f)


class GeneratorTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        """Every committed fixture is exactly what `build` produces today.

        Generated into a temporary directory, so the test never touches the working
        tree, and this is also the only check that the `default` fixture still matches
        the code that made it.
        """
        with tempfile.TemporaryDirectory() as out_dir:
            for profile, scenario in FIXTURES:
                fx = make_fixture.build(PROFILES[profile], scenario)
                produced = make_fixture.write_fixture(fx, scenario, out_dir)
                with open(produced, "rb") as f:
                    fresh = f.read()
                with open(path_of(profile, scenario), "rb") as f:
                    committed = f.read()
                self.assertEqual(fresh, committed, f"fixture_{profile}_{scenario}.json is stale")


class FixtureTest(unittest.TestCase):
    def test_test_fixture_exercises_chains(self):
        fx = load("test", "main")
        p = PROFILES["test"]
        self.assertGreater(fx["numBatches"], 1)
        self.assertGreater(len(fx["tallyProofs"]), 1)
        self.assertEqual(len(fx["ingestProofs"]), fx["numBatches"])
        self.assertEqual(fx["ingestProofs"][0]["stateIn"], ZERO)
        self.assertEqual(fx["ingestProofs"][-1]["hOut"], fx["checkpoints"][-1])
        self.assertEqual(fx["tallyProofs"][-1]["done"], 1)
        self.assertEqual(fx["tallyProofs"][-1]["tHashOut"], fx["transcriptHash"])
        self.assertLessEqual(fx["sealedCount"], p.n_sealed_max)
        self.assertTrue(any(v["ciphertext"] is not None and v["sealedRanks"] is None for v in fx["voters"]), "an invalid ciphertext")

    def test_smallm_fixture_has_fewer_projects_and_a_terminal_none(self):
        fx = load("test", "smallm")
        m = fx["m"]
        self.assertEqual(m, len(fx["costs"]))
        self.assertLess(m, fx["profile"]["mMax"])
        self.assertTrue(fx["transcript"])
        last = fx["transcript"][-1]
        self.assertEqual(last[m + 1], NONE)
        self.assertGreaterEqual(last[0], m)
        self.assertEqual(fx["tallyProofs"][-1]["done"], 1)

    def test_nosealed_fixture_has_one_empty_ingest_batch(self):
        fx = load("test", "nosealed")
        self.assertEqual(fx["sealedCount"], 0)
        self.assertEqual(fx["numBatches"], 1)
        self.assertEqual(fx["sealedEntries"], [])
        self.assertTrue(fx["publicEntries"])
        self.assertEqual(len(fx["ingestProofs"]), 1)
        self.assertEqual(fx["ingestProofs"][0]["hIn"], ZERO)
        self.assertEqual(fx["ingestProofs"][0]["hOut"], ZERO)
        self.assertEqual(fx["ingestProofs"][0]["stateIn"], ZERO)
        self.assertEqual(fx["checkpoints"], [ZERO, ZERO])
        self.assertEqual(fx["tallyProofs"][-1]["done"], 1)

    def test_every_fixture_matches_the_schema(self):
        for profile, scenario in FIXTURES:
            fx = load(profile, scenario)
            self.assertEqual(tuple(fx), make_fixture.FIXTURE_KEYS)
            self.assertEqual(fx["scenario"], scenario)
            self.assertEqual(fx["profile"]["name"], profile)
            for proof in fx["ingestProofs"]:
                self.assertEqual(tuple(proof), make_fixture.INGEST_PROOF_KEYS)
            for proof in fx["tallyProofs"]:
                self.assertEqual(tuple(proof), make_fixture.TALLY_PROOF_KEYS)

    def test_every_fixture_declares_its_m(self):
        for profile, scenario in FIXTURES:
            fx = load(profile, scenario)
            self.assertIsInstance(fx["m"], int)
            self.assertEqual(fx["m"], len(fx["costs"]))
            self.assertLessEqual(fx["m"], fx["profile"]["mMax"])

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

    def test_voters_carry_hasSealed(self):
        for profile, scenario in FIXTURES:
            for v in load(profile, scenario)["voters"]:
                self.assertIn("hasSealed", v)
                self.assertEqual(v["hasSealed"], v["ciphertext"] is not None)


if __name__ == "__main__":
    unittest.main()
