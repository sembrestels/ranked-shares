# Slow Quiet Ending valuation experiments

This directory adapts the requested Blossom Budgeting investigation to `ranked-shares`.
The report is [report.md](report.md). All code and results are isolated here; the Solidity
contracts and Python references retain their existing behavior.

## Reproduction

From `/home/sem/Projects/ranked-shares`, using Python 3.10 or later and the standard library:

```bash
python3 -m unittest discover -s experiments/valuation_sqe -p 'test_*.py' -v
python3 experiments/valuation_sqe/study.py --seeds 30 --random-cases 1000 --exhaustive
python3 experiments/valuation_sqe/summarize.py
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy fixed_usd
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy fixed_currency
python3 experiments/valuation_sqe/study.py --fixture stablecoin_depeg --seed 0 --policy fixed_usd
python3 experiments/valuation_sqe/support_ledger.py
python3 -m unittest discover -s reference -p 'test_quiet_ending*.py'
python3 -m unittest discover -s reference -p 'test_pbear.py'
```

`--out /tmp/valuation-sqe-rerun` avoids replacing the checked-in results. Replay a
scenario with `--fixture NAME --seed N --policy POLICY` to obtain full inputs,
ballots, cutoff history, payment maps and currency reservations. Scenario names are
listed by `--help`. `explicit_cases.json` contains the full output for all small
cases and policies. `fixture_runs.jsonl` has one row per seed, scenario and policy,
including a hash of the complete generated input. `summary.json` aggregates those
rows and records the first small counterexample for each policy that differs from
the final-input tally. JSON payment-map keys become strings when serialized.

## Input and timing assumptions

- USD uses six decimal places. ETH and synthetic ALT use 18; USDC uses six.
  Oracle prices are positive integer microdollars per whole currency unit. No floats
  are used in valuation, tallying, policy accounting or payment comparisons.
  `World` uses floating-point Gaussian draws only to invent preferences, as it already
  does in the repository. Full generated-input hashes and Python version are retained.
- One accepted NFT ID is one equal voting unit. IDs, sorted numerically, determine
  cumulative rounding order. Ownership is not a vote key and does not enter shares;
  multiple IDs can have the same owner. Authorization is an assumed valid input here.
- Initial shares are `budget // registered_count`; division dust supports nothing.
  The study assumes a nonempty registered roll; an empty roll raises an explicit
  error rather than inventing an election result. The contract must define that case.
  Currency reservations begin with equal atom quantities per registered NFT and leave
  indivisible currency dust unassigned. These are the explicit rounding conventions.
- Projects have fixed dollar asks. The registry file maps fixture project IDs to
  distinct **synthetic** addresses. Donations model allowed-currency balances at each
  address, without any live chain query. Pledges model authorized administrator records
  with an identity, denomination and outstanding amount. They are valued as if fully
  reliable; this is not a claim that a pledge is cash or collateral.
- A cutoff sees exactly the on-chain history whose timestamp is **strictly less** than
  the cutoff. Snapshots are invented historical oracle, balance and pledge records.
  The latest such complete snapshot supplies prices and balances. They have no
  missing-data, stale-price or reorganization failures. No participant publishes or
  approves checkpoints. Exact-cutoff events enter the next eligible window.
- Opening is second 0; first tallies for S/A/B are seconds 86,400 / 259,200 / 432,000.
  Each tier has at most four windows **including the initial window**, of 86,400,
  43,200, 21,600 and 10,800 seconds. Registration closes at second 172,800. Registered
  NFTs can revise open tiers. Settled tier membership stays fixed. Positive payers
  in the previous provisional tally cannot withdraw or lower that proposal in the
  next window; disallowed revisions are rejected whole. Restrictions take effect
  deterministically at the checkpoint cutoff. This is a synchronous-history model,
  not a model of real-world computation or transaction submission latency.
- A tier compares winner sets and exact rational normalized payment differences.
  The distance is the sum of each common project's current cost times the total
  variation distance between its old and new NFT payment fractions. Tolerance is
  2% of the budget used by that tally. Earlier payments charge nobody. The latest
  whole tier is accepted at a quiet comparison or the last allowed comparison.
- Funding need is `max(askUSD - donationUSD - outstandingPledgeUSD, 0)`. Zero needs
  mean external coverage and are excluded from new grant selection; they do not
  create free PB-EAR awards or supporter obligations. Unplaced entries **never**
  support a proposal. A later loss of external coverage may make need positive again.
- The wrapper reuses `quiet_ending._ear` and `pbear.cumulative_deductions`. For fully
  ranked fixed inputs it is differentially checked against `pbear.pbear`. It maps
  unplaced entries beyond the maximum counted rank instead of changing the core.
  The truncated final tally is also compared against `withhold.pbear_withhold` with
  every unplaced entry withheld. The currency policy uses the core's `_argmax` and
  cumulative deductions, updating supports for actual rounded basket debits.
- The fixture retains its existing `cost` field: asks reduced by 25% and capped at
  $200,000. These are scenario asks, not current or original grant requests. There are
  49 projects, 200 invented NFT IDs and ten interest groups. All NFTs register before
  the first S tally and keep ballots fixed in the valuation runs.
- Every NFT gets exactly 4 S, 7 A and 9 B entries, derived from `World(seed)` tastes.
  This deliberately avoids the existing rank-position cutoff problem: with unequal
  tier sizes, counting one voter's entire S tier can already count another's A tier.
  This study does not resolve that separate PB-EAR versus named-tier design question.
  Random/exhaustive ballots rank three projects strictly, so also avoid that ambiguity.

## Policy definitions

| Policy | Allocation and remaining share calculation |
| --- | --- |
| `fixed_usd` | Settle absolute USD amounts and NFT charges. At later cutoffs, redistribute the current pool equally and subtract those frozen charges. If any residual is negative, record it and stop adding grants in that tally. No clamping, cancellation or synthetic debt financing conceals the deficit. |
| `fixed_currency` | At settlement reserve allowed-currency atoms from each payer's remaining basket, proportionally to its current component USD values. Currency targets use cumulative rounding and atom quantities round up to cover the quoted charge. Revalue residual baskets after every selection, including the tiny cost of atom rounding, before selecting another project. Later cutoffs revalue the remaining baskets. Winners and reserved atoms remain fixed; USD coverage can change. No trade, liquidity or slippage is simulated. |
| `reserve30` | Same USD ledger, but new awards can use only 70% of each cutoff's pool valuation. Actual final affordability is checked against the full pool. This models an uninvested 30% buffer in the same currencies, not a hedge. |
| `tier_lock` | Pool value and project funding needs freeze at each tier's first tally for all its windows. New tiers use new snapshots. Settled USD awards and charges remain fixed. Actual final coverage and backing still use final prices and balances. |
| `round_lock` | Pool value and project funding needs freeze at the first S tally for the whole round. Ballot mechanics continue. This is a diagnostic of coherent fixed-input accounting; physical assets and live needs can diverge from that accounting snapshot. |
| `recompute` | Every checkpoint recomputes the full prefix through its current tier from current equal shares and current needs. It can remove or recharge earlier settled awards. Ballot tier membership restrictions persist, but economic finality is intentionally relaxed. The final B tally equals a fresh tally by construction. |

Fixed policies preserve accepted awards and their charge unit, not a prohibition on
ever funding an unfunded proposal in a later stage. PB-EAR may fund the same proposal
later as more approvals open. When valuations change, an S proposal with zero need
can also acquire positive need and be selected in A. A contract that promises a
stronger permanent rejection must specify that separately and accept a further
departure from a fresh tally.

## Scenario coverage

`flat` has no external support. Other scenarios begin with donations worth 10% of each
ask and outstanding pledges worth 10%, except where the following change specifies
otherwise. The pool begins at $1,000,000.

| Scenario | Historical change after S settles |
| --- | --- |
| `flat_support` | No change; ETH donations and USD pledges. |
| `gradual_down` / `gradual_up` | ETH starts at $2,500 and changes by $200 per day beginning at day 2 plus one second, five updates. A round ending at day 6 sees $1,700 / $3,300. A round continuing past day 6 plus one second can see the final $1,500 / $3,500 update. Each run is evaluated at its own actual closing cutoff. |
| `shock_down_50` / `shock_up_50` | ETH moves to $1,250 / $3,750 at day 2 plus one second. |
| `correlated_fall` | Pool is 200 ETH and 5,000 ALT. ETH and ALT both fall 50%; project support is in ETH. |
| `divergent` | Same pool basket; ETH falls 50%, ALT doubles. Project donations and pledges are in ALT. |
| `stablecoin_depeg` | Pool is 200 ETH and 500,000 USDC. USDC falls from $1 to $0.60; project donations and pledges are in USDC. |
| `withdrawal` | Project donation balances disappear after S; outstanding ETH pledges remain. |
| `pledge_correction` | Authorized USD pledge balances are corrected to zero after S. |
| `pledge_fulfilment` | Outstanding ETH pledges arrive as donations and are retired atomically. Net support stays constant. |
| `pledge_double_count` | Same receipts, but the pledge is mistakenly retained. This intentionally incorrect input tests the impact of counting the same support twice. |

Exact cases use deliberately small dollar amounts, fixed ballots, boundary donations,
price oscillations and pledge denominations. The systematic sweep enumerates all
6 × 6 two-NFT strict rankings, all 3³ cost vectors from {$20,$40,$60}, and final budgets
{$40,$70,$100,$140}, with an initial $100 pool: 3,888 cases. It adds 1,000 random cases
with seed 20261015, 1–5 NFTs, $10–$100 asks, $20–$180 final budgets and $0–$40 initial
and final external support. Pool quantities remain fixed and budget changes come from
ETH prices; USDC support has a separate fixed price. The differential check has seed
917 and 1,000 cases. Experiment tests additionally compare 1,000 currency transitions
with repeated core selections using seed 1801, and 1,000 truncated final tallies with
the existing withholding reference using seed 1802.

## What the metrics mean

`scalar_deficit_usd` is `max(total live-valued allocations - live pool USD, 0)`.
`nft_overdraw_usd` sums each NFT's excess charge above its current equal pool share.
`undercoverage_usd` and `overcoverage_usd` compare only awarded projects' allocations
with their final funding need; an unfunded project is not counted as an underfunded
award. Currency allocations are revalued at final prices. `quantity_overdraw` checks
reserved atoms against the final pool inventory, under the study's constant-pool-
quantity assumption. For other policies, no currency reservations are defined and
this metric is not evidence of actual backing.

`fresh_set_diff` counts the symmetric difference with a fresh final-input tally.
`fresh_nominal_payments_diff` compares settlement-time USD payment maps, so it is
not a comparison of live-valued currency obligations. `winner_finality_broken` and
`payment_finality_broken` track reversals of earlier accepted awards during recomputation;
the fixed policies cannot make those reversals by construction. Final-input IPSC
checks in the small sweep use complete rankings and positive costs, and include a
feasibility check. They do not justify IPSC claims for truncated ballots.

Passing tests and these finite simulations are not proofs. The model assumes complete,
valid history, no oracle failure, no trades, no execution costs and no actual custody
or payments. Asset-loss and guarantee impossibility arguments are given separately
in the report.
