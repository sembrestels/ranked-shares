# RankedShares

An on-chain participatory budgeting pool that selects projects with the
**PB Expanding Approvals Rule (PB-EAR)** from Aziz & Lee, *Proportionally
Representative Participatory Budgeting with Ordinal Preferences* (AAAI-21), using
the uniform fractional reweighting of Aziz & Lee, *The expanding approvals rule*
(Social Choice and Welfare, 2019). Both papers are in `docs/papers/`.

Voters rank projects (ties allowed), projects have costs, and the outcome satisfies
**Inclusion PSC**: any group of voters that solidly supports a set of projects gets
funding in proportion to its share of the budget.

## The model

- **Money is weight.** Tokens deposited into the pool form the budget, and every
  deposited token is one unit of voting weight. The contract keeps
  `totalWeight == budget` at all times, so a project is funded exactly when the
  unspent weight of the voters approving it reaches its cost.
- **One ballot per address.** An address's weight is the sum of its own
  contributions and the seats organisations sponsored for it. Its single ballot
  applies to all of it. Weight is maintained live during the voting window and
  frozen when the tally starts.
- **Sponsorships.** An organisation deposits and names who votes with the money:
  an explicit address list (one seat each) or an ERC-721 collection, where each
  token id is a seat the current holder can claim. `seats` may be passed as 0 to
  use the collection's `totalSupply()`; the call reverts if the collection does
  not expose one.
- **Abstaining weight.** Money behind an address that never votes, unclaimed NFT
  seats, and per-seat division dust never support any project and are never spent.
  They stay in the pool for `sweep`.

## Lifecycle

| Phase | Who | Calls |
|---|---|---|
| Setup (until `votingDeadline`) | anyone / proposer / owner | Anyone `propose(contentRef, cost, recipient)`; proposer or owner `editProposal(id, revision, contentRef, cost, recipient)` while pending; owner `acceptProposal(id, revision)` or `rejectProposal(id, revision)` |
| Setup | owner | `addProject(cost, recipient)`, `openVoting()` |
| Open (until `votingDeadline`) | anyone | `contribute(amount)`, `sponsor(amount, members)`, `sponsorNFT(amount, nft, seats)`, `claimSeat(id, tokenId)`, `vote(ranks)` |
| Tally | anyone | `startTally()` once the deadline has passed, then `step()` or `run(maxSteps)` until `tallyDone()` |
| Done | anyone / owner | `claim(projectId)` pays the recipient; owner `sweep(to)` withdraws the leftover |

There are no withdrawals of deposits. Fee-on-transfer and rebasing tokens are not
supported: `startTally` reverts if the pool's balance is below `totalWeight`.

## Proposals and Swarm ID

The `web/` frontend supports proposal submission and organizer review for newly
deployed `RankedShares`, `NoirRankedShares`, `CreRankedShares`, and `ZiskRankedShares`
pools. It follows the React Router SPA and Deno task structure described in the
frontend decision records. The same package holds the read API (`web/api/`, `deno
task dev:api`) that the round and project pages read from; see `web/README.md`.
See [`web/README.md`](web/README.md) for configuration. The web app's round page
(`/`) and project pages (`/project/:id`) show public commitments, the sealed total,
the stage of the round, and the outcome; see `web/README.md`.

- `/submit`: connect a wallet and Swarm ID, write any proposal text, attach any file
  types, and upload directly through `@snaha/swarm-id`. Review the saved amount,
  recipient and reference, then submit the wallet transaction.
- `/proposals`: browse proposals and their review status; read text and download
  attachments. (`/` is now the round page; see above.)
- On either board, the original proposer or current owner can choose **Edit proposal**
  for a pending submission, keep/remove attachments, add files, and save a new revision.
- `/setup`: the current pool owner can accept or reject pending proposals. Each
  decision is an on-chain transaction; Swarm ID is not the organizer authorization.
  Before inviting submissions, choose **Enable private review** with the organizer's
  Swarm ID connected. After reviewing, **Prepare voting** checks accepted revisions;
  **Publish accepted proposals and open voting** releases their keys and opens the round.

Proposal JSON `{version: 1, title, body, attachments}` and attachments are encrypted
in the browser with fresh AES-GCM keys. Swarm ACT shares each revision's document
key with the proposer and organizer. A public version-2 descriptor contains only
encrypted-content references, public keys, nonce, context and a key commitment;
its 64-hex-character Swarm address fits in `bytes32`. The original proposer key lives
in this metadata. The organizer key is registered on-chain in the per-round
`ProposalPrivacy` contract, available through `proposalPrivacy()`. Text and files
have no content or MIME allowlist.
The UI displays text literally and downloads files as binary; it never executes
uploaded HTML. Automatic text previews are limited to 1 MB and 100 attachments;
larger or unfamiliar content can still be downloaded.

`PoolBase.proposals(id)` stores the proposer, reference, requested cost, recipient,
status (`0` pending, `1` accepted, `2` rejected), and accepted `projectId` (only valid
for status `1`; project zero is valid). `proposalCount()` supports paginated reads.
Acceptance creates a project through the pool's existing registration path and
sets `contentRefOf(projectId)`. While pending, the original proposer and current owner
may edit the reference, amount and recipient. `proposalRevision(id)` starts at 1;
every edit increments it, records `proposalEditor(id)`, and emits `ProposalEdited`
with both references and the new terms. Authorship is preserved. Edits and review
decisions require the expected revision, so stale saves or decisions revert instead
of overwriting or approving someone else's concurrent edit. Accepted and rejected
proposals are locked. Existing cost and project-count limits apply on acceptance; a failed
acceptance leaves the proposal pending. Only accepted proposals enter ballots or
receive funding. Pending submissions cannot stop the owner opening voting; once
voting opens or its deadline passes, submissions and review close. Decisions are final.
The existing two-argument `addProject` remains available, with a zero content reference.

This revision requires a new pool deployment. `propose` and `editProposal` now take a
`bytes32 keyHash` immediately after `contentRef`. Acceptance keeps content private.
`ProposalPrivacy.openVoting(ids, keys)` verifies and publishes only accepted final
revision keys and opens the pool atomically. The ordinary pool opening method cannot
bypass this publication. Publication starts when keys are sent in the transaction:
pending and reverted transaction data can expose them too. Earlier revisions and
rejected proposals retain their own keys. Previously public uploads remain public.

Swarm ID holds the storage credentials in its trusted domain. No server postage
secret or upload API is required. Uploading requires an identity with `canUpload`;
the proposer supplies storage through Swarm ID. Storage availability and supported
file sizes depend on that storage and browser resources. Encrypted uploads can remain
on Swarm even if the proposal is rejected. The frontend retains only public upload
details and any pending transaction hash locally, allowing submission retries without
another upload. It does not persist private titles, drafts, encryption keys or wallet secrets.

These changes require new pool deployments: existing immutable deployed contracts
do not gain proposal methods. The browser prover remains a separate app because its
COOP/COEP isolation headers are incompatible with the Swarm ID popup flow.

## Ballot encoding

A ballot is `bytes` with one byte per project (project id = byte index). The byte is
the project's **competition rank**: `1 +` the number of projects the voter strictly
prefers. Tied projects share a value; `0` means unranked, and all unranked projects
form the last tier. The contract rejects rankings with gaps.

| Preference | Ballot (4 projects a,b,c,d) |
|---|---|
| a > b > c > d | `0x01020304` |
| a > b ~ c > d | `0x01020204` |
| b > a, rest unranked | `0x02010000` |
| indifferent | `0x00000000` |

## The algorithm

`step()` performs one iteration of PB-EAR:

1. For every unfunded project, sum the unspent weight of voters whose ballot ranks
   it within the current rank level `j`.
2. If some project's support reaches its cost, fund the one with the highest
   support (ties: lowest cost, then lowest id) and deduct exactly its cost from its
   supporters, proportionally to their weight, with cumulative rounding so the
   deduction is integer-exact.
3. Otherwise raise `j` by one, so every ballot approves one more tier.

The tally ends when no unfunded project fits in the remaining budget, or when `j`
reaches the number of projects and nothing is eligible (only abstaining weight is
left). Each call funds one project or advances one level; `run(maxSteps)` batches
calls.

## Layout

```
src/PBEAR.sol           abstract engine: projects, ballots, weights, step()
src/RankedShares.sol    ERC-20 pool, sponsorships, NFT seats, phases, payouts
src/SealedPool.sol      shared sealed-pool base for the cre and zisk variants
src/noir/               NoirRankedShares (chained-proof transcript tally), Poseidon2,
                        Grumpkin and the generated Honk verifiers
src/zisk/               ZiskRankedShares, the vendored ZisK PLONK verifier
src/cre/                CreRankedShares, the DON-attested variant
reference/pbear.py      Python reference implementation + brute-force IPSC checker
reference/noir/         Poseidon2, Grumpkin, sealed ballots, commitments, profiles, fixture tools
reference/zisk/         secp256k1, sealed ballots, commitments and fixtures of the zisk variant
noir/                   Noir circuits, committed ACIR/verification keys and real proofs
zisk/                   Rust workspace: PB-EAR, sealed-ballot guest logic, the ZisK guest, the tally-prover
test/                   Foundry tests, including an ffi differential fuzz
docs/superpowers/       design spec and implementation plan
```

## Running the tests

```
forge test                                    # Solidity suites (needs python3 for the ffi test)
python3 -m unittest discover reference        # reference implementation
FOUNDRY_FUZZ_RUNS=500 forge test --match-contract Differential
```

The differential test builds random small instances, tallies them on-chain and in
Python, checks that both agree, and brute-forces the IPSC axiom on the result.

## Sealed pools

`NoirRankedShares` is the pool of `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md`:
direct ballots are public and final, seat holders vote with sealed ballots, the tally runs
off-chain and is finalised by a chain of proofs.

| Phase | Who | Calls |
|---|---|---|
| Setup | owner | `addProject`, `openVoting` |
| Open | anyone | deposits as above, `vote(ranks)` (needs `minDirectVote` of own contributed weight, one ballot, final), `voteSealed(rx, ry, c)` (needs `minSealedVote` of seat weight, replaceable) |
| Closing (deadline passed) | anyone / DON | `close(maxVoters)` until `closed`; the CRE workflow may drive it with a kind-2 report |
| Tally | DON, coordinator, anyone | `onReport` (kind 1: result + transcript), `advance(proof, publicInputs, restart)` for each ingest batch then each tally group, or `advanceMany(proofs, publicInputs, restart)` for several of them in one atomic transaction — permissionless, except that `restart = true` rewinds the tally chain to the state the ingest chain ended at and only `coordinator` may ask for it (in a batch it reaches the first tally proof only); `acceptProvisional` after `proofGrace` since the report, `abandon` after `abandonGrace` since the deadline |
| Done | anyone / owner | `claim`, `sweep`; `finality()` says which path ended the pool |

`Proven` means the sealed half was proven against the committed ciphertexts and the
public half was attested by the DON and can be replayed by anyone from chain data
(`python3 reference/pbear.py --transcript …` and, later, `prover/cli audit`).

`onReport` is authorised twice: `msg.sender` must be the CRE `forwarder`, and the
metadata the forwarder prepends (`bytes32 workflowId ‖ bytes10 workflowName ‖ address
workflowOwner`, plus a `bytes2 reportId` on verified delivery) must name the pool's
`workflowOwner` and, unless it is `bytes10(0)`, its `workflowName`. The KeystoneForwarder
is a per-chain singleton shared by every workflow, so the sender check alone would let any
workflow owner registered with it deliver a kind-1 report — writing the provisional result
and starting the `proofGrace` clock, after which `acceptProvisional` would finalise it.
The check binds a report to a workflow owner, not to a specific workflow build
(`workflowId` is not checked), so that owner may redeploy code under the same name and
still report: that is the trust boundary. `workflowOwner == address(0)` disables it
entirely — needed only for `cre workflow simulate`, whose MockForwarder sends no metadata
at all — and such a pool must never hold real funds; `workflowNameOf(name)` derives the
`bytes10` from a workflow's name string (SHA-256, hex, first 10 characters, as ASCII).

A restart still needs its own valid proof, so `coordinator` cannot rewrite the result —
but a proof is public once submitted, so without the restriction anyone could replay the
first tally group with `restart = true` and rewind the chain at will, holding off an
honest `Proven` until the grace path applies. The two minimums (`minDirectVote`,
`minSealedVote`) are what a ballot costs: both also refuse a zero-weight ballot when the
minimum itself is zero, since such a ballot only enlarges the roster every close and
tally pay for. `votersFrom(start, count)` returns a page of that roster — address,
direct weight, packed ballot, seat weight, ciphertext, and the flag that tells an
indifferent ballot (packed zero) from no ballot at all — so the workflow and the prover
rebuild it without one call per voter. `profileId()` is
`keccak256(abi.encode(nSealedMax, mMax, batch))`.

Deploy with `script/DeployNoir.s.sol`:

```
TOKEN=0x... OWNER=0x... VOTING_DEADLINE=<unix> FORWARDER=0x... COORDINATOR=0x... \
WORKFLOW_OWNER=0x... WORKFLOW_NAME=ranked-shares-sealed-staging \
TALLIER_PK_X=<uint> TALLIER_PK_Y=<uint> KEY_SALT=0x<32 bytes> \
PROFILE=test|default MIN_DIRECT_VOTE=10000000 MIN_SEALED_VOTE=10000000 \
PROOF_GRACE=86400 ABANDON_GRACE=604800 \
[POSEIDON=0x...] [INGEST_VERIFIER=0x...] [TALLY_VERIFIER=0x...] \
forge script script/DeployNoir.s.sol --rpc-url $RPC_URL --broadcast
```

`WORKFLOW_OWNER` and `WORKFLOW_NAME` are what `onReport` authorises the DON's report
against (above). `WORKFLOW_NAME` must be exactly the `workflow-name` in
`cre/workflows/sealed/workflow.yaml` for the target being deployed —
`ranked-shares-sealed-staging` for `staging-settings` — and `WORKFLOW_OWNER` the address
of the `CRE_ETH_PRIVATE_KEY` that registers the workflow; the script logs the derived
`bytes10` next to the name it came from, so a typo is visible before the pool is used.
Leaving `WORKFLOW_NAME` empty accepts any workflow name from `WORKFLOW_OWNER`. Leaving
`WORKFLOW_OWNER` unset turns the check off and is refused unless `ALLOW_ANY_WORKFLOW=1`
is also set: that opt-out exists for `cre workflow simulate`, whose MockForwarder sends
no metadata, and a pool deployed with it must never hold real funds.

`PROFILE` sets `nSealedMax`, `mMax` and `batch` together (`test` is 8 / 4 / 2, `default`
256 / 16 / 32); the verifiers are compiled for one profile, so the three are never chosen
independently, and `profileId()` — `keccak256(abi.encode(nSealedMax, mMax, batch))` — lets
a client refuse a pool its proving keys were not built for. The
Poseidon2 hasher (`src/noir/lib/Poseidon2.sol`) is generated from the reference constants by
`python3 -m noir.tools.gen_poseidon2_sol` from `reference/`; the Honk verifiers come from the Noir
circuits (`noir/README.md`) and are deployed once per chain with
`script/DeployNoirVerifiers.s.sol`.

Gas on the default fixture (70 voters, 65 sealed, 16 projects):

| Call | Gas |
|---|---|
| `close(1000)`, full closing pass (total / per sealed voter) | 8,266,073 / 127,170 |
| `onReport` (kind 1, 23 transcript steps) | 8,975,324 |
| `voteSealed` (first / replacement) | 75,475 / 4,443 |

See `forge test --match-contract SealedGasTest -vv`.

`advance` with real proofs (test profile, `RealProofsTest`, generated Honk verifiers and
`bb`-made proofs from the fixtures) costs about 686k–930k gas per call, one ingest or
tally group per proof. See `forge test --match-path "test/noir/verifiers/RealProofs.t.sol" -vv`.

`advanceMany` verifies several of those proofs in one atomic transaction. Measured on
anvil against the same verifiers, the whole `test_main` chain — 3 ingest batches and 3
tally groups — costs **about 5.12 M gas as one `advanceMany`** against **about 5.32 M gas as six
`advance` transactions** (878,981 + 845,645 + 865,147 + 832,600 + 832,684 + 1,068,578):
about 200k saved (one sample run; receipts move by a few hundred gas between runs), which
is the five transaction intrinsics the batch does not pay plus the
account and storage warming the six proofs now share. The calldata is the same either way
(50,564 bytes batched against 50,616 in six calls), so the saving is a fixed
per-transaction one rather than a per-proof one — batching buys one signature and a few
percent, not an order of magnitude. See `cd prover && npx vitest run test/e2e.test.ts
--reporter=verbose`, which logs both.

## Prover CLI

`prover/src/cli/index.ts` (`cd prover && npx tsx src/cli/index.ts …`, or `npm run cli --`)
drives a sealed pool from the TypeScript prover of `prover/src/core/`:

```
prover audit --rpc <url> --pool <addr> [--from-block n]
prover status --rpc <url> --pool <addr> [--from-block n]
prover prove --rpc <url> --pool <addr> --private-key <hex> ($RANKED_SHARES_MASTER | --sign | --master <hex>) [--threads n] [--batch]
prover serve --rpc <url> [--port 8787] [--private-key 0x…] ($RANKED_SHARES_MASTER | --sign | --master 0x…) [--submit] [--batch] [--threads n] [--job-timeout 1800]
```

`audit` replays the reported transcript against the public block read from chain and
exits non-zero if it does not reproduce it — the same check anyone can run without the
tallier key. `status` prints phase, ingest progress and the current `stateCommit`.
`prove` derives the tallier secret from a master secret and the pool's `keySalt`, resumes
the proof chain from wherever it stands, and submits `advance` for each remaining ingest
batch and tally group as `--private-key` (it exits 1 with "pool not closed yet" if the
pool has no `inputsRoot` yet, since ingest needs the checkpoints `close()` writes).
`--batch` sends the whole run as a single `advanceMany` instead: the same proofs in the
same order with the same `restart` decision, but one transaction and one signature. It
is off by default because a batch lands nothing until the last proof is ready and a
single rejected proof reverts all of it, where one `advance` per proof banks each
accepted proof as it goes.

The master secret should come from `RANKED_SHARES_MASTER` in the environment, or from
`--sign`, which signs `MASTER_MESSAGE` with `--private-key` and never puts the secret on
a command line at all — `--sign` is also how the browser prover derives it from a wallet,
so it is the flow to use when the coordinator key is the same wallet that should hold the
tallier secret. `--master <hex>` passes the raw 32-byte secret directly; it is a
development convenience only, since a command line is visible to every process on the box
(`ps`) and lands in shell history.

## Coordinator page

`prover/src/web/` is a single Vite page that drives the same `prover/src/core/`
against an injected wallet, so the coordinator never has to hold a raw master
secret or run the CLI: RPC URL and pool address inputs, Connect wallet, Sign for
tallier key (signs `MASTER_MESSAGE`, deriving the master secret in memory only),
Switch wallet to RPC chain (reads the chain id from the RPC URL and asks the wallet
to switch, adding the chain with that RPC if the wallet doesn't know it), Refresh
status, Audit, and Prove and submit (runs `runChain` in the browser with bb.js,
logging each proof, then sending them all as one `advanceMany` — the page batches by
default, so the operator confirms once in the wallet after the last proof is ready
rather than once per proof). Refresh and Audit work
without a connected wallet; the page reads `?rpc=…&pool=…` from the URL query
string to prefill the inputs. `bb.js`/`noir_js` are only imported (dynamically)
inside the Prove handler, so the page's initial load doesn't pull in that WASM
until someone actually proves.

```
cd prover
npm run build      # -> dist/, inlines the bb.js/noir_js WASM and the compiled circuits
npm run preview    # serves dist/ with the COOP/COEP headers bb.js needs for its worker pool
```

`npm run dev` serves the page from source for local development (same headers).
Building needs `noir/artifacts/default/*.json` to exist (`cd noir && ...` per its
README) since `prover/src/core/artifacts.ts` imports them statically.

Manual walkthrough against the e2e fixture's anvil chain. Run on 2026-09-05 in a
desktop browser with a wallet: all six test-profile proofs were produced in the
browser and submitted as one `advanceMany`, ending in `Proven`; the first tally
group took about 12–30 s (including bb.js start-up). The default profile is about
40× heavier per proof (see the spec's B12.1), so for real pools use the prove
service and keep the page for small pools and audits.

1. `cd prover && npm run dev:pool` (leave it running — it starts anvil, deploys
   the fixture pool, replays its votes and reports the transcript, then prints
   the RPC URL, pool address, coordinator private key and a ready-to-open page
   URL), then `npm run preview` in another terminal and open the printed URL.
2. Import the coordinator private key printed by `dev:pool`
   (`0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`,
   anvil's account 2) into the wallet.
3. Switch wallet to RPC chain → the wallet asks to add "Anvil (local)" (chain id
   31337, the printed RPC URL) and to switch to it; approve both.
4. Connect wallet → approve the connection to the coordinator account.
5. Use master secret → paste the `MASTER` value printed by `dev:pool` (the
   fixture's fixed tallier secret; the page keeps it in memory only). On a real
   pool, whose `tallierPkX/Y` came from `make-master-secret.mjs` with the
   coordinator's key, use Sign for tallier key instead: it signs the
   `MASTER_MESSAGE` prompt and derives the same value.
6. Refresh status → confirm phase/ingestCursor/coordinator look right and
   `youAreCoordinator` is `true`.
7. Audit → confirms the public block reproduces the reported transcript.
8. Prove and submit → proves each remaining ingest batch and tally group, then
   sends them as one `advanceMany` (one wallet confirmation), logging its gas and
   ending in `Proven`.

## Prove service

```
prover serve --rpc <url> [--port 8787] [--private-key 0x…] ($RANKED_SHARES_MASTER | --sign | --master 0x…) [--submit] [--threads n] [--job-timeout 1800]
```

`serve` runs the same prover core as a long-running HTTP API for the operator's home
box: `POST /prove {"pool":"0x…"}` queues a job (409 if the pool hasn't closed yet, since
ingest needs the checkpoints `close()` writes, and 409 with the previous job if that pool
failed within the last minute — proving is deterministic, so an immediate retry would
fail the same way), `GET /jobs/<id>` polls it for its log, proofs and `resume` hint, and
`GET /health` reports whether it submits. Without `--submit` it only proves and hands the
proofs back for someone else to submit, along with `resume` — `{ingestFrom, tallyFrom,
restart}`, where whoever submits should start and whether the first tally `advance` needs
`restart = true` — since the un-submitted proofs are what would move the pool's state.
With `--submit` it sends `advance` itself, signing locally with `--private-key` (which
must then be the pool's coordinator, for restarts); adding `--batch` sends each job's
whole run as one `advanceMany`, with the trade-off described under the CLI above. A job that overruns `--job-timeout`
seconds is marked failed and the worker moves on. The job cache is in-memory and bounded
(the newest 200 jobs, 500 log lines each), so restarting the service loses it —
harmlessly, since proving a pool is deterministic and re-proving after a restart
reproduces the same proofs.

Deployment: run it under a user systemd unit on the operator's machine and expose it
through a Cloudflare Tunnel or Tailscale Funnel rather than an open port. Point `TMPDIR`
at a disk directory — on the reference home box `/tmp` is a 16 GB tmpfs, which proving
should not compete with — and size `--threads` to leave a couple of cores free (that box
has 16 threads and 30 GiB, so 14 is a reasonable default rather than
`os.availableParallelism()`).

## Uniswap LP voting: proportional Arc demo

LPs can subscribe a Uniswap v4 position to earn voting weight from a sponsored
budget, proportional to liquidity value multiplied by time. The position stays in
their wallet; withdrawal or transfer stops future accrual and preserves earned
credit. Registered LPs can cast an encrypted ballot before final allocation.

The new [LP subscriber](src/uniswap/LPVoting.sol) tracks callbacks and allocation;
[LPCreRankedShares](src/uniswap/LPCreRankedShares.sol) gates ballot closing until that
allocation finishes. The [CRE workflow](cre/src/lp-workflow.ts) samples finalized pool
prices, finalizes LP weight, closes Arkiv ballots and attests the tally. These are
pool spot samples, not an independent oracle. Limits and privacy/trust assumptions
are in the [implemented specification](docs/superpowers/specs/2026-09-13-uniswap-proportional-arc-demo.md).

Open `/liquidity` for positions, projected weights and sponsorships. Follow the
[Arc demo signing runbook](docs/superpowers/notes/2026-09-13-arc-lp-demo-runbook.md)
to deploy pinned official v4 contracts, DAO/USDC and DAO/EURC pools, and two sponsored
budgets. Local rehearsal and real-v4 integration tests pass; live Arc deployment and
DON activation require the operator's configuration and signatures. Integration
feedback is in [FEEDBACK.md](FEEDBACK.md).

## Off-chain: CRE workflow and secrets

`cre/` is a bun project holding the shared TypeScript port of the reference (Poseidon2,
Grumpkin, sealed-ballot packing/encryption, the PB-EAR transcript and its public replay —
`cre/src/lib/`) and the Chainlink CRE workflow built on it (`cre/src/workflow.ts` +
`cre/src/main.ts`). Every couple of hours (`workflows/sealed/config.staging.json`'s
`schedule`) it reads each configured pool, and inside the DON's TEE handler
(`onCronInTee`, `{ tee: "nitro" }`) either drives `close` (kind-2 report) while the pool
is closing, or — once `phase` is `Tally` and no result has been reported yet — derives the
tallier's secret key from the `RANKED_SHARES_MASTER` secret and the pool's `keySalt`,
decrypts the sealed ballots, runs the same PB-EAR transcript as the reference and reports
the result (kind-1) via `evm.writeReport`. Nothing but `(inputsRoot, funded, transcript)`
ever leaves `processPool`, the pure function the handler wraps.

**`config.staging.json` ships with `pools: ["0x0…0"]` as an obvious placeholder — replace
it with your deployed pool's address before running the workflow for real.** The handler
validates every entry at the start of each run (`validPools`) and skips anything that
isn't a real, non-zero address with a `<pool>: skipped, not a pool address (edit
config.staging.json)` summary line, so the shipped placeholder is inert rather than
crashing the run, but it still has to be edited for the workflow to do anything.

```
cd cre
bun test           # unit + differential tests: Poseidon2 vs reference/vectors/noir/poseidon2.json,
                    # Grumpkin/sealed vectors, pbearTranscript vs reference/pbear.py --transcript,
                    # and the tampered-transcript audit checks
bunx tsc --noEmit
bun run compile     # compiles src/main.ts to dist/workflow.wasm with Javy (cre-compile)
bun run sync-abi    # refreshes src/abi/NoirRankedShares.json from the forge build
```

**Secrets and keys.** The tallier's master secret is a wallet signature, never a stored
file: `cre/scripts/make-master-secret.mjs` signs `MASTER_MESSAGE` with `PRIVATE_KEY` and
prints `keccak256(signature)` — the exact value the coordinator page derives in the
browser via "Sign for tallier key", and the same value `prover prove --sign` derives from
the CLI. Feed it to the CLI's secrets store without ever putting it in a file or shell
history:

```
cd cre
export CRE_RANKED_SHARES_MASTER=$(PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs)
cre secrets create workflows/sealed/secrets.yaml --target staging-settings
```

`workflows/sealed/secrets.yaml` maps the secret id the workflow reads
(`RANKED_SHARES_MASTER`) to the environment variable that supplies its value
(`CRE_RANKED_SHARES_MASTER`); the CLI reads that variable from the shell or from `cre/.env`
(see `cre/.env.example`, which also holds `CRE_ETH_PRIVATE_KEY` for registry writes).

(`node` also works in place of `bun` if it resolves `viem` from `cre/node_modules`; bun
imports the `.ts` lib modules directly, so nothing needs building first.)

The pool's `tallierPkX`/`tallierPkY` (`script/DeployNoir.s.sol`'s `TALLIER_PK_X`/
`TALLIER_PK_Y` env vars) must be the public key for that same `(master, keySalt)` pair, so
deployment and the workflow agree on who can decrypt by construction:

```
cd cre
PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs --print-pk --key-salt 0x<32 bytes>
# -> pkX=0x… / pkY=0x…, feed straight into TALLIER_PK_X / TALLIER_PK_Y:

export KEY_SALT=0x<32 bytes>
PK=$(PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs --print-pk --key-salt $KEY_SALT)
export TALLIER_PK_X=$(printf '%s\n' "$PK" | sed -n 's/^pkX=//p')
export TALLIER_PK_Y=$(printf '%s\n' "$PK" | sed -n 's/^pkY=//p')
# then run script/DeployNoir.s.sol with those three exported
```

**Simulation.** `cre/project.yaml` and `workflows/sealed/workflow.yaml` follow the CLI's
target layout (`staging-settings`: chain `arc-testnet`, RPC `https://rpc.testnet.arc.network`,
entry point `src/main.ts`, `config.staging.json`, `secrets.yaml`). With the CRE CLI installed
(`curl -sSL https://app.chain.link/cre/install.sh | bash`) and logged in (`cre login`), run
from the project root:

```
cd cre
export CRE_RANKED_SHARES_MASTER=$(PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs)
cre workflow simulate workflows/sealed --target staging-settings --non-interactive --trigger-index 0
```

The simulator compiles `src/main.ts` itself (add `--wasm $PWD/dist/workflow.wasm` to reuse
`bun run compile`'s output), does not send transactions unless `--broadcast` is given, and
prints the TEE handler's logs for debugging only (in production they never leave the enclave).

Observed on 2026-09-05 with CRE CLI v1.32.0 and the shipped placeholder config: the settings,
the `arc-testnet` RPC and the secret load, the cron trigger is reported as requesting TEE
execution (AWS Nitro), and the handler runs until its first `callContract` read, which
returns `0x` for the zero address. A full run — the tally under QuickJS and the kind-1 report
it writes — still needs a pool deployed on Arc testnet with `DeployNoirVerifiers` +
`DeployNoir --profile test` and its address in `config.staging.json`.

## Reference implementation

`reference/` is the oracle every port is tested against, in dependency-free Python:

| Module | Defines |
|---|---|
| `pbear.py` | PB-EAR, the IPSC checker, and the transcript mode of the sealed design |
| `noir/poseidon2.py` | Poseidon2 over BN254 (t = 4), equal to Barretenberg's; vectors in `vectors/noir/poseidon2.json` |
| `noir/grumpkin.py`, `noir/sealed.py` | Grumpkin, ballot packing, ECDH ballot encryption; vectors in `vectors/noir/sealed.json` |
| `noir/commitments.py`, `noir/profiles.py` | on-chain commitments, transcript hash, circuit state and profiles |
| `noir/tools/make_fixture.py` | writes `vectors/noir/fixture_<profile>_<scenario>.json`, consumed by the Solidity, Noir and TypeScript tests |

Shared modules (`pbear.py`, `ballots.py`, `keccak.py`) sit at the root; each variant's
own code lives in its package, `noir/` or `zisk/`, and its vectors under
`vectors/<variant>/`. Run `python3 -m unittest discover reference`. The variant packages
are imported as `noir.*` / `zisk.*`, so their modules and tools run from `reference/`:

```
cd reference
python3 -m noir.tools.extract_poseidon2_params
node noir/tools/poseidon2_vectors.mjs > vectors/noir/poseidon2.json   # npm install in noir/tools first
python3 -m noir.test_sealed --write                                   # sealed-ballot vectors
```

### Fixtures

```
cd reference && python3 -m noir.tools.make_fixture --profile test|default [--out DIR]
```

Writes every scenario of that profile as `fixture_<profile>_<scenario>.json`, into
`reference/vectors/noir/` unless `--out` names another directory. The `test` profile
(`N_SEALED_MAX 8, M_MAX 4, B 2, K 2`) gets all three scenarios, the `default` profile
(`256, 16, 32, 8`) only `main`, because it takes about ten seconds:

| Scenario | Exercises |
|---|---|
| `main` | the full roster: public-only voters, sealed voters spanning several batches, one address with both kinds of weight, a replayed ciphertext that decrypts to an absent ballot, a silent seat holder and a silent direct voter |
| `smallm` | `m = mMax − 1`, so every consumer sees a pool with fewer projects than the profile allows, and a tally that ends with a terminal `NONE` step at `level ≥ m` instead of by exhaustion |
| `nosealed` | no ciphertext anywhere: `sealedCount == 0`, `numBatches == 1` and a single ingest proof over an empty batch with `hIn == hOut == 0`, over a non-empty public block |

Each file carries the profile, the scenario name, `m`, the keys, the roster, both
commitment chains and their checkpoints, `inputsRoot`, the funded order, the transcript
and its hash, and the public inputs of every ingest and tally proof. The key set is
asserted against `FIXTURE_KEYS` before writing, and `reference/noir/test_fixture.py`
regenerates all four files into a temporary directory and compares them byte for byte
with the committed ones.

### Transcript mode

`pbear.py` also runs the split tally of the sealed design, the mode the CRE enclave and
the browser prover mirror:

```
python3 reference/pbear.py --transcript '{"costs": [30, 70],
  "public": [[40, [1, 2]]], "sealed": [[60, [2, 1]]], "budget": 100}'
```

The input is one JSON object: `costs` per project, `public` and `sealed` as lists of
`[weight, ranks]` entries (`ranks` may be `null` for an abstaining entry) in the tally
order of spec B2, and `budget`, which must be at least the sum of all entry weights —
the difference is the abstaining weight. The output is one JSON object:

```
{"funded": [0, 1], "transcript": [[1, 40, 0, 0, 40],
                                  [1, 0, 0, 18446744073709551615, 0],
                                  [2, 0, 10, 1, 70]]}
```

Each step is `[level, pubSupport[0..m), best, total]`, one per executed iteration as
spec B6.3 defines it, with `best = 2^64 − 1` for a step that funded nothing and at most
`2m` steps in all. The positional form,
`python3 reference/pbear.py '{"costs": …, "voters": …}'`, is the single-list tally the
Foundry differential fuzz calls and prints an ABI-encoded `uint256[]` instead.

### zisk variant

`reference/zisk/` holds the secp256k1 + keccak scheme of the zisk (and cre) variant and
its fixtures; `python3 -m zisk.make_fixture` from `reference/` regenerates them, and
`zisk/README.md` describes the Rust side. The three sealed variants share
`src/SealedPool.sol` and differ only in how the sealed half is finalised: `cre` is
`Attested` by the DON, `noir` is `Proven` over a transcript of chained proofs, and `zisk`
is `Proven` over the whole tally in one guest program (spec:
`docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`). `zisk/README.md`
covers the `tally-prover` CLI and the `scripts/e2e-anvil.sh` end-to-end run;
`docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md` covers deploying to Arc.

## Gas and limits

- `step()` is O(voters × projects). At 100 voters and 20 projects it costs about
  2.0M gas; a full tally there is about 21M gas across 10 calls. The pool is meant
  for tens to low hundreds of voters. At most 255 projects.
- Weight is proportional to money: a large contributor can fund any project costing
  at most their deposit by ranking it first. That is the paper's model.
- NFT seats are per token, not per person.

## Deploying

```
TOKEN=0x... OWNER=0x... VOTING_DEADLINE=1760000000 \
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

The sealed pools have their own scripts — `script/DeployNoir.s.sol` (noir),
`script/DeployZisk.s.sol` and `script/DeployCre.s.sol` — documented with the variant
they deploy. Both CRE-reporting pools (`DeployNoir` and `DeployCre`) additionally take
`WORKFLOW_OWNER` and `WORKFLOW_NAME`, which authorise `onReport` against the workflow
allowed to report to that pool:

- `WORKFLOW_OWNER` is the address of the `CRE_ETH_PRIVATE_KEY` that registers the
  workflow (`cre/.env.example`).
- `WORKFLOW_NAME` is the `workflow-name` from `cre/workflows/sealed/workflow.yaml` for
  the target being deployed — `ranked-shares-sealed-staging` for `staging-settings`.
  Empty accepts any workflow name from `WORKFLOW_OWNER`.
- `ALLOW_ANY_WORKFLOW=1` is required to deploy with `WORKFLOW_OWNER` unset, which turns
  the check off. That is for `cre workflow simulate` only — its MockForwarder calls
  `onReport` with no metadata — and such a pool must never hold real funds.

## Arkiv ballot storage

The updated public, Noir, CRE and ZisK pools can store ballot payloads in Arkiv.
For a new round, the owner calls `enableArkivBallots()` in Setup before opening
voting. The web app's `/vote` page uploads and confirms votes, and calculates live
public results in the browser. Proposals remain in Swarm; no result snapshots are
stored. Existing deployed rounds retain their original storage and require a new
deployment to adopt this mode.

See [the voting guide](web/README.md#arkiv-voting) and
[the architecture decision](docs/decisions/2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md).
