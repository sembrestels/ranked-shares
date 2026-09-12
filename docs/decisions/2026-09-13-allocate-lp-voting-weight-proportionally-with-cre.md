---
status: accepted
date: 2026-09-13
decision-makers: Sem
---

# Allocate LP voting weight proportionally and automate the Arc demo with CRE

## Context and decision

Sem chose proportional time-weighted allocation, asked for automated CRE behavior
if straightforward, and selected the Arc demo. This records those choices and their
implementation; Sem will sign live deployments. The earlier LP draft assumed equal
seats, late reveal and sponsor-posted prices. Those assumptions no longer describe
the current per-wallet sealed-ballot ledger.

Allocate each sponsored budget by each wallet's integrated LP principal value.
Aggregate positions before dividing the budget; retain earned credit after transfer
or withdrawal. Use a dedicated `LPCreRankedShares` subclass and bounded `LPVoting`
subscriber so existing pool variants retain their current behavior. Let registered
LPs cast encrypted ballots early; settle and allocate before closing the commitment.
Weights and ownership remain public. This offers encrypted rankings, not equal-seat
anonymity.

Use CRE for finalized pool-price samples, chunked allocation, Arkiv ballot closing
and attested tallying. Samples affect future accrual only. Authentication identifies
the forwarder and workflow owner/name. A missing price update preserves the previous
rate; the UI signals staleness. A missing accepted ballot blocks closing/tallying.

## Alternatives and consequences

- Whole seats and a later reveal would require additional ballot machinery and an
  extra user action. Proportional weights fit the existing per-wallet ledger and the
  user's chosen allocation rule, while exposing distinctive wallet weights.
- Raw liquidity would overvalue narrow ranges relative to their capital. Principal
  valuation at a common price compares ranges in currency units, but counts value
  outside the current active range and excludes uncollected fees.
- Sponsor-posted prices are simpler but require regular operator transactions.
  CRE automates that work. Sampling the sponsored pool remains susceptible to market
  manipulation; it is suitable for showing the mechanism, not a production oracle.
- Price-history replay in callbacks would grow with round length. Cached rates,
  eager settlement on each update and fixed caps keep unsubscribe work constant.
  The cost is bounded campaign capacity and price-update gas proportional to the
  campaign's registered positions.
- Sharing implementation with the independent Noir contract would enlarge an
  already tight bytecode budget and broaden the proof changes. This demo targets
  the CRE variant; the other variants can adopt the ledger in a separate decision.

## Implementation and validation

See the [implemented specification](../superpowers/specs/2026-09-13-uniswap-proportional-arc-demo.md)
for formulas, lifecycle, limits and trust assumptions, and the
[Arc signing runbook](../superpowers/notes/2026-09-13-arc-lp-demo-runbook.md) for deployment.
The subscriber is tested against pinned official v4 contracts, including transfer,
resize, burn and after-deadline callbacks. Crypto vectors, budget conservation,
price authorization/replay, bounded unsubscribe gas and early Arkiv votes pass.
Live Arc deployment and DON activation are not claimed by the local test results.
