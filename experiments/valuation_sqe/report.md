# Currency prices and project support during Slow Quiet Ending

15 October 2026. Investigation for the Blossom Budgeting contract implementation agent,
adapted to `/home/sem/Projects/ranked-shares`.

## Decision recorded on 15 October 2026

**Lock USD awards and NFT charges when each tier settles.** The priority is that
announced final awards remain final, even when prices or project support change
afterwards. This is the report's `fixed_usd` settlement policy, not its alternative
`tier_lock` policy, which freezes economic inputs at the tier's first tally.

- Every provisional tally uses the project's current remaining USD funding need at
  that tally's historical cutoff: `max(askUSD - donationsUSD - outstandingPledgesUSD, 0)`.
  USD-denominated pledges retain their outstanding dollar amount; any other pledge
  denomination must be explicit. Valuing project balances does not exchange their tokens.
- The tally that announces a tier's final winners is its binding settlement tally.
  Its cutoff fixes the accepted USD awards and per-NFT charges. Earlier provisional
  tallies are comparison baselines and commit no money.
- After settlement, price changes, donations, withdrawals and pledge corrections do
  not reprice that tier's awards or create an automatic top-up. A resulting project
  funding gap or excess coverage is outside that settled allocation decision.
  Unsettled tiers continue using current funding needs and the shares left after
  subtracting settled charges.
- Before settlement, material increases in funding need or NFT payment burden should
  prevent a quiet comparison even if payment proportions are unchanged, subject to
  the configured maximum number of windows and forced-close rule. This additional
  comparison criterion still needs precise thresholds and implementation; the study
  demonstrates the limitation of comparing payment proportions alone.

The pool's budget should be fixed and actually secured in the award currency by the
first S tally, using actual net conversion proceeds or an enforceable funding
guarantee. Registration closes at the end of the first window, fixing the NFT count
and equal initial shares of that budget. An oracle's USD valuation alone does not
secure dollar funding. No asset conversion, hedge or guarantee was executed by this
study, and later funding must not dilute or reuse the shares already committed.

**Accepted tradeoff:** the final allocation can differ from a fresh PB-EAR tally using
all end-of-round economic inputs. Do not claim unconditional agreement with that
tally or carry its proportionality guarantee over to this sequence of changing
inputs. The alternatives and counterexamples below remain evidence for this tradeoff.
No contract or shared reference behavior is changed by recording this decision.

## Findings and alternative priorities

Live dollar valuations are incompatible with unconditional permanent dollar awards.
Freezing a tier's ballots and payers does not freeze either the pool's purchasing power
or a project's remaining funding need. The same problem occurs with no ballot changes,
no new voters, and an honest oracle. It also occurs when the pool still covers total
awards but a particular NFT's historical charge exceeds its new equal share.

**Alternative if final-input agreement is required:** if the round must use current
inputs at each cutoff and agree with a fresh final-input tally, treat earlier
economic awards as provisional and recompute
the full tally at the final B cutoff. Keep the finite window schedule; economic changes
must not restart it indefinitely. Reconcile any provisional supporter restrictions when
their valuation assumptions change. Say explicitly that S and A have settled ballot
membership or completed a response phase, rather than promising irrevocable economic
awards. A final result still fixes a valuation cutoff; it cannot guarantee perpetual
agreement with prices or project balances after the round ends.

If irrevocable S awards are the priority, reserve actual currency quantities and state
that the award is those quantities, with a dollar estimate at its settlement cutoff.
That preserves quantity accounting when the inventory is available and reserved, but
does not promise that the project will meet its dollar ask. Guaranteed dollar coverage
needs an enforceable external guarantee, conversion/hedging, or another source of
funds. A valuation lock by itself provides none of those.

No Solidity, shared tally code, reference behavior, or pre-existing working edits were
changed. This is an experimental policy comparison, not a contract implementation.

## Repository adaptation and scope

The source prompt's `vote/` paths become this repository's `README.md`,
`docs/quiet-ending-rules.md`, `docs/quiet-ending.md`, and `reference/`. The existing
49-project data and invented-preference generator are reused. The fixture asks total
$4,400,767; they are its existing discounted/capped `cost` values, not current project
quotes. The pool starts with 400 ETH at $2,500, or an explicitly specified mixed basket
of the same $1,000,000 initial value. All prices and support histories are invented
stress scenarios. No current price, donation or project solvency claim is made.

The user's requirements take precedence over the drafts: equal **NFT ID** voting units,
registration closing at first S tally plus the initial window, configurable first S/A/B
tallies, a finite number of halving windows including the initial one, historical
valuation of both pool and support, and deterministic checkpoints without publication
or approval. Unplaced proposals never support a project. The existing core instead
turns unplaced proposals into a final tied tier, so an isolated adapter handles that
difference. No existing reference is edited.

The model reads donations as allowed-currency balances at separate project addresses.
`results/project_registry.json` assigns each fixture project a distinct synthetic
address. Pledges are authorized-admin records with an ID, outstanding amount, and
either a currency denomination or a USD denomination. A currency pledge retains its
token quantity; a USD pledge retains its dollar face amount. Counting either at face
value assumes performance and availability, not custody or collateral. The exact
denomination comparison below holds the pool in USDC so only the pledge is exposed.

The main fixture has 200 registered NFTs, fixed ballots, and identical 4/7/9 S/A/B
cardinalities. Its IDs can be grouped three per wallet without changing a result.
Uniform cardinalities avoid a separate reference issue: PB-EAR expands competition
rank positions, whereas the product names S/A/B tiers. With unequal tier sizes one
voter's A can enter before another voter's whole S has been counted. The existing
`quiet_ending_steps.py` documents this. The study does not silently resolve that design
question; the implementation agent must settle it before extending any guarantee to
arbitrary named-tier ballots.

## Exact counterexamples

Amounts in this section are dollars; the implementation uses integer microdollars.
Each example starts with fixed NFT ballots. S first tallies on day 1 and settles on
day 2 when its first window is quiet. A and B first tally on days 3 and 5.

### Pool price falls after S settles

One NFT ranks X in S and Y in A. X asks $600 and Y asks $300. There is no external
support. The pool is 400 ETH, initially $2.50 per ETH: $1,000. This deliberately small
price makes the arithmetic transparent; multiplying every ask and price by 1,000 gives
the same structure with a $1,000,000 pool.

S settles X for $600, charged to that NFT. One second later ETH falls to $1.25 and
the pool is worth $500. The fixed dollar ledger now has a **$100 scalar deficit** and
the NFT is $100 above its current share. A fresh final-input tally cannot afford X and
funds Y for $300 instead. The fixed-dollar outcome remains X. There is no ballot move
to forbid and no supporter restriction that can repair this.

Reserving 240 ETH for X instead avoids any quantity overdraw. After the fall it is
worth $300, leaving X **$300 short** of its dollar need. A 30% reserve does not repair
the dollar example: X's $600 award already fits within the initial $700 allocation
limit, yet exceeds the later $500 pool.

```bash
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy fixed_usd
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy fixed_currency
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy reserve30
python3 experiments/valuation_sqe/study.py --case pool_fall_after_s --policy recompute
```

The last command removes X and funds Y. It restores the final-input relationship by
breaking S award finality.

### One NFT is overdrawn while the pool remains sufficient

Two NFTs share a $100 pool, $50 each. Project X asks $40, an unaffordable dummy project
asks $1,000, and Y asks $20. NFT 1 puts X in S and Y in A; NFT 2 puts the dummy in S
and Y in A. S settles X, paid entirely by NFT 1. The pool then falls to $60.

The $40 award fits within the $60 pool, but NFT 1 has a **$40 charge against a $30
share**. A scalar reserve check alone misses this $10 individual overdraw. A fresh
final-input tally funds Y instead of X. This experiment refuses new grants when any
residual share is negative; spending other NFTs' residual shares would not cure the
existing individual overdraw.

```bash
python3 experiments/valuation_sqe/study.py --case individual_overdraw_without_scalar_deficit
```

### Donation withdrawals and later donations reopen settled assumptions

With a flat $100 pool and one NFT, X asks $100 and Y asks $40; X is in S and Y in A.
Initially X has a $40 external donation balance, so S settles X for $60. The project
then withdraws its donation. The fixed ledger can still give Y $40, but X's need is
now $100: its settled award is **$40 short**. A fresh tally spends the full $100 on X
and does not fund Y. Pool conservation alone is therefore insufficient.

Conversely, let X ask $80 and Y $50, initially with no donation. S settles X for $80;
then X receives a $40 donation. Keeping the old award creates **$40 excess coverage**
and leaves only $20 for Y. A fresh tally allocates $40 to X and $50 to Y. Even a
monotone support increase, with no price fall, defeats final-input agreement if awards
and historical NFT charges are immutable.

```bash
python3 experiments/valuation_sqe/study.py --case donation_withdrawal_after_s
python3 experiments/valuation_sqe/study.py --case donation_arrives_after_s
python3 experiments/valuation_sqe/study.py --case zero_need_then_reopens
```

The last case starts with X fully externally covered. S allocates nothing to it.
When the support disappears, the continuing PB-EAR pass can fund X at A using its
unchanged S approvals. A zero-need status is an observation, not a permanent guarantee
of external coverage. A stronger permanent exclusion would require another rule and
can make the final outcome disagree further with a fresh tally.

### Pledge denomination changes the exposure

X asks $100, has a pledge initially worth $40, and receives a $60 S award. Its pool
is flat at $100 in USDC. If the pledge is 40 ETH at an illustrative $1/ETH and ETH
falls to $0.50, the pledge becomes $20 and X is **$20 short**. If the pledge is $40
USD, its face value remains $40 and this particular valuation gap does not occur.
A USD pledge can still default or be corrected; denomination does not eliminate that
separate risk.

```bash
python3 experiments/valuation_sqe/study.py --case pledge_denomination_eth
python3 experiments/valuation_sqe/study.py --case pledge_denomination_usd
```

### Equal payment fractions can hide a doubled bill

One NFT pays for X, which asks $100. A $50 donation is present at the first S tally,
so the provisional charge is $50. The donation disappears during that window; the
closing charge becomes $100. The winner is unchanged and the NFT still pays 100% of
its cost. Normalized payment-share distance is **exactly zero** and the tier settles.
The comparison succeeds according to its definition while the absolute burden doubles.

```bash
python3 experiments/valuation_sqe/study.py --case same_payer_double_bill
```

If the intended protection includes economic burden, compare both normalized payment
fractions and charges as a fraction of each NFT's current initial entitlement, and
check affordability separately. Define how much absolute bill/coverage deterioration
can keep a tier open. Those checks cannot override the finite schedule forever, so
forced-close behavior still needs an explicit policy.

### A boundary donation changes the result without changing final support

One NFT, a $100 pool, X asking $100 in S, and Y asking $50 in A. Donate $50 to X at
second 172,799: S settles at $50 and A can fund Y. Donate it at second 172,800 or
172,801: the closing prefix excludes it, S settles at $100, and A cannot fund Y.
All three runs end with the same balances and ballots. Their outcomes differ solely
because the donor timed an observable event across an irreversible cutoff.

```bash
python3 experiments/valuation_sqe/study.py --case boundary_donation_before
python3 experiments/valuation_sqe/study.py --case boundary_donation_exact
python3 experiments/valuation_sqe/study.py --case boundary_donation_after
```

### Price changes alone can exhaust every window

A $75 S project faces pool values $100, $50, $100, $50, $100 at the baseline and
successive cutoffs. Its provisional funded status alternates despite an unchanged
ballot and supporter lock. S force-closes at day 2.875 after four windows. Locks on
ballots do not constrain oracle prices, donations, withdrawals or authorized pledge
corrections. The final shortest window necessarily admits a change with no later
response window.

```bash
python3 experiments/valuation_sqe/study.py --case price_only_exhausts_windows
```

## Policy comparison

| Policy | What remains fixed | Main benefit | Failure or cost |
| --- | --- | --- | --- |
| Fixed settled dollars | Award dollars and historical NFT dollar charges | Simple nominal promises and immutable award ledger | Pool and individual-share deficits after losses; stale support creates undercoverage or excess coverage |
| Fixed currencies | Award token quantities, reserved from each NFT's basket | Per-currency and per-NFT quantity backing under conserved inventory | Dollar coverage changes; requires actual reservation if backing is promised; differs from a final-input USD tally |
| Reserve or haircut | Only 70% of current pool value available for awards in this experiment | Reduces exposure to specified losses | Leaves budget unused, changes the effective election budget, and cannot cover arbitrary falls or support loss |
| Tier valuation lock | One economic snapshot per tier's windows; settled dollars persist | Comparisons within a tier use one price basis | Different tiers still join incompatible dollar ledgers; the market and support can move while the lock is active |
| Whole-round valuation lock | One economic snapshot for all tiers | Coherent accounting instance for a fixed-input tally | Snapshot accounting can diverge from actual assets and live needs; prices must be fixed or exposure separately secured to promise coverage |
| Recompute earlier tiers | Only ballot membership and the schedule remain settled | Uses current equal shares and costs; final B matches a fresh final-input tally | Earlier awards and payers can change; cannot irrevocably pay them beforehand without a reconciliation mechanism |

Tier and whole-round valuation locks change the requested rule that each tally uses
the applicable current historical inputs. They are explicit alternative policies,
not implementations of that rule. The reserve also changes the usable election budget.
The diagnostics still evaluate these alternatives against actual final prices and
funding needs so their accounting locks cannot hide economic gaps.

Matching currency exposures does not neutralize fixed dollar asks. If a project's
external support is in the same falling currency as the pool, the pool loses USD
value while that project's residual USD need increases. The correlated-fall scenario
tests this joint deterioration. Divergent exposures can instead increase the pool's
value while reducing project needs, leaving previously settled awards excessive.

The currency policy reserves each charge across the payer's available currencies in
proportion to their current USD component values. It is a basket reservation, not a
trade into a selected payout token. Atom quantities round up to cover the current
quote, and are bounded by that payer's inventory. Asset-specific limits matter:
positive aggregate USD value cannot by itself deliver a promised currency for which
the round has insufficient atoms. The other policies have no currency reservation,
so their scalar tests do not establish payout feasibility.

Integer atom precision needs a separate rule. One NFT with 50 ETH at $0.70 has a $35
share. Two awards of $20 and $15 sum to $35, but rounding each separately up to ETH
atoms requires one atom too many. The corrected currency policy revalues the basket
after every reservation and refuses the second award when its residual USD value
floors to $14.999999. This preserves backing while changing the discrete funding
outcome even at flat prices. Dust can matter at an all-or-nothing threshold. The
ordinary USD tally can fund both; the study does not claim an identical theorem for
the currency adapter at every atom boundary.

```bash
python3 experiments/valuation_sqe/study.py --case currency_atom_boundary --policy fixed_currency
```

A 30% same-currency buffer is conditional protection. If every NFT's irrevocable
charge is at most 70% of its original share, the inventory is conserved, the roster
is fixed, and the final value of that equal inventory slice stays at least 70% of
its original value, those old charges fit. A deeper fall, a new obligation, a lost
asset, or increased project need escapes that argument. Reserving volatile assets
does not create a dollar floor, and calling a token a stablecoin does not give one.

## Theoretical conclusions

**Fixed-input PB-EAR.** Proposition 7 of Aziz and Lee establishes Inclusion PSC for
the paper's fixed budget, fixed positive project costs, fixed voter weights and weak
ordinal preference profile. Its input interprets omitted projects as a final tied
class. The proof allows different ways of deducting the required cost from approving
voters; cumulative integer deductions preserve exact charges and nonnegative weights.
The source is [Aziz and Lee, AAAI 2021](https://ojs.aaai.org/index.php/AAAI/article/view/16646).
The local copy is `docs/papers/aziz2021.pdf`; uniform fractional reweighting is discussed
in `docs/papers/aziz2019.pdf`.

For a complete fixed profile and positive costs, the ordinary engine's budget
conservation, per-voter affordability and full project-cost deductions remain the
relevant guarantees. With equal NFT weights, coalition entitlements are proportional
to NFT count. Integer division dust is excluded from supporting weight; exact equality
of every share is maintained by leaving it unused. Claims apply to the accounted
budget and profile, not to later market prices.

**Truncation changes the claim independently of prices.** Under the user's requirement,
unplaced proposals receive no support ever. One NFT with a $100 budget leaving a $10
project unplaced funds nothing. This is not exhaustive in the paper's sense; ordinary
IPSC implies exhaustiveness. Therefore the full paper guarantee cannot simply be
advertised for this truncated rule, even at flat prices. A restricted acceptability or
coalition guarantee needs its own definition and proof. The existing `is_ipsc` checker
also treats omitted projects as last-ranked, so it is used here only for complete
rankings with positive final costs, together with a feasibility check.

The existing `reference/withhold.py` supplies a useful fixed-input interpretation:
withheld candidates fall below a padded Return option. Its tests check IPSC on that
**enlarged** instance. Mapping every unplaced entry to withholding reproduces the
study's truncated final tally in 1,000 checked cases. This preserves a connection to
PB-EAR without claiming ordinary IPSC over just the original project set. It also
does not repair the separate incompatibility caused by changing economic inputs.

**Time-varying inputs form different elections.** A sequence of valid PB-EAR steps for
different budgets, costs or shares need not be a valid transcript for any one final
instance. A fixed snapshot can recover an accounting instance, but does not recover
its current asset value. Fixed ballots alone are not a sufficient invariant. Agreement
of winner sets is also weaker than agreement of their costs, payer vectors and actual
coverage: two policies can choose X while promising it different amounts.

**Impossibility under arbitrary adverse changes.** Consider a positive irrevocable
dollar award A, backed only by q units of an asset with no guaranteed positive price
floor. Choose a later price below A/q. Either the award exceeds its backing, its
dollar amount is reduced, or outside resources must cover it. Fixed quantities avoid
the quantity deficit but not the dollar shortfall. Separately, the donation-arrival
example proves that immutable earlier awards need not equal a fresh final-input
tally even when the pool is stable and support only increases. Thus arbitrary live
inputs, immutable dollar awards and NFT charges, current affordability and coverage,
fresh-final-input agreement, and no external subsidy cannot all be promised together.
These are counterexample arguments; they do not depend on simulation frequencies.

**Termination is a schedule property.** With initial integer duration W and K windows
including the initial window, the maximum elapsed time per tier is
`sum(W >> k for k in range(K)) < 2W`, provided every configured window is positive.
The experiment uses 24/12/6/3 hours, first tallies on days 1/3/5, and at most five
tallies including the baseline per tier. Every logical run ends by day 6.875
(second 594,000). Repeated economic changes do not alter that bound. Restarting the
schedule whenever prices or support change would lose it. Completing a real replay
also requires available history and data; the logical bound is not a promise of
unbounded oracle, blob retrieval or computation service availability.

## Strategic timing and supporter restrictions

The boundary donation and alternating-price witnesses establish a timing surface;
they do not assume that a voter can control an entire market. An actor able to move
allowed-currency balances or authorized pledge records can place a cheap or temporary
support state before a cutoff, then withdraw or correct it after settlement. A trader
may also act on observable price changes before the next deterministic cutoff.
An oracle update whose publication straddles a cutoff can change which observation is
eligible even if the economic price was already known elsewhere.

Supporter locks only reject ballot moves. They cannot retain a donation, enforce an
uncollateralized pledge, prevent a depeg, or preserve an NFT's dollar entitlement.
They can bind a voter to a proposal whose economic terms have worsened after the
commitment. A payer may also move from positive to zero payment because other support
arrives; obligations must be rebuilt from the specified current provisional result,
not accumulated forever. Zero-payment rows should not create a binding obligation.
The experiment binds only actual positive payers and rejects disallowed revisions
whole. Current reference behavior that includes zero-deduction entries needs care
when translated into the new NFT-based acceptance rules.

To protect economic consent, include a valuation epoch and maximum burden or defined
material-change release condition in the restriction policy. Releasing or replacing
locks after changed inputs opens a new response opportunity; it is not a free
improvement that preserves every original finality and timing promise. Smoothing
prices, a fixed lag or time-weighted support can reduce a particular boundary effect
but introduces a new valuation convention. It cannot guarantee strategyproofness.
No strategyproofness claim is made by this study.

## Preventing double counting

Use an identified support ledger alongside historical balances. A balance alone does
not say whether funds are external support, fulfillment of a counted pledge, or this
round's own payout. These distinctions must be fixed before applying
`max(askUSD - donationsUSD - pledgesUSD, 0)`.

1. **Pledge fulfillment.** Record a unique pledge ID, its denomination, original and
   outstanding amount, and linked fulfillment receipts. Count only the outstanding
   remainder alongside received donations. For ask $100, receipt $40 and an original
   pledge $40, the correct need is $60; retaining the pledge as well gives a false
   $20. Partial fulfillment, cancellation and corrections require equally explicit
   transitions. For a USD pledge paid in tokens, fix the fulfillment conversion
   price/cutoff; a later price change must not silently resurrect fulfilled principal.
2. **Round payouts.** Exclude this round's delivery from external donations. In a
   cumulative-entitlement ledger, an award of $100 with $20 delivered still has a
   total grant target of $100 and an undelivered obligation of $80. Treating the
   project's $20 payout balance as new external support reduces the target to $80
   and subtracts the same money twice. Track committed, delivered, refunded and
   outstanding quantities separately. Do not compare cumulative awards against only
   the post-payment pool balance; compare undelivered obligations to remaining assets,
   or include historical deliveries on both sides at a specified valuation basis.
3. **Spent or withdrawn funds.** Under the required live-balance model, both can reduce
   donations and increase need. A balance cannot reveal whether an expense legitimately
   fulfilled the project's budget or was an abusive withdrawal. If verified expenses
   should continue to count, add an explicit expenditure-credit policy and evidence;
   that changes the raw-balance funding-need model. If support must stay available,
   use an escrow or restricted support account. Specify withdrawal and refund rules.
4. **Fungible and circular flows.** Designate eligible support accounts and receipt
   provenance, reserve/escrow semantics, round IDs and transfer identities. Prevent
   pool-to-project transfers and internal moves from minting support credit. Tracking
   a source address alone does not identify every indirect loop or distinguish
   mixed-fund spending. Dedicated accounts or a deterministic attribution convention
   are necessary if balances and provenance are both part of the definition.

`support_ledger.py` reproduces the three numerical ledger examples. The fixture also
compares correct pledge fulfillment with intentionally retained pledges; that last
scenario is an invalid support ledger by design, not another proposed policy.

## Contract and data requirements

| Area | Required specification or committed data |
| --- | --- |
| Round identity and timing | Chain and round ID, opening timestamp, first S/A/B tallies, initial duration, maximum windows per tier including initial, integer halving convention, positive-window validation and nonoverlapping schedules. State exactly which time defines the final valuation cutoff. |
| NFT eligibility and authorization | Collection/domain, eligible ID universe or snapshot, owner/approval checks at the specified block, transfer semantics, nonce domain, registration by accepted NFT ballot before first S tally plus initial duration, and explicit empty-roll behavior. One address must be able to authorize independent ballots for multiple eligible NFTs. |
| Accepted ballot history | Canonical receipt order, signed bytes, whole-ballot rejection reasons, previous accepted revision, frozen registered NFT roster, tier memberships and deterministic restriction state. Receipt acceptance and ballot acceptance are distinct. |
| Projects | Stable ID and address mapping, ask in a fixed USD integer unit, ask revision/freeze policy, allowed recipients and support accounts. Real addresses replace the study's synthetic registry. |
| Assets and balances | Allowed chain/token identifiers, decimals, native-asset handling, pool inventory source, project balances at canonical cutoff blocks, accounting exclusions, and unsupported rebasing/fee-on-transfer behavior. Quantities and USD values must be separate fields. |
| Historical oracles | Feed identity for each currency including stablecoins, publication and observation timestamps, eligible round selection, decimals, staleness/invalid-price rules and deterministic fallback. Use information published in the eligible history; do not backfill a cutoff using a later observation or correction without an explicit recomputation policy. |
| Pledges | Authorized admins, unique IDs and revisions, currency or USD denomination, outstanding amount, fulfillment linkage and conversion rule, cancellation/correction timestamps, and whether performance is collateralized. Corrections are new history, not silent edits of old checkpoints. |
| Allocation ledger | Valuation epoch, nominal USD target or exact currency vector, per-NFT charge in the same unit, delivery/refund state, and whether an award is provisional, immutable or revocable. Select cumulative-entitlement versus residual-cash accounting explicitly. |
| Comparison and restrictions | Exact normalized payment-distance formula, cost basis and tolerance denominator, an optional burden/coverage test, positive-payer definition, economic-change release/rebinding rule and treatment of zero funding need. |
| Replay and proof boundary | A checkpoint is a pure function of committed configuration, complete eligible receipts, eligibility state, oracle history, balances, pledges and earlier deterministic transitions. Any submitted proof or cached result verifies that function; its publisher has no authority to select or approve the snapshot. Specify canonical block selection, reorg/finality handling and unavailable-data behavior. |
| Arithmetic | Checked multiplication/division, conservative rounding for prices and reserves, dust ownership, NFT ordering, overflow bounds and reproducible cross-multiplication of rational payment shares. Different currency decimals must never be mixed as if they were equal units. |
| Funding claims | Identify whether this round only records allocations, custodies inventory, reserves it, or actually pays. State which actor bears market losses, pledge default and project withdrawal risk. An allocation proof is not a proof of custody or settlement. |

If the round only records allocations, a positive scalar deficit means the announced
allocations exceed the modeled pool value. It does **not** establish actual insolvency:
the experiment does not observe liabilities, custody, payment rights, liquid markets,
hedges or external treasury resources. Conversely, zero scalar deficit does not prove
solvency, per-currency deliverability, individual affordability or project coverage.

## Decisions for the user before implementation

- Choose the priority: irrevocable economic S/A awards, or agreement with a fresh tally
  of final economic inputs. The recommendation under the live-input requirement is the
  latter. The contract must not claim both unconditionally.
- Choose the award unit and who bears currency risk. A fixed dollar target, fixed ETH
  amount and fixed multi-currency basket are different promises. If a dollar floor is
  desired, specify its guarantor or executed hedge, not only an accounting haircut.
- Confirm which pledges count, their denominations, enforceability and fulfillment
  conversions. Decide whether uncollateralized face value is acceptable support.
- Decide whether donations mean live eligible balances, escrowed funds or cumulative
  verified contributions/expenditures, and how withdrawals and excess support behave.
- Define when economic changes release/rebind supporters, what comparison protects
  burden, and what happens when the last allowed window still changes materially.
- Resolve named S/A/B expansion versus PB-EAR competition ranks, the revised fairness
  claim for unplaced proposals, NFT transfer/eligibility semantics, and zero-need
  project status. These choices are not inferred from older drafts.
- Specify oracle cutoffs, stale/missing-data behavior, finality lag and whether the
  announced timestamps guarantee only logical receipt cutoffs or also completed proofs.

## Reproduction and evidence

The complete protocol, units, scenarios, metrics and commands are in [README.md](README.md).
The main command is:

```bash
python3 experiments/valuation_sqe/study.py --seeds 30 --random-cases 1000 --exhaustive
```

The source uses the standard library. Python version, repository commit and SHA-256
hashes of the actual working sources are in `results/provenance.json`; source hashes
matter because the pre-existing rule documents had uncommitted changes. The fixture
uses seeds 0–29; the random small cases use seed 20261015 and the fully ranked
differential check uses seed 917. Tally amounts use integer microdollars, native asset
atoms and exact rational comparison. The original preference generator alone uses
floating-point draws; input hashes preserve which generated ballots were actually
studied. All results are conditional on the explicit scenarios and model assumptions.

The empirical tables that follow are generated from saved runs. Passing simulations
are not a proof of any universal property; the theoretical claims above stand on
their stated fixed-input assumptions or explicit counterexamples.

## Simulation results

The fixture produced 2,340 policy runs: 30 seeds × 13 scenarios × 6 policies. Each policy has 390 runs. These equally weighted stress scenarios are not estimates of real-world failure probabilities. One scenario, `pledge_double_count`, intentionally supplies an invalid support ledger; it is included as a diagnostic and identified separately below. Dollar amounts in tables round to cents; JSON retains microdollars.

| Policy | Pool deficit | NFT overdraw | Award undercoverage | Different final winner set | Earlier winners reversed |
| --- | --- | --- | --- | --- | --- |
| Fixed dollars | 67 | 120 | 180 | 298 | 0 |
| Fixed currency quantities | 0 | 0 | 180 | 300 | 0 |
| 30% reserve | 16 | 86 | 180 | 388 | 0 |
| Tier valuation lock | 68 | 120 | 180 | 299 | 0 |
| Whole-round valuation lock | 120 | 120 | 180 | 300 | 0 |
| Recompute | 0 | 0 | 0 | 0 | 155 |

The fixed currency policy had zero quantity overdraws. Recompute had zero final-input payment-map disagreements by construction, while it changed earlier payments in 300 runs. Immutable dollar policies preserve earlier award records by construction; that observation does not establish continuing affordability.

### Fixed dollar results by scenario

| Scenario | Pool deficit | NFT overdraw | Award undercoverage | Award overcoverage | Different final winner set |
| --- | --- | --- | --- | --- | --- |
| flat | 0 | 0 | 0 | 0 | 0 |
| flat_support | 0 | 0 | 0 | 0 | 0 |
| gradual_down | 10 | 30 | 30 | 0 | 30 |
| gradual_up | 0 | 0 | 0 | 30 | 29 |
| shock_down_50 | 28 | 30 | 30 | 0 | 30 |
| shock_up_50 | 0 | 0 | 0 | 30 | 29 |
| correlated_fall | 28 | 30 | 30 | 0 | 30 |
| divergent | 0 | 0 | 0 | 30 | 30 |
| stablecoin_depeg | 1 | 30 | 30 | 0 | 30 |
| withdrawal | 0 | 0 | 30 | 0 | 30 |
| pledge_correction | 0 | 0 | 30 | 0 | 30 |
| pledge_fulfilment | 0 | 0 | 0 | 0 | 0 |
| pledge_double_count | 0 | 0 | 0 | 30 | 30 |

Every cell is a count out of 30. Flat economics and correctly retired pledge fulfillment preserve the same net funding inputs and agree with the fresh tally. The reserve policy elects using 70% of the pool, so disagreement with a fresh 100%-budget tally is an intentional budget change, not a core PB-EAR bug. Its guarantee, if any, would concern the discounted election budget. The intentionally retained pledge scenario illustrates an incorrect input ledger even when the tally faithfully follows its supplied inputs.

Across fixed-dollar runs, the largest scalar deficit was $352,213.60, the largest sum of individual overdraws was $356,671.12, and the largest award undercoverage was $106,526.70. The 30% reserve still had 16 scalar-deficit runs and 86 individual-overdraw runs.

### Exact fixture replay for seed zero and a 50 percent ETH fall

| Policy | Pool deficit | NFT overdraw total | Award undercoverage | Winner set difference |
| --- | --- | --- | --- | --- |
| Fixed dollars | $114,700.00 | $181,991.11 | $76,837.50 | 5 |
| Fixed currency quantities | $0.00 | $0.00 | $384,187.50 | 7 |
| 30% reserve | $0.00 | $15,881.54 | $45,712.50 | 1 |
| Tier valuation lock | $114,700.00 | $181,991.11 | $76,837.50 | 5 |
| Whole-round valuation lock | $479,013.60 | $479,013.60 | $122,376.70 | 9 |
| Recompute | $0.00 | $0.00 | $0.00 | 0 |

The final pool is $500,000. Fixed dollars retain $614,700 of awards; recomputation selects $465,412.50 of fully covered current-need awards. Currency quantities remain backed but deliver less USD than some selected projects need. Reproduce each row with:

```bash
python3 experiments/valuation_sqe/study.py --fixture shock_down_50 --seed 0 --policy fixed_usd
```

Replace the policy argument with the identifiers in README.md. The replay includes every ballot, every comparison cutoff, costs, payment maps and reservations.

### Small cases and fixed input checks

The sweep covers 3,888 exhaustive grid cases and 1,000 random cases, each evaluated under six policies. Pool quantities remain fixed; the final budget changes through ETH prices, while project support in these cases is held in separately valued USDC.

| Policy | Pool deficit | NFT overdraw | Award undercoverage | Different final winner set | Final cost infeasible or IPSC fails |
| --- | --- | --- | --- | --- | --- |
| Fixed dollars | 509 | 1030 | 164 | 809 | 632 |
| Fixed currency quantities | 0 | 0 | 2227 | 1457 | 1312 |
| 30% reserve | 136 | 179 | 118 | 3068 | 2850 |
| Tier valuation lock | 509 | 1030 | 164 | 809 | 632 |
| Whole-round valuation lock | 2066 | 2233 | 277 | 2965 | 2841 |
| Recompute | 0 | 0 | 0 | 0 | 0 |

The last column is checked only in the 4,747 cases with positive final costs and complete rankings. It first requires feasibility at final costs, then applies the existing brute-force IPSC checker. It therefore measures the outcome as a candidate for the final input instance, not fairness in its original snapshot. The fresh final-input tally had 0 such failures. The 1,000 fully ranked differential cases also reproduced the existing core's funding order. These are finite checks, not a proof.

The small sweep stores a first exact set-disagreement input for each applicable policy in `summary.json`. It preserves full snapshots and the result trace. Atom rounding may additionally change the currency policy at tight thresholds, as the separate flat-price witness shows.

### Finality termination and validation

Fixture closing cutoffs ranged from second 518,400 to 583,200, within the 594,000-second configured bound. No fixture run exhausted its four windows in a tier; the explicit alternating-price case does force S to its fourth window. A quiet flag or forced close is a statement about that cutoff, not a guarantee that later economics remain quiet. Because policies can close at different times, gradual-path comparisons include that timing effect; every fresh comparison uses the same final cutoff as the policy run it evaluates.

Validation passed: 26 experiment tests, 143 existing Quiet Ending tests and 22 existing PB-EAR tests. The experiment tests include 1,000 currency-transition comparisons against repeated existing-core selections with seed 1801, and 1,000 truncated-tally comparisons against the existing withholding reference with seed 1802. The report-table generator verifies saved fixture counts, aggregates, input hashes, closing bounds, currency backing and recomputation invariants. Authorization signatures, real oracle availability, reorganizations, custody, exchange execution and payout contracts are outside this experiment. The reference and contract sources were left untouched.
