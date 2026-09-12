# Uniswap v4 LP seats: liquidity providers as sponsored voters

> Superseded on 2026-09-13 by the
> [implemented proportional Arc demo](2026-09-13-uniswap-proportional-arc-demo.md).
> This historical draft's whole-seat, reveal, privacy and manual-price assumptions
> do not describe the implementation. Current prize eligibility is not established
> by this draft.

Status: draft, under discussion (2026-09-04). Uniswap Foundation prize entry for
ETHOnline 2026. Builds on the seat ledger of
`2026-09-04-sealed-seat-ballots-design.md` (A3 there) and must not conflict with its
engine refactor.

## Context

RankedShares gives voting weight to money. Contributors vote their own deposits;
organisations sponsor seats for a group. Today a group is an explicit address list or
the holders of an ERC-721 collection.

This design adds a third kind of group: **liquidity providers of a Uniswap v4 pool**.
A DAO issues a token, seeds DAO/USDC and DAO/EURC pools on Arc, and its treasury
sponsors a RankedShares budget whose seats go to the LPs of those pools. An LP has real
capital at risk in the DAO's markets, so seating them keeps the money-is-weight
principle without inventing a token vote.

The user experience is one click. An LP already holds a v4 position NFT. In the app
they pick a position, press "Claim seats", sign one transaction, and watch their seats
accrue for as long as the liquidity stays. From there they vote privately through the
sealed-ballot path. Nothing to buy, nothing to approve, no second transaction.

Decisions made with the user:

- **LP seats over a zap-in or fee hook.** A "contribute with any token" zap solves a
  problem Arc users do not have (gas is USDC, the pool token is USDC); a fee-skimming
  hook has invisible UX and a contrived testnet demo. LP seats reuse the existing seat
  model and give a real one-click flow.
- **Seat units, not one seat per position and not proportional weight.** One seat per
  position is trivially split-gamed; proportional weight breaks sealed-ballot
  anonymity, which needs every seat in a sponsorship to weigh the same.
- **Any tick range, valued as money at a reference price.** Raw v4 liquidity is only
  comparable to capital within one range and rewards narrow positions. A position is
  valued as what it would hold at a sponsor-set reference price, optionally clipped to
  a band around that price. Unbounded band means capital-fair; a narrow band means
  depth-fair. The sponsor chooses.
- **Time-weighted accrual.** Seats are the time-weighted average value over the
  window divided by the unit. This defeats minting a large position just before the
  deadline to buy votes, and it makes reference-price updates safe: an update only
  affects the time still ahead, never what was already accrued.
- **No Chainlink price feed.** Chainlink Data Feeds are not deployed on Arc (checked
  2026-09-04). The sponsor posts reference prices. CRE posting them is a stretch item.

Points marked *(proposed)* are recommendations not yet confirmed; they are collected
under "Open questions".

## Goals and non-goals

Goals:

1. A sponsor can fund seats for LPs of one specific v4 pool, any tick range.
2. Claiming seats is a single transaction for the LP.
3. Seats track the position: withdrawing, burning or transferring stops accrual.
4. Seats cannot be bought at the last minute or by splitting positions.
5. Works with the sealed-ballot ledger: LP seats vote privately like any other seat.
6. Qualifies for the Uniswap prize: public repo, `FEEDBACK.md`, feedback form, README
   pointing at the exact contracts and lines.

Non-goals:

- Comparing positions across pools, or pricing the DAO token from outside.
- A v4 hook. The integration is the PositionManager subscriber interface plus position
  reads. A hook is not needed and is not built.
- Crediting liquidity held before subscription. The PositionManager keeps no history,
  so accrual starts when the pool is told about the position.
- The Arc frontend itself. Its LP flow is described in Part B; the frontend has its
  own spec.

---

## Part A: Specification

### A1. Uniswap surface used

Uniswap v4 periphery `PositionManager` (one per chain) mints one ERC-721 per position
and exposes, for a token id: the `PoolKey` and packed `PositionInfo` (pool id, tick
range, subscriber flag) through `getPoolAndPositionInfo`, the current liquidity
through `getPositionLiquidity`, and the current subscriber through `subscriber`.

It also implements the **Notifier** pattern: the owner of a position may call
`subscribe(tokenId, subscriber, data)`, after which the PositionManager calls the
subscriber on every change to that position:

| PositionManager event | Callback on subscriber | Reverts propagate? |
|---|---|---|
| `subscribe` by owner | `notifySubscribe(tokenId, data)` | yes (owner's own tx) |
| liquidity increased or decreased | `notifyModifyLiquidity(tokenId, liquidityChange, feesAccrued)` | yes, wrapped: **a revert blocks the LP's action** |
| position burned | `notifyBurn(tokenId, owner, info, liquidity, feesAccrued)` | yes, wrapped |
| `unsubscribe` by owner, or **any transfer** | `notifyUnsubscribe(tokenId)` | no: called with a fixed gas limit, failure swallowed |

A position has at most one subscriber at a time.

RankedShares becomes an `ISubscriber`. The subscribe call **is** the seat claim: the
LP calls `positionManager.subscribe(tokenId, rankedShares, abi.encode(sponsorshipId))`,
the pool verifies and registers the position inside `notifySubscribe`, and the
subscription then guarantees the pool hears about every later change. One transaction,
and accrual cannot outlive the liquidity.

The pool does not import v4-core or v4-periphery as dependencies. It uses a local
minimal interface (`src/uniswap/IPositionManager.sol`) declaring `ownerOf`,
`getPoolAndPositionInfo`, `getPositionLiquidity`, `subscriber`, the `PoolKey` struct
`(address currency0, address currency1, uint24 fee, int24 tickSpacing, address
hooks)`, and the `PositionInfo` unpacking (`tickUpper = int24(uint24(info >> 32))`,
`tickLower = int24(uint24(info >> 8))`). Pool id is `keccak256(abi.encode(key))`,
computed from the returned key rather than read from `PositionInfo`, whose pool id is
truncated to 25 bytes.

Pure math is vendored (MIT) into `src/uniswap/`: `TickMath.getSqrtPriceAtTick`,
`FullMath.mulDiv`, and the amount-for-liquidity functions
(`getAmount0Delta`/`getAmount1Delta` composed as in `LiquidityAmounts`).

### A2. Sponsorship terms and reference prices

A new sponsorship kind, `LP`, alongside explicit-list and NFT sponsorships.

```
struct LPTerms {
    address positionManager;
    bytes32 poolId;
    bool    stableIsCurrency0;   // which side the unit is denominated in
    int24   bandLower;           // clip range; MIN_TICK/MAX_TICK for unbounded
    int24   bandUpper;
    uint256 unit;                // stable units per seat (6 decimals for USDC/EURC)
    uint64  createdAt;           // accrual window start
}
struct PriceEpoch { uint64 since; uint160 sqrtPriceX96; }

mapping(uint256 => LPTerms)      public lpTerms;   // sponsorship id → terms
mapping(uint256 => PriceEpoch[]) internal _prices; // id → reference price history
uint256 constant MAX_PRICE_EPOCHS = 16;
```

```
function sponsorLP(
    uint256 amount, address positionManager, PoolKey calldata key, bool stableIsCurrency0,
    int24 bandLower, int24 bandUpper, uint256 unit, uint160 sqrtPriceX96
) external inPhase(Open) beforeDeadline returns (uint256 id);

function setReferencePrice(uint256 id, uint160 sqrtPriceX96)
    external inPhase(Open) beforeDeadline;   // sponsor only
```

- `sponsorLP`: `_deposit(amount)`; `perSeat = 0` and `seats = 0` until finalisation
  (A5); `nft = positionManager`; `kind = LP`. Requires `unit > 0`, `bandLower <
  bandUpper`, non-zero manager and price. Pushes `_prices[id] = [{now, sqrtPriceX96}]`.
  Emits `SponsoredLP(id, sponsor, amount, positionManager, poolId, stableIsCurrency0,
  bandLower, bandUpper, unit, sqrtPriceX96)`.
- `setReferencePrice`: `msg.sender == sponsor` (`NotSponsor`), fewer than
  `MAX_PRICE_EPOCHS` entries (`TooManyPriceUpdates`), pushes `{now, price}`. Effective
  from now; earlier accrual is untouched. Emits `ReferencePriceSet(id, sqrtPriceX96)`.

The sponsor passes the reference price rather than the contract reading it from the
PoolManager: the sponsor funds these seats and every LP is valued at the same price,
so a self-serving price cannot favour one LP over another, only shift value between
ranges for the time ahead. The deploy script reads the pool's price off-chain.

**Window.** `T = votingDeadline − createdAt`. Using sponsorship creation rather than
`openVoting` *(proposed)*: nobody can subscribe earlier, and since per-seat weight is
`amount / totalSeats` (A5), the choice only affects seat granularity, not weight
distribution.

### A3. Position value

For a record with liquidity `L`, clipped range `[√a, √b]` (sqrt prices at the clipped
ticks, cached at subscription) and a reference price `√P`:

```
(amount0, amount1) = amountsForLiquidity(√P, √a, √b, L)   // standard v4 position maths
value = stableIsCurrency0 ? amount0 + amount1 · 2^192 / √P²
                          : amount0 · √P² / 2^192 + amount1
```

`value` is in the stable's raw units. Properties the design relies on:

- **Additive in `L` and over sub-ranges**, so splitting a position into pieces yields
  the same total, minus rounding. Splitting only ever loses seats.
- **Independent of the live pool price**, so a flash-swap before or after any
  callback changes nothing.
- **Cheap**: three `mulDiv`s per evaluation with cached sqrt bounds.

Clipping happens once, at subscription: `[max(tickLower, bandLower), min(tickUpper,
bandUpper)]`; an empty result is rejected (`OutsideBand`). The band is the sponsor's
fairness knob: unbounded counts all committed capital; a band around the price counts
only capital that is actually quoting near the market. With a band from half to double
the reference price, a full-range position gets credit for roughly 29% of its capital.

### A4. Accrual records and subscriber callbacks

```
struct LPPosition {
    uint256 tokenId;
    address owner;
    uint128 liquidity;     // 0 once vacated
    uint160 sqrtLower;     // clipped bounds, cached
    uint160 sqrtUpper;
    uint64  lastSettled;   // timestamp
    uint32  epoch;         // index into _prices at lastSettled
    uint256 accrued;       // value · seconds
}
mapping(uint256 => LPPosition[]) internal _positions;           // id → records
mapping(address => mapping(uint256 => uint256)) internal _active; // pm → tokenId → packed (id, index + 1)
mapping(address => uint256) public lpRecordsOf;                  // owner → records ever created
```

Records are per subscription, not per token id: a transfer auto-unsubscribes, the old
owner keeps what they accrued, and the new owner starts a fresh record if they
subscribe.

**Settle** `(id, record, until)` with `until = min(now, votingDeadline)`: walk
`_prices[id]` from `record.epoch`; for each epoch add
`value(record, epoch.price) · overlap([epoch.since, nextSince), [lastSettled, until))`
to `accrued`; set `lastSettled = until`, `epoch = last`. Cost is bounded by
`MAX_PRICE_EPOCHS`, which is what keeps the unsubscribe callback inside the
PositionManager's fixed gas limit.

All four callbacks check `msg.sender` is a PositionManager named by some LP
sponsorship, else revert (`NotPositionManager`) for `notifySubscribe` and silently
return for the others.

**`notifySubscribe(tokenId, data)`** — the claim. `data = abi.encode(uint256 id)`.

1. `inPhase(Open)`, `beforeDeadline`, `lpTerms[id].positionManager == msg.sender`
   (`WrongSponsorship`).
2. `(key, info) = pm.getPoolAndPositionInfo(tokenId)`; require the pool id matches
   (`WrongPool`); clip the range to the band (`OutsideBand` if empty).
3. `L = pm.getPositionLiquidity(tokenId)`; require `value(L, range, currentPrice) >=
   unit` (`BelowSeatUnit`) *(proposed spam guard: keeps records that could never earn
   a seat out of the finalisation loop)*.
4. If `_active[pm][tokenId]` still points at a live record (a previous owner's
   unsubscribe callback ran out of gas), settle and vacate it now.
5. `owner = pm.ownerOf(tokenId)`. Push the record with `lastSettled = now`,
   `epoch = last`, `accrued = 0`; set `_active`; `lpRecordsOf[owner]++`.
6. Emit `LPPositionSubscribed(id, index, tokenId, owner, liquidity)`.

**`notifyModifyLiquidity(tokenId, liquidityChange, feesAccrued)`** — resize. Must
not revert. Return if not active, or if `phase() != Open`, or past the deadline.
Settle; `liquidity = pm.getPositionLiquidity(tokenId)` (already updated when the
callback runs); if it is now 0, vacate. Emit `LPPositionUpdated(id, index, liquidity)`.

**`notifyUnsubscribe(tokenId)`** and **`notifyBurn(...)`** — vacate. Same guards;
settle; `liquidity = 0`; clear `_active`. Emit `LPPositionVacated(id, index)`.
Bounded cost as above, so it fits the unsubscribe gas limit with margin.

`supportsInterface` is extended for `ISubscriber` alongside the CRE `IReceiver`.

### A5. Finalisation

Seats exist only after the deadline. In the `Reveal` phase, before an LP sponsorship
can be revealed, its records are finalised in chunks:

```
function finalizeLP(uint256 id, uint256 from, uint256 to) external inPhase(Reveal);
uint256 public lpFinalized[id];   // records finalised so far, in index order
```

For each record in `[from, to)`: settle to `votingDeadline`; `seats = accrued /
(unit · T)`; append `owner` to `holders` `seats` times. When `to == _positions[id]
.length`: `seats = holders.length`, `perSeat = seats == 0 ? 0 : amount / seats`,
`claimed = seats`, `totalSeatWeight += seats · perSeat`. Emit
`LPFinalized(id, from, to)` and, on close, `LPSponsorshipClosed(id, seats, perSeat)`.

Consequences:

- **No seat cap.** The sponsor's whole deposit is distributed in proportion to
  time-weighted capital. The unit only sets granularity: smaller unit means more seats,
  a larger anonymity set, and more reveal gas. If no LP shows up, the money abstains,
  as unvoted money does today; rounding dust does the same.
- Anyone may call `finalizeLP`; the CRE workflow does it as a chore (A6).
- Every seat of a sponsorship has the same `perSeat`, so the sealed-ballot
  indistinguishability argument holds unchanged.

### A6. Interaction with the sealed-ballot design

- **Sealed vote gate.** `voteSealed` currently requires `seatWeight[msg.sender] > 0`.
  LP weight is not known while voting is open, so the gate becomes
  `seatWeight[msg.sender] > 0 || lpRecordsOf[msg.sender] > 0`. A ballot from an LP who
  ends with zero seats yields no entries and is harmless.
- **`seatWeight` per address is not maintained for LP sponsorships**; it is only
  needed as a gate during voting, and `totalSeatWeight` is updated at close.
- **Reveal gating.** The reveal's "skip forward over sponsorships with zero holders"
  and its chunk processing must treat an LP sponsorship with `lpFinalized[id] <
  _positions[id].length` as not ready (`LPNotFinalized`), not as empty. `revealDone()`
  therefore implies every LP sponsorship is finalised.
- **Grace path.** If the tally starts on the grace timeout with an LP sponsorship
  unfinalised, that sponsorship's money abstains, like unrevealed seat weight.
- **CRE workflow.** In `Reveal`, before revealing sponsorship `id` of kind LP with
  unfinalised records, it writes a report of a new kind `5 FINALIZE_LP` with payload
  `abi.encode(id, from, to)`, chunk-sized to the gas budget. The public function stays
  open to anyone, as with the other chores.
- Everything else (entry format, input hash over `holders[i]` and their sealed
  ballots, anonymous ids) is unchanged: after finalisation an LP sponsorship looks
  exactly like an explicit-list one.

Stated in the README: seats are decided by liquidity held up to the deadline; what an
LP does with the position afterwards does not matter, and the capital behind the seats
is the sponsor's deposit, not the LP's liquidity.

### A7. Views for clients

- `lpPositions(id) returns (LPPosition[])` and `lpPositionCount(id)`.
- `lpAccrual(id, index) returns (uint256 accruedSeats, uint256 projectedSeats)`:
  settles in memory to `now` for the first value, and to `votingDeadline` at the
  current rate for the second. This is the live counter the app shows.
- `referencePrices(id) returns (PriceEpoch[])`.

### A8. Errors and events summary

New errors: `NotPositionManager`, `WrongSponsorship`, `WrongPool`, `OutsideBand`,
`BelowSeatUnit`, `NotSponsor`, `TooManyPriceUpdates`, `NotLPSponsorship`,
`LPNotFinalized`, `BadChunk` (reused). New events: `SponsoredLP`, `ReferencePriceSet`,
`LPPositionSubscribed`, `LPPositionUpdated`, `LPPositionVacated`, `LPFinalized`,
`LPSponsorshipClosed`.

Invariants for tests: (1) `accrued` of a record equals the exact integral of its
value over the price history, for any interleaving of settles; (2) splitting a position
into pieces never yields more total seats; (3) after close, `holders.length · perSeat
<= amount` and `totalSeatWeight` matches.

---

## Part B: Frontend flow (for the frontend spec)

1. **Your positions.** The app lists the connected wallet's v4 positions by scanning
   PositionManager `Transfer` logs (the PositionManager is not enumerable; Arc has no
   subgraph), then reads pool, range and liquidity per token. Positions matching an
   open LP sponsorship show "eligible: about N seats if held to the deadline"; others
   say why not (wrong pool, outside band, below one unit, subscribed elsewhere).
2. **Claim seats.** One button, one transaction: `subscribe(tokenId, pool,
   abi.encode(id))`.
3. **Accruing.** A live counter from `lpAccrual`: seats so far and projected seats at
   the deadline, with the plain sentence "seats accrue while the liquidity stays;
   claiming early earns more". Reference-price changes appear as a note.
4. **Vote privately.** Same sealed-ballot screen as any seat holder, available as soon
   as the position is registered.
5. **After the deadline.** Final seats appear once the sponsorship is finalised.
   Unsubscribing during voting is offered as "stop accruing".

---

## Part C: Deployment and demo fixtures

### C1. Arc testnet (chain 5042002)

No official Uniswap deployment exists on Arc testnet, so the script self-deploys v4
from the official repositories, permissionlessly:

- `PoolManager` (v4-core), `PositionDescriptor` and `PositionManager` (v4-periphery)
  with the canonical Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` and an
  unsubscribe gas limit of 300 000. Arc's Osaka baseline satisfies v4's Cancun
  requirement.
- `DAOToken`: a plain mintable ERC-20 demo token (`src/demo/DAOToken.sol`).
- Two pools, DAO/USDC and DAO/EURC (USDC `0x3600…0000`, EURC
  `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`), fee 3000, tick spacing 60, no hook,
  each initialised and seeded by the deployer. Faucet USDC and EURC cover the stable
  sides.
- A RankedShares pool with a few projects, then two `sponsorLP` calls from the
  deployer acting as the DAO treasury, one per pool, unbounded band *(proposed demo
  default)*, unit 100 USDC / 100 EURC, reference price read from each pool.
- Demo wallets mint positions of different widths in each pool, subscribe, and the
  video shows the counters accrue and one wallet stop accruing after withdrawing.

### C2. Arc mainnet (chain 5042, opens 2026-09-16)

An official v4 `PoolManager` exists at `0x8366a39cc670b4001a1121b8f6a443a643e40951`
per the UniswapX playbook. The README records that the mainnet deployment uses the
official PositionManager once its address is published, and that nothing in the pool
depends on who deployed the PositionManager. Arc's prize wants deployment-ready on
mainnet by 2026-09-30.

### C3. Files

```
src/RankedShares.sol                 LP sponsorship kind, ISubscriber callbacks, accrual, finalisation
src/uniswap/IPositionManager.sol     minimal interface, PoolKey, PositionInfo unpacking
src/uniswap/ISubscriber.sol          the four callbacks (copied signatures)
src/uniswap/PositionValue.sol        vendored TickMath/FullMath/amount maths + value()
src/demo/DAOToken.sol                demo ERC-20
test/LPSeats.t.sol                   unit tests against a mock PositionManager
test/PositionValue.t.sol             value maths vs. reference numbers
test/mocks/MockPositionManager.sol   drives the four callbacks, fakes positions
test/v4/LPSeatsV4.t.sol              integration under the `v4` foundry profile
script/DeployV4.s.sol                PoolManager, PositionManager, pools, liquidity
script/DeployDemo.s.sol              DAOToken, RankedShares pool, LP sponsorships
FEEDBACK.md                          running log for the Uniswap feedback form
```

The main foundry profile stays free of v4 dependencies. `v4-core` and `v4-periphery`
are installed as libraries used only by `test/v4` and `script/DeployV4.s.sol` under
a `v4` profile (solc 0.8.26, `evm_version = cancun`, via-ir as those repos require).

---

## Part D: Testing

Unit (`test/LPSeats.t.sol`, mock PositionManager, time warped with `vm.warp`):

- `sponsorLP` stores terms, deposits, records the first price epoch, emits.
- Subscribe: right pool registers with clipped bounds; wrong pool, outside band,
  below unit, wrong manager, wrong sponsorship, after deadline, non-LP sponsorship all
  revert with the named error. Stale active record is closed on re-subscribe.
- Accrual: constant liquidity over the full window gives `value / unit` seats;
  half the window gives half; resize mid-window; vacate on unsubscribe, burn and
  transfer stops accrual; callbacks after the deadline are no-ops and do not revert;
  callbacks for unknown managers or tokens are no-ops.
- Price updates: only the sponsor, only while open, capped; an update changes accrual
  only after its timestamp; a record untouched across several epochs settles exactly.
- Finalisation: chunks, out-of-order chunk reverts, close computes `perSeat`,
  zero-seat sponsorship closes with `perSeat = 0`; reveal refuses an unfinalised LP
  sponsorship and skips a finalised empty one.
- Invariant fuzz over random subscribe/resize/vacate/price sequences for A8 (1)–(3).

Value maths (`test/PositionValue.t.sol`): full-range, in-range, above-range and
below-range positions against numbers computed with the Python reference; both
`stableIsCurrency0` orientations; band clipping.

Integration (`test/v4/LPSeatsV4.t.sol`, real v4 deployed in-test): mint a position,
subscribe with sponsorship data, warp, check accrual; decrease liquidity and check the
rate drops; transfer and burn vacate; an LP's decrease transaction succeeds after the
deadline (callback no-op); finalise and reveal end to end with the sealed-ballot
harness.

End-to-end on Arc testnet: the deploy scripts run, two demo wallets claim seats and
cast sealed ballots, one withdraws, the tally completes with the expected seat split.

---

## Part E: Uniswap prize compliance

- Public repository, open-source licence.
- `FEEDBACK.md` kept as a dated log from the first v4 deployment attempt: what was
  built, obstacles (self-deploying v4 on a chain with no official deployment,
  PositionManager constructor inputs, notifier gas and revert semantics, docs gaps),
  doc and support ratings, plans to continue. Submitted through the developer
  feedback form.
- README section "Uniswap integration" linking to the exact lines: `sponsorLP`, the
  four `notify*` callbacks, the value maths, finalisation, the interface file, the
  deploy script, and the v4 integration test. States clearly that testnet uses a
  self-deployed v4 and mainnet the official PoolManager.
- Positioning for judges: "time-weighted, range-fair LP governance for v4 positions":
  a reusable pattern where any contract seats a pool's LPs through the subscriber
  interface, values positions fairly across ranges without an oracle, and cannot be
  gamed by splitting or last-minute liquidity. Not a hook, deliberately.

---

## Open questions

1. **Window start** *(proposed: sponsorship creation)* versus `openVoting`. Only
   affects seat granularity.
2. **Spam guard at subscribe** *(proposed: value at the current reference price must
   be at least one unit)*. Alternative: accept anything and let zero-seat records cost
   finalisation gas.
3. **Demo band** *(proposed: unbounded on both pools)*. A band on one pool would show
   the depth-fair knob in the video at the cost of explaining it.
4. **Who posts reference prices.** Sponsor now; the CRE forwarder posting the pool's
   observed price on a schedule is a stretch that gives the Chainlink judges a second
   CRE use.
5. **Where the sealed-ballot ledger refactor lands first.** This spec assumes the A3
   ledger (`holders[]`, `totalSeatWeight`, the reveal) exists. If the LP work starts
   before that lands, it branches from the ledger commit, not from `master`.
6. **Zap-in as an extra** (EURC to USDC contribution through the self-deployed
   PoolManager plus Permit2 single-signature). Cheap once v4 is deployed anyway; only
   if time remains after LP seats and the sealed ballots.

## Future work

- CRE-posted reference prices; CRE-sourced EURC/USD rate to express both
  sponsorships' units in USD.
- A `contributeFor` entry point and a fee-to-budget hook, if the trader story is ever
  wanted.
