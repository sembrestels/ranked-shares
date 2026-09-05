import json
import os
import tempfile
import unittest

from pbear import pbear
from zisk import make_fixture, sealed

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(os.path.dirname(HERE), "vectors", "zisk")
COMMITTED = ("main", "nosealed", "nodirect")


def load(scenario, directory=VECTORS):
    with open(os.path.join(directory, f"fixture_{scenario}.json")) as f:
        return json.load(f)


def entries_of(fx):
    m = fx["m"]
    sk = int(fx["sk"], 16)
    public = [(int(v["directWeight"], 16), v["directRanks"]) for v in fx["voters"] if v["directBallot"]]
    sealed_block = []
    for v in fx["voters"]:
        if not v["ciphertext"]:
            continue
        ranks = sealed.decrypt(sk, int(v["addr"], 16), bytes.fromhex(v["ciphertext"][2:]), m)
        if ranks is not None:
            sealed_block.append((int(v["seatWeight"], 16), ranks))
    return public + sealed_block


class GeneratorTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        with tempfile.TemporaryDirectory() as out_dir:
            for scenario in COMMITTED:
                produced = make_fixture.write_fixture(make_fixture.build(scenario), scenario, out_dir)
                with open(produced, "rb") as f:
                    fresh = f.read()
                with open(os.path.join(VECTORS, f"fixture_{scenario}.json"), "rb") as f:
                    self.assertEqual(fresh, f.read(), f"fixture_{scenario}.json is stale")

    def test_schema(self):
        for scenario in COMMITTED:
            fx = load(scenario)
            self.assertEqual(tuple(fx.keys()), make_fixture.FIXTURE_KEYS)
            for v in fx["voters"]:
                self.assertEqual(tuple(v.keys()), make_fixture.VOTER_KEYS)
                self.assertEqual(bool(v["directBallot"]), v["directRanks"] is not None)
                if v["directBallot"]:
                    self.assertEqual(len(bytes.fromhex(v["directBallot"][2:])), fx["m"])
                if v["ciphertext"]:
                    self.assertEqual(len(bytes.fromhex(v["ciphertext"][2:])), 33 + fx["m"])


class FixtureTest(unittest.TestCase):
    def test_funded_is_pbear_over_the_entry_list(self):
        for scenario in COMMITTED:
            fx = load(scenario)
            entries = entries_of(fx)
            abstaining = int(fx["totalWeight"], 16) - sum(w for w, _ in entries)
            self.assertGreaterEqual(abstaining, 0)
            self.assertEqual(pbear([int(c, 16) for c in fx["costs"]], entries, abstaining), fx["funded"])

    def test_main_exercises_every_case(self):
        fx = load("main")
        voters = fx["voters"]
        self.assertTrue(any(v["directBallot"] and v["ciphertext"] for v in voters), "both kinds")
        absent = [v for v in voters if v["ciphertext"] and v["sealedRanks"] is None]
        self.assertGreaterEqual(len(absent), 5, "copied, off-curve, x>=p, bad prefix, invalid ranking")
        self.assertTrue(any(v["ciphertext"] and int(v["seatWeight"], 16) == 0 for v in voters), "revoked seat")
        self.assertTrue(any(not v["directBallot"] and not v["ciphertext"] and int(v["seatWeight"], 16) for v in voters))
        self.assertTrue(any(not v["directBallot"] and not v["ciphertext"] and int(v["directWeight"], 16) for v in voters))
        self.assertGreater(len(fx["funded"]), 0)
        self.assertLess(len(fx["funded"]), fx["m"])

    def test_nosealed_and_nodirect(self):
        self.assertFalse(any(v["ciphertext"] for v in load("nosealed")["voters"]))
        self.assertFalse(any(v["directBallot"] for v in load("nodirect")["voters"]))

    def test_big_builds(self):
        fx = make_fixture.build("big")
        self.assertEqual(fx["m"], 16)
        self.assertEqual(len(fx["voters"]), 2200)


if __name__ == "__main__":
    unittest.main()
