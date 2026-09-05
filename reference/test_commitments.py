import unittest

import commitments as cm
import poseidon2
from keccak import keccak256
from pbear import NONE, pbear_transcript
from profiles import PROFILES
from sealed import pack

TEST = PROFILES["test"]


class ChainTest(unittest.TestCase):
    def test_sealed_chain_and_checkpoints(self):
        entries = [(i + 1, 10 * (i + 1), 100 + i, 200 + i, 300 + i) for i in range(5)]
        h, checkpoints = cm.sealed_chain(entries, batch=2)
        expected = 0
        manual = [0]
        for j, (a, w, rx, ry, c) in enumerate(entries):
            expected = poseidon2.hash([expected, a, w, rx, ry, c])
            if (j + 1) % 2 == 0 or j + 1 == len(entries):
                manual.append(expected)
        self.assertEqual(h, expected)
        self.assertEqual(checkpoints, manual)
        self.assertEqual(len(checkpoints), 1 + 3)  # ceil(5 / 2) batches

    def test_sealed_chain_empty(self):
        self.assertEqual(cm.sealed_chain([], batch=2), (0, [0]))

    def test_public_chain(self):
        entries = [(0xAA, 5, pack([1, 2])), (0xBB, 7, pack([2, 1]))]
        h = b"\x00" * 32
        for a, w, p in entries:
            h = keccak256(h + a.to_bytes(20, "big") + w.to_bytes(32, "big") + p.to_bytes(32, "big"))
        self.assertEqual(cm.public_chain(entries), h)
        self.assertEqual(cm.public_chain([]), b"\x00" * 32)

    def test_costs_hash_and_inputs_root(self):
        self.assertEqual(cm.costs_hash([3, 4]), poseidon2.hash([3, 4]))
        root = cm.inputs_root(b"\x01" * 32, 5, 2, 9, 100)
        self.assertEqual(root, keccak256(b"\x01" * 32 + (5).to_bytes(32, "big") + (2).to_bytes(32, "big") + (9).to_bytes(32, "big") + (100).to_bytes(32, "big")))

    def test_transcript_hash(self):
        t = [[1, 40, 0, 0, 40], [1, 0, 10, NONE, 0]]
        h = poseidon2.hash([0] + t[0])
        h = poseidon2.hash([h] + t[1])
        self.assertEqual(cm.transcript_hash(t), h)
        self.assertEqual(cm.transcript_hash([]), 0)


class StateTest(unittest.TestCase):
    def test_empty_state_commit_is_deterministic(self):
        s1 = cm.empty_state(TEST, m=2, budget=100)
        s2 = cm.empty_state(TEST, m=2, budget=100)
        self.assertEqual(cm.state_commit(TEST, s1), cm.state_commit(TEST, s2))
        self.assertEqual(s1.level, 1)
        self.assertEqual(len(s1.weights), TEST.n_sealed_max)

    def test_commit_layout(self):
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 0, 60, pack([2, 1]))
        s.funded[1] = True
        s.funded_order[0] = 1
        s.funded_count = 1
        flat = s.weights + s.ballots + [cm.funded_bits(s), cm.funded_order_packed(s), s.funded_count, s.level, s.spent, int(s.done), s.m, s.budget, s.t_hash]
        self.assertEqual(cm.state_commit(TEST, s), poseidon2.hash(flat))
        self.assertEqual(cm.funded_bits(s), 0b10)
        self.assertEqual(cm.funded_order_packed(s), 1)

    def test_ingest_absent_ballot_writes_zeros(self):
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 3, 60, None)
        self.assertEqual((s.weights[3], s.ballots[3]), (0, 0))

    def test_tally_follows_transcript(self):
        costs = [30, 70]
        public = [(40, [1, 2])]
        sealed = [(60, [2, 1])]
        funded, transcript = pbear_transcript(costs, public, sealed, 100)
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 0, 60, pack([2, 1]))
        for step in transcript:
            cm.tally_step(TEST, s, costs, step)
        self.assertTrue(s.done)
        self.assertEqual(s.funded_order[: s.funded_count], funded)
        self.assertEqual(s.t_hash, cm.transcript_hash(transcript))
        self.assertEqual(s.spent, 100)
        self.assertEqual(s.weights[0], 0)  # 60 − 60·70/70 after funding B with total 70

    def test_tally_rejects_forged_best_total_level(self):
        costs = [30, 70]
        _, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
        for index, field, value in [(0, 3, 1), (0, 4, 41), (0, 0, 2), (1, 3, 1)]:
            s = cm.empty_state(TEST, m=2, budget=100)
            cm.ingest(s, 0, 60, pack([2, 1]))
            forged = [list(x) for x in transcript]
            forged[index][field] = value
            with self.assertRaises(cm.TranscriptMismatch):
                for step in forged:
                    cm.tally_step(TEST, s, costs, step)

    def test_done_state_ignores_steps(self):
        s = cm.empty_state(TEST, m=1, budget=10)
        s.done = True
        before = cm.state_commit(TEST, s)
        cm.tally_step(TEST, s, [5], [1, 0, NONE, 0])
        self.assertEqual(cm.state_commit(TEST, s), before)

    def test_exhausted_state_becomes_done_without_absorbing(self):
        s = cm.empty_state(TEST, m=1, budget=10)  # cost 50 > budget: exhausted at start
        cm.tally_step(TEST, s, [50], [1, 0, NONE, 0])
        self.assertTrue(s.done)
        self.assertEqual(s.t_hash, 0)


class SplitConsistencyTest(unittest.TestCase):
    def test_sealed_weights_match_full_tally(self):
        import random
        from test_pbear import random_instance
        rng = random.Random(3)
        for _ in range(200):
            m = rng.randint(1, TEST.m_max)
            costs, public, sealed, budget = random_instance(rng, rng.randint(0, 3), rng.randint(0, TEST.n_sealed_max), m)
            funded, transcript = pbear_transcript(costs, public, sealed, budget)
            s = cm.empty_state(TEST, m, budget)
            for i, (w, ballot) in enumerate(sealed):
                cm.ingest(s, i, w, None if ballot is None else pack(ballot))
            for step in transcript:
                cm.tally_step(TEST, s, costs, step)
            self.assertEqual(s.funded_order[: s.funded_count], funded)
            self.assertEqual(s.done or not transcript, True)


if __name__ == "__main__":
    unittest.main()
