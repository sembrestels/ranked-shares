# Sealed ballots, zisk variant: the whole tally proven in a ZisK guest

Status: draft 2026-09-05. Supersedes `2026-09-04-sealed-seat-ballots-design.md` (the
first ZisK design, which also ran a CRE tally for a provisional result). Sibling of
`2026-09-05-sealed-ballots-noir-design.md`. Sections it inherits from the older specs
say so and are not repeated.

## Context

RankedShares now has three ways to tally a pool with sealed seat ballots. They form a
ladder of trust and the README presents them as one:

| Variant | Who decrypts and tallies | What makes the result final | Trust |
|---|---|---|---|
| **cre** | the DON's enclave | a forwarder report | DON attestation |
| **noir** | the enclave (transcript) plus the coordinator's browser | a chain of Honk proofs over the transcript | sealed half proven, public half attested |
| **zisk** | a ZisK guest on the operator's machine | one PLONK proof of the whole tally | everything proven, no DON |

This spec is the zisk variant. It is deliberately the simplest of the three: one guest
program that decrypts, runs PB-EAR over every voter and commits a hash of the result;
one contract call that verifies the proof. No transcript, no circuit state, no
Poseidon2 on-chain, no report kinds.

Decisions taken with the user on 2026-09-05:

1. **No CRE in this variant.** The TEE tally belongs to the cre and noir variants. CRE
   may still post Uniswap LP reference prices for the pool (see the Uniswap spec); that
   is not this spec's concern and the zisk pool has no forwarder.
2. **Ordinary primitives: secp256k1 ECDH and keccak-256.** Grumpkin and Poseidon2 are
   what a Noir circuit wants; an enclave and a zkVM guest are better off with
   secp256k1 and keccak, which ZisK accelerates through syscalls, viem ships in the
   browser, and Python needs forty lines for. The **cre** variant uses the same scheme,
   so cre and zisk share ballots, commitment, reference, fixtures and the browser's
   encryption module. Only noir keeps the Grumpkin scheme.
3. **Ciphertexts live in storage**, not events. Same cost as the Noir triple, and the
   prover's `fetch` becomes plain contract reads with no log scan.
4. **Variants are named by their proof mechanism**, never by a version number. Shared
   code sits at the root of each module, variant-specific code in a subdirectory named
   after the variant (`src/zisk/`, `reference/zisk/`, `test/zisk/`, `zisk/`). The
   Noir-specific files that today sit at the root of `reference/` move to
   `reference/noir/` in one mechanical commit when the Noir session is at a clean
   commit boundary; this spec does not move them.
5. **Same tally order in every variant**: the public block (addresses with a direct
   ballot, registration order) then the sealed block (addresses with a ciphertext,
   registration order), as the Noir spec's B2 defines. The same urn therefore yields
   the same funded set in cre, noir and zisk, and a test can assert it.
6. **The prover is the operator's machine**, first as a CLI, later wrapped by a
   "prove this pool" service (see the deployment decision note in Claude's memory).
   Proving cannot move to a browser or to CRE: the ZisK prover is native x86_64 with
   multi-gigabyte keys.

Unchanged from the older specs and not repeated: the product decisions of the first
ZisK spec's context, the `PoolBase` extraction and hooks (A1, now committed as
`src/PoolBase.sol`), the seat ledger (A3), the phases and `Finality` enum (A5), the
grace path `abandon` (A6.5), claims (A6.6), the Arc facts (chain id 5042002, USDC at
`0x3600…0000` with 6 decimals).

---

## Part Z: Specification

### Z1. Contracts

```
src/PBEAR.sol            unchanged; engine of RankedShares and oracle of every port
src/PoolBase.sol         unchanged; custody, projects, deposits, sponsorships, seats, claims
src/RankedShares.sol     unchanged; on-chain tally
src/SealedPool.sol       abstract, is PoolBase: everything cre and zisk share (Z2–Z5)
src/zisk/ZiskRankedShares.sol   is SealedPool: finalize(fundedOrder, publicValues, proof)
src/cre/CreRankedShares.sol     is SealedPool, IReceiver: kind 1 RESULT, kind 2 CLOSE
src/zisk/ZiskVerifier.sol, PlonkVerifier.sol, IZiskVerifier.sol
                         copied verbatim from the ZisK release that built the PLONK key
```

`SealedPool` implements every `PoolBase` hook. Constructor parameters beyond
`PoolBase`'s: `bytes tallierPk` (33 bytes, SEC1 compressed), `bytes32 keySalt`,
`uint64 minDirectVote`, `uint64 abandonGrace`. The scalars are immutable; `tallierPk`
is a public storage `bytes` written by the constructor and by nothing else. Each
concrete pool exposes `kind()`:

```
function kind() external pure returns (string memory);   // "zisk" | "cre"
```

### Z2. Voters, weights, ballots

```
address[] public voters;                          // registration order, append-only
mapping(address => uint64)  public directWeight;  // Σ contribute()
mapping(address => uint64)  public seatWeight;    // Σ perSeat of seats currently held
uint64 public totalSeatWeight;
mapping(address => bytes) internal _directBallot; // m bytes, or empty
mapping(address => bytes) internal _sealed;       // 33 + m bytes, or empty
uint256[] internal _costs;                        // each < 2^64
```

Views: `directBallotOf(addr) → bytes`, `sealedOf(addr) → bytes`, `voterCount()`,
`costs() → uint256[]`, `projectCount()`, `cost(id)`. `totalWeight` is `PoolBase`'s
budget.

Limits, all reverting at write time:

- `addProject`: `cost < 2^64` (`CostTooLarge`), `projectCount < 32`
  (`TooManyProjects`). With `m ≤ 31` a direct ballot fits one storage slot and a
  ciphertext two.
- every deposit path: `totalWeight ≤ 2^64 − 1` after the deposit (`WeightOverflow`).
  Weights are stored as `uint64` and the guest computes in `u64` with `u128`
  intermediates.

**Direct ballot.** `vote(bytes ranks)` — `inPhase(Open)`, `beforeDeadline`. Reverts
`BallotAlreadyCast` if one exists, `BelowMinimumVote` if
`directWeight[msg.sender] < minDirectVote`; a zero `directWeight` is refused the same
way regardless of `minDirectVote`, so `vote` cannot be used to enlarge the roster for
free even when the minimum itself is zero. Validation is the competition-ranking check
of `PBEAR._setBallot` (length `m`, every byte `≤ m`, no gaps), copied as a private
function since `SealedPool` does not inherit `PBEAR`. Stores the bytes, registers the
voter, emits `Voted(address indexed voter)`.

**Sealed ballot.** `voteSealed(bytes ciphertext)` — `inPhase(Open)`, `beforeDeadline`.
Requires `seatWeight[msg.sender] > 0` (`NoSeatWeight`) and
`ciphertext.length == 33 + m` (`InvalidCiphertext`). Stores the bytes, replacing any
previous value, registers the voter, emits `SealedVote(address indexed voter)`. The
contract inspects nothing else: a malformed point or an invalid ranking is the guest's
business and becomes an absent ballot there (Z4). There is no cap on sealed voters;
proving cost bounds them (Z9).

Registration: `_register(addr)` appends to `voters` on first contribution, seat grant,
direct vote or sealed vote. The seat ledger hooks are A3 with `uint64` arithmetic.

### Z3. Encryption and keys

Domain string `RankedShares/sealed/secp256k1`. Shared by the browser, the guest, the cre
enclave and the Python reference:

```
curve       secp256k1, generator G, group order n
pk          tallier public key, 33 bytes SEC1 compressed
k           fresh random scalar per vote, 1 ≤ k < n
R           k·G, 33 bytes compressed
S           k·pk
key         keccak256(DOMAIN ‖ S.x as 32 bytes big-endian ‖ voter address as 20 bytes)
pad[b]      keccak256(key ‖ uint8(b)),  b = 0, 1, …      (32-byte blocks)
c           ranks ⊕ pad[0 .. m)
ciphertext  R ‖ c        (33 + m bytes)
```

Decryption: parse `R` (prefix `0x02`/`0x03`, `x < p`, `x` lifts to a curve point),
`S = sk·R`, derive `key` with the voter's own address, unpad, validate. Any failure is
an absent ballot. Binding the key to the address makes a copied ciphertext decrypt to
garbage under another address. There is no MAC: only `msg.sender` writes their own
slot, and an undecryptable ballot only costs its owner their vote.

Tallier key: `sk = keccak256(masterSecret ‖ keySalt) mod n`, `pk = sk·G`. The master
secret is 32 bytes the operator holds (environment variable for the CLI, a file or
secret store for the service). The deploy script derives `pk` from the same inputs and
passes it to the constructor. One master secret serves every pool; `keySalt` is fresh
per pool.

### Z4. Guest (`zisk/`)

Rust workspace:

```
zisk/Cargo.toml
zisk/crates/pbear/     PB-EAR over u64 weights. No I/O, no ZisK dependency.
zisk/crates/sealed/    types (TallyInput, TallyOutput), key derivation, decryption,
                       voter chain, inputsHash, output hash, and `tally::run`.
                       Uses ziskos::zisklib for secp256k1 and keccak (syscalls on
                       the guest target, software on the host).
zisk/guest/            the program: read TallyInput, run, commit 32 bytes.
zisk/prover/           `tally-prover` CLI (Z6).
```

**Arithmetic.** `pbear` is a port of `reference/pbear.py`'s single-list tally with
`u64` weights: same voter order, same support sums, same argmax with ties broken by
lowest cost then lowest id, same cumulative rounding
`d_i = floor(cum_i · cost / total) − floor(cum_{i−1} · cost / total)` in `u128`, same
termination as `PBEAR.step()`. The Solidity engine is the definition; the Python is the
executable oracle; the Rust must match both on random instances (Z8).

**Input** (private witness, bincode via `ziskos::io::read`):

```
TallyInput  { chain_id: u64, pool: [u8; 20], sk: [u8; 32], costs: Vec<u64>,
              total_weight: u64, voters: Vec<VoterIn> }
VoterIn     { addr: [u8; 20], direct_weight: u64, seat_weight: u64,
              direct_ballot: Vec<u8>,     // m bytes or empty
              ciphertext: Vec<u8> }       // 33 + m bytes or empty
```

**Steps** (`sealed::tally::run`, shared by the guest and by `tally-prover check`):

1. `pk = sk·G`, compressed.
2. `h = 0`; for each voter in order,
   `h = keccak256(h ‖ addr ‖ uint256(direct_weight) ‖ uint256(seat_weight) ‖
   keccak256(direct_ballot) ‖ keccak256(ciphertext))`, with empty bytes hashing as
   `keccak256("")`. Then
   `inputsHash = keccak256(uint256(chain_id) ‖ pool ‖ h ‖ uint256(voters.len()) ‖
   keccak256(costs as 32-byte words) ‖ uint256(total_weight))`. This is exactly what
   `close` computes (Z5).
3. Entries, in tally order: first every voter with a non-empty `direct_ballot`, as
   `(direct_weight, ranks)`; then every voter with a non-empty `ciphertext`, as
   `(seat_weight, ranks)` if it decrypts and validates, else skipped. Skipped weight,
   direct weight of voters without a direct ballot, seat weight of voters without a
   usable ciphertext, unclaimed seats and division dust are all abstaining:
   `abstaining = total_weight − Σ entry weights`.
4. `funded_order = pbear::tally(costs, entries, abstaining)`.
5. `output_hash = keccak256(abi.encode(bytes32 inputsHash, bytes pk, uint256[]
   funded_order))` (Solidity's `abi.encode` of three arguments: two heads with offsets
   for the dynamic ones, then the tails). `ziskos::io::commit_slice(&output_hash)`.

Nothing the guest reads can make it panic on voter-chosen data: prefix, `x < p`,
lifting, the scalar product returning the identity, length and ranking checks are all
decisions, never asserts. A panic would make the pool unprovable and one voter could
stall it. The guest never checks its input against the chain and does not need to:
wrong inputs give a different `inputsHash`, a wrong key a different `pk`, and either
changes `output_hash`, which `finalize` will not accept.

Cycle budget: one secp256k1 scalar multiplication per sealed ballot (a few thousand
cycles each through the `secp256k1_add`/`secp256k1_dbl` syscalls) plus two keccaks per
voter and `O(entries × m)` per tally step. Measured in spike Z10.2.

### Z5. Closing and finalisation

**Phases.** `Setup → Open → Closing → Tally → Done` as A5: `Done` once
`finality != None`, `Tally` once `closed`, `Closing` after the deadline while open.

**`close(uint256 maxVoters)`** — `inPhase(Closing)`, anyone, repeatable. On the first
call requires `token.balanceOf(this) >= totalWeight` (`BalanceBelowTotalWeight`).
Walks `voters` from `closeCursor` for at most `maxVoters` entries, updating
`voterChain` exactly as Z4 step 2 (Solidity: `keccak256(abi.encodePacked(h, addr,
uint256(directWeight[a]), uint256(seatWeight[a]), keccak256(_directBallot[a]),
keccak256(_sealed[a])))`). When the cursor reaches the end:

```
inputsHash = keccak256(abi.encodePacked(
    block.chainid, address(this), voterChain, voters.length,
    keccak256(abi.encodePacked(_costs)), uint256(totalWeight)));
closed = true; emit Closed(inputsHash, voters.length);
```

About 15k gas per voter (three keccaks and seven cold slots); the frontend or the
prover calls it with `maxVoters` sized to Arc's block gas limit. `closeCursor` and
`voterChain` are public so a caller can see progress.

**Result validation, shared.** `_finalize(uint256[] fundedOrder, Finality f)`: every id
`< m`, no duplicates, `Σ cost ≤ totalWeight` (`InvalidResult`); sets `funded[id]`,
`fundedOrder`, `spent`, `finality = f`; emits `Finalized(f, fundedOrder)`. The
zero-length list is valid (nothing was affordable).

**`ZiskRankedShares.finalize(uint256[] fundedOrder, bytes publicValues, bytes
proofBytes)`** — `inPhase(Tally)`, anyone. Immutables: `IZiskVerifier verifier`,
`bytes32 programVK`, `bytes32 rootC`.

1. `expected = keccak256(abi.encode(inputsHash, tallierPk, fundedOrder))`, using the
   pool's own stored `inputsHash` and `tallierPk`. A proof produced over other inputs
   or another key commits a different hash and fails at step 3; nothing else needs
   comparing.
2. `publicValues` must be exactly the ZisK encoding of a guest that committed those 32
   bytes and nothing else (`PublicValuesMismatch`): length 512; for `i` in `0..8`,
   bytes `8i .. 8i+4` equal `expected[4i .. 4i+4]` and bytes `8i+4 .. 8i+8` are zero;
   bytes `64 .. 512` are zero. (ZisK packs committed bytes into 64 little-endian `u32`
   slots and the on-chain form writes each slot as a little-endian `u64`; see
   `snark_inputs_bytes` in the ZisK sources.)
3. `verifier.verifySnarkProof(programVK, rootC, publicValues, proofBytes)`; it reverts
   `InvalidProof` on a bad proof and the revert propagates. About 360k gas measured
   with ZisK v1.2.0-alpha's verifier.
4. `_finalize(fundedOrder, Finality.Proven)`.

`programVK` changes with every guest build; `rootC` with every PLONK key version; the
verifier contract is tied to the key version. A new guest means a new pool.

**`CreRankedShares`** — immutable `forwarder`, `workflowOwner`, `workflowName`;
`onReport(bytes metadata, bytes report)` only from `forwarder` (`NotForwarder`);
`supportsInterface` for `IReceiver`. Reports are `abi.encode(uint8 kind, bytes payload)`:

| kind | payload | effect |
|---|---|---|
| 1 `RESULT` | `abi.encode(bytes32 inputsHash, uint256[] fundedOrder)` | `inPhase(Tally)`, `inputsHash` must match (`InputMismatch`), `_finalize(order, Attested)` |
| 2 `CLOSE` | `abi.encode(uint256 maxVoters)` | same as public `close` |

The workflow that feeds it decrypts with the Z3 scheme and tallies in the Z4 order; it
is specified with the cre variant, not here.

**Workflow authorization.** The KeystoneForwarder is a per-chain singleton shared by
every workflow registered with it, so `msg.sender == forwarder` alone would let any
workflow owner deliver a report to a `CreRankedShares` pool. Before decoding `report`
(both kinds), `onReport` checks the forwarder's `metadata` —
`abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)`,
optionally followed by a `bytes2 reportId` — against the constructor's
`workflowOwner_`/`workflowName_`: `metadata.length >= 62` (else `BadMetadata`),
`address(bytes20(metadata[42:62])) == workflowOwner` (else `WrongWorkflow`), and, when
`workflowName != bytes10(0)`, `bytes10(metadata[32:42]) == workflowName` (else
`WrongWorkflow`). `workflowNameOf(string name)` derives `bytes10 workflowName` from a
workflow's name the way CRE does: SHA-256 the name, hex-encode, take the first 10 hex
characters, and return their ASCII bytes. If `workflowOwner_` is `address(0)` the check
is disabled — such a pool accepts a report from any workflow reaching the forwarder and
must never hold real funds; it exists only so `cre workflow simulate`'s MockForwarder,
which calls `onReport` with no metadata at all, can exercise a pool. This check binds
the report to a workflow owner (and optionally a name), not to a specific workflow
build: `workflowId` is not checked, so the owner can redeploy different workflow code
under the same name and still report; that is the trust boundary.

**Liveness.** `abandon()` — anyone, in `Closing` or `Tally`, once
`block.timestamp ≥ votingDeadline + abandonGrace` (`ResultPending` before that). Sets
`finality = Abandoned` with an empty funded set; `sweep` then returns everything.

**Claims.** `claim(projectId)` and `sweep(to)` from `PoolBase`, in `Done`.

### Z6. Prover (`zisk/prover`, binary `tally-prover`)

Runs on the operator's Linux x86_64 machine with the ZisK toolchain installed
(`~/.zisk`: STARK proving key, PLONK key, `cargo-zisk` with the wrap fix of ZisK PR
#1299 until it is released). Subcommands, each a step of one pipeline:

```
tally-prover fetch   --rpc <url> --pool <addr> --out input.bin
tally-prover check   --input input.bin [--rpc <url> --pool <addr>]
tally-prover prove   --input input.bin --elf guest.elf --out stark.bin
tally-prover wrap    --proof stark.bin --out plonk.bin
tally-prover export  --proof plonk.bin --input input.bin --out calldata.json
tally-prover submit  --rpc <url> --pool <addr> --calldata calldata.json --key <env var>
tally-prover run     all of the above with a working directory
```

- `fetch` reads `voterCount`, then per voter `directWeight`, `seatWeight`,
  `directBallotOf`, `sealedOf` (multicall where available), plus `costs`,
  `totalWeight`, `keySalt`, chain id. Master secret from `TALLIER_MASTER` (32-byte
  hex). Writes the bincode `TallyInput`.
- `check` runs `sealed::tally::run` natively and prints `inputsHash`, `pk`,
  `fundedOrder`, `outputHash`. With `--rpc` it compares `inputsHash` with the pool's
  and refuses to continue on a mismatch (the pool is not closed, or the RPC lied).
- `prove` and `wrap` shell out to `cargo-zisk prove` and `cargo-zisk wrap` as two
  processes, because on a 30 GB box the two together exhaust memory. Both are invoked
  with the environment the operator machine needs (`HWLOC_COMPONENTS=-gl`,
  `GLIBC_TUNABLES=glibc.rtld.execstack=2`, memlock unlimited), documented in
  `zisk/README.md`.
- `export` runs `cargo-zisk export-solidity-calldata` and adds `fundedOrder` from a
  native run, producing `{programVK, rootCVadcopFinal, publicValues, proofBytes,
  fundedOrder, inputsHash}`.
- `submit` sends `finalize(fundedOrder, publicValues, proofBytes)`; anyone may, so the
  key only needs gas.

`programVK` and `rootCVadcopFinal` from `export` are the constructor arguments of the
pool. `tally-prover vk --elf guest.elf` prints them without proving.

The service (`POST /prove {chainId, pool}`, `GET /jobs/{id}`) is a thin queue around
`run`, one job per pool, cached by `inputsHash`. Out of scope for the first plan.

### Z7. Reference and fixtures (`reference/zisk/`)

Pure Python, stdlib only, importing `keccak` and `pbear` from the reference root and
the ballot validation from a new `reference/ballots.py` (`validate(ranks, m)` and
`pack(ranks)`, lifted from `sealed.py`; `sealed.py` starts importing them when the Noir
files move).

```
reference/zisk/secp256k1.py   affine arithmetic, scalar mul, SEC1 compress/decompress
reference/zisk/sealed.py      derive_sk, pubkey, encrypt(pk, voter, ranks, k), decrypt
reference/zisk/commitments.py voter_chain, inputs_hash, output_hash (hand-rolled abi.encode)
reference/zisk/make_fixture.py
reference/vectors/zisk/sealed.json     encryption vectors with fixed k
reference/vectors/zisk/fixture_<scenario>.json
```

Scenarios, each a complete pool:

| Scenario | Exercises |
|---|---|
| `main` | public-only voters, sealed voters, one address with both, a ciphertext copied from another voter (decrypts to garbage, absent), a ciphertext with an off-curve `x`, a silent seat holder, a silent direct voter, a seat holder whose seat was revoked after voting (`seatWeight = 0`, entry weight zero) |
| `nosealed` | no ciphertext anywhere; the sealed block is empty |
| `nodirect` | only sealed ballots |
| `big` | 200 sealed and 2000 direct voters, 16 projects; generated on demand for cycle measurement, not committed |

Fixture fields: `scenario`, `chainId`, `pool`, `m`, `costs`, `totalWeight`,
`minDirectVote`, `master`, `keySalt`, `sk`, `pk`, `voters[]` (`addr`, `directWeight`,
`seatWeight`, `directBallot` hex or `""`, `ciphertext` hex or `""`, `directRanks`,
`sealedRanks` or `null`, `k`), `voterChain`, `inputsHash`, `funded`, `outputHash`. All
numbers as `0x`-prefixed 32-byte hex so `stdJson` reads them. The tally that produces
`funded` is `reference/pbear.py` over the Z4 entry list with the abstaining budget, the
same function the Foundry differential fuzz already calls.

`reference/zisk/test_*.py` cover: secp256k1 against known vectors (generator
multiples, a public key from a known private key), encrypt/decrypt round trip, wrong
address yields garbage, `validate`, the fixture determinism (regenerate into a
temporary directory and compare byte for byte), and that `funded` of every fixture
equals a direct `pbear` run.

### Z8. Testing

Foundry (`test/zisk/` for `SealedPool` and the zisk pool, `test/cre/` for the cre pool;
`test/noir/` already belongs to the Noir pool), with a `SealedPoolHarness` that
exposes `_finalize`:

- Ledger: `directWeight`, `seatWeight`, `totalSeatWeight`, `voters` order after
  contribute, sponsor, NFT claim and takeover; `WeightOverflow`, `CostTooLarge`,
  `TooManyProjects`.
- Ballots: direct once, `BelowMinimumVote`, validation errors; `voteSealed` length and
  seat-weight checks, replacement, both blocked after the deadline.
- Closing: the fixtures replayed through the public API (`ZiskFixtureLoader` reads a
  `reference/vectors/zisk/fixture_*.json`, deploys, deposits, votes, warps, closes);
  `voterChain` equals the fixture's; `inputsHash` equals the fixture's outer hash
  recomputed with the test's chain id and pool address; chunked `close` over 1, 2 and
  all voters gives the same result; `close` before the deadline and after `closed`
  reverts.
- `finalize` with a `MockZiskVerifier` (accept, reject, record calldata): wrong
  `fundedOrder`, malformed `publicValues` (length, non-zero padding, wrong slot),
  verifier reject, success sets `funded`, `spent`, `finality`, `Finalized`; the
  recorded `publicValues` equal the fixture's `outputHash` laid out as Z5 step 2.
- `onReport`: only the forwarder, unknown kind, wrong `inputsHash`, twice, invalid
  list, kind 2 closes.
- `abandon` before and after the grace, in `Closing` and `Tally`; claims and sweep
  under `Proven`, `Attested` and `Abandoned`.
- Fork test (manual, `--match-contract` guarded by an env var): the repo's
  `ZiskVerifier` deployed on Arc testnet accepts the fixture proof from Z10.3.

Rust (`cargo test` in `zisk/`, host target):

- `pbear` against `reference/pbear.py` on random instances (spawn `python3`, as the
  Foundry differential test does), including weights near `2^64` to exercise the
  `u128` path.
- `sealed` against `reference/vectors/zisk/sealed.json`; decryption of every fixture
  voter yields the fixture's `sealedRanks`; `voter_chain`, `inputs_hash` and
  `output_hash` match every fixture.
- `tally::run` on every fixture yields `funded` and `outputHash`.
- Guest in the ZisK emulator (`cargo-zisk run`) on `main`: committed bytes equal
  `outputHash`. Marked `#[ignore]` unless `cargo-zisk` is on the path.

Cross-variant: `reference/test_variants.py` builds one roster, encrypts it once per
scheme, and asserts the Noir fixture generator and the zisk one produce the same
`funded`. Added once the Noir files have moved to `reference/noir/`; until then a
comment in `make_fixture.py` records the intent.

End-to-end, manual, recorded for the demo: deploy `ZiskVerifier` and a pool on Arc
testnet, one sponsor with three members voting sealed, two direct voters, `close`,
`tally-prover run` on the operator machine, `Finalized(Proven, …)` on arcscan, claim.

### Z9. Gas, limits, trust

- `vote`: one slot for the ballot plus registration, about 45k the first time.
- `voteSealed`: two slots, about 66k the first time, 10k for a replacement.
- `close`: about 15k per voter (three keccaks and seven cold slots), chunked.
- `sponsor(1, [N addresses])` registers `N` zero-weight voters for one token unit; none
  of them can vote, but each still costs `close` gas and guest steps once registered.
  There is no cap on the roster today: `maxVoters` from the measured provable bound
  (Z10.2) is deferred until `big` is proven, and `abandon` is the floor if a pool
  becomes unprovable because its roster grew too large.
- `finalize`: about 360k for the verifier plus `m` `funded` writes.
- Voter count is bounded by proving cost, not gas. Spike Z10.2 fixes the documented
  limit; the expectation is that a few hundred sealed and a few thousand direct voters
  prove in well under an hour on the operator machine.
- A sponsorship with one occupied seat still tells the sponsor that this member voted
  (or not) through `SealedVote`, never how. The frontend says so.

| Party | Can | Cannot |
|---|---|---|
| Public | see direct ballots, see who voted sealed, verify the proof, recompute `inputsHash` | learn any sealed ranking or which seats abstained |
| Operator (holds the master secret) | decrypt off-chain, delay the result until `abandonGrace` | publish a result that differs from PB-EAR over the committed inputs |

The funded set itself leaks whatever a deterministic function of the ballots leaks; no
scheme here addresses that. Liveness rests on the operator; `abandon` is the floor.

### Z10. Spikes, in order

Implementation is two plans: plan A covers `reference/zisk/`, the Rust workspace, the
guest and spikes 1, 2 and 4; plan B covers the contracts, the prover CLI, spike 3 and
the end-to-end run.

1. **Public values layout.** A guest that commits 32 known bytes, proven and wrapped
   with yesterday's pipeline; confirm the 512-byte form of Z5 step 2 byte for byte in
   a Foundry test against the real verifier. Half a day, and it fixes the contract's
   decoding before anything else is written.
2. **Cycles and proving time** for `main` and `big` on the operator machine
   (`cargo-zisk run -p summary`, then a full prove and wrap of `big`). Sets the
   documented voter limit in Z9.
3. **Arc testnet verifier.** Deploy `ZiskVerifier` and call it with the spike-1 proof:
   confirms the BN254 precompiles under Arc's Reth and measures gas.
4. **`zisklib` on the host target.** Confirm `scalar_mul_secp256k1`, `lift_x_secp256k1`
   and `keccak256` compile and run natively inside `cargo test` of a plain library
   crate; if the host build of `ziskos` is too heavy for the reference tests, the
   `sealed` crate gets a `k256` fallback behind a feature.

### Z11. Files touched outside `zisk/`, `src/zisk/`, `src/cre/`, `test/zisk/`, `test/cre/`

- `src/SealedPool.sol` (shared by cre and zisk).
- `src/cre/IReceiver.sol`: the Chainlink receiver interface. Plan 2 of the Noir work
  also creates one under `src/interfaces/`; whichever lands second imports the other.
- `reference/ballots.py` (new), `reference/zisk/`, `reference/vectors/zisk/`.
- `script/DeployZisk.s.sol`, `script/DeployZiskVerifier.s.sol`.
- `README.md`: the variant table and the `zisk/` pointers.
- `.gitignore`: `.claude/`.
- Nothing under `src/lib/`, `src/interfaces/`, `test/sealed/*.t.sol` written by the
  Noir session, or the Noir reference modules.
