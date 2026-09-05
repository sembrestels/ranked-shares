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
| Setup | owner | `addProject(cost, recipient)`, `openVoting()` |
| Open (until `votingDeadline`) | anyone | `contribute(amount)`, `sponsor(amount, members)`, `sponsorNFT(amount, nft, seats)`, `claimSeat(id, tokenId)`, `vote(ranks)` |
| Tally | anyone | `startTally()` once the deadline has passed, then `step()` or `run(maxSteps)` until `tallyDone()` |
| Done | anyone / owner | `claim(projectId)` pays the recipient; owner `sweep(to)` withdraws the leftover |

There are no withdrawals of deposits. Fee-on-transfer and rebasing tokens are not
supported: `startTally` reverts if the pool's balance is below `totalWeight`.

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
reference/pbear.py      Python reference implementation + brute-force IPSC checker
reference/zisk/         secp256k1, sealed ballots, commitments and fixtures of the zisk variant
zisk/                   Rust workspace: PB-EAR, sealed-ballot guest logic, the ZisK guest
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

`SealedRankedShares` is the pool of `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md`:
direct ballots are public and final, seat holders vote with sealed ballots, the tally runs
off-chain and is finalised by a chain of proofs.

| Phase | Who | Calls |
|---|---|---|
| Setup | owner | `addProject`, `openVoting` |
| Open | anyone | deposits as above, `vote(ranks)` (needs `minDirectVote` of own contributed weight, one ballot, final), `voteSealed(rx, ry, c)` (needs `minSealedVote` of seat weight, replaceable) |
| Closing (deadline passed) | anyone / DON | `close(maxVoters)` until `closed`; the CRE workflow may drive it with a kind-2 report |
| Tally | DON, coordinator, anyone | `onReport` (kind 1: result + transcript), `advance(proof, publicInputs, restart)` for each ingest batch then each tally group — permissionless, except that `restart = true` rewinds the tally chain to the state the ingest chain ended at and only `coordinator` may ask for it; `acceptProvisional` after `proofGrace` since the report, `abandon` after `abandonGrace` since the deadline |
| Done | anyone / owner | `claim`, `sweep`; `finality()` says which path ended the pool |

`Proven` means the sealed half was proven against the committed ciphertexts and the
public half was attested by the DON and can be replayed by anyone from chain data
(`python3 reference/pbear.py --transcript …` and, later, `prover/cli audit`).

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

Deploy with `script/DeploySealed.s.sol`:

```
TOKEN=0x... OWNER=0x... VOTING_DEADLINE=<unix> FORWARDER=0x... COORDINATOR=0x... \
TALLIER_PK_X=<uint> TALLIER_PK_Y=<uint> KEY_SALT=0x<32 bytes> \
PROFILE=test|default MIN_DIRECT_VOTE=10000000 MIN_SEALED_VOTE=10000000 \
PROOF_GRACE=86400 ABANDON_GRACE=604800 \
[POSEIDON=0x...] [INGEST_VERIFIER=0x...] [TALLY_VERIFIER=0x...] \
forge script script/DeploySealed.s.sol --rpc-url $RPC_URL --broadcast
```

`PROFILE` sets `nSealedMax`, `mMax` and `batch` together (`test` is 8 / 4 / 2, `default`
256 / 16 / 32); the verifiers are compiled for one profile, so the three are never chosen
independently, and `profileId()` — `keccak256(abi.encode(nSealedMax, mMax, batch))` — lets
a client refuse a pool its proving keys were not built for. The
Poseidon2 hasher (`src/lib/Poseidon2.sol`) is generated from the reference constants by
`python3 reference/tools/gen_poseidon2_sol.py`; the Honk verifiers come from the Noir
circuits (`noir/README.md`) and are deployed once per chain with
`script/DeployVerifiers.s.sol`.

Gas on the default fixture (70 voters, 65 sealed, 16 projects):

| Call | Gas |
|---|---|
| `close(1000)`, full closing pass (total / per sealed voter) | 8,266,073 / 127,170 |
| `onReport` (kind 1, 23 transcript steps) | 8,975,324 |
| `voteSealed` (first / replacement) | 75,475 / 4,443 |

See `forge test --match-contract SealedGasTest -vv`.

`advance` with real proofs (test profile, `RealProofsTest`, generated Honk verifiers and
`bb`-made proofs from the fixtures) costs about 686k–930k gas per call, one ingest or
tally group per proof. See `forge test --match-path "test/verifiers/RealProofs.t.sol" -vv`.

## Prover CLI

`prover/src/cli/index.ts` (`cd prover && npx tsx src/cli/index.ts …`, or `npm run cli --`)
drives a sealed pool from the TypeScript prover of `prover/src/core/`:

```
prover audit --rpc <url> --pool <addr> [--from-block n]
prover status --rpc <url> --pool <addr> [--from-block n]
prover prove --rpc <url> --pool <addr> --private-key <hex> ($RANKED_SHARES_MASTER | --sign | --master <hex>) [--threads n]
prover serve --rpc <url> [--port 8787] [--private-key 0x…] ($RANKED_SHARES_MASTER | --sign | --master 0x…) [--submit] [--threads n] [--job-timeout 1800]
```

`audit` replays the reported transcript against the public block read from chain and
exits non-zero if it does not reproduce it — the same check anyone can run without the
tallier key. `status` prints phase, ingest progress and the current `stateCommit`.
`prove` derives the tallier secret from a master secret and the pool's `keySalt`, resumes
the proof chain from wherever it stands, and submits `advance` for each remaining ingest
batch and tally group as `--private-key` (it exits 1 with "pool not closed yet" if the
pool has no `inputsRoot` yet, since ingest needs the checkpoints `close()` writes).

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
logging each proof and `advance` transaction). Refresh and Audit work
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

Manual walkthrough against the e2e fixture's anvil chain (there is no
wallet-equipped browser in this environment, so this has not been run here —
only `npm run build` and a header check via `curl` against `npm run preview`
were verified):

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
5. Sign for tallier key → sign the `MASTER_MESSAGE` prompt.
6. Refresh status → confirm phase/ingestCursor/coordinator look right and
   `youAreCoordinator` is `true`.
7. Audit → confirms the public block reproduces the reported transcript.
8. Prove and submit → proves and submits each remaining ingest batch and tally
   group, logging gas used per `advance`, ending in `Proven`.

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
must then be the pool's coordinator, for restarts). A job that overruns `--job-timeout`
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
bun test           # unit + differential tests: Poseidon2 vs reference/vectors/poseidon2.json,
                    # Grumpkin/sealed vectors, pbearTranscript vs reference/pbear.py --transcript,
                    # and the tampered-transcript audit checks
bunx tsc --noEmit
bun run compile     # compiles src/main.ts to dist/workflow.wasm with Javy (cre-compile)
bun run sync-abi    # refreshes src/abi/SealedRankedShares.json from the forge build
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

The pool's `tallierPkX`/`tallierPkY` (`script/DeploySealed.s.sol`'s `TALLIER_PK_X`/
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
# then run script/DeploySealed.s.sol with those three exported
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
it writes — still needs a pool deployed on Arc testnet with `DeployVerifiers` +
`DeploySealed --profile test` and its address in `config.staging.json`.

## Reference implementation

`reference/` is the oracle every port is tested against, in dependency-free Python:

| Module | Defines |
|---|---|
| `pbear.py` | PB-EAR, the IPSC checker, and the transcript mode of the sealed design |
| `poseidon2.py` | Poseidon2 over BN254 (t = 4), equal to Barretenberg's; vectors in `vectors/poseidon2.json` |
| `grumpkin.py`, `sealed.py` | Grumpkin, ballot packing, ECDH ballot encryption; vectors in `vectors/sealed.json` |
| `commitments.py`, `profiles.py` | on-chain commitments, transcript hash, circuit state and profiles |
| `tools/make_fixture.py` | writes `vectors/fixture_<profile>_<scenario>.json`, consumed by the Solidity, Noir and TypeScript tests |

Run `python3 -m unittest discover reference`. Regenerate Poseidon2 constants and vectors with
`python3 reference/tools/extract_poseidon2_params.py` and
`node reference/tools/poseidon2_vectors.mjs > reference/vectors/poseidon2.json`
(needs `npm install` in `reference/tools`). Regenerate the sealed-ballot vectors with
`python3 test_sealed.py --write` from `reference/`.

### Fixtures

```
python3 reference/tools/make_fixture.py --profile test|default [--out DIR]
```

Writes every scenario of that profile as `fixture_<profile>_<scenario>.json`, into
`reference/vectors/` unless `--out` names another directory. The `test` profile
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
asserted against `FIXTURE_KEYS` before writing, and `reference/test_fixture.py`
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
`zisk/README.md` describes the Rust side. Spec:
`docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`.

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
