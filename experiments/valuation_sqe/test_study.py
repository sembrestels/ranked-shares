"""Tests assert the experiments' semantics and reproduce failures, not their absence."""

import copy
import random
import unittest

from study import (DAY, USD, POLICIES, SCALES, Scenario, base_economy, differential_checks,
                   currency_ear, ear, explicit_cases, fixture, moved, reserve, run, simple, value)
from support_ledger import examples
from withhold import pbear_withhold, withhold_all


class ValuationStudy(unittest.TestCase):
    def case(self, name, policy="fixed_usd"):
        return run(next(s for s in explicit_cases() if s.name == name), policy)

    def test_pool_fall_reproduces_scalar_and_individual_deficit(self):
        r = self.case("pool_fall_after_s")
        self.assertEqual(r["metrics"]["final_budget_usd"], 500 * USD)
        self.assertEqual(r["metrics"]["scalar_deficit_usd"], 100 * USD)
        self.assertEqual(r["metrics"]["nft_overdraw_usd"], 100 * USD)
        self.assertEqual((r["funded"], r["fresh_funded"]), ([0], [1]))

    def test_scalar_affordability_does_not_imply_individual_affordability(self):
        m = self.case("individual_overdraw_without_scalar_deficit")["metrics"]
        self.assertEqual(m["scalar_deficit_usd"], 0)
        self.assertEqual(m["nft_overdraw_usd"], 10 * USD)

    def test_currency_reservation_prevents_quantity_deficit_but_loses_coverage(self):
        r = self.case("pool_fall_after_s", "fixed_currency")
        self.assertEqual(r["metrics"]["scalar_deficit_usd"], 0)
        self.assertEqual(r["metrics"]["nft_overdraw_usd"], 0)
        self.assertEqual(r["metrics"]["undercoverage_usd"], 300 * USD)
        self.assertEqual(r["currency_reservations"][0][1]["ETH"], 240 * SCALES["ETH"])

    def test_finite_haircut_does_not_cover_unbounded_price_fall(self):
        self.assertEqual(self.case("pool_fall_after_s", "reserve30")["metrics"]["scalar_deficit_usd"], 100 * USD)

    def test_withdrawn_balance_leaves_an_unfunded_gap(self):
        r = self.case("donation_withdrawal_after_s")
        self.assertEqual(r["metrics"]["undercoverage_usd"], 40 * USD)
        self.assertEqual(r["metrics"]["scalar_deficit_usd"], 0)
        self.assertNotEqual(r["funded"], r["fresh_funded"])

    def test_later_support_strands_a_prior_allocation(self):
        r = self.case("donation_arrives_after_s")
        self.assertEqual(r["metrics"]["overcoverage_usd"], 40 * USD)
        self.assertEqual(r["fresh_funded"], [0, 1])
        self.assertEqual(r["funded"], [0])

    def test_zero_need_is_external_coverage_and_can_reopen(self):
        r = self.case("zero_need_then_reopens")
        self.assertEqual(r["trace"][0]["order"], [])
        # The S allocation is empty, yet the same S approvals fund it in the A pass.
        self.assertEqual(r["trace"][2]["order"], [0])
        self.assertEqual(r["funded"], [0])

    def test_payment_fraction_comparison_accepts_doubled_bill(self):
        r = self.case("same_payer_double_bill")
        opening, closing = r["trace"][:2]
        self.assertEqual(opening["payments"][0][1], 50 * USD)
        self.assertEqual(closing["payments"][0][1], 100 * USD)
        self.assertTrue(closing["quiet"])
        self.assertEqual(closing["normalized_shift_num"], 0)
        self.assertEqual(moved({0: {1: 1, 2: 1}}, {0: {1: 2, 2: 2}}, [4]), 0)

    def test_exact_cutoff_event_is_excluded_from_closing_prefix(self):
        self.assertEqual(self.case("boundary_donation_before")["funded"], [0, 1])
        self.assertEqual(self.case("boundary_donation_exact")["funded"], [0])
        self.assertEqual(self.case("boundary_donation_after")["funded"], [0])

    def test_usd_and_currency_pledges_have_different_price_exposure(self):
        self.assertEqual(self.case("pledge_denomination_eth")["metrics"]["undercoverage_usd"], 20 * USD)
        self.assertEqual(self.case("pledge_denomination_usd")["metrics"]["undercoverage_usd"], 0)

    def test_prices_alone_reach_forced_close_with_support_locks(self):
        r = self.case("price_only_exhausts_windows")
        self.assertEqual(r["forced_stages"], [1])
        self.assertEqual(r["metrics"]["rejected_revisions"], 0)
        self.assertEqual([t["cutoff"] for t in r["trace"] if t["stage"] == 1],
                         [DAY, 2 * DAY, 5 * DAY // 2, 11 * DAY // 4, 23 * DAY // 8])

    def test_unplaced_proposal_never_receives_support(self):
        self.assertEqual(self.case("unplaced_gets_no_support")["funded"], [])

    def test_same_wallet_nfts_are_independent_and_ordered_by_id(self):
        # IDs 7 and 42 can have the same owner; ownership is deliberately no voting key.
        sc = simple("nft-identities", [50, 50], [[1, 2], [2, 1]])
        sc.ballots = {42: [2, 1], 7: [1, 2]}
        r = run(sc, "fixed_usd")
        self.assertEqual(r["payments"], {0: {7: 50 * USD}, 1: {42: 50 * USD}})

    def test_registration_closes_at_first_s_plus_initial_window(self):
        sc = simple("registration", [50], [[1]])
        sc.revisions = [(2 * DAY - 1, 2, [1]), (2 * DAY, 3, [1])]
        r = run(sc, "fixed_usd")
        self.assertEqual(r["metrics"]["registered_nfts"], 2)
        self.assertEqual(r["rejections"][0]["reason"], "registration closed")

    def test_opening_timestamp_rejects_earlier_receipts(self):
        sc = simple("before-opening", [50], [[1]])
        sc.revisions = [(-1, 2, [1])]
        r = run(sc, "fixed_usd")
        self.assertEqual(r["metrics"]["registered_nfts"], 1)
        self.assertEqual(r["rejections"][0]["reason"], "voting not open")

    def test_support_restriction_rejects_whole_revision(self):
        sc = simple("restriction", [50, 50], [[1, 2]])
        sc.revisions = [(DAY + 1, 1, [0, 1])]
        r = run(sc, "fixed_usd")
        self.assertEqual(r["final_ballots"], {1: [1, 2]})
        self.assertEqual(r["rejections"][0]["reason"], "bound supporter withdrawal")

    def test_settled_tier_membership_cannot_change(self):
        sc = simple("tier-lock", [50, 50], [[1, 2]])
        sc.revisions = [(2 * DAY + 1, 1, [2, 1])]
        self.assertEqual(run(sc, "fixed_usd")["rejections"][0]["reason"], "settled tier membership")

    def test_currency_reservations_are_backed_with_mixed_exposures(self):
        amounts = {"ETH": 13 * SCALES["ETH"], "USDC": 777 * SCALES["USDC"]}
        prices = {"ETH": 2500 * USD, "USDC": 930001}
        for target in (1, 1000, 123456789, value(amounts, prices)):
            q = reserve(amounts, target, prices)
            self.assertGreaterEqual(value(q, prices), target)
            self.assertTrue(all(q[c] <= amounts[c] for c in amounts))

    def test_atom_rounding_cannot_spend_the_last_atom_twice(self):
        # 50 ETH at $0.70 is $35. Separate ceil reservations for $20 and $15
        # need one atom too many; the second award must be reconsidered.
        prices = {"ETH": 700000}
        inventory = {1: {"ETH": 50 * SCALES["ETH"]}}
        order, paid, remaining, reservations = currency_ear(
            [20 * USD, 15 * USD], inventory, {1: [1, 2]}, 3, (), prices)
        self.assertEqual(order, [0])
        self.assertGreaterEqual(remaining[1]["ETH"], 0)

    def test_currency_transitions_match_repeated_core_selections(self):
        def slow(costs, available, ballots, stage, prices):
            available = copy.deepcopy(available)
            ids, order, paid, reservations = sorted(ballots), [], {}, {}
            while True:
                weights = [value(available[i], prices) for i in ids]
                candidates, payments = ear(costs, weights, ballots, stage, paid)
                if not candidates:
                    return order, paid, available, reservations
                c = candidates[0]
                order.append(c)
                paid[c], reservations[c] = payments[c], {}
                for i, d in paid[c].items():
                    taking = reserve(available[i], d, prices)
                    reservations[c][i] = taking
                    for curr, q in taking.items():
                        available[i][curr] -= q

        rng = random.Random(1801)
        for _ in range(1000):
            ballots = {i: rng.sample((1, 2, 3), 3) for i in range(1, rng.randint(1, 5) + 1)}
            costs = [rng.randint(1, 50) * USD for _ in range(3)]
            prices = {"ETH": rng.randint(1, 200) * 10000, "USDC": rng.randint(1, 150) * 10000}
            available = {i: {"ETH": rng.randint(1, 100) * SCALES["ETH"],
                             "USDC": rng.randint(1, 50) * SCALES["USDC"]} for i in ballots}
            stage = rng.randint(1, 3)
            self.assertEqual(currency_ear(costs, available, ballots, stage, (), prices),
                             slow(costs, available, ballots, stage, prices))

    def test_flat_economics_match_fresh_tally_for_all_nonreserve_policies(self):
        for seed in range(3):
            for policy in POLICIES:
                r = run(fixture(seed, "flat"), policy)
                if policy != "reserve30":
                    self.assertEqual(r["metrics"]["fresh_set_diff"], 0, (seed, policy))
                    self.assertFalse(r["metrics"]["fresh_nominal_payments_diff"], (seed, policy))

    def test_recomputation_matches_final_input_but_reverses_s(self):
        r = self.case("pool_fall_after_s", "recompute")
        self.assertFalse(r["metrics"]["fresh_set_diff"])
        self.assertFalse(r["metrics"]["fresh_nominal_payments_diff"])
        self.assertTrue(r["metrics"]["winner_finality_broken"])
        self.assertTrue(r["metrics"]["payment_finality_broken"])

    def test_pledge_fulfilment_replaces_outstanding_pledge(self):
        correct, naive = fixture(0, "pledge_fulfilment"), fixture(0, "pledge_double_count")
        before = correct.at(DAY).inputs(correct.asks)
        self.assertEqual(before, correct.at(3 * DAY).inputs(correct.asks))
        self.assertLess(sum(naive.at(3 * DAY).inputs(naive.asks)[1]), sum(before[1]))

    def test_support_ledger_examples(self):
        e = examples()
        self.assertEqual(e["pledge_conversion"]["correct_need"], 60)
        self.assertEqual(e["round_payment"]["correct_total_grant_target"], 100)

    def test_wrapper_matches_existing_core_for_fully_ranked_ballots(self):
        self.assertEqual(differential_checks()["fully_ranked_differential_cases"], 1000)

    def test_truncated_tally_matches_existing_withholding_reference(self):
        from study import ranks_of
        rng = random.Random(1802)
        for _ in range(1000):
            n = rng.randint(1, 5)
            ballots = {i: [rng.randrange(4) for _ in range(5)] for i in range(1, n + 1)}
            costs = [rng.randint(1, 60) * USD for _ in range(5)]
            weights = [100 * USD // n] * n
            expected = []
            for i in sorted(ballots):
                ranks = ranks_of(ballots[i])
                expected.append(withhold_all([0 if t == 0 else r for t, r in zip(ballots[i], ranks)]))
            reference = pbear_withhold(costs, list(zip(weights, expected)))[0]
            self.assertEqual(ear(costs, weights, ballots, 3)[0], reference)


if __name__ == "__main__":
    unittest.main()
