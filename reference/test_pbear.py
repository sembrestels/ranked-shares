"""Tests for the PB-EAR reference implementation.

Fixtures come from Aziz & Lee, "Proportionally Representative Participatory
Budgeting with Ordinal Preferences" (AAAI-21), Examples 1-5.

Ballot encoding: list of ints, one per project, value = 1 + number of projects the
voter strictly prefers (ties share a value), 0 = unranked (last tier).
"""

import random
import unittest

from pbear import (
    abi_encode_uint_array,
    cumulative_deductions,
    effective_ranks,
    is_exhaustive,
    is_ipsc,
    pbear,
    validate_ballot,
)


def strict(order, m):
    """Build a ballot from a strict order given as project indices."""
    ranks = [0] * m
    for pos, c in enumerate(order):
        ranks[c] = pos + 1
    return ranks


A, B, C, D = 0, 1, 2, 3


def merged(voters):
    """Merge voters with identical ballots into one weighted voter.

    Sound for IPSC checks: any coalition mixing partial groups is dominated by
    the union of the full groups it touches, which has at least as much weight.
    """
    groups = {}
    for w, ballot in voters:
        key = tuple(ballot)
        groups[key] = groups.get(key, 0) + w
    return [(w, list(key)) for key, w in groups.items()]


class ExampleFixtures(unittest.TestCase):
    def test_example1_selects_a_and_b(self):
        # 9 voters, 4 equal-cost projects, room for exactly 3 of them.
        # Budget equals total weight (9), so each project costs 3.
        costs = [3, 3, 3, 3]
        voters = [(1, strict([A, B, C, D], 4))] * 6
        voters += [(1, strict([D, C, B, A], 4))] * 2
        voters += [(1, strict([C, A, B, D], 4))]
        funded = pbear(costs, voters)
        self.assertIn(A, funded)
        self.assertIn(B, funded)
        self.assertEqual(len(funded), 3)

    def test_example2(self):
        # 30 voters a>b>c>d, 70 voters d>c>b>a; costs a50 b30 c30 d40; L=100.
        costs = [50, 30, 30, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 30
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: d has 70 >= 40 -> fund d, the 70 voters keep 30.
        # Level 2: b has 30 >= 30 (first group), c has 30 >= 30 (second group);
        #          tie on support and cost -> lower id b first, then c.
        self.assertEqual(funded, [D, B, C])

    def test_example3_ties_in_first_group(self):
        # first group: a > b ~ c > d
        costs = [50, 30, 30, 40]
        voters = [(1, [1, 2, 2, 4])] * 30
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: d funded (70 -> 30 left).
        # Level 2: group1 approves {a,b,c}, group2 {d,c}: c has 60, b 30, a 30.
        #          c funded; supporters keep 30 in total (15 per group).
        # Level 3: group2 now approves b too: b has 15+15 = 30 -> funded.
        self.assertEqual(funded, [D, C, B])

    def test_example4_split_first_group(self):
        costs = [50, 30, 30, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 15
        voters += [(1, strict([B, A, C, D], 4))] * 15
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        self.assertEqual(funded, [D, B, C])

    def test_example5_combined_groups(self):
        costs = [90, 30, 80, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 14
        voters += [(1, strict([A, C, B, D], 4))] * 16
        voters += [(1, strict([C, A, B, D], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: c has 70 < 80, a has 30 < 90 -> advance.
        # Level 2: a is approved by everyone (100 >= 90), c by 86 (>= 80).
        #          Highest support wins: a. Remaining 10 affords nothing.
        self.assertEqual(funded, [A])
        self.assertTrue(is_ipsc(costs, 100, merged(voters), funded))


class Validation(unittest.TestCase):
    def test_valid_ballots(self):
        for ranks in ([1, 2, 2, 4], [0, 0, 0], [2, 2, 1], [1, 0, 0], [1, 2, 3]):
            validate_ballot(ranks, len(ranks))

    def test_invalid_ballots(self):
        for ranks, m in (([1, 3, 3], 3), ([1, 2], 3), ([4, 1, 2], 3), ([2, 2, 2], 3)):
            with self.assertRaises(ValueError):
                validate_ballot(ranks, m)

    def test_effective_ranks_fill_last_tier(self):
        self.assertEqual(effective_ranks([2, 0, 1, 0]), [2, 3, 1, 3])
        self.assertEqual(effective_ranks([0, 0]), [1, 1])


class Reweighting(unittest.TestCase):
    def test_cumulative_deductions_are_exact(self):
        rng = random.Random(1)
        for _ in range(200):
            weights = [rng.randint(1, 50) for _ in range(rng.randint(1, 8))]
            total = sum(weights)
            thr = rng.randint(0, total)
            deductions = cumulative_deductions(weights, thr)
            self.assertEqual(sum(deductions), thr)
            for w, d in zip(weights, deductions):
                self.assertTrue(0 <= d <= w)


def random_ballot(rng, m):
    order = list(range(m))
    rng.shuffle(order)
    kept = rng.randint(0, m)
    ranks = [0] * m
    rank = 1
    for pos, c in enumerate(order[:kept]):
        if pos > 0 and rng.random() < 0.4:
            pass  # tie with previous
        else:
            rank = pos + 1
        ranks[c] = rank
    return ranks


def random_instance(rng, all_vote=True):
    n = rng.randint(1, 6)
    m = rng.randint(1, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    voters = []
    for _ in range(n):
        w = rng.randint(1, 10)
        if all_vote or rng.random() < 0.7:
            voters.append((w, random_ballot(rng, m)))
        else:
            voters.append((w, None))
    abstaining = 0 if all_vote else rng.randint(0, 10)
    return costs, voters, abstaining


class Properties(unittest.TestCase):
    def test_outcome_is_exhaustive_when_everyone_votes(self):
        rng = random.Random(7)
        for _ in range(300):
            costs, voters, abstaining = random_instance(rng, all_vote=True)
            funded = pbear(costs, voters, abstaining)
            budget = sum(w for w, _ in voters) + abstaining
            self.assertTrue(is_exhaustive(costs, budget, funded), (costs, voters, funded))

    def test_outcome_satisfies_ipsc(self):
        rng = random.Random(11)
        for _ in range(300):
            for all_vote in (True, False):
                costs, voters, abstaining = random_instance(rng, all_vote)
                funded = pbear(costs, voters, abstaining)
                budget = sum(w for w, _ in voters) + abstaining
                self.assertTrue(is_ipsc(costs, budget, voters, funded), (costs, voters, abstaining, funded))

    def test_ipsc_rejects_unrepresentative_outcome(self):
        # Two voters, each with weight 5 and their own favourite costing 5.
        # Funding only voter 0's favourite twice-over is impossible, so fund a
        # project nobody ranks first instead.
        costs = [5, 5]
        voters = [(5, [1, 2]), (5, [2, 1])]
        self.assertFalse(is_ipsc(costs, 10, voters, [0]))
        self.assertTrue(is_ipsc(costs, 10, voters, [0, 1]))

    def test_spent_never_exceeds_budget(self):
        rng = random.Random(3)
        for _ in range(300):
            costs, voters, abstaining = random_instance(rng, all_vote=False)
            funded = pbear(costs, voters, abstaining)
            budget = sum(w for w, _ in voters) + abstaining
            self.assertLessEqual(sum(costs[c] for c in funded), budget)


class AbiEncoding(unittest.TestCase):
    def test_encodes_uint256_array(self):
        self.assertEqual(
            abi_encode_uint_array([]),
            "0x" + "20".rjust(64, "0") + "0" * 64,
        )
        self.assertEqual(
            abi_encode_uint_array([3]),
            "0x" + "20".rjust(64, "0") + "1".rjust(64, "0") + "3".rjust(64, "0"),
        )


if __name__ == "__main__":
    unittest.main()
