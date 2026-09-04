# RankedShares implementation plan

Spec: docs/superpowers/specs/2026-09-04-pb-ear-contract-design.md


Follow TDD per task: write the failing test, run it, implement, run again. Commit after
each task. `forge fmt` before each commit.

### Task 0: Scaffold

- `git init`, then `forge init --no-git --no-commitlint --force` in the project dir (or
  `forge init` into a temp dir and move `foundry.toml`, `src`, `test`, `script`,
  `lib`, `.gitignore`).
- `forge install OpenZeppelin/openzeppelin-contracts` (v5.x); add remapping
  `@openzeppelin/=lib/openzeppelin-contracts/`.
- `foundry.toml`: `solc = "0.8.28"`, `optimizer = true`, `ffi = true`,
  `fs_permissions = [{ access = "read", path = "./reference" }]`, `gas_reports =
  ["PBEAR", "RankedShares"]`.
- Copy this file's Part A to `docs/superpowers/specs/2026-09-04-pb-ear-contract-design.md`
  and Part B to `docs/superpowers/plans/2026-09-04-pb-ear-contract.md`.
- Delete Foundry's `Counter` sample. Move the PDFs into `docs/papers/`.
- Verify: `forge build` succeeds. Commit "Scaffold Foundry project and design docs".

### Task 1: Python reference + brute-force checkers

Files: `reference/pbear.py`, `reference/test_pbear.py` (unittest).

Tests to write first (encode the paper's examples as fixtures):
- Example 1: 9 voters, 4 unit-cost projects, L=3 → funded ⊇ {a, b}.
- Example 2: 30 voters `a≻b≻c≻d`, 70 voters `d≻c≻b≻a`, costs a50 b30 c30 d40, L=100
  → outcome contains d, c and one of {a, b}; check exactly what the tie-break yields.
- Examples 3, 4, 5 from the paper with expected outcomes worked by hand.
- Exhaustiveness on random instances; `is_ipsc` accepts `pbear` outputs on random
  small instances with `budget == totalWeight`; `is_ipsc` rejects a hand-built violating
  outcome.
- Cumulative rounding: Σ deductions == threshold on random inputs.
- CLI round-trip: ABI encoding of `[]`, `[3]`, `[1,0,2]` matches known hex.

Verify: `python3 -m unittest discover reference`. Commit.

### Task 2: `PBEAR` engine — ballots and weights

Files: `src/PBEAR.sol`, `test/PBEARHarness.sol` (exposes internals), `test/PBEAR.t.sol`.

Tests first: `_addProject` ids and zero-cost revert; `_setBallot` validation cases
(wrong length, rank > m, `[1,3,3]` invalid, `[1,2,2,4]` valid, all zeros valid,
`[2,2,1]` valid); `_defaultRank`; `effectiveRank`; `_increaseTotalWeight` /
`_grantWeight` / `_revokeWeight` bookkeeping, including the `Σ weight ≤ totalWeight`
invariant revert; `_startTally` sets `budget == totalWeight`; all mutators revert after
`_startTally`.

Implement storage, internal API, views. Commit.

### Task 3: `PBEAR` engine — `step()`

Tests first (same harness):
- Example 1 through 5 fixtures reproduce the Python reference's outputs.
- Tie-break: equal support → lower cost wins; equal support and cost → lower id.
- Reweighting exactness: after funding, `Σ weight before − Σ weight after == threshold`.
- Rank advance when nothing eligible; `RankAdvanced` event.
- Termination: nothing affordable at start → `tallyDone` immediately; `run(maxSteps)`
  stops early and resumes; `step()` reverts after done.
- Abstaining weight: a voter with weight but no ballot, and ungranted `totalWeight`,
  contribute no support; the tally ends at `rankLevel == m` with an affordable but
  unsupported project left unfunded, `tallyDone == true`, `isExhausted() == false`.
- Invariant after every step: `Σ _weight over voters + abstaining == budget - spent`.

Implement `step`, `run`, `_isExhausted`, events. Commit.

### Task 4: Differential fuzz against the reference (`test/PBEARDifferential.t.sol`)

- Fuzz test: random `n ∈ [1,7]`, `m ∈ [1,5]`, costs `∈ [1,10]`, weights `∈ [1,10]`,
  random valid ballots (generate a random permutation then randomly merge adjacent
  ranks into ties, randomly truncate to leave unranked). Two regimes:
  (a) every voter has a ballot and no abstaining weight; (b) some voters have no ballot
  and/or extra abstaining weight `∈ [0, totalWeight]`.
- Assert on-chain `fundedOrder == pbear(...)` via `vm.ffi` in both regimes.
- Assert `is_ipsc` in both regimes and `is_exhaustive` in regime (a), by having the CLI
  return `[ipsc, exhaustive, ...funded]`.
- Run with `FOUNDRY_FUZZ_RUNS=500` locally. Commit.

### Task 5: `RankedShares` pool — deposits, sponsorships, ballots

Files: `src/RankedShares.sol`, `test/mocks/MockERC20.sol`, `test/mocks/MockERC721.sol`
(one enumerable, one not), `test/RankedShares.t.sol`.

Tests first: phase gating for every function; `contribute` moves tokens and weight;
`sponsor(list)` splits equally with dust left in budget; `sponsorNFT` with explicit
seats, with `seats = 0` on an enumerable NFT, and `SeatsUnknown` on a plain ERC721;
`claimSeat` ownership check, `NoSeatsLeft`, `AlreadyHeld`, and transfer-then-reclaim
moving weight from old to new holder; `vote` allowed at zero weight and later weight
counted in `totalWeight`; deadline enforcement.

Implement. Commit.

### Task 6: `RankedShares` pool — tally, payouts, sweep

Tests first: `startTally` before deadline reverts; `budget` equals pool balance
including direct transfers; end-to-end round (contribute + sponsor + vote → `run` →
`claim` → `sweep`) with balances asserted; double-claim revert; `claim` before done
reverts; `sweep` leaves exactly unclaimed funded costs; non-owner sweep reverts.

Implement. Commit.

### Task 7: Gas snapshot, README, script

- `test/Gas.t.sol`: n = 100 voters, m = 20 projects, assert one `step()` under 3M gas
  and record `forge snapshot`.
- `script/Deploy.s.sol` taking token, owner, deadline from env.
- `README.md`: what it implements, ballot encoding, lifecycle, limits (A7), how to run
  tests (`forge test`, `python3 -m unittest discover reference`).
- Commit.

### Verification (end to end)

```
forge build
python3 -m unittest discover reference
forge test -vv                      # includes ffi differential fuzz
FOUNDRY_FUZZ_RUNS=500 forge test --match-contract Differential
forge snapshot --check              # gas
```

Manual: on `anvil`, deploy with the script, run a round with a MockERC20 and three
projects via `cast`, confirm `claim` payouts and `sweep`.
