# Uniswap v4 integration feedback

Recorded while building RankedShares' proportional LP voting demo, 2026-09-13.
This is repository feedback, not confirmation of a prize submission or eligibility.

## What we built

A sponsor funds a community voting budget for a v4 pool. LPs subscribe their NFT
without transferring it. `LPVoting` integrates principal value over time, retaining
credit on transfer/withdrawal, and allocates the budget proportionally at the round's
deadline. CRE updates reference prices and closes/tallies the encrypted ballots.
The Arc deployment scripts seed DAO/USDC and DAO/EURC pools with different ranges.

Code entry points: [subscriber](src/uniswap/LPVoting.sol),
[valuation](src/uniswap/PositionValue.sol), [pool](src/uniswap/LPCreRankedShares.sol),
[real-v4 tests](v4/test/LPIntegration.t.sol), and [deployment](v4/script/DeployV4.s.sol).

## Integration observations

- **Subscriber callbacks made noncustodial participation practical.** Subscribe,
  liquidity modification, transfer-triggered unsubscribe and burn provide the
  lifecycle needed to account for voting credit. No staking vault or pool hook was
  necessary.
- **Unsubscribe failure semantics matter for accounting.** The notifier can swallow
  a subscriber failure. Replaying an unbounded price history in that callback would
  risk continuing credit after transfer. We cache valuation rates, settle eagerly on
  updates, and keep unsubscribe to constant storage work. A test fills all 64
  position records and checks the callback fits under 200,000 gas; the demo's real
  manager is configured with a 300,000 limit. An integration guide highlighting
  swallowed failures and the gas-left check would help subscriber authors.
- **A reproducible compiler recipe would help.** Current pinned periphery uses
  Solidity 0.8.26, Permit2 requires 0.8.17, and the application uses 0.8.28. A separate
  Foundry root plus a London profile for Permit2 avoids forcing all dependencies
  through one compiler/EVM setting.
- **Constructor versions should be explicit in deployment examples.** The pinned
  PositionManager takes PoolManager, Permit2, unsubscribe gas, descriptor and native
  wrapper. This demo uses ERC-20 currencies only, so its wrapper is unused.
- **Liquidity is not a capital denominator across ranges.** We value the amounts
  represented by liquidity at a shared reference price, including out-of-range
  principal and excluding fees. An official subscriber example showing this
  distinction and both currency orientations would be useful.

## Versions and verification

Official [v4-periphery](https://github.com/Uniswap/v4-periphery) revision
`dce236d4e2057422d0791d9a973a58765eb46f65`, with recursive pinned submodules.
The application's forward TickMath implementation is adapted from
[v4-core](https://github.com/Uniswap/v4-core) revision
`59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` and retains its MIT license.

Two real-v4 tests cover mint, subscribe, resize, transfer, burn, deadline settlement
and final payout. Thirteen dedicated root tests cover the ledger and valuation,
alongside the existing pool regression suite. Both deployment stages also completed
on local Anvil. Live Arc deployment is prepared for the operator's signatures; a
running DON and public transaction links are still needed for a live submission.
