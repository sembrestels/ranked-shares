# Sealed seat ballots: confidential tally in CRE, ZisK proof of the result

Status: rewritten 2026-09-05. Supersedes the 2026-09-04 version, which revealed
shuffled per-seat ballots on-chain and ran the tally in the contract.

## Context

RankedShares (see `2026-09-04-pb-ear-contract-design.md`) has two kinds of voting
weight: money an address deposits itself (`contribute`) and seats an organisation
sponsors for it (`sponsor`, `sponsorNFT` + `claimSeat`). Today both share one public,
replaceable ballot per address, and PB-EAR runs on-chain.

This design splits the ballots and moves the tally off-chain for pools with sealed
votes:

- **Direct votes are public and final.** An address voting its own money casts one
  plaintext ballot and cannot change it.
- **Seat votes are sealed and replaceable.** An address voting sponsored seats submits
  an encrypted ballot, may replace it until the deadline, and is never linked to its
  ranking, not even after the tally. Nothing about it is ever revealed: not the ranking,
  not the weight, not which seats abstained.
- **The tally runs twice, off-chain, over the same committed inputs.** A Chainlink CRE
  confidential workflow decrypts and tallies inside a TEE and delivers a provisional
  result through the CRE forwarder. The operator then runs the same computation inside a
  ZisK zkVM guest and submits a PLONK proof; the contract verifies it and the result
  becomes final. The proof makes correctness cryptographic; the enclave makes the
  result fast and keeps plaintext away from DON nodes.
- **The contract commits to every input.** At the deadline it hashes all voters,
  weights, direct ballots, sealed-ballot hashes, costs and the budget into one
  `inputsHash`. Both the TEE result and the proof must carry that exact hash.

Target chain: Arc testnet (chain id 5042002), pool token USDC. The CRE forwarder on Arc
testnet is `0x76c9cf548b4179F8901cda1f8623568b58215E62`. Arc runs Reth under Malachite
consensus; it is on the CRE supported-networks list (TypeScript SDK ≥ 1.3.1).

Decisions made with the user:

- Privacy goal is **member protection**: seat ballots stay unlinkable to addresses
  permanently. Revealing shuffled entries (previous design) was dropped because the
  per-entry weight tags each entry with its sponsorship and small sponsorships leak the
  members' rankings. With the tally off-chain, only the funded set is public.
- **Both TEE and proof.** The Chainlink prize needs the confidential workflow; the user
  wants a result that does not rest on DON attestation. The two are layered: TEE result
  is provisional, the proof finalises. Claims open on proof, or on the provisional result
  after a grace period.
- **ZisK** is the zkVM (Polygon, Rust guest, PLONK wrap with a Solidity verifier in the
  repo, secp256k1 and keccak precompiles). Proving happens on the operator's machine
  because the witness contains the tallier key; the ZisK remote coordinator and any
  prover network are excluded for that reason.
- **Ciphertexts live in events**, with only their keccak hash in storage. The EVM can
  hash calldata and storage but not blob contents, so blobs cannot enter the commitment;
  full storage of the bytes costs about three times as much as the hash.
- The tallier's key is an operator-held Vault secret released only into the enclave and
  also available to the operator's prover. Stated plainly in docs: the operator can
  decrypt off-chain; the system guarantees that DON nodes never see plaintext, that
  nobody else can decrypt, and that no one, the operator included, can publish a wrong
  result once a proof is required.
- The on-chain PB-EAR engine is untouched. It remains the tally for pools without a
  tallier (`RankedShares`) and the oracle every off-chain port is tested against.
- Liveness: if neither TEE nor proof ever delivers, the pool ends with nothing funded
  after a second grace period and the owner sweeps everything.

Out of scope here (separate specs): the Arc frontend, the Uniswap LP seats. Note for
`2026-09-04-uniswap-lp-seats-design.md`: its requirement that every seat in a
sponsorship weigh the same, and its reference to the "engine refactor", both came from
the previous version of this spec and no longer apply. The seat ledger it builds on is
now section A3 below.

---

## Part A: Specification

### A1. Contracts

Three contracts replace today's two:

```
PBEAR.sol               unchanged: abstract on-chain engine
PoolBase.sol            extracted from RankedShares: token, owner, projects, deposits,
                        sponsorships, NFT seats, phases up to the deadline, claim/sweep
RankedShares.sol        is PoolBase, PBEAR: today's behaviour, tallies on-chain
SealedRankedShares.sol  is PoolBase, IReceiver: sealed votes, commitment, TEE report,
                        proof finalisation
```

`PoolBase` keeps every deposit path exactly as `RankedShares` has it today and calls
three internal hooks the two pools implement differently:

```
function _onContribution(address who, uint256 amount) internal virtual;
function _onSeatGranted(address who, uint256 perSeat) internal virtual;
function _onSeatRevoked(address who, uint256 perSeat) internal virtual;
```

`RankedShares` maps them to `_grantWeight` / `_revokeWeight`. The existing test suites
must pass unchanged after the extraction. `PoolBase` also owns `claim(projectId)` and
`sweep(to)` against an abstract `_isFunded(id)` / `_spent()` / `_isDone()` that each
pool provides.

### A2. Voter identity and weights (`SealedRankedShares`)

One record per address, created on first contribution, seat grant, or vote:

```
address[] public voters;                        // registration order, append-only
mapping(address => uint256) public directWeight; // Σ contribute()
mapping(address => uint256) public seatWeight;   // Σ perSeat of seats currently held
mapping(address => bytes)   internal _directBallot;  // length m, or empty
mapping(address => bytes32) public sealedHash;   // keccak256(latest ciphertext), or 0
uint256 public totalSeatWeight;                  // Σ seatWeight
```

`totalWeight` (in `PoolBase`, the sum of all deposits) is the budget, as today.
Abstaining weight is `totalWeight − Σ directWeight − Σ seatWeight` plus the weight of
every voter without a usable ballot; the off-chain tally computes it, the contract never
needs it.

An address with both kinds of weight is two voters in the tally: `(addr, directWeight,
directBallot)` and `(addr, seatWeight, sealedBallot)`. Neither is split per seat: the
tally never reveals anything per voter, so per-seat entries have no purpose.

### A3. Seat ledger

`_onSeatGranted(who, perSeat)`: `seatWeight[who] += perSeat`,
`totalSeatWeight += perSeat`, register voter. `_onSeatRevoked` reverses it (NFT seat
takeover). `_onContribution(who, amount)`: `directWeight[who] += amount`, register.
All frozen by `beforeDeadline`, which every deposit and claim path already carries, so
the ledger the tallier reads after the deadline is final.

### A4. Ballots

**Direct:** `vote(bytes ranks)` — `inPhase(Open)`, `beforeDeadline`. Reverts with
`BallotAlreadyCast` if a direct ballot exists. Validates with the same rules as
`PBEAR._setBallot` (length `m`, ranks ≤ `m`, competition-ranking property; a private
copy of that check lives in `SealedRankedShares` since it does not inherit `PBEAR`).
Stores it, registers the voter, emits `Voted(address)`. Allowed with zero direct weight.

**Sealed:** `voteSealed(bytes ciphertext)` — `inPhase(Open)`, `beforeDeadline`.
Requires `seatWeight[msg.sender] > 0` (`NoSeatWeight`) and
`ciphertext.length == 33 + m` (`InvalidCiphertext`). Sets
`sealedHash[msg.sender] = keccak256(ciphertext)`, replacing any previous value, and
emits `SealedVote(address indexed voter, bytes ciphertext)`. The ciphertext is not
stored. The contract never decrypts and performs no curve arithmetic.

Gas per sealed vote, 31 projects, standard schedule: about 21k the first time, about 4k
for a replacement, plus calldata.

**Encryption** (client, enclave and guest share one definition; A7 and A8 list the
implementations):

```
curve      secp256k1
pk         tallier public key, 33 bytes compressed, immutable in the pool
k          fresh random scalar per vote
R          k·G, 33 bytes compressed
S          k·pk
key        keccak256("RankedShares/sealed/v1" ‖ S.x ‖ voter address)
pad[b]     keccak256(key ‖ uint8(b)),  b = 0,1,...  (32-byte blocks)
c          ranks ⊕ pad[0..m)
ciphertext R ‖ c   (33 + m bytes)
```

Decryption: `S = sk·R`, derive `key` with the voter's address, unpad. Binding the key
to the voter address makes a copied ciphertext decrypt to garbage under another address,
so nobody can "vote like X" by copying X's bytes. There is no MAC: an undecryptable,
malformed, or invalid-ranking ballot is an absent one, and only `msg.sender` can write
their hash.

**Tallier key.** `bytes tallierPk` (33 bytes, set in the constructor, no setter) and
`bytes32 keySalt` (immutable). Both enclave and prover derive
`sk = keccak256(masterSecret ‖ keySalt) mod n` from the single operator master secret.
The deployer derives `pk` the same way at deploy time. One master secret serves every
pool.

### A5. Phases

```
Setup → Open → Closing → Tally → Done
```

`phase()`: `Done` if `finality != None`; `Tally` if `closed`; `Closing` if `votingOpen`
and `block.timestamp >= votingDeadline`; `Open` if `votingOpen`; else `Setup`.

```
enum Finality { None, Proven, Attested, Abandoned }
Finality public finality;
```

- `Proven`: a valid proof was verified (A6.4).
- `Attested`: the provisional TEE result was accepted after `proofGrace` (A6.5).
- `Abandoned`: nothing arrived before `abandonGrace` (A6.5); funded set empty.

Constructor parameters beyond `PoolBase`'s: `tallierPk`, `keySalt`, `forwarder`,
`verifier` (the deployed ZisK verifier), `programVK` (bytes32), `rootC` (bytes32, the
PLONK key root the verifier was built for), `proofGrace` (uint64 seconds),
`abandonGrace` (uint64 seconds, must exceed `proofGrace`). `verifier`, `programVK` and
`rootC` are immutable; a new guest build means a new pool.

### A6. Closing, results, finalisation

**A6.1 Commitment.** `close(uint256 maxVoters)` — `inPhase(Closing)`, anyone,
repeatable. Requires `token.balanceOf(this) >= totalWeight` on the first call (as
`startTally` does today). Walks `voters` from `closeCursor` for at most `maxVoters`
entries:

```
h = keccak256(abi.encodePacked(
        h, addr, directWeight[addr], seatWeight[addr],
        keccak256(_directBallot[addr]), sealedHash[addr]))
```

`h` starts at `bytes32(0)`. When the cursor reaches `voters.length`:

```
inputsHash = keccak256(abi.encodePacked(
        block.chainid, address(this),
        h, voters.length,
        keccak256(abi.encodePacked(costs)),   // uint256[] in id order: m words of 32 bytes
        totalWeight))
closed = true; emit Closed(inputsHash, voters.length)
```

A voter with no direct ballot contributes `keccak256("")`; a voter with no sealed vote
contributes `bytes32(0)`. Everything hashed is what the off-chain implementations
recompute from public reads and logs, so a wrong ciphertext or wrong RPC answer can only
produce a hash the contract rejects. Roughly 10k gas per voter; the workflow and the
frontend call it with `maxVoters` sized to Arc's block gas limit (spike item).

**A6.2 Reports from the DON.** The pool implements Chainlink's `IReceiver`:
`onReport(bytes metadata, bytes report)`, callable only by the immutable `forwarder`
(`NotForwarder`), plus `supportsInterface`. Reports are `abi.encode(uint8 kind, bytes
payload)`; unknown kinds revert (`UnknownReport`).

| kind | payload | effect |
|---|---|---|
| 1 `RESULT` | `abi.encode(bytes32 inputsHash, uint256[] fundedOrder)` | provisional result, below |
| 2 `CLOSE` | `abi.encode(uint256 maxVoters)` | same as public `close(maxVoters)` |

Kind 2 exists only because a CRE workflow reaches the chain solely through forwarder
reports; `close` stays public so the frontend or anyone else can call it too.

Kind 1 is accepted in `Tally` only, once (`ResultAlreadyReported`); `inputsHash` must
equal the stored one (`InputMismatch`); `fundedOrder` must be distinct valid project
ids whose costs sum to at most `totalWeight` (`InvalidResult`). Stored as
`provisional`, emits `ProvisionalResult(uint256[] fundedOrder)`. It has no effect on
claims until A6.5. Optional hardening, not required for the hackathon: check the
workflow owner from `metadata` against an immutable.

**A6.3 Proof public values.** The guest commits one ABI-encoded struct:

```
struct TallyOutput { bytes32 inputsHash; bytes tallierPk; uint256[] fundedOrder; }
```

**A6.4 `finalize(bytes publicValues, bytes proofBytes)`** — `inPhase(Tally)`, anyone.

1. Decode `TallyOutput`; require `inputsHash == stored` (`InputMismatch`) and
   `keccak256(tallierPk) == keccak256(stored tallierPk)` (`WrongTallierKey`).
2. `IZiskVerifier(verifier).verifySnarkProof(programVK, rootC, publicValues,
   proofBytes)`; a revert propagates (`InvalidProof`).
3. Validate `fundedOrder` as in A6.2, store it, set `funded[id]`, `spent`,
   `finality = Proven`, emit `Finalized(Finality.Proven, fundedOrder)`. If a
   provisional result exists and differs, also emit `ProvisionalOverridden` (the
   implementations disagree; the proof is the authority and the disagreement is a bug
   to investigate).

The ZisK verifier is the repo's `ZiskVerifier.sol` (a PLONK verifier plus a wrapper
whose entry point takes the program VK, the PLONK-key root, the public values and a
24-word proof, and hashes the first three with SHA-256 modulo the BN254 scalar field).
It is deployed once per chain by `script/DeployVerifier.s.sol` and needs the BN254
add, mul and pairing precompiles; confirming Arc testnet exposes them is a spike item.
Expected gas in the high 200k range, unmeasured.

**A6.5 Grace paths**, `inPhase(Tally)`, anyone:

- `acceptProvisional()` — requires a provisional result and
  `block.timestamp >= votingDeadline + proofGrace` (`ProofPending`). Applies it exactly
  as step 3 above with `finality = Attested`.
- `abandon()` — requires no provisional result and
  `block.timestamp >= votingDeadline + abandonGrace` (`ResultPending`). Sets
  `finality = Abandoned` with an empty funded set; `sweep` then returns everything.

A proof can still arrive before either grace elapses and always wins. `abandon` is
also accepted in `Closing` after `abandonGrace`, so a pool whose `close` never
completes still ends.

**A6.6 Claims.** `claim(projectId)` and `sweep(to)` from `PoolBase`, in `Done`.
`ClaimedTotal`, recipient payout and leftover accounting are unchanged.

### A7. CRE workflow (`cre/`)

TypeScript workflow, one per operator, configured with a chain selector and a list of
pool addresses. Trigger: cron, every few minutes. Per pool, in order:

1. Read `phase()`. Skip unless `Closing` or `Tally` without a provisional result.
2. In `Closing`: `writeReport` kind 2 with `maxVoters` sized to the block gas limit.
   One chunk per tick; the cron cadence provides the loop.
3. In `Tally`, on the DON nodes (outside the enclave): read `inputsHash`, `voters`,
   each voter's `directWeight`, `seatWeight`, `directBallotOf`, `sealedHash`, the
   `costs`, `totalWeight`, `keySalt`, and the `SealedVote` logs for the pool from its
   deployment block to the deadline block via `filterLogs` (address + topic; paginate
   the block range if a provider limits it). Pin reads and the log range to the last
   finalized block so all nodes agree. For each voter pick the log whose ciphertext
   hashes to `sealedHash`.
4. Inside the TEE handler: `sk = derive(getSecret(master), keySalt)`; decrypt and
   validate each sealed ballot (missing, wrong length, undecodable, or failing the
   competition-ranking check → absent); build the voter list of A2; recompute
   `inputsHash` exactly as A6.1 and abort if it differs from the chain's; run PB-EAR
   (`cre/src/pbear.ts`, a port of `reference/pbear.py`); leave the enclave with
   `(inputsHash, fundedOrder)` only.
5. `writeReport` kind 1 through the forwarder.

Enclave constraints: TypeScript only, deterministic logic, no logging of anything
derived from plaintext, TEE currently AWS Nitro in one region, enclaves may be shared
between workflows until per-workflow isolation ships. Chain reads and writes always run
on DON nodes, never inside the enclave, which is why step 3 sits outside step 4.

**Shared crypto module** `cre/src/sealed.ts`: `deriveKey`, `encryptBallot(pk, voter,
ranks)`, `decryptBallot(sk, voter, ciphertext)`, `validateRanks(ranks, m)`,
`inputsHash(...)`. The frontend imports the same module. Test vectors are checked in as
JSON so the Rust implementation can match them.

Evidence for submission: `cre workflow simulate` logs showing the TEE handler running,
a report written to the Arc testnet forwarder, and the `ProvisionalResult` event on
arcscan.

### A8. ZisK guest and prover (`zk/`)

Rust workspace:

```
zk/pbear/    PB-EAR library: ballots, validation, tally. No I/O. Used by guest and host.
zk/sealed/   decryption, key derivation, inputsHash. Uses k256 and tiny-keccak
             (ZisK-patched builds when compiled for the guest target).
zk/guest/    the ZisK program: reads TallyInput, commits TallyOutput.
zk/host/     `tally-prover` CLI: fetch, execute, prove, wrap, export, submit.
```

**Arithmetic.** Weights are `uint256` on-chain; the reweighting uses
`mulDiv(newCum, thr, T)` with a 512-bit intermediate. `zk/pbear` uses `ruint`
`U256`/`U512` (the ZisK-patched ruint on the guest target) with floor division, which
matches Solidity's `mulDiv` and Python's `//`. Same voter order, same tie-break, same
cumulative rounding as `PBEAR.step()`.

**Guest input** (private witness, serde/bincode via `ziskos::io::read`):

```
TallyInput { chain_id: u64, pool: [u8; 20], sk: [u8; 32], costs: Vec<U256>,
             total_weight: U256, voters: Vec<VoterIn> }
VoterIn    { addr: [u8; 20], direct_weight: U256, seat_weight: U256,
             direct_ballot: Vec<u8>,   // empty = none
             ciphertext: Vec<u8> }     // empty = none
```

**Guest steps:**

1. `pk = sk·G` compressed.
2. Recompute `inputsHash` as A6.1 from the inputs (`sealedHash` is
   `keccak256(ciphertext)` when non-empty, else zero).
3. For each voter with `seat_weight > 0` and a ciphertext: decrypt with the
   address-bound key, validate; failures are absent. Build the tally voter list: the
   direct voter if a direct ballot exists, the seat voter if the sealed ballot decrypted.
   Abstaining weight = `total_weight − Σ listed weights`.
4. Run `pbear::tally(costs, voters, abstaining)`.
5. `ziskos::io::commit_slice(abi_encode(TallyOutput { inputsHash, pk, fundedOrder }))`.

The guest never checks inputs against the chain; it does not need to. If the host feeds
wrong data the committed hash differs and `finalize` rejects the proof. If the host
feeds the wrong key the committed `pk` differs and `finalize` rejects it.

**Prover CLI** (`tally-prover`, operator's machine, Linux x86_64, locked memory
unlimited, about 32 GB RAM, GPU optional):

```
tally-prover fetch   --rpc <url> --pool <addr> --out input.bin
tally-prover check   --input input.bin            # native run, prints fundedOrder
tally-prover prove   --input input.bin --out proof.bin [--gpu]
tally-prover export  --proof proof.bin --out calldata.json
tally-prover submit  --rpc <url> --pool <addr> --calldata calldata.json --key <env>
```

`fetch` does what A7 step 3 does with any RPC and adds the master secret from an
environment variable. `check` runs `zk/pbear` natively and compares with the pool's
provisional result if one exists. `prove` uses the zisk-sdk embedded client with the
PLONK option and the STARK and PLONK proving keys installed by `ziskup` (STARK key via
the installer, PLONK key via `ziskup setup_snark`, plus one `cargo-zisk program-setup`
per guest build). `export` writes the four fields the verifier takes (`programVK`,
`rootCVadcopFinal`, `publicValues`, `proofBytes`); `submit` calls `finalize`.

`programVK` and `rootC` printed by `export` are the values passed to the pool
constructor. Any guest change changes `programVK`.

**Evidence for submission:** a `Finalized(Proven, …)` event on arcscan for a pool with
sealed votes, and the proof file.

### A9. Gas and limits

- `voteSealed`: about 21k first time, 4k replacement, plus calldata (A4).
- `close`: about 10k per voter, chunked.
- `finalize`: verifier call, expected high 200k, plus `m` `funded` writes.
- Voter count is bounded by proving cost, not gas: one secp256k1 scalar multiplication
  per sealed ballot dominates the guest. Measure with `cargo-zisk run -p summary` on a
  synthetic 200-voter input before fixing a documented limit.
- Sponsorships with one occupied seat still tell the sponsor that this member voted (or
  not) through the `SealedVote` event, never how. The frontend says so.

### A10. Trust summary (for the README)

| Party | Can | Cannot |
|---|---|---|
| Public | see direct ballots, see that a seat holder voted sealed, verify the proof, recompute `inputsHash` | learn any sealed ranking, weight split, or which seats abstained |
| Sponsor | see which members submitted a sealed ballot | see or infer their rankings beyond what the funded set implies |
| DON nodes | see ciphertexts, public inputs, and the funded set | see the key or any plaintext |
| Enclave | see everything | change inputs the contract did not commit to, or make a wrong result final once a proof arrives |
| Operator (holds master secret) | decrypt off-chain | publish a result that differs from PB-EAR over the committed inputs, once a proof is required; be stopped from decrypting (documented trust assumption) |

The result itself leaks: the funded set is a deterministic function of the ballots, and
in a small pool a sponsor may infer things from which projects won. No scheme in this
design addresses that.

Liveness: `acceptProvisional` after `proofGrace`, `abandon` after `abandonGrace`.
The README states which path a pool took (`finality`).

### A11. Testing

Solidity (Foundry):
- `PoolBase` extraction: all existing `RankedShares` and `PBEAR` suites pass unchanged.
- Ledger: `directWeight` / `seatWeight` / `totalSeatWeight` after contribute, sponsor,
  first NFT claim, takeover; `voters` order.
- Ballots: direct ballot immutable; `voteSealed` length and seat-weight checks;
  replacement updates `sealedHash`; both blocked after deadline.
- Closing: chunked `close` over 0, 1, many voters equals a single-call `close`; the
  `inputsHash` of a fixed fixture matches a checked-in value produced by the harness
  (this fixture is also consumed by the TypeScript and Rust tests).
- Receiver: only the forwarder; unknown kind; wrong `inputsHash`; twice; invalid funded
  list; no effect on claims.
- Finalisation with a `MockZiskVerifier` (accept / reject / record calldata): wrong
  hash, wrong key, verifier reject, success sets `funded`, `spent`, `finality`;
  provisional differing from proof emits `ProvisionalOverridden`; `acceptProvisional`
  before and after `proofGrace`; `abandon` before and after `abandonGrace`, with and
  without provisional; claims and sweep under each finality.
- Verifier deployment script runs against the repo's fixture proof in a fork test.

TypeScript (vitest, in `cre/`):
- Encrypt/decrypt round trip; wrong address yields absent; test vectors stable.
- `inputsHash` matches the Solidity fixture.
- `pbear.ts` against `reference/pbear.py` on random instances (spawn Python).

Rust (`zk/`):
- `zk/sealed` matches the JSON test vectors and the Solidity `inputsHash` fixture.
- `zk/pbear` against `reference/pbear.py` on random instances (spawn Python), including
  weights large enough to exercise the 512-bit intermediate.
- Guest runs in the ZisK emulator on the fixture and commits the expected output
  (CI-safe; proving itself is manual).

End-to-end (manual, recorded for the demo): deploy verifier and pool on Arc testnet,
one sponsor with three members voting sealed, one direct voter, `close`, run the
workflow in simulation and observe `ProvisionalResult`, run `tally-prover` and observe
`Finalized(Proven)`, claim.

### A12. Spikes before the implementation plan

1. Deploy `ZiskVerifier.sol` on Arc testnet and call it with the repo's fixture proof:
   confirms the BN254 precompiles and measures gas.
2. Install the ZisK toolchain and PLONK key on the operator machine; prove and wrap a
   toy guest that decrypts ten ciphertexts; record time and memory.
3. In a CRE simulation on Arc testnet: `filterLogs` over a pool's `SealedVote` logs
   with a pinned finalized block, register a TEE handler and confirm the exact
   TypeScript API for entering and leaving it, and deliver a kind-2 report.
4. Arc testnet block gas limit, to size `close` chunks.
