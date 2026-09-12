# Proportional LP voting on Arc

Implemented demo, 2026-09-13. Supersedes the allocation, privacy and price-update
choices in the [original LP seats draft](2026-09-04-uniswap-lp-seats-design.md).
Sem selected proportional time-weighted allocation, automated CRE updates and the
Arc demo, with live transactions left for Sem to sign.

## Allocation

Each sponsorship funds a fixed voting budget for one exact Uniswap v4 pool ID.
An LP registers by subscribing their PositionManager NFT to `LPVoting`, passing
the sponsorship ID. The position remains in their wallet. All tick ranges qualify;
the position must meet the sponsorship's minimum value when it registers.

At the accepted reference price, compute the principal amounts the position would
hold, then convert both amounts to the selected currency of that pool. Uncollected
fees are excluded. Values use the selected currency's raw token units. This avoids
comparing raw liquidity across different tick ranges. It does not reward only
in-range liquidity: out-of-range principal also has value.

For sponsorship budget B and each wallet w:

```
credit[w] = sum over its positions and intervals(value × elapsed seconds)
weight[w] = floor(B × credit[w] / sum of all wallets' credits)
```

Voting weight is measured in the round token's raw units, not whole seats. Wallet
aggregation happens before the final division. Splitting positions does not create
extra entitlement, apart from the conservative rounding inherent in valuation.
For example, equal-value LPs registered for 20 and 10 minutes earn approximately
two thirds and one third of the budget. A very large late deposit can still earn a
large share: time weighting reduces late-entry advantage, not capital's influence.
Floor dust and a campaign with no accrued value retain budget with zero voting
weight (abstention), under the pool's existing unused-funds rules.

`notifyModifyLiquidity` settles the old rate before recording new liquidity.
Zero liquidity earns zero; a later increase resumes automatically while subscribed.
Unsubscribe, transfer and burn stop accrual. Already earned credit stays with the
previous owner. A new owner can subscribe again to earn future credit. Accrual stops
at the voting deadline even when a callback arrives later.

## Prices and automation

The sponsor chooses the valuation currency and minimum, not an arbitrary price.
Creation reads the pool's current slot0 price through `StateView`. The CRE cron
workflow then reads one finalized block and samples each pool every two minutes.
An authenticated kind-4 report settles outstanding credit at the previous rate,
then applies the new rate from the report's delivery time. Nothing is backdated.

The receiver checks the configured forwarder and workflow owner/name, a strictly
increasing source block, a nonfuture observation no older than five minutes, and
at least sixty seconds between delivered updates. The supported Q96 square-root
price interval is `[2^64, 2^128)`; values outside it fail explicitly. If updates stop,
accrual continues at the last accepted price and the page shows a stale-price notice.

This is a finalized pool spot sample, not a TWAP or an independent oracle. Swaps can
influence valuation, especially in the thin demo pools. CRE authenticates the
workflow's observations; it does not make the market price manipulation-resistant.
Production use needs a separately chosen oracle/liquidity policy.

After the deadline, the same workflow sends kind-5 reports to settle all positions
and allocate wallet weights in bounded chunks. Anyone can call `finalizeLP` directly
as a fallback. Only after every campaign is finalized can the pool close its ballot
commitment. Subsequent cron runs close Arkiv ballots and attest the PB-EAR tally.
All reads for one run use the same finalized block. Missing or invalid accepted
Arkiv payloads stop progress and are retried, never silently treated as abstentions.

## Privacy and limits

`LPCreRankedShares` extends the CRE sealed-ballot pool. A registered LP can encrypt
and cast their ballot before final weight exists; finalization adds the weight to
that wallet's existing sponsored-weight ledger. The final commitment includes the
settled weights. There is no later reveal or extra voting transaction.

Rankings are encrypted. Wallet addresses, individual weights and position activity
are public; this demo does not promise anonymity among equal-size seats. The TEE
derives the secp256k1 tallier key from the master secret and the pool's key salt,
checks its public key and input commitment, then reports the result. The existing
Noir and ZisK variants do not implement LP voting in this change.

Bounds are explicit: eight sponsorships per module, one per pool ID, 64 distinct
positions and 128 historical owners per sponsorship. Re-registering a known NFT
reuses its position slot. Limits do not reclaim old records. The CRE tally has a
4096-voter demo guard. Unsubscribe performs constant work with no external reads,
valuation math or price-history scan, because v4 can swallow a failed callback.
The module requires at least 200,000 unsubscribe gas; the demo manager provides
300,000. Value/credit arithmetic is bounded for uint128 liquidity, supported prices,
the uint64 deadline and these record caps.

## Implementation and evidence

- `src/uniswap/`: integration ABI, principal valuation, subscriber ledger and CRE pool.
- `v4/`: pinned official v4 core/periphery and Permit2, built separately with their
  compiler versions; real-contract integration tests and infrastructure deployment.
- `script/DeployLPDemo.s.sol`: Arc/local round, projects and two sponsored budgets.
- `cre/src/lp-workflow.ts`: prices, allocation, Arkiv closing and attested tally.
- `web/app/routes/liquidity.tsx`: wallet discovery, eligibility, registration,
  accrued/projected weight, sponsorship and manual finalization.

Verification: 306 root Solidity tests, two real-v4 integration tests, 46 CRE tests,
36 web tests, frontend typecheck/production build and CRE WASM compilation passed.
This includes differential crypto vectors, callback/transfer/burn behavior,
prospective prices, stale/replayed reports, full-capacity unsubscribe gas and
allocation fuzzing. Live Arc signatures and a deployed DON execution remain
operator steps in the [runbook](../notes/2026-09-13-arc-lp-demo-runbook.md).
