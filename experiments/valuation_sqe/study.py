#!/usr/bin/env python3
"""Isolated integer valuation/SQE study. Never changes reference behavior.

Run from the repository root; see README.md for the full protocol and limitations.
USD values are microdollars; amounts are integer native currency atoms.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import random
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference"))
from pbear import cumulative_deductions, pbear, is_ipsc, _argmax  # noqa: E402
from quiet_ending import _ear  # noqa: E402
from quiet_ending_sim import World, INITIATIVES  # noqa: E402

USD = 10**6
DAY = 86400
SCALES = {"ETH": 10**18, "ALT": 10**18, "USDC": 10**6}
POLICIES = ("fixed_usd", "fixed_currency", "reserve30", "tier_lock", "round_lock", "recompute")


def value(amounts, prices):
    return sum(q * prices[c] // SCALES[c] for c, q in amounts.items())


def quantity(dollars, currency, prices):
    """Floor a USD amount into currency atoms; only used to invent support inputs."""
    return dollars * SCALES[currency] // prices[currency]


@dataclass
class Economy:
    prices: dict
    pool: dict
    donations: list
    pledges: list

    def inputs(self, asks):
        support = []
        for donation, pledges in zip(self.donations, self.pledges):
            outstanding = sum(p["amount"] if p["denomination"] == "USD" else
                              value({p["denomination"]: p["amount"]}, self.prices)
                              for p in pledges)
            support.append(value(donation, self.prices) + outstanding)
        return value(self.pool, self.prices), [max(a - s, 0) for a, s in zip(asks, support)]


@dataclass
class Scenario:
    name: str
    asks: list
    # Ballots have explicit tier labels: 0 unplaced, 1 S, 2 A, 3 B.
    ballots: dict
    snapshots: list  # (event timestamp, full economy state); event must precede cutoff
    revisions: list | None = None  # (timestamp, NFT ID, full ballot), in chain order

    def at(self, cutoff):
        seen = [economy for timestamp, economy in self.snapshots if timestamp < cutoff]
        if not seen:
            raise ValueError("no historical economy before cutoff")
        return seen[-1]


def ranks_of(ballot):
    """Competition ranks with unplaced beyond every counted level (never support)."""
    return [1 + sum(0 < other < tier for other in ballot) if tier else len(ballot) + 1
            for tier in ballot]


def cap_for(ballots, stage):
    # This is the existing reference's rank-position stopping convention.
    # Main fixture uses the SAME (4,7,9) tier sizes for every NFT to prevent leakage.
    return max([1] + [r for b in ballots.values() for t, r in zip(b, ranks_of(b))
                      if 0 < t <= stage])


def ear(costs, weights, ballots, stage, already=()):
    ids = sorted(ballots)
    ranks = [ranks_of(ballots[i]) for i in ids]
    candidates = [c for c, cost in enumerate(costs) if cost > 0 and c not in already]
    # Reuse the actual selection and cumulative rounding, without forced reservations.
    ordered, payments, forced = _ear(costs, list(weights), ranks, sum(weights), 0,
                                     candidates, max_level=cap_for(ballots, stage))
    assert not forced
    return ordered, {c: {ids[i]: d for i, d in pay.items() if d > 0}
                     for c, pay in payments.items()}


def moved(previous, current, costs):
    """Exact USD-normalized total variation of per-project payment fractions."""
    total = Fraction(0)
    for c in previous.keys() & current.keys():
        old, new = previous[c], current[c]
        a, b = sum(old.values()), sum(new.values())
        if not a or not b:
            continue
        tv = sum(abs(Fraction(old.get(i, 0), a) - Fraction(new.get(i, 0), b))
                 for i in old.keys() | new.keys()) / 2
        total += costs[c] * tv
    return total


def reserve(amounts, charge, prices):
    """Buy the charge across available currencies, proportional to their USD values.

    Each currency target is rounded cumulatively; atom quantities round UP. This
    reserves at least charge USD at these prices and never more atoms than available.
    Currency overcoverage due to atom rounding remains charged to that NFT.
    """
    currencies = sorted(amounts)
    targets = cumulative_deductions([value({c: amounts[c]}, prices) for c in currencies], charge)
    taken = {}
    for c, target in zip(currencies, targets):
        q = (target * SCALES[c] + prices[c] - 1) // prices[c]
        assert 0 <= q <= amounts[c]
        taken[c] = q
    assert value(taken, prices) >= charge
    return taken


def currency_ear(costs, available, ballots, stage, already, prices):
    """Reserve atom quantities after EACH selection, then revalue remaining shares.

    A ceil-to-atoms reservation can consume a fraction of an additional microdollar.
    Reusing a complete USD transcript without updating the actual residual baskets
    could therefore reserve the last atom twice at an exact affordability boundary.
    The core selects every next winner; only this policy's residual accounting differs.
    """
    available = copy.deepcopy(available)
    ids = sorted(ballots)
    ranks = [ranks_of(ballots[i]) for i in ids]
    weights = [value(available[i], prices) for i in ids]
    is_funded = [cost == 0 or c in already for c, cost in enumerate(costs)]
    cap = cap_for(ballots, stage)
    opens, approved = {}, [[] for _ in ids]
    approvers, support = [[] for _ in costs], [0] * len(costs)
    for i, r in enumerate(ranks):
        for c in range(len(costs)):
            if not is_funded[c] and r[c] <= cap:
                opens.setdefault(r[c], []).append((i, c))
    levels = iter(sorted(opens))

    def open_next():
        level = next(levels, None)
        if level is None:
            return False
        for i, c in opens[level]:
            approved[i].append(c)
            approvers[c].append(i)
            support[c] += weights[i]
        return True

    ordered, paid, reserved = [], {}, {}
    open_next()
    while True:
        c = _argmax(costs, support, is_funded)
        if c is None:
            if open_next():
                continue
            return ordered, paid, available, reserved
        ordered.append(c)
        payers = sorted(i for i in approvers[c] if weights[i])
        deductions = cumulative_deductions([weights[i] for i in payers], costs[c])
        paid[c], reserved[c] = {}, {}
        for i, charge in zip(payers, deductions):
            if not charge:
                continue
            nft = ids[i]
            paid[c][nft] = charge
            taking = reserve(available[nft], charge, prices)
            reserved[c][nft] = taking
            for curr, q in taking.items():
                available[nft][curr] -= q
            remaining = value(available[nft], prices)
            debit = weights[i] - remaining
            weights[i] = remaining
            for other in approved[i]:
                support[other] -= debit
        is_funded[c] = True


def run(scenario, policy, *, opening=0, first=(DAY, 3 * DAY, 5 * DAY), window=DAY,
        max_windows=4, lock_supporters=True):
    """Replay bounded deterministic checkpoints, with a fresh final-input comparator."""
    assert policy in POLICIES and max_windows > 0 and window >> (max_windows - 1) > 0
    bound = sum(window >> k for k in range(max_windows))
    assert first[0] >= opening and all(b >= a + bound for a, b in zip(first, first[1:]))
    register_close = first[0] + window
    events = [(opening, i, list(b)) for i, b in sorted(scenario.ballots.items())]
    events += list(scenario.revisions or [])
    events = sorted(enumerate(events), key=lambda e: (e[1][0], e[0]))
    cursor, accepted, refused = 0, {}, []
    locks, settled_stage = {}, 0
    paid, order, inventory, currency_paid = {}, [], None, {}
    trace, forced, broke_winners, broke_payments = [], [], False, False
    round_economy = scenario.at(first[0])

    def replay(cutoff):
        nonlocal cursor
        while cursor < len(events) and events[cursor][1][0] < cutoff:
            _, (timestamp, nft, ballot) = events[cursor]
            cursor += 1
            old = accepted.get(nft)
            reason = None
            if timestamp < opening:
                reason = "voting not open"
            elif len(ballot) != len(scenario.asks) or any(t not in (0, 1, 2, 3) for t in ballot):
                reason = "invalid ballot"
            elif old is None and timestamp >= register_close:
                reason = "registration closed"
            elif old is not None and any((old[c] == t) != (ballot[c] == t)
                                         for t in range(1, settled_stage + 1)
                                         for c in range(len(ballot))):
                reason = "settled tier membership"
            elif old is not None and lock_supporters and any(
                    ballot[c] == 0 or ballot[c] > old[c] for c in locks.get(nft, set())):
                reason = "bound supporter withdrawal"
            if reason:
                refused.append({"time": timestamp, "nft": nft, "reason": reason})
            else:
                accepted[nft] = list(ballot)

    for stage, start in enumerate(first, 1):
        previous = None
        tier_economy = scenario.at(start)
        cutoff = start
        for index in range(max_windows + 1):
            replay(cutoff)
            ids = sorted(accepted)
            if not ids:
                raise ValueError("empty registered electorate")
            actual = scenario.at(cutoff)
            economics = round_economy if policy == "round_lock" else tier_economy if policy == "tier_lock" else actual
            budget, costs = economics.inputs(scenario.asks)
            capacity = budget * 70 // 100 if policy == "reserve30" else budget
            if policy == "fixed_currency":
                if inventory is None:
                    # First S comparison closes registration; no currency is reserved earlier.
                    available = {i: {c: q // len(ids) for c, q in actual.pool.items()} for i in ids}
                else:
                    available = copy.deepcopy(inventory)
                weights = [value(available[i], actual.prices) for i in ids]
            elif policy == "recompute":
                weights = [capacity // len(ids)] * len(ids)
            else:
                weights = [capacity // len(ids) - sum(p.get(i, 0) for p in paid.values()) for i in ids]
            blocked = min(weights) < 0
            if policy == "fixed_currency":
                new_order, provisional, remaining_inventory, new_reservations = currency_ear(
                    costs, available, accepted, stage, paid, actual.prices)
            else:
                new_order, provisional = ([], {}) if blocked else ear(
                    costs, weights, accepted, stage, () if policy == "recompute" else paid)
            shifted = moved(previous or {}, provisional, costs)
            quiet = previous is not None and set(previous) == set(provisional) and shifted <= Fraction(budget, 50)
            closing = index > 0 and (quiet or index == max_windows)
            trace.append({"cutoff": cutoff, "stage": stage, "comparison": index,
                          "budget": budget, "actual_budget": actual.inputs(scenario.asks)[0],
                          "costs": costs, "order": new_order, "payments": provisional,
                          "normalized_shift_num": shifted.numerator,
                          "normalized_shift_den": shifted.denominator,
                          "negative_policy_capacity": blocked, "quiet": quiet, "settles": closing})
            locks = {}
            for c, payments in provisional.items():
                for i, d in payments.items():
                    if d:
                        locks.setdefault(i, set()).add(c)
            if closing:
                if not quiet:
                    forced.append(stage)
                if policy == "recompute":
                    broke_winners |= not set(paid).issubset(provisional)
                    broke_payments |= any(provisional.get(c) != p for c, p in paid.items())
                    paid, order = provisional, new_order
                else:
                    for c in new_order:
                        paid[c] = provisional[c]
                        order.append(c)
                        if policy == "fixed_currency":
                            currency_paid[c] = new_reservations[c]
                    if policy == "fixed_currency":
                        inventory = remaining_inventory
                settled_stage, locks = stage, {}
                break
            previous = provisional
            cutoff += window >> index

    final = scenario.at(cutoff)
    final_budget, final_costs = final.inputs(scenario.asks)
    ids = sorted(accepted)
    fresh_order, fresh_paid = ear(final_costs, [final_budget // len(ids)] * len(ids), accepted, 3)
    allocations = {c: sum(p.values()) for c, p in paid.items()}
    charges = {i: sum(p.get(i, 0) for p in paid.values()) for i in ids}
    if policy == "fixed_currency":
        allocations = {c: sum(value(q, final.prices) for q in p.values()) for c, p in currency_paid.items()}
        charges = {i: sum(value(p.get(i, {}), final.prices) for p in currency_paid.values()) for i in ids}
    spent = sum(allocations.values())
    under = sum(max(final_costs[c] - allocation, 0) for c, allocation in allocations.items())
    over = sum(max(allocation - final_costs[c], 0) for c, allocation in allocations.items())
    # Include per-currency obligations to distinguish a USD scalar from quantity backing.
    used = {curr: sum(p.get(i, {}).get(curr, 0) for p in currency_paid.values() for i in ids)
            for curr in final.pool}
    metrics = {"funded_count": len(order), "spent_usd": spent, "final_budget_usd": final_budget,
               "scalar_deficit_usd": max(spent - final_budget, 0),
               "nft_overdraw_usd": sum(max(d - final_budget // len(ids), 0) for d in charges.values()),
               "undercoverage_usd": under, "overcoverage_usd": over,
               "fresh_set_diff": len(set(order) ^ set(fresh_order)),
               "fresh_order_diff": order != fresh_order,
               "fresh_nominal_payments_diff": paid != fresh_paid,
               "winner_finality_broken": broke_winners, "payment_finality_broken": broke_payments,
               "forced_tiers": len(forced), "end_time": cutoff,
               "negative_capacity_checkpoints": sum(t["negative_policy_capacity"] for t in trace),
               "quantity_overdraw": any(q > final.pool[c] for c, q in used.items()),
               "registered_nfts": len(ids), "rejected_revisions": len(refused)}
    assert cutoff <= first[-1] + bound
    assert len(trace) <= 3 * (max_windows + 1)
    assert sum(charges.values()) == spent
    return {"scenario": scenario.name, "policy": policy, "metrics": metrics,
            "funded": order, "fresh_funded": fresh_order, "payments": paid,
            "fresh_payments": fresh_paid, "allocations_usd": allocations, "charges_usd": charges,
            "currency_reservations": currency_paid, "forced_stages": forced,
            "rejections": refused, "trace": trace, "final_ballots": accepted}


def base_economy(m, pool=None, prices=None):
    return Economy(prices or {"ETH": 2500 * USD, "ALT": 100 * USD, "USDC": USD},
                   pool or {"ETH": 400 * SCALES["ETH"]}, [{} for _ in range(m)], [[] for _ in range(m)])


def simple(name, asks, ballots, *, budget=100, support=0, after_support=None,
           price_percent=100, event_time=2 * DAY + 1):
    initial = base_economy(len(asks), {"USDC": budget * SCALES["USDC"]})
    initial.donations[0] = {"USDC": support * SCALES["USDC"]}
    later = copy.deepcopy(initial)
    later.prices["USDC"] = USD * price_percent // 100
    if after_support is not None:
        later.donations[0] = {"USDC": after_support * SCALES["USDC"]}
    return Scenario(name, [a * USD for a in asks], {i + 1: b for i, b in enumerate(ballots)},
                    [(-1, initial), (event_time, later)])


def explicit_cases():
    fall = simple("pool_fall_after_s", [600, 300], [[1, 2]], budget=1000, price_percent=50)
    # This exact witness is 400 ETH at $2.50 -> $1.25, a deliberately small USD scale.
    fall.snapshots[0][1].pool = {"ETH": 400 * SCALES["ETH"]}
    fall.snapshots[0][1].prices["ETH"] = 2500000
    fall.snapshots[1][1].pool = {"ETH": 400 * SCALES["ETH"]}
    fall.snapshots[1][1].prices["ETH"] = 1250000
    fall.snapshots[1][1].prices["USDC"] = USD
    cases = [fall,
             simple("individual_overdraw_without_scalar_deficit", [40, 1000, 20], [[1, 0, 2], [0, 1, 2]], price_percent=60),
             simple("donation_withdrawal_after_s", [100, 40], [[1, 2]], support=40, after_support=0),
             simple("donation_arrives_after_s", [80, 50], [[1, 2]], after_support=40),
             simple("same_payer_double_bill", [100], [[1]], support=50, after_support=0, event_time=DAY + DAY // 2),
             simple("unplaced_gets_no_support", [10], [[0]]),
             simple("zero_need_then_reopens", [100, 40], [[1, 2]], support=100, after_support=0)]
    for suffix, offset in (("before", -1), ("exact", 0), ("after", 1)):
        cases.append(simple("boundary_donation_" + suffix, [100, 50], [[1, 2]],
                            after_support=50, event_time=2 * DAY + offset))
    for denom in ("ETH", "USD"):
        sc = simple("pledge_denomination_" + denom.lower(), [100, 40], [[1, 2]])
        initial, later = sc.snapshots[0][1], sc.snapshots[1][1]
        initial.prices["ETH"], later.prices["ETH"] = USD, USD // 2
        initial.pledges[0] = [{"id": "pledge-1", "denomination": denom,
                               "amount": 40 * (USD if denom == "USD" else SCALES[denom])}]
        later.pledges = copy.deepcopy(initial.pledges)
        cases.append(sc)
    oscillate = simple("price_only_exhausts_windows", [75], [[1]])
    initial = oscillate.snapshots[0][1]
    oscillate.snapshots = [(-1, initial)]
    for t, percent in zip((2 * DAY, 5 * DAY // 2, 11 * DAY // 4, 23 * DAY // 8), (50, 100, 50, 100)):
        e = copy.deepcopy(initial)
        e.prices["USDC"] = USD * percent // 100
        oscillate.snapshots.append((t - 1, e))
    cases.append(oscillate)
    atoms = simple("currency_atom_boundary", [20, 15], [[1, 2]], budget=35)
    for _, e in atoms.snapshots:
        e.pool = {"ETH": 50 * SCALES["ETH"]}
        e.prices["ETH"] = 700000
    cases.append(atoms)
    return cases


FIXTURE_SCENARIOS = ("flat", "flat_support", "gradual_down", "gradual_up", "shock_down_50",
                     "shock_up_50", "correlated_fall", "divergent", "stablecoin_depeg",
                     "withdrawal", "pledge_correction", "pledge_fulfilment", "pledge_double_count")


def fixture(seed, name):
    world = World(seed)
    # Keep the reference's taste model, but give every NFT identical tier cardinalities.
    world.tier_sizes = [(4, 7, 9)] * world.n
    ballots = {}
    for i in range(world.n):
        raw = world.ballot(i)
        levels = sorted(set(raw) - {0})
        ballots[i + 1] = [levels.index(r) + 1 if r else 0 for r in raw]
    initial = base_economy(world.m)
    if name in ("correlated_fall", "divergent"):
        initial.pool = {"ETH": 200 * SCALES["ETH"], "ALT": 5000 * SCALES["ALT"]}
    if name == "stablecoin_depeg":
        initial.pool = {"ETH": 200 * SCALES["ETH"], "USDC": 500000 * SCALES["USDC"]}
    if name != "flat":
        curr = "ALT" if name == "divergent" else "USDC" if name == "stablecoin_depeg" else "ETH"
        for c, ask in enumerate(world.costs):
            initial.donations[c] = {curr: quantity(ask // 10, curr, initial.prices)}
            denom = "USD" if name in ("flat_support", "pledge_correction") else curr
            initial.pledges[c] = [{"id": f"pledge-{c}", "denomination": denom,
                                   "amount": ask // 10 if denom == "USD" else quantity(ask // 10, curr, initial.prices)}]
    snapshots = [(-1, initial)]
    later = copy.deepcopy(initial)
    if name.startswith("gradual"):
        for k in range(1, 6):
            e = copy.deepcopy(initial)
            e.prices["ETH"] = (2500 + (-200 if name == "gradual_down" else 200) * k) * USD
            snapshots.append(((k + 1) * DAY + 1, e))
    else:
        if name in ("shock_down_50", "shock_up_50", "correlated_fall", "divergent"):
            later.prices["ETH"] = (3750 if name == "shock_up_50" else 1250) * USD
        if name == "correlated_fall":
            later.prices["ALT"] = 50 * USD
        if name == "divergent":
            later.prices["ALT"] = 200 * USD
        if name == "stablecoin_depeg":
            later.prices["USDC"] = 600000
        if name == "withdrawal":
            later.donations = [{} for _ in world.costs]
        if name == "pledge_correction":
            later.pledges = [[] for _ in world.costs]
        if name in ("pledge_fulfilment", "pledge_double_count"):
            for c, p in enumerate(later.pledges):
                denom, q = p[0]["denomination"], p[0]["amount"]
                later.donations[c][denom] += q
                if name == "pledge_fulfilment":
                    later.pledges[c] = []
        snapshots.append((2 * DAY + 1, later))
    return Scenario(name, world.costs, ballots, snapshots)


def aggregate(runs):
    out = {"runs": len(runs)}
    flags = ("scalar_deficit_usd", "nft_overdraw_usd", "undercoverage_usd", "overcoverage_usd",
             "fresh_set_diff", "fresh_order_diff", "fresh_nominal_payments_diff", "forced_tiers",
             "winner_finality_broken", "payment_finality_broken", "quantity_overdraw",
             "negative_capacity_checkpoints")
    for key in flags:
        out[key + "_runs"] = sum(bool(r[key]) for r in runs)
    for key in ("scalar_deficit_usd", "nft_overdraw_usd", "undercoverage_usd", "overcoverage_usd",
                "fresh_set_diff", "forced_tiers", "end_time"):
        out[key + "_max"] = max((r[key] for r in runs), default=0)
    return out


def small_sweep(count, exhaustive=False):
    rng = random.Random(20261015)
    inputs = []
    if exhaustive:
        # All two-NFT strict 3-project permutations, three cost choices, four B2 values.
        perms = list(itertools.permutations((1, 2, 3)))
        inputs.extend((100, b, list(costs), [list(p), list(q)], 0, 0)
                      for p, q, costs, b in itertools.product(
                          perms, perms, itertools.product((20, 40, 60), repeat=3), (40, 70, 100, 140)))
    inputs.extend((100, rng.randint(20, 180), [rng.randint(10, 100) for _ in range(3)],
                   [rng.sample((1, 2, 3), 3) for _ in range(rng.randint(1, 5))],
                   rng.randint(0, 40), rng.randint(0, 40)) for _ in range(count))
    buckets, witnesses = {p: [] for p in POLICIES}, {}
    ipsc_counts = {p: 0 for p in POLICIES}
    fresh_ipsc, positive_cost_cases = 0, 0
    for index, (budget, new_budget, asks, ballots, support, new_support) in enumerate(inputs):
        sc = simple(f"small-{index}", asks, ballots, budget=budget,
                    support=support, after_support=new_support)
        # Change price, not pool quantity: currency reserves require conserved atoms.
        # USDC project support remains separately valued at $1.
        for _, e in sc.snapshots:
            e.pool = {"ETH": 100 * SCALES["ETH"]}
        sc.snapshots[0][1].prices["ETH"] = USD
        sc.snapshots[1][1].prices["ETH"] = new_budget * USD // 100
        final_budget, final_costs = sc.at(7 * DAY).inputs(sc.asks)
        voters = [(final_budget // len(sc.ballots), ranks_of(b)) for _, b in sorted(sc.ballots.items())]
        positive_cost_cases += all(final_costs)
        for p in POLICIES:
            result = run(sc, p)
            buckets[p].append(result["metrics"])
            if p == "fixed_currency":
                assert not any(result["metrics"][k] for k in
                               ("scalar_deficit_usd", "nft_overdraw_usd", "quantity_overdraw"))
            # Fully ranked, positive-cost, fixed FINAL-input IPSC check. Zero needs
            # are removed from this checker because the published theorem uses R+.
            if all(final_costs):
                feasible = sum(final_costs[c] for c in result["funded"]) <= final_budget
                ipsc_counts[p] += not (feasible and is_ipsc(final_costs, final_budget, voters, result["funded"]))
                if p == "recompute":
                    fresh_ipsc += not (feasible and is_ipsc(final_costs, final_budget, voters, result["fresh_funded"]))
            if result["metrics"]["fresh_set_diff"] and p not in witnesses:
                witnesses[p] = {"input": asdict(sc), "result": result}
    return {"seed": 20261015, "random_cases": count,
            "exhaustive_cases": len(inputs) - count, "policies": {p: aggregate(v) for p, v in buckets.items()},
            "final_input_infeasible_or_ipsc_violations": ipsc_counts,
            "positive_final_cost_cases_checked_for_ipsc": positive_cost_cases,
            "fresh_positive_cost_ipsc_violations": fresh_ipsc,
            "first_set_disagreement": witnesses}


def differential_checks():
    rng = random.Random(917)
    for _ in range(1000):
        n = rng.randint(1, 5)
        costs = [rng.randint(1, 60) * USD for _ in range(3)]
        ballots = {i + 1: rng.sample((1, 2, 3), 3) for i in range(n)}
        weights = [100 * USD // n] * n
        a, _ = ear(costs, weights, ballots, 3)
        b = pbear(costs, [(w, ranks_of(ballots[i])) for w, i in zip(weights, sorted(ballots))])
        assert a == b
    return {"seed": 917, "fully_ranked_differential_cases": 1000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "results")
    parser.add_argument("--seeds", type=int, default=30)
    parser.add_argument("--random-cases", type=int, default=1000)
    parser.add_argument("--exhaustive", action="store_true")
    parser.add_argument("--case", choices=[s.name for s in explicit_cases()])
    parser.add_argument("--fixture", choices=FIXTURE_SCENARIOS)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--policy", choices=POLICIES, default="fixed_usd")
    args = parser.parse_args()
    if args.case or args.fixture:
        scenario = fixture(args.seed, args.fixture) if args.fixture else next(s for s in explicit_cases() if s.name == args.case)
        print(json.dumps({"input": asdict(scenario), "result": run(scenario, args.policy)}, indent=2, sort_keys=True))
        return
    args.out.mkdir(parents=True, exist_ok=True)
    exact = {s.name: {p: run(s, p) for p in POLICIES} for s in explicit_cases()}
    (args.out / "explicit_cases.json").write_text(json.dumps(exact, indent=2, sort_keys=True) + "\n")
    buckets = {name: {p: [] for p in POLICIES} for name in FIXTURE_SCENARIOS}
    with (args.out / "fixture_runs.jsonl").open("w") as stream:
        for seed in range(args.seeds):
            for name in FIXTURE_SCENARIOS:
                sc = fixture(seed, name)
                digest = hashlib.sha256(json.dumps(asdict(sc), sort_keys=True).encode()).hexdigest()
                for policy in POLICIES:
                    metrics = run(sc, policy)["metrics"]
                    buckets[name][policy].append(metrics)
                    stream.write(json.dumps({"seed": seed, "scenario": name, "policy": policy,
                                             "input_sha256": digest, "metrics": metrics}, sort_keys=True) + "\n")
            print(f"completed fixture seed {seed}", flush=True)
    summary = {"configuration": {"USD_unit": USD, "currency_scales": SCALES, "seed_range": [0, args.seeds - 1],
                                  "first_tallies_seconds": [DAY, 3 * DAY, 5 * DAY], "initial_window_seconds": DAY,
                                  "max_windows_including_initial": 4, "fixture_tier_sizes": [4, 7, 9],
                                  "fixture_sha256": hashlib.sha256((ROOT / "reference/thedao_initiatives.json").read_bytes()).hexdigest()},
               "differential": differential_checks(),
               "fixture": {name: {p: aggregate(v) for p, v in by_policy.items()} for name, by_policy in buckets.items()},
               "small": small_sweep(args.random_cases, args.exhaustive)}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"fixture_runs": args.seeds * len(FIXTURE_SCENARIOS) * len(POLICIES),
                      "small_cases": summary["small"]["random_cases"] + summary["small"]["exhaustive_cases"],
                      "output": str(args.out)}, sort_keys=True))


if __name__ == "__main__":
    main()
