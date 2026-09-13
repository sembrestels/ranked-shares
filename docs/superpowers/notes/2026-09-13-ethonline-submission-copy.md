# ETHOnline 2026 submission copy

Text for the ETHGlobal submission form. Emoji for the project: 🗳️.

## Short description (100 chars)

Ranked-ballot budgeting in stablecoins, sealed votes. Each group funds its share, not the majority.

## Project description

RankedShares is on-chain participatory budgeting with a proportionality guarantee. In ordinary token voting a bare majority wins every proposal, so 51% of the voters can direct 100% of the treasury while the other 49% pay in and get nothing out. RankedShares replaces that rule with the Expanding Approvals Rule for participatory budgeting (Aziz and Lee, AAAI 2021). Voters rank the projects they want, ties allowed, and the tally funds projects step by step so that each group of voters ends up funding a share of the budget proportional to its share of the weight. The majority cannot spend the minority's money.

Money is weight. Stablecoins deposited into a pool are both the budget and the voting power, and the pool keeps one invariant: total voting weight equals the money in the pool. Every proposal carries a concrete cost in USDC or EURC, and a project is funded the moment its supporters' unspent weight reaches that cost. That is why the pool lives on Arc: gas is paid in USDC, so an entire round runs in a single stable asset from the first proposal to the last claim. Funded projects claim directly from the contract, with no treasurer in between.

Weight can also come from Uniswap v4 liquidity. Liquidity providers who pair a DAO token against a stablecoin carry the ecosystem's risk first, since bad spending shows up as impermanent loss on their position, so they get a vote on what the DAO does. Positions never leave the LP's wallet: the pool subscribes to the v4 PositionManager and tracks modify, transfer and burn events. Each position is valued in the sponsorship's stablecoin at a reference price, and weight accrues as value multiplied by time, so LPs who carried the risk longer receive a larger share of the sponsored budget.

Two Chainlink CRE workflows run in confidential compute. The first refreshes the reference price every two minutes from a finalized block and the v4 pool state, so LP weight stays honest for the whole voting period rather than being frozen on day one. The receiver settles accrued credit at the old rate before applying the new one and rejects stale or out-of-order reports. The second workflow tallies sealed ballots. Voters encrypt their ranking in the browser to the round's public key. Inside the enclave the workflow derives the round's secret, decrypts the ballots, runs the full tally, and reports the inputs root, the funded set and the transcript. The pool verifies the forwarder, the workflow identity and its own commitment before finalizing, so nobody, including the organiser, ever sees an individual ballot. The same pool also accepts Noir proofs and a ZisK zkVM proof, making the confidential workflow one of three interchangeable verifiers.

The product includes round, project, proposal, voting and liquidity pages on top of a read API, contracts deployed on Arc testnet with a self-deployed Uniswap v4 stack, a differential fuzz against a Python reference implementation, and a FEEDBACK.md on building with the Uniswap stack.

## How it's made

**Contracts.** Everything on-chain is Solidity built with Foundry. The core pool keeps the invariant that total voting weight equals the stablecoin balance, and the tally is a Solidity implementation of the PB-EAR rule. A ballot is a byte string with one byte per project holding the project's competition rank, so ties are natural and the contract rejects rankings with gaps. Each `step()` call either funds one project or expands every ballot by one rank tier, and the cost deduction uses cumulative rounding so it is integer-exact across supporters. The algorithm is checked by an ffi differential fuzz against a Python reference implementation, plus a brute-force checker for the proportionality guarantee from the paper.

**Arc.** The pool runs on Arc testnet with USDC as both gas and pool token, and an EURC pool alongside. Because costs, weight and gas are the same unit, there is no conversion anywhere in a round.

**Uniswap v4.** Arc testnet has no official v4, so we deploy the pinned v4-core and v4-periphery ourselves with forge scripts that also seed DAO/USDC and DAO/EURC pools with a wide and a narrow range. The LP voting module is a PositionManager subscriber, not a hook and not a vault: subscribe, modify-liquidity, transfer and burn callbacks drive the accounting while the NFT stays in the LP's wallet. Position value is computed from the principal implied by the liquidity at a reference price, both legs converted into the sponsorship's stablecoin, fees excluded. Weight is the integral of that value over time. The notifier can swallow a failing unsubscribe, so the module caches rates, settles eagerly on every update and keeps unsubscribe to constant storage work, with a test that fills all 64 position slots and asserts the callback fits under 200k gas.

**Chainlink CRE.** Both workflows are TypeScript on the CRE SDK, run with bun, and use confidential execution on AWS Nitro. The price workflow fires on a two-minute cron, reads a finalized block header and the v4 StateView slot0 for each sponsored pool, and writes a signed report through the Keystone forwarder. The receiver checks the forwarder address, the workflow owner and name, a strictly increasing source block, observation age under five minutes and at least sixty seconds between updates, then settles at the old rate before switching. The tally workflow pulls a master secret with `getSecret`, derives the round's tallier key from it and the pool's public salt, decrypts the ballots, replays the PB-EAR transcript and reports the inputs root, funded set and transcript. The pool refuses the report unless that inputs root matches its own commitment. One hacky detail: the forwarder prepends the workflow name as ten bytes of the SHA-256 of the name, so the pool stores and compares that truncated form.

**Sealed ballots.** Ballots are encrypted in the browser with noble curves and a Poseidon2 port. The same encrypted ballot format feeds three verifiers on one pool interface: the CRE attestation above, chained Noir Honk proofs of every tally batch, and a single ZisK zkVM proof of the whole tally.

**Frontend.** A React Router 7 single-page app with React 19, Tailwind 4, wagmi and viem, served with a small Deno read API. It covers rounds, projects, proposals, voting and a liquidity page for registering positions and watching accrued weight.

## Architecture diagram

`docs/design/brand/architecture.png` (3200×2240), source `architecture.html` beside it.
Required by the Arc DeFi prize together with the frontend, backend and video.

## Slides

Pitch canvas: https://claude.ai/code/artifact/423e112e-2e25-478b-a81c-0501107f2e74

## How AI was used

RankedShares was built by one person working with Claude Code over ten days, from the first Foundry scaffold on 2026-09-04 to the submission on 2026-09-13. The agent wrote most of the code and documents. The human chose the sponsors and the voting rule, accepted or rejected every design decision, held every key, and ran every live transaction.

**Spec, plan, then subagents.** Every feature followed the same path, and the artifacts are in the repo under `docs/superpowers/`. A brainstorm note captured the problem and the options. A design spec fixed what would be built. An implementation plan broke it into tasks with tests. Subagents then executed the plan task by task while the human slept, each task ending in passing tests and a review pass, and the branch was fast-forward merged into master the next morning. Seven specs and nine plans cover the PB-EAR contract, the three sealed-ballot verifiers, the round pages and the Uniswap LP module.

**Verification instead of trust.** The tally is an implementation of a published algorithm (Aziz and Lee, AAAI 2021), and an agent can misread a paper as easily as a person. So the agent first wrote a Python reference implementation of PB-EAR that mirrors the contract's integer arithmetic, then a differential fuzz test that calls it through Foundry's ffi and compares every tally step, plus a brute-force checker for the paper's proportionality guarantee. The same discipline applies to the sealed ballots: the CRE enclave, the Noir circuits and the ZisK guest all consume one encrypted ballot format and must agree on the same transcript, so each verifier checks the others.

**A design process the agent can follow.** The frontend was designed with a Double Diamond process and a Lean UX inner loop, adopted by a decision record on 2026-09-05. Sixteen open-source agent skills for proto-personas, jobs to be done, journey maps, story mapping, user stories with Gherkin criteria, design tokens, atomic design, Nielsen heuristics and WCAG 2.2 audits were vendored into the repo, pinned by hash and audited for prompt injection before use. The agent drafted personas, jobs, journeys, hypotheses, a story map and eight story files, then a design system and token set, and the human closed each gate. Before a screen was called done the agent ran heuristic and accessibility reviews against it, and the findings became new stories.

**Decisions stay with the human.** Twelve records in `docs/decisions/` cover the framework, hosting, wallet library, Swarm storage, CRE weighting, Arkiv ballots and the navigation model. The agent writes a record as proposed. Only the decision-maker sets it to accepted, and accepted records are never edited, so the reasoning behind the build is readable without the chat history.

**Everything that touches money is manual.** The runbooks for the Arc deployment and the CRE demo say which commands the agent has not run. Private keys, CRE registry writes, secret uploads and testnet deployments were executed by the human from the runbook.

**Also drafted with AI.** The brand logo and cover, the pitch canvas, the Uniswap feedback report and this submission text were drafted by the agent and edited by the human.

## AI usage (short form)

Built by one person with Claude Code in ten days. The agent wrote most of the code and docs; the human chose the sponsors and the voting rule, accepted every decision, held the keys and ran every live transaction. Each feature went brainstorm, spec, plan, then subagent implementation with tests. The paper trail is in the repo: brainstorms, specs and plans in `docs/superpowers/`; twelve decision records in `docs/decisions/` that the agent proposes and only the human accepts; personas, journeys, story map, stories, design system, tokens and the heuristic and WCAG reviews in `docs/design/`, produced with sixteen vendored agent skills pinned in `skills-lock.json`. The PB-EAR tally is checked by an AI-written Python reference through a differential fuzz, and the three sealed-ballot verifiers cross-check each other. Runbooks in `docs/superpowers/notes/` list what the agent did not run.

## Arc integration (short form)

Arc is the settlement chain for every round. The pool keeps one invariant, total voting weight equals the stablecoin balance, and on Arc the budget, the voting weight, each proposal's cost and the gas are all USDC, so a round runs in one unit from the first proposal to the last claim with no conversion anywhere. A second pool runs the same flow in EURC. Rounds are created from the browser at `/deploy`, where Arc Testnet (chain 5042002) is the default and the official USDC and EURC addresses from the Arc contract directory are preselected; funded projects claim directly from the contract. Because Arc has no official Uniswap deployment, the LP voting demo ships forge scripts that deploy the pinned v4 core and periphery on Arc against Arc's existing Permit2 and seed DAO/USDC and DAO/EURC pools, and the Chainlink CRE price and tally workflows target the Arc RPC and write their reports to receivers on Arc. The ZisK verifier was also exercised against the Arc testnet EVM with a `cast call --create` probe before the receivers were built. The Arc addresses, funding amounts and deployment order are in `docs/superpowers/notes/2026-09-13-arc-lp-demo-runbook.md`; the web configuration is in `web/README.md`.
