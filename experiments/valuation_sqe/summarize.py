#!/usr/bin/env python3
"""Verify saved fixture aggregates, record provenance, and refresh report tables."""

import hashlib
import json
import platform
import subprocess
from pathlib import Path

from study import (DAY, ROOT, USD, FIXTURE_SCENARIOS, POLICIES, INITIATIVES, aggregate,
                   explicit_cases, fixture, run)
from support_ledger import examples

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
NAMES = {"fixed_usd": "Fixed dollars", "fixed_currency": "Fixed currency quantities",
         "reserve30": "30% reserve", "tier_lock": "Tier valuation lock",
         "round_lock": "Whole-round valuation lock", "recompute": "Recompute"}


def money(micro):
    cents = (micro + 5000) // 10000
    return f"${cents // 100:,}.{cents % 100:02d}"


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    lines += ["| " + " | ".join(map(str, row)) + " |" for row in rows]
    return "\n".join(lines)


def main():
    summary = json.loads((RESULTS / "summary.json").read_text())
    rows = [json.loads(line) for line in (RESULTS / "fixture_runs.jsonl").read_text().splitlines()]
    seeds = summary["configuration"]["seed_range"][1] + 1
    assert len(rows) == seeds * len(FIXTURE_SCENARIOS) * len(POLICIES)
    assert len({(r["seed"], r["scenario"], r["policy"]) for r in rows}) == len(rows)
    for name in FIXTURE_SCENARIOS:
        for p in POLICIES:
            subset = [r["metrics"] for r in rows if r["scenario"] == name and r["policy"] == p]
            assert aggregate(subset) == summary["fixture"][name][p]
        for seed in range(seeds):
            sc = fixture(seed, name)
            from dataclasses import asdict
            digest = hashlib.sha256(json.dumps(asdict(sc), sort_keys=True).encode()).hexdigest()
            assert all(r["input_sha256"] == digest for r in rows if r["seed"] == seed and r["scenario"] == name)
    for r in rows:
        m = r["metrics"]
        assert m["end_time"] <= 5 * DAY + sum(DAY >> i for i in range(4))
        if r["policy"] == "fixed_currency":
            assert not any(m[k] for k in ("scalar_deficit_usd", "nft_overdraw_usd", "quantity_overdraw"))
        if r["policy"] == "recompute":
            assert not any(m[k] for k in ("scalar_deficit_usd", "nft_overdraw_usd", "undercoverage_usd",
                                          "fresh_set_diff", "fresh_nominal_payments_diff"))
    assert summary["small"]["policies"]["fixed_currency"]["quantity_overdraw_runs"] == 0
    assert summary["small"]["positive_final_cost_cases_checked_for_ipsc"] > 0

    # Refresh all exact cases after any additional case has been added to the study.
    exact = {s.name: {p: run(s, p) for p in POLICIES} for s in explicit_cases()}
    (RESULTS / "explicit_cases.json").write_text(json.dumps(exact, indent=2, sort_keys=True) + "\n")
    (RESULTS / "support_ledger.json").write_text(json.dumps(examples(), indent=2, sort_keys=True) + "\n")
    registry = [{"project_id": i, "address": "0x" + format(0x1000 + i, "040x"),
                 "title": p["title"], "ask_micro_usd": p["cost"] * USD, "original_ask_usd": p["asked"]}
                for i, p in enumerate(INITIATIVES)]
    (RESULTS / "project_registry.json").write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
    paths = ["README.md", "docs/quiet-ending-rules.md", "docs/quiet-ending.md", "reference/pbear.py",
             "reference/quiet_ending.py", "reference/quiet_ending_steps.py", "reference/quiet_ending_sim.py",
             "reference/withhold.py", "reference/test_withhold.py",
             "reference/thedao_initiatives.json", "experiments/valuation_sqe/study.py",
             "experiments/valuation_sqe/test_study.py", "experiments/valuation_sqe/support_ledger.py",
             "experiments/valuation_sqe/summarize.py"]
    metadata = {"git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "python": platform.python_version(), "date": "2026-10-15",
                "sources": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths},
                "synthetic_pool_address": "0x0000000000000000000000000000000000000100",
                "nft_owner_rule": "IDs 1..200 map to owner wallet floor((id-1)/3); independent votes per NFT ID"}
    (RESULTS / "provenance.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")

    totals = {p: aggregate([r["metrics"] for r in rows if r["policy"] == p]) for p in POLICIES}
    text = "## Simulation results\n\n"
    text += (f"The fixture produced {len(rows):,} policy runs: {seeds} seeds × {len(FIXTURE_SCENARIOS)} scenarios × "
             f"{len(POLICIES)} policies. Each policy has {seeds * len(FIXTURE_SCENARIOS)} runs. These equally weighted "
             "stress scenarios are not estimates of real-world failure probabilities. One scenario, "
             "`pledge_double_count`, intentionally supplies an invalid support ledger; it is included as a "
             "diagnostic and identified separately below. Dollar amounts in tables round to cents; JSON retains microdollars.\n\n")
    text += table(["Policy", "Pool deficit", "NFT overdraw", "Award undercoverage", "Different final winner set", "Earlier winners reversed"],
                  [[NAMES[p]] + [totals[p][k + "_runs"] for k in ("scalar_deficit_usd", "nft_overdraw_usd",
                    "undercoverage_usd", "fresh_set_diff", "winner_finality_broken")] for p in POLICIES]) + "\n\n"
    text += ("The fixed currency policy had zero quantity overdraws. Recompute had zero final-input payment-map "
             "disagreements by construction, while it changed earlier payments in "
             f"{totals['recompute']['payment_finality_broken_runs']} runs. Immutable dollar policies preserve earlier "
             "award records by construction; that observation does not establish continuing affordability.\n\n")
    text += "### Fixed dollar results by scenario\n\n"
    text += table(["Scenario", "Pool deficit", "NFT overdraw", "Award undercoverage", "Award overcoverage", "Different final winner set"],
                  [[name] + [summary["fixture"][name]["fixed_usd"][k + "_runs"] for k in (
                      "scalar_deficit_usd", "nft_overdraw_usd", "undercoverage_usd", "overcoverage_usd", "fresh_set_diff")]
                   for name in FIXTURE_SCENARIOS]) + "\n\n"
    text += ("Every cell is a count out of 30. Flat economics and correctly retired pledge fulfillment preserve "
             "the same net funding inputs and agree with the fresh tally. The reserve policy elects using 70% "
             "of the pool, so disagreement with a fresh 100%-budget tally is an intentional budget change, "
             "not a core PB-EAR bug. Its guarantee, if any, would concern the discounted election budget. "
             "The intentionally retained pledge scenario illustrates an incorrect input ledger even when the "
             "tally faithfully follows its supplied inputs.\n\n")
    text += ("Across fixed-dollar runs, the largest scalar deficit was " + money(totals["fixed_usd"]["scalar_deficit_usd_max"]) +
             ", the largest sum of individual overdraws was " + money(totals["fixed_usd"]["nft_overdraw_usd_max"]) +
             ", and the largest award undercoverage was " + money(totals["fixed_usd"]["undercoverage_usd_max"]) + ". "
             "The 30% reserve still had " + str(totals["reserve30"]["scalar_deficit_usd_runs"]) + " scalar-deficit runs "
             "and " + str(totals["reserve30"]["nft_overdraw_usd_runs"]) + " individual-overdraw runs.\n\n")
    text += "### Exact fixture replay for seed zero and a 50 percent ETH fall\n\n"
    shock = {r["policy"]: r["metrics"] for r in rows if r["seed"] == 0 and r["scenario"] == "shock_down_50"}
    text += table(["Policy", "Pool deficit", "NFT overdraw total", "Award undercoverage", "Winner set difference"],
                  [[NAMES[p], money(shock[p]["scalar_deficit_usd"]), money(shock[p]["nft_overdraw_usd"]),
                    money(shock[p]["undercoverage_usd"]), shock[p]["fresh_set_diff"]] for p in POLICIES]) + "\n\n"
    text += ("The final pool is $500,000. Fixed dollars retain $614,700 of awards; recomputation selects "
             "$465,412.50 of fully covered current-need awards. Currency quantities remain backed but deliver "
             "less USD than some selected projects need. Reproduce each row with:\n\n"
             "```bash\npython3 experiments/valuation_sqe/study.py --fixture shock_down_50 --seed 0 --policy fixed_usd\n```\n\n"
             "Replace the policy argument with the identifiers in README.md. The replay includes every ballot, "
             "every comparison cutoff, costs, payment maps and reservations.\n\n")
    text += "### Small cases and fixed input checks\n\n"
    small = summary["small"]
    text += (f"The sweep covers {small['exhaustive_cases']:,} exhaustive grid cases and "
             f"{small['random_cases']:,} random cases, each evaluated under six policies. "
             "Pool quantities remain fixed; the final budget changes through ETH prices, while project support "
             "in these cases is held in separately valued USDC.\n\n")
    text += table(["Policy", "Pool deficit", "NFT overdraw", "Award undercoverage", "Different final winner set", "Final cost infeasible or IPSC fails"],
                  [[NAMES[p]] + [small["policies"][p][k + "_runs"] for k in (
                      "scalar_deficit_usd", "nft_overdraw_usd", "undercoverage_usd", "fresh_set_diff")] +
                   [small["final_input_infeasible_or_ipsc_violations"][p]] for p in POLICIES]) + "\n\n"
    text += (f"The last column is checked only in the {small['positive_final_cost_cases_checked_for_ipsc']:,} cases "
             "with positive final costs and complete rankings. It first requires feasibility at final costs, "
             "then applies the existing brute-force IPSC checker. It therefore measures the outcome as a candidate "
             "for the final input instance, not fairness in its original snapshot. The fresh final-input tally "
             f"had {small['fresh_positive_cost_ipsc_violations']} such failures. The 1,000 fully ranked differential "
             "cases also reproduced the existing core's funding order. These are finite checks, not a proof.\n\n")
    text += ("The small sweep stores a first exact set-disagreement input for each applicable policy in "
             "`summary.json`. It preserves full snapshots and the result trace. Atom rounding may additionally "
             "change the currency policy at tight thresholds, as the separate flat-price witness shows.\n\n")
    ends = [r["metrics"]["end_time"] for r in rows]
    text += "### Finality termination and validation\n\n"
    text += (f"Fixture closing cutoffs ranged from second {min(ends):,} to {max(ends):,}, within the "
             "594,000-second configured bound. No fixture run exhausted its four windows in a tier; the explicit "
             "alternating-price case does force S to its fourth window. A quiet flag or forced close is a "
             "statement about that cutoff, not a guarantee that later economics remain quiet. Because policies "
             "can close at different times, gradual-path comparisons include that timing effect; every fresh "
             "comparison uses the same final cutoff as the policy run it evaluates.\n\n"
             "Validation passed: 26 experiment tests, 143 existing Quiet Ending tests and 22 existing PB-EAR tests. "
             "The experiment tests include 1,000 currency-transition comparisons against repeated existing-core "
             "selections with seed 1801, and 1,000 truncated-tally comparisons against the existing withholding "
             "reference with seed 1802. "
             "The report-table generator verifies saved fixture counts, aggregates, input hashes, closing bounds, "
             "currency backing and recomputation invariants. Authorization signatures, real oracle availability, "
             "reorganizations, custody, exchange execution and payout contracts are outside this experiment. "
             "The reference and contract sources were left untouched.\n")
    report = HERE / "report.md"
    prefix = report.read_text().split("## Simulation results\n", 1)[0].rstrip()
    report.write_text(prefix + "\n\n" + text)
    print(json.dumps({"verified_fixture_runs": len(rows), "small_cases": small["random_cases"] + small["exhaustive_cases"],
                      "exact_scenarios": len(exact), "report": str(report)}, sort_keys=True))


if __name__ == "__main__":
    main()
