# Uniswap prize: handoff notes for a new session

Written 2026-09-04 so the Uniswap brainstorm can continue in a fresh session in
parallel with the sealed-ballot work. Everything below was established in the earlier
session; nothing has been decided about the Uniswap integration yet.

## Hackathon context

- Event: ETHGlobal ETHOnline 2026. Submission deadline **Sunday 2026-09-13, 12:00 EDT**.
  Late submissions are refused.
- RankedShares is a **from-scratch** entry (all commits are from 2026-09-04, inside the
  hackathon window). Continuity-only prizes are not available to it.
- A submission may apply to **at most 3 partner prizes**. Chosen: **Arc**, **Chainlink
  CRE**, **Uniswap Foundation**. ENS was dropped because ENSv2 exists only on Sepolia and
  cannot be read from Arc. If both Arc prizes are entered, check whether the form counts
  them as two of the three picks.
- Demo video: 2–4 minutes, ≥720p, no phone recording, no speed-ups, no text-to-speech,
  no music-with-text-overlay format.
- General judging: creativity, functionality, technical difficulty, impact.

## Target chain

- Arc testnet, chain id **5042002**, RPC `https://rpc.testnet.arc.io`, explorer
  `https://testnet.arcscan.app`, faucet `https://faucet.circle.com`. viem has a built-in
  chain definition.
- Gas is USDC. The ERC-20 view of native USDC is at
  `0x3600000000000000000000000000000000000000` with **6 decimals**; the native view has
  18. The pool token is that ERC-20.
- Arc EVM quirks: value transfers to the zero address revert, burns revert,
  `block.prevrandao` is always 0, no blob txs, PUSH0/transient storage/EIP-7702 are
  supported (Osaka baseline). None of this affects RankedShares, which does no native
  value transfers.
- Arc mainnet (chain id 5042) opens **2026-09-16**, after the deadline. Arc's prizes
  want "deployed or deployment-ready on mainnet by September 30".
- Canonical contracts already on Arc testnet: **Permit2**
  `0x000000000022D473030F116dDEE9F6B43aC78BA3`, Multicall3
  `0xcA11bde05977b3631167028862bE2a173976CA11`, CREATE2 factory
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`.

## Uniswap Foundation prize (verified 2026-09-04)

**Best Uniswap Stack Contribution — $3,000, up to 3 teams × $1,000, unranked.**

Description: "Build on or integrate any part of the Uniswap stack, including the
Uniswap API, the Uniswap AMM (v2, v3, or v4), CCA, or any other Uniswap protocol."
Explicitly listed as qualifying: new v4 hooks, extensions or improvements to official
Uniswap repositories, tooling or ecosystem solutions around Uniswap.

Qualification requirements (judges audit for these before finalising winners):
1. Public GitHub repository with open-source code.
2. A `FEEDBACK.md` file in the repo.
3. The Uniswap Developer Feedback Form submitted with a link to `FEEDBACK.md`
   (https://developers.uniswap.org/hackathon-feedback). The form asks for: what was
   built, whether the integration succeeded, time to first successful integration,
   major obstacles, doc helpfulness 1–5, support quality 1–5, support channels used,
   gaps, plans to continue.
4. A README that "clearly points to the relevant contracts and lines of code".

No chain restriction is stated. Local forks are acceptable per the general tone of the
page, but a live testnet deployment is safer for judging.

Resources: https://developers.uniswap.org/docs, the developer dashboard,
https://github.com/Uniswap/uniswap-ai.

## Uniswap on Arc: what exists

- **Arc testnet has no official Uniswap deployment.** The v4 deployments page does not
  list Arc at all. A community Uniswap v2 fork ("Arc Swap") exists on testnet; it is not
  an official contract.
- **Arc mainnet (5042)** has an official v4 `PoolManager` at
  `0x8366a39cc670b4001a1121b8f6a443a643e40951` per the UniswapX playbook, plus v3
  factory and SwapRouter02 (addresses abbreviated in the source). Mainnet opens
  2026-09-16 with real USDC.
- **Ethereum Sepolia** has official v4: `PoolManager`
  `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`.
- Consequence: on Arc testnet, v4 has to be **self-deployed from v4-core with forge**
  (permissionless). Permit2 is already there. The README should note the official
  mainnet PoolManager so the mainnet deployment needs no self-deploy.

## Ideas discussed (none chosen yet)

1. **Zap-in contribution.** A periphery contract that takes any token, swaps it to USDC
   through the v4 `PoolManager` (unlock/swap callback), and calls `contribute` for the
   sender. Useful and simple; also the most common kind of hackathon Uniswap entry.

2. **Fee-to-budget v4 hook.** An `afterSwap` hook that skims a configurable share of
   swap fees into a RankedShares pool and credits voting weight to the swapper through a
   new `contributeFor(address)` entry point. Traders fund a community budget and get a
   say proportional to the fees they paid. Ties directly to the money-is-weight model,
   gives the Arc demo a second funding source, and is a "new v4 hook", which the prize
   explicitly rewards. More work: hook deployment with mined address flags, a pool with
   the hook, and a `contributeFor` path in the pool contract.

3. **Uniswap API / CCA** were mentioned as in-scope by the prize but not explored.

Working assessment from the earlier session: the hook is the stronger entry, the zap is
the safe fallback if the hook is not finished by roughly day five of the remaining nine.

## Open questions for the brainstorm

- Zap, hook, or both? If the hook: which pool(s) carry it on testnet, who provides
  liquidity for the demo, and what is the fee share?
- Does `contributeFor` interact with the sealed-ballot split? (Fee-derived weight is
  the swapper's own money, so it should land in the **direct** slot and vote publicly.)
- Where does the swap surface in the Arc frontend: as an "contribute with any token"
  option, or hidden behind the hook only?
- Self-deployed v4 on Arc testnet vs. demonstrating on a Sepolia fork: judges may
  prefer canonical deployments; the README must be explicit either way.
- What goes in `FEEDBACK.md`: keep a running log of obstacles from day one so the file
  is specific, not generic.

## Related files

- `docs/superpowers/specs/2026-09-04-pb-ear-contract-design.md` — engine and pool spec.
- `docs/superpowers/specs/2026-09-04-sealed-seat-ballots-design.md` — private seat
  ballots with a CRE tallier (in review; touches `contribute`, voter ids, phases).
  The Uniswap work must not conflict with its engine refactor (voter ids become
  `bytes32`).
- Claude memory: `ethonline-2026-sponsor-targets` records the sponsor choice.
