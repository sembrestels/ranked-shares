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
