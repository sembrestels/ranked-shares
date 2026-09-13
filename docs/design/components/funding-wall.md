# Proposal funding wall

Purpose: compare what each accepted proposal asks for with its projected or final
allocation on the round overview. Inspired by the cost-scaled wall in the final
section of the supplied participatory-budgeting explainer.

## Anatomy and behaviour

- Heading, view status, total requested, and total projected/final allocation.
- A treemap, ordered by cost with project ID as the tie-breaker. Tile area is
  proportional to the requested amount; changing support never moves a tile.
- Solid fill represents a projected or final allocation. Striped fill represents
  first-choice public support on proposals without an allocation. Coverage is capped
  visually, while amounts remain exact. Public support may overlap across tied
  proposals and is never summed or presented as a payout.
- A matching numbered list gives every proposal's full title, asking amount,
  receiving amount, public support where available, and payment/outcome status.
  Titles link to that proposal in the current round.
- Missing API titles load directly from Swarm in the browser, one query per public
  content revision. Names appear progressively and are cached across snapshot polls.
  Failed reads offer a retry without hiding budgets; unpublished private titles stay
  private. The same resolved titles are used by the outcome and public results.

## Variants and states

1. Public view: first-choice commitments, with projected allocations when the
   browser's Arkiv tally is available. Chain commitments alone do not determine an
   allocation. Sealed weight is not assigned to individual proposals.
2. Pending/unavailable: requests remain visible; unknown support/allocation displays
   as pending or unavailable, never a fabricated zero. Errors have a notice in the
   round container. Older public projections identify their block.
3. Completed: allocation is exactly the proposal's cost if funded, otherwise zero.
   Claimed proposals are labelled Paid; other funded proposals Awaiting payment.
   Attested outcomes retain the Provisional label.
4. Abandoned: zero allocation for every proposal, regardless of old commitments.
5. Empty: explain that accepted proposals appear here; no empty chart. A zero-cost
   proposal appears in the list but occupies no chart area.

## Accessibility and responsive behaviour

The chart is a visual supplement to the complete definition lists beneath it, so
screen readers read the exact values once. State uses text and fill patterns as well
as colour. Project links use existing keyboard focus styles. Full names and exact
token amounts remain available in the list, even for tiny chart cells. The desktop
list aligns asking and receiving columns; mobile rows stack with their labels.
Chart labels adapt to their own tile size. Reduced motion uses the existing duration
tokens. All monetary arithmetic uses bigint; conversion to numbers is limited to
bounded geometry and coverage ratios.

## Composition and tokens

Money and Badge atoms compose funding tiles and amount rows; FundingWall composes
those molecules. Data selection and geometry live in `lib/funding.ts`; fetching
remains in the round route and its existing hooks. No new runtime dependencies.
Uses existing semantic surface, primary, secondary, success, edge, signal, spacing,
type, and motion tokens. Component tokens define chart height and fill colours.
