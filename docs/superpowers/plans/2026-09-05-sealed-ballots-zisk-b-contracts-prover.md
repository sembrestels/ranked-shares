# Sealed ballots, zisk variant, plan B of 2: contracts, prover CLI, Arc probe, end to end

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The on-chain side of the zisk variant (`SealedPool`, `ZiskRankedShares`, `CreRankedShares`, the ZisK verifier contracts, deploy scripts), a `tally-prover` CLI that takes a closed pool to a `Finalized(Proven)` transaction, proof that Arc testnet's EVM verifies our PLONK proofs, and an end-to-end run on a local anvil that replays the `main` fixture, proves it with the committed proof and finalises through the real verifier.

**Architecture:** `SealedPool` is an abstract pool on `PoolBase` holding everything cre and zisk share: ledger, public and sealed ballots stored as `bytes`, a keccak voter chain closed into `inputsHash`, `abandon`, and `_finalize`. `ZiskRankedShares` adds `finalize(fundedOrder, publicValues, proof)` against the ZisK verifier; `CreRankedShares` adds the Chainlink receiver. The fixture pool address becomes the address anvil's first account gets at nonce 3, so one committed proof serves the Foundry tests (`deployCodeTo` at that address) and the anvil end-to-end (natural `CREATE`). The prover CLI is a Rust binary in the existing `zisk/` workspace: alloy for RPC, the `sealed` crate for the native tally, `cargo-zisk` shelled out for prove, wrap and export.

**Tech Stack:** Solidity 0.8.28 / Foundry 1.5 (forge-std 1.16 `deployCodeTo`, `stdJson`), Python 3.14 stdlib, Rust stable with `alloy 2.4` (`features = ["full"]`), `clap 4`, `tokio 1`, `eyre`, ZisK v1.2.0-alpha (`~/.zisk/bin/cargo-zisk`, the PR #1299 build), `anvil`/`cast`.

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`, sections Z1, Z2, Z5, Z6, Z8 (Foundry bullets), Z9, Z10.3, Z11. Plan A (`2026-09-05-sealed-ballots-zisk-a-reference-guest.md`) built what this plan consumes: `reference/zisk/`, the fixtures, the `sealed` crate, the guest ELF, `zisk/fixtures/main-calldata.json`.

## Global Constraints

- Solidity `0.8.28`, optimizer on, 200 runs (`foundry.toml` as is). `forge fmt` before every commit. `forge test` must stay green (151 tests before this plan, 15 s). `python3 -m unittest discover reference` (93 tests) and `cd zisk && cargo test` (17 + 1 ignored) too.
- Nothing under `src/SealedRankedShares.sol`, `src/lib/`, `src/interfaces/IHonkVerifier.sol`, `src/interfaces/IPoseidon2.sol`, `test/sealed/`, `script/DeploySealed.s.sol` or the Noir reference modules is modified. `src/interfaces/IReceiver.sol` (already on master) is reused, not recreated. `PBEAR.sol`, `PoolBase.sol`, `RankedShares.sol` are not modified.
- Byte layouts, verbatim from the spec: voter chain `h = keccak256(abi.encodePacked(h, addr, uint256(directWeight), uint256(seatWeight), keccak256(directBallot), keccak256(ciphertext)))` from `bytes32(0)`; `inputsHash = keccak256(abi.encodePacked(block.chainid, address(this), voterChain, voters.length, keccak256(abi.encodePacked(_costs)), uint256(totalWeight)))`; output hash `keccak256(abi.encode(bytes32 inputsHash, bytes tallierPk, uint256[] fundedOrder))`; on-chain `publicValues` is 512 bytes with `publicValues[8i .. 8i+4] == hash[4i .. 4i+4]` for `i < 8` and every other byte zero.
- Limits: `cost` in `(0, 2^64)`, `projectCount ≤ 31`, `totalWeight ≤ 2^64 − 1` after every deposit, `abandonGrace` in `(0, 365 days]`, `tallierPk` 33 bytes with prefix `0x02` or `0x03`. Weights are stored as `uint256` capped at `2^64 − 1` (the spec's `uint64` on the wire is the same 32-byte word once hashed).
- Tally order and abstaining as spec Z4 step 3; `_finalize` validates `fundedOrder` (distinct ids `< m`, `Σ cost ≤ totalWeight`), sets `funded`, `spent`, `finality`, emits `Finalized`.
- Fixture pool address is `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` (anvil account 0 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, nonce 3: token, nft, verifier, pool); fixture chain id 31337 (Foundry's and anvil's default).
- ZisK on this machine: `~/.zisk/bin/cargo-zisk` and `cargo-zisk-dev` (rebuilt with the PR #1299 fix), `~/.zisk/provingKey`, `~/.zisk/provingKeySnark`, env `HWLOC_COMPONENTS=-gl` and `GLIBC_TUNABLES=glibc.rtld.execstack=2`, `prove` and `wrap` as separate processes; guest ELF `zisk/target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest` (rebuild with `cd zisk && ~/.zisk/bin/cargo-zisk build --release -p tally-guest` if missing).
- `zisk/fixtures/main-calldata.json` carries `programVK 0x7d0bd8b8…`, `rootCVadcopFinal 0x564c2b1bcbd5932c81cfad1fa786a98372eb3d6495257c2d944544334f84382f`, `publicValues` (512 B), `proofBytes` (768 B); Task 2 regenerates it for the new fixture pool address.
- Anything that needs an external account (Arc testnet funds) is documented in the runbook, never blocking: the Arc precompile check uses `cast call --create`, which needs no funds.
- No attribution lines in commit messages. Commit after every task.

## File structure

```
reference/zisk/make_fixture.py             pool address, nftTakeover (Task 1)
reference/zisk/test_fixture.py
reference/vectors/zisk/fixture_*.json      regenerated (Task 1)
zisk/fixtures/main-calldata.json           re-proven (Task 2)
src/zisk/IZiskVerifier.sol, PlonkVerifier.sol, ZiskVerifier.sol   copied verbatim (Task 3)
src/SealedPool.sol                         abstract shared pool (Task 4)
src/zisk/ZiskRankedShares.sol              (Task 5)
src/cre/CreRankedShares.sol                (Task 6)
test/mocks/MockZiskVerifier.sol            (Task 5)
test/zisk/ZiskFixtureLoader.sol            fixture replay at the fixture address (Task 4)
test/zisk/SealedPoolHarness.sol            concrete SealedPool for base tests (Task 4)
test/zisk/SealedPoolLedger.t.sol, SealedPoolBallots.t.sol, SealedPoolClose.t.sol,
test/zisk/SealedPoolEnd.t.sol              (Task 4)
test/zisk/ZiskVerifier.t.sol               real verifier + committed calldata (Task 3)
test/zisk/ZiskFinalize.t.sol               mock and real finalisation (Task 5)
test/cre/CreReport.t.sol                   (Task 6)
script/DeployZiskVerifier.s.sol, DeployZisk.s.sol, DeployCre.s.sol   (Task 7)
script/E2EAnvil.s.sol                      (Task 11)
zisk/crates/sealed/src/keys.rs             derive_sk (Task 8)
zisk/prover/                               tally-prover crate (Tasks 8, 9)
zisk/scripts/arc-probe.sh, script/ArcProbe.s.sol, src/zisk/VerifierProbe.sol   (Task 10)
zisk/scripts/e2e-anvil.sh                  (Task 11)
docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md   (Task 10)
foundry.toml                               fs_permissions for zisk/fixtures and zisk/proofs (Task 3)
README.md, zisk/README.md                  (Task 12)
```

---

### Task 1: Make the fixture replayable on chain and give it the anvil pool address

**Files:**
- Modify: `reference/zisk/make_fixture.py`, `reference/zisk/test_fixture.py`
- Regenerate: `reference/vectors/zisk/fixture_main.json`, `fixture_nosealed.json`, `fixture_nodirect.json`

**Interfaces:**
- Produces: fixture key `nftTakeover` (after `minDirectVote`, before `master`): `null`, or `{"from": addr, "to": addr, "sponsorshipAmount": hex32, "tokenId": 1}` meaning voter `from` held one NFT seat of `sponsorshipAmount` (a `sponsorNFT(sponsorshipAmount, nft, 1)` sponsorship), cast its sealed ballot, and then `to` (already registered through a list sponsorship of `seatWeight − sponsorshipAmount`) took the seat over with `claimSeat`, so `from` ends with `seatWeight = 0` and `to` with its recorded `seatWeight`. `POOL` becomes `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`. Every other key and format stays as plan A's Task 5 defined.
- Consumed by: Tasks 2, 4, 5, 11 (the Foundry loader and the anvil script replay the takeover exactly this way).

- [ ] **Step 1: Update the tests first**

In `reference/zisk/test_fixture.py`:

```python
    def test_pool_is_anvil_nonce_3(self):
        for scenario in COMMITTED:
            self.assertEqual(load(scenario)["pool"], "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9")

    def test_main_takeover_is_replayable(self):
        fx = load("main")
        t = fx["nftTakeover"]
        by_addr = {v["addr"]: v for v in fx["voters"]}
        frm, to = by_addr[t["from"]], by_addr[t["to"]]
        self.assertEqual(int(frm["seatWeight"], 16), 0)
        self.assertTrue(frm["ciphertext"])
        self.assertGreater(int(to["seatWeight"], 16), int(t["sponsorshipAmount"], 16))
        self.assertEqual(t["tokenId"], 1)
        order = [v["addr"] for v in fx["voters"]]
        self.assertLess(order.index(t["from"]), order.index(t["to"]))
        self.assertIsNone(load("nosealed")["nftTakeover"])
        self.assertIsNone(load("nodirect")["nftTakeover"])
```

Also, in `test_main_exercises_every_case`, keep the existing assertions (the revoked seat is still a voter with a ciphertext and zero seat weight).

Run: `cd reference && python3 -m unittest zisk.test_fixture -v`
Expected: the two new tests FAIL (`KeyError: 'nftTakeover'`, pool mismatch).

- [ ] **Step 2: Change the generator**

In `reference/zisk/make_fixture.py`:

```python
# anvil's first account (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) deploys the mock
# token at nonce 0, the mock NFT at nonce 1, the ZisK verifier at nonce 2 and the pool at
# nonce 3, so the committed proof of this fixture verifies both in the Foundry tests
# (`deployCodeTo` at this address) and on a fresh anvil (scripts/e2e-anvil.sh).
POOL = 0xCF7ED3ACCA5A467E9E704C703E8D87F634FB0FC9
```

replacing the keccak-derived `POOL`. Add `"nftTakeover"` to `FIXTURE_KEYS` right after `"minDirectVote"`. In `_roster("main")`, change the last three lines to:

```python
        # silent seat holder, silent direct voter below the minimum
        r.add(base + 0x505, seat=30 * USDC)
        r.add(base + 0x506, direct=5 * USDC)
        # a revoked NFT seat that still carries a ballot: 0x507 claimed the one-seat NFT
        # sponsorship (30 USDC), voted sealed, and 0x508 took the seat over afterwards, so
        # 0x508 holds its own 30 USDC list seat plus the 30 USDC NFT seat.
        r.add(base + 0x507, seat=0, sealed_ranks=ballot(m, rot(0), kept=1), k_label="revoked")
```

and move the `0x508` line so it comes right after `0x507`, with `seat=60 * USDC`:

```python
        r.add(base + 0x508, seat=60 * USDC, sealed_ranks=[m] * m, k_label="invalid")  # decrypts to an invalid ranking
```

(so the registration order ends `…, 0x505, 0x506, 0x507, 0x508`). `_roster` returns a fifth value, the takeover record, `None` except for `main`:

```python
    takeover = None
    if scenario == "main":
        takeover = {"from": addr_hex(base + 0x507), "to": addr_hex(base + 0x508),
                    "sponsorshipAmount": hx(30 * USDC), "tokenId": 1}
    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in r.voters) + dust
    return m, costs, r, total_weight, takeover
```

and `build` unpacks it and emits `"nftTakeover": takeover,` right after `"minDirectVote"`.

- [ ] **Step 3: Regenerate and run every suite**

```bash
cd reference && python3 -m zisk.make_fixture && cd .. && python3 -m unittest discover reference && (cd zisk && cargo test)
```
Expected: all green. `fixture_main.json` must still have `funded == [1, 2, 0]` (the extra 30 USDC of seat weight sits on an absent ballot, so only the abstaining weight grows); if it changed, stop and report the new value instead of editing the test. The Rust fixture tests pass unchanged because `sealed::fixture::input_of` ignores unknown keys, and the `outputHash` changed with the pool address, which they recompute.

- [ ] **Step 4: Commit**

```bash
git add reference/zisk reference/vectors/zisk
git commit -m "Give the zisk fixtures the anvil pool address and a replayable seat takeover"
```

---

### Task 2: Re-prove `main` for the new fixture

**Files:**
- Modify: `zisk/fixtures/main-calldata.json`, `zisk/README.md` (Proof subsection: the new `outputHash`; times if they differ by more than a minute)

The committed proof was made over the old pool address, so its `publicValues` no longer match `fixture_main.json`. This task takes about thirty minutes of machine time and most of its memory; run nothing else heavy meanwhile. Commands are those of plan A's Task 12; the checker and the pipeline already exist.

- [ ] **Step 1: Fresh input and native check**

```bash
cd zisk && mkdir -p proofs
cargo run -q -p sealed --bin fixture-input -- ../reference/vectors/zisk/fixture_main.json proofs/main.bin | tee proofs/main.native.txt
```
Expected: exit 0 and an `outputHash` line equal to `fixture_main.json`'s `outputHash`.

- [ ] **Step 2: Prove, wrap, export, check** (background the two long processes, redirect to `proofs/*.log`, wait for exit; never kill a running prove)

```bash
export HWLOC_COMPONENTS=-gl GLIBC_TUNABLES=glibc.rtld.execstack=2
ELF=target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest
~/.zisk/bin/cargo-zisk prove -e $ELF -i proofs/main.bin -k ~/.zisk/provingKey -o proofs/main-stark.bin -y > proofs/prove.log 2>&1
~/.zisk/bin/cargo-zisk wrap -p proofs/main-stark.bin -k ~/.zisk/provingKey -w ~/.zisk/provingKeySnark --plonk -o proofs/main-plonk.bin > proofs/wrap.log 2>&1
~/.zisk/bin/cargo-zisk-dev export-solidity-calldata -p proofs/main-plonk.bin -o fixtures/main-calldata.json
python3 scripts/check_publics.py fixtures/main-calldata.json $(awk '/^outputHash/ {print $2}' proofs/main.native.txt)
```
Expected: `publicValues layout OK`, `programVK` unchanged from the README (same guest ELF), `rootCVadcopFinal` unchanged. Record the wall times.

- [ ] **Step 3: Update the README's Proof subsection and commit**

Replace the old `outputHash` in `zisk/README.md` with the new one and, if the times moved by more than a minute, the times. Then:

```bash
git add zisk/fixtures/main-calldata.json zisk/README.md
git commit -m "Re-prove the main fixture at the anvil pool address"
```

---

### Task 3: The ZisK verifier contracts and a test of the committed proof

**Files:**
- Create: `src/zisk/IZiskVerifier.sol`, `src/zisk/PlonkVerifier.sol`, `src/zisk/ZiskVerifier.sol` (byte-for-byte copies of `~/.zisk/provingKeySnark/final/*.sol`, AGPL-3.0 headers kept), `test/zisk/ZiskVerifier.t.sol`
- Modify: `foundry.toml` (`fs_permissions`)

**Interfaces:**
- Produces: `IZiskVerifier.verifySnarkProof(bytes32 programVK, bytes32 rootCVadcopFinal, bytes calldata publicValues, bytes calldata proofBytes) external view` (reverts `InvalidProof()` on a bad proof), `ZiskVerifier.getRootCVadcopFinal() external pure returns (bytes32)`, `ZiskVerifier.VERSION()`. Test helper pattern for reading `zisk/fixtures/main-calldata.json` with `stdJson` (`readBytes32(".programVK")`, `readBytes(".publicValues")`, …).

- [ ] **Step 1: Copy the contracts and open the fixtures directory to tests**

```bash
mkdir -p src/zisk && cp ~/.zisk/provingKeySnark/final/IZiskVerifier.sol ~/.zisk/provingKeySnark/final/PlonkVerifier.sol ~/.zisk/provingKeySnark/final/ZiskVerifier.sol src/zisk/
```

In `foundry.toml` change the permissions line to:

```toml
fs_permissions = [
    { access = "read", path = "./reference" },
    { access = "read", path = "./zisk/fixtures" },
    { access = "read-write", path = "./zisk/proofs" },
]
```

- [ ] **Step 2: Write the test**

```solidity
// test/zisk/ZiskVerifier.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ZiskVerifier} from "../../src/zisk/ZiskVerifier.sol";

/// @dev The verifier shipped with the ZisK PLONK key, against the proof of the main
///      fixture that plan A produced. This is the whole chain of trust plan B builds on:
///      if this test passes, `finalize` can only be a matter of matching bytes.
contract ZiskVerifierTest is Test {
    using stdJson for string;

    ZiskVerifier internal verifier;
    string internal json;

    function setUp() public {
        verifier = new ZiskVerifier();
        json = vm.readFile("zisk/fixtures/main-calldata.json");
    }

    function test_rootMatchesTheKey() public view {
        assertEq(verifier.getRootCVadcopFinal(), json.readBytes32(".rootCVadcopFinal"));
        assertEq(keccak256(bytes(verifier.VERSION())), keccak256("v1.2.0-alpha"));
    }

    function test_acceptsTheCommittedProof() public view {
        uint256 before = gasleft();
        verifier.verifySnarkProof(
            json.readBytes32(".programVK"),
            json.readBytes32(".rootCVadcopFinal"),
            json.readBytes(".publicValues"),
            json.readBytes(".proofBytes")
        );
        uint256 used = before - gasleft();
        assertLt(used, 500_000, "verifySnarkProof gas");
    }

    function test_rejectsATamperedPublicValue() public {
        bytes memory pv = json.readBytes(".publicValues");
        pv[0] = bytes1(uint8(pv[0]) ^ 0x01);
        vm.expectRevert(ZiskVerifier.InvalidProof.selector);
        verifier.verifySnarkProof(
            json.readBytes32(".programVK"), json.readBytes32(".rootCVadcopFinal"), pv, json.readBytes(".proofBytes")
        );
    }

    function test_rejectsAWrongProgramVK() public {
        vm.expectRevert(ZiskVerifier.InvalidProof.selector);
        verifier.verifySnarkProof(
            bytes32(uint256(1)),
            json.readBytes32(".rootCVadcopFinal"),
            json.readBytes(".publicValues"),
            json.readBytes(".proofBytes")
        );
    }
}
```

- [ ] **Step 3: Run**

Run: `forge test --match-contract ZiskVerifierTest -vv`
Expected: 4 passed. If `test_acceptsTheCommittedProof` reverts with `InvalidProof`, the calldata does not belong to this verifier version: check Task 2 ran with the rebuilt `cargo-zisk` (`rootCVadcopFinal` must be `0x564c2b1b…4f84382f`). Note the gas number for the README (about 360k is expected). Also run `forge build --sizes 2>&1 | grep -i verifier` and confirm `ZiskVerifier` is under the 24 576-byte runtime limit.

- [ ] **Step 4: Commit**

```bash
forge fmt src/zisk test/zisk && git add src/zisk test/zisk/ZiskVerifier.t.sol foundry.toml
git commit -m "Vendor the ZisK PLONK verifier and check it accepts the committed proof"
```
(`forge fmt` may rewrite the vendored files; that is acceptable, they stay semantically verbatim. If it changes `PlonkVerifier.sol` heavily, exclude the three vendored files from formatting instead: add `fmt = { exclude = ["src/zisk/PlonkVerifier.sol", "src/zisk/ZiskVerifier.sol", "src/zisk/IZiskVerifier.sol"] }`-style ignore via a `[fmt]` section with `ignore = [...]` in `foundry.toml`.)

---

### Task 4: `SealedPool` and its tests

**Files:**
- Create: `src/SealedPool.sol`, `test/zisk/SealedPoolHarness.sol`, `test/zisk/ZiskFixtureLoader.sol`, `test/zisk/SealedPoolLedger.t.sol`, `test/zisk/SealedPoolBallots.t.sol`, `test/zisk/SealedPoolClose.t.sol`, `test/zisk/SealedPoolEnd.t.sol`

**Interfaces:**
- Produces `SealedPool` (abstract, `is PoolBase`): errors `InvalidConfig, ZeroCost, CostTooLarge, TooManyProjects, NoProjects, WeightOverflow, InvalidBallot, BallotAlreadyCast, BelowMinimumVote, NoSeatWeight, InvalidCiphertext, InvalidResult, ResultPending`; events `Voted(address indexed)`, `SealedVote(address indexed)`, `Closed(bytes32 inputsHash, uint256 voterCount)`, `Finalized(Finality, uint256[])`; enums `Phase {Setup, Open, Closing, Tally, Done}`, `Finality {None, Proven, Attested, Abandoned}`; constructor `(IERC20 token, address owner, uint64 votingDeadline, bytes tallierPk, bytes32 keySalt, uint256 minDirectVote, uint64 abandonGrace)`; public `tallierPk() (bytes)`, `keySalt`, `minDirectVote`, `abandonGrace`, `totalWeight`, `voters(i)`, `directWeight(a)`, `seatWeight(a)`, `totalSeatWeight`, `finality`, `closed`, `closeCursor`, `voterChain`, `inputsHash`, `funded(id)`, `spent`; views `phase()`, `kind()` (abstract), `projectCount()`, `cost(id)`, `costs()`, `voterCount()`, `directBallotOf(a) (bytes)`, `sealedOf(a) (bytes)`, `fundedProjects() (uint256[])`, `votersFrom(start, count) (address[] who, uint256[] direct, uint256[] seats, bytes[] ballots, bytes[] cts)`; external `vote(bytes)`, `voteSealed(bytes)`, `close(uint256 maxVoters)`, `abandon()`; internal `_close(uint256)`, `_finalize(uint256[] memory, Finality)`, `_validateResult(uint256[] memory)`.
- Produces the test base `ZiskFixtureLoader` (abstract, `is Test`): `loadFixture(name)`, `fx*` JSON helpers, `newMocks()`, `deployAt(string artifact, bytes ctorArgs)` (deploys at the fixture's `pool` address with `deployCodeTo`, adds the projects, opens voting, funds `org`), `deployHarnessFromFixture()`, `replayVoters()` (contributions, list seats, the NFT takeover, ballots, dust), `closeAll(chunk)`, `fixtureInputsHash()`, constants `DEADLINE = 1_000_000`, `ABANDON_GRACE = 7 days`, `NFT_TOKEN = 1`, addresses `owner`, `org`, `recipient`, mocks `token`, `nft`, the pool as `SealedPool pool`.

- [ ] **Step 1: Write `SealedPool.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolBase, WrongPhase} from "./PoolBase.sol";

/// @title SealedPool
/// @notice What the cre and zisk pools share (spec Z1–Z5): a public, final direct ballot
///         and a replaceable sealed ballot per address, both stored as bytes; a keccak
///         chain over every registered voter closed into `inputsHash`; one `_finalize`
///         that every ending goes through; and `abandon` as the liveness floor. The
///         encryption is secp256k1 ECDH with a keccak pad (spec Z3); the contract never
///         looks inside a ciphertext.
abstract contract SealedPool is PoolBase {
    // ---------------------------------------------------------------- errors

    error InvalidConfig();
    error ZeroCost();
    error CostTooLarge();
    error TooManyProjects();
    error NoProjects();
    error WeightOverflow();
    error InvalidBallot();
    error BallotAlreadyCast();
    error BelowMinimumVote();
    error NoSeatWeight();
    error InvalidCiphertext();
    error InvalidResult();
    error ResultPending();

    // ---------------------------------------------------------------- events

    event Voted(address indexed voter);
    event SealedVote(address indexed voter);
    event Closed(bytes32 inputsHash, uint256 voterCount);
    event Finalized(Finality finality, uint256[] fundedOrder);

    // ----------------------------------------------------------------- types

    enum Phase {
        Setup,
        Open,
        Closing,
        Tally,
        Done
    }

    enum Finality {
        None,
        Proven,
        Attested,
        Abandoned
    }

    // ------------------------------------------------------------- constants

    uint256 internal constant MAX_WEIGHT = type(uint64).max;
    /// @dev One byte per project in a ballot and a ciphertext of `33 + m` bytes: 31 keeps
    ///      a ballot in one storage slot and a ciphertext in two.
    uint256 internal constant MAX_PROJECTS = 31;
    uint64 internal constant MAX_GRACE = 365 days;
    uint256 internal constant PK_LENGTH = 33;

    // ------------------------------------------------------------ immutables

    bytes32 public immutable keySalt;
    uint256 public immutable minDirectVote;
    uint64 public immutable abandonGrace;

    // --------------------------------------------------------------- storage

    /// @notice The tallier's public key, SEC1 compressed. Written once by the constructor.
    bytes public tallierPk;

    uint256 public totalWeight;
    uint256[] internal _costs;

    address[] public voters;
    mapping(address => bool) internal _isVoter;
    mapping(address => uint256) public directWeight;
    mapping(address => uint256) public seatWeight;
    uint256 public totalSeatWeight;
    mapping(address => bytes) internal _directBallot;
    mapping(address => bytes) internal _sealed;

    Finality public finality;
    bool public closed;
    uint256 public closeCursor;
    bytes32 public voterChain;
    bytes32 public inputsHash;

    mapping(uint256 => bool) public funded;
    uint256[] internal _fundedOrder;
    uint256 public spent;

    // ----------------------------------------------------------- constructor

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_
    ) PoolBase(token_, owner_, votingDeadline_) {
        if (
            tallierPk_.length != PK_LENGTH || (tallierPk_[0] != 0x02 && tallierPk_[0] != 0x03) || abandonGrace_ == 0
                || abandonGrace_ > MAX_GRACE || minDirectVote_ > MAX_WEIGHT
        ) revert InvalidConfig();
        tallierPk = tallierPk_;
        keySalt = keySalt_;
        minDirectVote = minDirectVote_;
        abandonGrace = abandonGrace_;
    }

    // ------------------------------------------------------------- modifiers

    modifier inPhase(Phase expected) {
        if (phase() != expected) revert WrongPhase();
        _;
    }

    // ----------------------------------------------------------------- views

    /// @notice "zisk" or "cre": tells a client which finalisation this pool uses.
    function kind() external pure virtual returns (string memory);

    function phase() public view returns (Phase) {
        if (finality != Finality.None) return Phase.Done;
        if (closed) return Phase.Tally;
        if (votingOpen && block.timestamp >= votingDeadline) return Phase.Closing;
        if (votingOpen) return Phase.Open;
        return Phase.Setup;
    }

    function projectCount() public view returns (uint256) {
        return _costs.length;
    }

    function cost(uint256 projectId) public view returns (uint256) {
        return _costs[projectId];
    }

    function costs() external view returns (uint256[] memory) {
        return _costs;
    }

    function voterCount() external view returns (uint256) {
        return voters.length;
    }

    function directBallotOf(address voter) external view returns (bytes memory) {
        return _directBallot[voter];
    }

    function sealedOf(address voter) external view returns (bytes memory) {
        return _sealed[voter];
    }

    function fundedProjects() external view returns (uint256[] memory) {
        return _fundedOrder;
    }

    /// @notice One page of the roster in registration order: up to `count` entries from
    ///         `start`, fewer at the end, empty arrays past it. The prover rebuilds the
    ///         whole witness from these pages instead of one call per voter. Empty
    ///         `ballots[i]` means no direct ballot; empty `cts[i]` means no sealed one.
    function votersFrom(uint256 start, uint256 count)
        external
        view
        returns (
            address[] memory who,
            uint256[] memory direct,
            uint256[] memory seats,
            bytes[] memory ballots,
            bytes[] memory cts
        )
    {
        uint256 n = voters.length;
        uint256 len = start >= n ? 0 : (n - start > count ? count : n - start);
        who = new address[](len);
        direct = new uint256[](len);
        seats = new uint256[](len);
        ballots = new bytes[](len);
        cts = new bytes[](len);
        for (uint256 i = 0; i < len; i++) {
            address a = voters[start + i];
            who[i] = a;
            direct[i] = directWeight[a];
            seats[i] = seatWeight[a];
            ballots[i] = _directBallot[a];
            cts[i] = _sealed[a];
        }
    }

    // --------------------------------------------------------------- ballots

    /// @notice Cast the caller's public ballot: one per address, never replaced, at least
    ///         `minDirectVote` of the caller's own money behind it (spec Z2).
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        if (_directBallot[msg.sender].length != 0) revert BallotAlreadyCast();
        uint256 w = directWeight[msg.sender];
        if (w == 0 || w < minDirectVote) revert BelowMinimumVote();
        _validate(ranks);
        _directBallot[msg.sender] = ranks;
        _register(msg.sender);
        emit Voted(msg.sender);
    }

    /// @notice Cast or replace the caller's sealed ballot, `R ‖ (ranks ⊕ pad)` of spec Z3.
    ///         Only the length is checked: a malformed point or an invalid ranking is an
    ///         absent ballot in the tally, and only its owner loses by it.
    function voteSealed(bytes calldata ciphertext) external inPhase(Phase.Open) beforeDeadline {
        if (seatWeight[msg.sender] == 0) revert NoSeatWeight();
        if (ciphertext.length != PK_LENGTH + _costs.length) revert InvalidCiphertext();
        _sealed[msg.sender] = ciphertext;
        _register(msg.sender);
        emit SealedVote(msg.sender);
    }

    // --------------------------------------------------------------- closing

    /// @notice Walk the voters and commit to every input, at most `maxVoters` per call.
    function close(uint256 maxVoters) external inPhase(Phase.Closing) {
        _close(maxVoters);
    }

    /// @dev One keccak per voter over exactly what the guest hashes (spec Z4 step 2):
    ///      the running chain, the address, both weights as 32-byte words, and the
    ///      keccak of each ballot's bytes, `keccak256("")` when absent. Chunking never
    ///      changes the result: the chain only depends on the order of `voters`.
    function _close(uint256 maxVoters) internal {
        if (closeCursor == 0) _requireBalanceCoversBudget();
        uint256 n = voters.length;
        uint256 end = closeCursor + maxVoters;
        if (end > n) end = n;
        bytes32 h = voterChain;
        for (uint256 i = closeCursor; i < end; i++) {
            address a = voters[i];
            h = keccak256(
                abi.encodePacked(
                    h, a, directWeight[a], seatWeight[a], keccak256(_directBallot[a]), keccak256(_sealed[a])
                )
            );
        }
        closeCursor = end;
        voterChain = h;
        if (end == n) {
            inputsHash = keccak256(
                abi.encodePacked(block.chainid, address(this), h, n, keccak256(abi.encodePacked(_costs)), totalWeight)
            );
            closed = true;
            emit Closed(inputsHash, n);
        }
    }

    // ----------------------------------------------------------------- grace

    /// @notice End the pool with nothing funded once `abandonGrace` has elapsed since the
    ///         deadline with no result; also from `Closing`, so a pool whose `close`
    ///         never completes still ends (spec Z5).
    function abandon() external {
        Phase p = phase();
        if (p != Phase.Tally && p != Phase.Closing) revert WrongPhase();
        if (block.timestamp < uint256(votingDeadline) + abandonGrace) revert ResultPending();
        _finalize(new uint256[](0), Finality.Abandoned);
    }

    // ------------------------------------------------------------- internals

    function _register(address voter) internal {
        if (!_isVoter[voter]) {
            _isVoter[voter] = true;
            voters.push(voter);
        }
    }

    /// @dev Competition-ranking check identical to PBEAR._setBallot: length m, every rank
    ///      at most m, ranks form a competition ranking (no gaps).
    function _validate(bytes calldata ranks) internal view {
        uint256 m = _costs.length;
        if (ranks.length != m) revert InvalidBallot();
        uint256[] memory counts = new uint256[](m + 1);
        for (uint256 c = 0; c < m; c++) {
            uint8 r = uint8(ranks[c]);
            if (r > m) revert InvalidBallot();
            counts[r]++;
        }
        uint256 seen = 0;
        for (uint256 r = 1; r <= m; r++) {
            if (counts[r] != 0 && r != seen + 1) revert InvalidBallot();
            seen += counts[r];
        }
    }

    /// @dev Distinct valid project ids whose costs fit the budget (spec Z5).
    function _validateResult(uint256[] memory order) internal view {
        uint256 m = _costs.length;
        bool[] memory seen = new bool[](m);
        uint256 sum;
        for (uint256 i = 0; i < order.length; i++) {
            uint256 id = order[i];
            if (id >= m || seen[id]) revert InvalidResult();
            seen[id] = true;
            sum += _costs[id];
        }
        if (sum > totalWeight) revert InvalidResult();
    }

    /// @dev The one way the pool ends (proof, report, abandon). Validates the list, then
    ///      records it; `spent` is what `sweep` leaves behind for the claims.
    function _finalize(uint256[] memory order, Finality how) internal {
        if (finality != Finality.None) revert WrongPhase();
        _validateResult(order);
        uint256 total;
        for (uint256 i = 0; i < order.length; i++) {
            funded[order[i]] = true;
            total += _costs[order[i]];
        }
        _fundedOrder = order;
        spent = total;
        finality = how;
        emit Finalized(how, order);
    }

    // ----------------------------------------------------------------- hooks

    function _isSetup() internal view override returns (bool) {
        return phase() == Phase.Setup;
    }

    function _isOpen() internal view override returns (bool) {
        return phase() == Phase.Open;
    }

    function _isDone() internal view override returns (bool) {
        return phase() == Phase.Done;
    }

    function _registerProject(uint256 cost_) internal override returns (uint256 id) {
        if (cost_ == 0) revert ZeroCost();
        if (cost_ > MAX_WEIGHT) revert CostTooLarge();
        if (_costs.length >= MAX_PROJECTS) revert TooManyProjects();
        id = _costs.length;
        _costs.push(cost_);
    }

    function _beforeOpen() internal view override {
        if (_costs.length == 0) revert NoProjects();
    }

    function _addBudget(uint256 amount) internal override {
        if (totalWeight + amount > MAX_WEIGHT) revert WeightOverflow();
        totalWeight += amount;
    }

    function _budget() internal view override returns (uint256) {
        return totalWeight;
    }

    function _onContribution(address who, uint256 amount) internal override {
        directWeight[who] += amount;
        _register(who);
    }

    function _onSeatGranted(address who, uint256 perSeat) internal override {
        seatWeight[who] += perSeat;
        totalSeatWeight += perSeat;
        _register(who);
    }

    function _onSeatRevoked(address who, uint256 perSeat) internal override {
        seatWeight[who] -= perSeat;
        totalSeatWeight -= perSeat;
    }

    function _isFunded(uint256 projectId) internal view override returns (bool) {
        return funded[projectId];
    }

    function _costOf(uint256 projectId) internal view override returns (uint256) {
        return _costs[projectId];
    }

    function _spent() internal view override returns (uint256) {
        return spent;
    }
}
```

- [ ] **Step 2: Harness and fixture loader**

```solidity
// test/zisk/SealedPoolHarness.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedPool} from "../../src/SealedPool.sol";

/// @dev A concrete SealedPool with `_finalize` exposed, for testing the shared base.
contract SealedPoolHarness is SealedPool {
    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {}

    function kind() external pure override returns (string memory) {
        return "harness";
    }

    function finalizeFor(uint256[] memory order, Finality how) external {
        _finalize(order, how);
    }
}
```

```solidity
// test/zisk/ZiskFixtureLoader.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";

/// @dev Rebuilds a pool from one of the zisk fixtures through the public API, at the
///      fixture's pool address, so `inputsHash` and the committed proof line up. The
///      concrete pool is deployed by the test through `deployAt`; this base only knows
///      it is a `SealedPool`.
abstract contract ZiskFixtureLoader is Test {
    using stdJson for string;

    string internal json;
    MockERC20 internal token;
    MockERC721 internal nft;
    SealedPool internal pool;

    address internal owner = makeAddr("owner");
    address internal org = makeAddr("org");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant DEADLINE = 1_000_000;
    uint64 internal constant ABANDON_GRACE = 7 days;
    uint256 internal constant NFT_TOKEN = 1;

    function loadFixture(string memory name) internal {
        json = vm.readFile(string.concat("reference/vectors/zisk/fixture_", name, ".json"));
    }

    // ---- JSON helpers ----

    function fxUint(string memory key) internal view returns (uint256) {
        return json.readUint(key);
    }

    function fxWord(string memory key) internal view returns (uint256) {
        return uint256(json.readBytes32(key));
    }

    function fxBytes32(string memory key) internal view returns (bytes32) {
        return json.readBytes32(key);
    }

    /// @dev "" marks an absent ballot in the fixtures; stdJson cannot parse an empty hex
    ///      string, so the string is read first.
    function fxBytes(string memory key) internal view returns (bytes memory) {
        string memory s = json.readString(key);
        if (bytes(s).length == 0) return "";
        return json.readBytes(key);
    }

    function fxAddress(string memory key) internal view returns (address) {
        return json.readAddress(key);
    }

    function fxUintArray(string memory key) internal view returns (uint256[] memory) {
        return json.readUintArray(key);
    }

    function fxWords(string memory key) internal view returns (uint256[] memory out) {
        bytes32[] memory b = json.readBytes32Array(key);
        out = new uint256[](b.length);
        for (uint256 i = 0; i < b.length; i++) {
            out[i] = uint256(b[i]);
        }
    }

    function fxCount(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function voterKey(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".voters[", vm.toString(i), "].", field);
    }

    function hasTakeover() internal view returns (bool) {
        return vm.keyExistsJson(json, ".nftTakeover.from");
    }

    function fixtureInputsHash() internal view returns (bytes32) {
        return fxBytes32(".inputsHash");
    }

    // ---- pool construction ----

    function newMocks() internal {
        token = new MockERC20();
        nft = new MockERC721();
    }

    /// @dev Deploys the concrete pool at the fixture address with `ctorArgs` and finishes
    ///      the setup: projects, open voting, org funding.
    function deployAt(string memory artifact, bytes memory ctorArgs) internal {
        vm.warp(1);
        address where = fxAddress(".pool");
        deployCodeTo(artifact, ctorArgs, where);
        pool = SealedPool(where);
        uint256[] memory costs = fxWords(".costs");
        vm.startPrank(owner);
        for (uint256 c = 0; c < costs.length; c++) {
            pool.addProject(costs[c], recipient);
        }
        pool.openVoting();
        vm.stopPrank();
        token.mint(org, type(uint64).max);
        vm.prank(org);
        token.approve(address(pool), type(uint256).max);
    }

    /// @dev The harness at the fixture address; the concrete pools' tests pass their own artifact.
    function deployHarnessFromFixture() internal {
        newMocks();
        deployAt(
            "SealedPoolHarness.sol:SealedPoolHarness",
            abi.encode(
                token, owner, DEADLINE, json.readBytes(".pk"), fxBytes32(".keySalt"), fxWord(".minDirectVote"), ABANDON_GRACE
            )
        );
    }

    /// @dev Registration order is what the fixture's voter order says: every deposit path
    ///      registers on first touch, so contributions and seats are granted voter by
    ///      voter, ballots afterwards, the NFT takeover last (its holder must still have
    ///      the seat when it votes), and the dust as unclaimed NFT seats at the very end.
    function replayVoters() internal {
        uint256 n = fxCount(".voters");
        address tFrom;
        address tTo;
        uint256 tAmount;
        if (hasTakeover()) {
            tFrom = fxAddress(".nftTakeover.from");
            tTo = fxAddress(".nftTakeover.to");
            tAmount = fxWord(".nftTakeover.sponsorshipAmount");
        }
        uint256 nftSponsorship;
        uint256 granted;
        for (uint256 i = 0; i < n; i++) {
            address a = fxAddress(voterKey(i, "addr"));
            uint256 direct = fxWord(voterKey(i, "directWeight"));
            uint256 seat = fxWord(voterKey(i, "seatWeight"));
            if (direct > 0) {
                token.mint(a, direct);
                vm.startPrank(a);
                token.approve(address(pool), direct);
                pool.contribute(direct);
                vm.stopPrank();
            }
            if (a == tFrom) {
                vm.prank(org);
                nftSponsorship = pool.sponsorNFT(tAmount, IERC721(address(nft)), 1);
                nft.mint(a, NFT_TOKEN);
                vm.prank(a);
                pool.claimSeat(nftSponsorship, NFT_TOKEN);
                granted += tAmount;
            } else if (seat > 0) {
                uint256 listSeat = a == tTo ? seat - tAmount : seat;
                address[] memory members = new address[](1);
                members[0] = a;
                vm.prank(org);
                pool.sponsor(listSeat, members);
                granted += listSeat;
            }
            granted += direct;
        }
        for (uint256 i = 0; i < n; i++) {
            address a = fxAddress(voterKey(i, "addr"));
            bytes memory ballot = fxBytes(voterKey(i, "directBallot"));
            if (ballot.length != 0) {
                vm.prank(a);
                pool.vote(ballot);
            }
            bytes memory ct = fxBytes(voterKey(i, "ciphertext"));
            if (ct.length != 0) {
                vm.prank(a);
                pool.voteSealed(ct);
            }
        }
        if (tFrom != address(0)) {
            vm.prank(tFrom);
            nft.transferFrom(tFrom, tTo, NFT_TOKEN);
            vm.prank(tTo);
            pool.claimSeat(nftSponsorship, NFT_TOKEN);
        }
        uint256 dust = fxWord(".totalWeight") - granted;
        if (dust > 0) {
            vm.prank(org);
            pool.sponsorNFT(dust, IERC721(address(nft)), dust);
        }
        assertEq(pool.totalWeight(), fxWord(".totalWeight"), "fixture totalWeight");
        assertEq(pool.voterCount(), n, "fixture voter count");
        for (uint256 i = 0; i < n; i++) {
            address a = pool.voters(i);
            assertEq(a, fxAddress(voterKey(i, "addr")), "registration order");
            assertEq(pool.seatWeight(a), fxWord(voterKey(i, "seatWeight")), "seat weight");
            assertEq(pool.directWeight(a), fxWord(voterKey(i, "directWeight")), "direct weight");
        }
    }

    function closeAll(uint256 chunk) internal {
        vm.warp(DEADLINE);
        while (!pool.closed()) pool.close(chunk);
    }
}
```

The `deployCodeTo` artifact string for a test-tree contract is `"SealedPoolHarness.sol:SealedPoolHarness"` (forge resolves it by file name). If forge reports the artifact as not found, use the path form `"test/zisk/SealedPoolHarness.sol:SealedPoolHarness"`.

- [ ] **Step 3: Tests**

```solidity
// test/zisk/SealedPoolLedger.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";
import {SealedPoolHarness} from "./SealedPoolHarness.sol";

contract SealedPoolLedgerTest is ZiskFixtureLoader {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
    }

    function test_kindAndConfig() public view {
        assertEq(pool.kind(), "harness");
        assertEq(pool.tallierPk(), json.readBytes(".pk"));
        assertEq(pool.keySalt(), fxBytes32(".keySalt"));
        assertEq(pool.minDirectVote(), fxWord(".minDirectVote"));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Open));
    }

    function test_constructorRejectsBadConfig() public {
        bytes memory pk = json.readBytes(".pk");
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, new bytes(32), bytes32(0), 0, 1 days);
        bytes memory badPrefix = pk;
        badPrefix[0] = 0x04;
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, badPrefix, bytes32(0), 0, 1 days);
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, pk, bytes32(0), 0, 0);
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, pk, bytes32(0), 0, 366 days);
    }

    function test_contributionAndSeatsRegisterInOrder() public {
        token.mint(alice, 100);
        vm.startPrank(alice);
        token.approve(address(pool), 100);
        pool.contribute(100);
        vm.stopPrank();
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = alice;
        vm.prank(org);
        pool.sponsor(50, members);
        assertEq(pool.voterCount(), 2);
        assertEq(pool.voters(0), alice);
        assertEq(pool.voters(1), bob);
        assertEq(pool.directWeight(alice), 100);
        assertEq(pool.seatWeight(alice), 25);
        assertEq(pool.seatWeight(bob), 25);
        assertEq(pool.totalSeatWeight(), 50);
        assertEq(pool.totalWeight(), 150);
    }

    function test_nftTakeoverMovesSeatWeight() public {
        vm.prank(org);
        uint256 id = pool.sponsorNFT(30, IERC721(address(nft)), 1);
        nft.mint(alice, 7);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 30);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 7);
        vm.prank(bob);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 0);
        assertEq(pool.seatWeight(bob), 30);
        assertEq(pool.totalSeatWeight(), 30);
        assertEq(pool.voterCount(), 2);
    }

    function test_weightCapAndProjectLimits() public {
        vm.prank(org);
        vm.expectRevert(SealedPool.WeightOverflow.selector);
        pool.contribute(type(uint64).max);
        // A fresh pool for the project limits: this one is already open.
        SealedPoolHarness p = new SealedPoolHarness(token, owner, DEADLINE, json.readBytes(".pk"), bytes32(0), 0, 1 days);
        vm.startPrank(owner);
        vm.expectRevert(SealedPool.ZeroCost.selector);
        p.addProject(0, recipient);
        vm.expectRevert(SealedPool.CostTooLarge.selector);
        p.addProject(uint256(type(uint64).max) + 1, recipient);
        for (uint256 i = 0; i < 31; i++) {
            p.addProject(1, recipient);
        }
        vm.expectRevert(SealedPool.TooManyProjects.selector);
        p.addProject(1, recipient);
        vm.stopPrank();
    }

    function test_openVotingNeedsAProject() public {
        SealedPoolHarness p = new SealedPoolHarness(token, owner, DEADLINE, json.readBytes(".pk"), bytes32(0), 0, 1 days);
        vm.prank(owner);
        vm.expectRevert(SealedPool.NoProjects.selector);
        p.openVoting();
    }

    function test_votersFromPages() public {
        replayVoters();
        uint256 n = pool.voterCount();
        (address[] memory who,,,, bytes[] memory cts) = pool.votersFrom(0, 5);
        assertEq(who.length, 5);
        assertEq(who[0], pool.voters(0));
        assertEq(cts[0].length, pool.sealedOf(who[0]).length);
        (address[] memory tail, uint256[] memory direct, uint256[] memory seats, bytes[] memory ballots,) =
            pool.votersFrom(n - 2, 100);
        assertEq(tail.length, 2);
        assertEq(tail[1], pool.voters(n - 1));
        assertEq(direct[1], pool.directWeight(tail[1]));
        assertEq(seats[1], pool.seatWeight(tail[1]));
        assertEq(ballots[1], pool.directBallotOf(tail[1]));
        (address[] memory none,,,,) = pool.votersFrom(n, 10);
        assertEq(none.length, 0);
    }
}
```

```solidity
// test/zisk/SealedPoolBallots.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolBallotsTest is ZiskFixtureLoader {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 minVote;

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
        minVote = pool.minDirectVote();
        token.mint(alice, minVote);
        vm.startPrank(alice);
        token.approve(address(pool), minVote);
        pool.contribute(minVote);
        vm.stopPrank();
        address[] memory members = new address[](1);
        members[0] = bob;
        vm.prank(org);
        pool.sponsor(30, members);
    }

    function test_directBallotOnceAndValidated() public {
        vm.startPrank(alice);
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"010203"); // length
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"01030000"); // gap
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"01020305"); // > m
        vm.expectEmit(true, false, false, true);
        emit SealedPool.Voted(alice);
        pool.vote(hex"01020200");
        assertEq(pool.directBallotOf(alice), hex"01020200");
        vm.expectRevert(SealedPool.BallotAlreadyCast.selector);
        pool.vote(hex"01020304");
        vm.stopPrank();
    }

    function test_directBallotNeedsMinimumWeight() public {
        address carol = makeAddr("carol");
        vm.prank(carol);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
        token.mint(carol, minVote - 1);
        vm.startPrank(carol);
        token.approve(address(pool), minVote - 1);
        pool.contribute(minVote - 1);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
        vm.stopPrank();
        // Seat weight alone does not open the public ballot.
        vm.prank(bob);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
    }

    function test_sealedBallotNeedsSeatWeightAndLength() public {
        bytes memory ct = new bytes(33 + 4);
        vm.prank(alice);
        vm.expectRevert(SealedPool.NoSeatWeight.selector);
        pool.voteSealed(ct);
        vm.startPrank(bob);
        vm.expectRevert(SealedPool.InvalidCiphertext.selector);
        pool.voteSealed(new bytes(36));
        vm.expectEmit(true, false, false, true);
        emit SealedPool.SealedVote(bob);
        pool.voteSealed(ct);
        bytes memory ct2 = new bytes(37);
        ct2[0] = 0x03;
        pool.voteSealed(ct2);
        assertEq(pool.sealedOf(bob), ct2);
        vm.stopPrank();
        assertEq(pool.voterCount(), 2);
    }

    function test_ballotsBlockedAfterDeadline() public {
        vm.warp(DEADLINE);
        vm.prank(alice);
        vm.expectRevert(WrongPhase.selector);
        pool.vote(hex"01020304");
        vm.prank(bob);
        vm.expectRevert(WrongPhase.selector);
        pool.voteSealed(new bytes(37));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Closing));
    }
}
```

(`inPhase(Open)` runs before `beforeDeadline`, so at the deadline the revert is `WrongPhase`.)

```solidity
// test/zisk/SealedPoolClose.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, BalanceBelowTotalWeight} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolCloseTest is ZiskFixtureLoader {
    function runFixture(string memory name, uint256 chunk) internal {
        loadFixture(name);
        deployHarnessFromFixture();
        replayVoters();
        closeAll(chunk);
        assertEq(pool.voterChain(), fxBytes32(".voterChain"), "voterChain");
        assertEq(pool.inputsHash(), fixtureInputsHash(), "inputsHash");
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Tally));
    }

    function test_mainInOneCall() public {
        runFixture("main", 1000);
    }

    function test_mainOneVoterPerCall() public {
        runFixture("main", 1);
    }

    function test_mainInChunksOfFive() public {
        runFixture("main", 5);
    }

    function test_nosealed() public {
        runFixture("nosealed", 3);
    }

    function test_nodirect() public {
        runFixture("nodirect", 2);
    }

    function test_closeOnlyInClosing() public {
        loadFixture("main");
        deployHarnessFromFixture();
        vm.expectRevert(WrongPhase.selector);
        pool.close(10);
        closeAll(1000);
        vm.expectRevert(WrongPhase.selector);
        pool.close(10);
    }

    function test_closeEmitsAndNeedsBalance() public {
        loadFixture("main");
        deployHarnessFromFixture();
        replayVoters();
        vm.warp(DEADLINE);
        // Drain one token: the first chunk must refuse.
        vm.prank(address(pool));
        token.transfer(org, 1);
        vm.expectRevert(BalanceBelowTotalWeight.selector);
        pool.close(1000);
        token.mint(address(pool), 1);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Closed(fixtureInputsHash(), pool.voterCount());
        pool.close(1000);
    }

    function test_zeroVotersCloses() public {
        loadFixture("main");
        deployHarnessFromFixture();
        vm.warp(DEADLINE);
        pool.close(0);
        assertTrue(pool.closed());
        assertEq(pool.voterChain(), bytes32(0));
    }
}
```

```solidity
// test/zisk/SealedPoolEnd.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, NotFunded} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {SealedPoolHarness} from "./SealedPoolHarness.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolEndTest is ZiskFixtureLoader {
    SealedPoolHarness h;

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
        replayVoters();
        h = SealedPoolHarness(address(pool));
    }

    function test_finalizeValidatesTheList() public {
        closeAll(1000);
        uint256[] memory bad = new uint256[](2);
        bad[0] = 1;
        bad[1] = 1;
        vm.expectRevert(SealedPool.InvalidResult.selector);
        h.finalizeFor(bad, SealedPool.Finality.Proven);
        bad[1] = 9;
        vm.expectRevert(SealedPool.InvalidResult.selector);
        h.finalizeFor(bad, SealedPool.Finality.Proven);
        // All four projects cost 500 USDC, within the fixture's budget: a list within
        // budget is accepted even when the tally would not have funded it. The proof,
        // not this check, ties the list to the ballots.
        uint256[] memory all = new uint256[](4);
        for (uint256 i = 0; i < 4; i++) {
            all[i] = i;
        }
        h.finalizeFor(all, SealedPool.Finality.Proven);
        assertEq(pool.spent(), 500_000_000);
    }

    function test_finalizeRecordsAndEndsThePool() public {
        closeAll(1000);
        uint256[] memory order = fxUintArray(".funded");
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Proven, order);
        h.finalizeFor(order, SealedPool.Finality.Proven);
        assertEq(uint256(pool.finality()), uint256(SealedPool.Finality.Proven));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Done));
        assertEq(pool.fundedProjects(), order);
        assertTrue(pool.funded(1));
        assertFalse(pool.funded(3));
        assertEq(pool.spent(), pool.cost(0) + pool.cost(1) + pool.cost(2));
        vm.expectRevert(WrongPhase.selector);
        h.finalizeFor(order, SealedPool.Finality.Proven);
    }

    function test_claimsAndSweepAfterProven() public {
        closeAll(1000);
        h.finalizeFor(fxUintArray(".funded"), SealedPool.Finality.Proven);
        pool.claim(1);
        assertEq(token.balanceOf(recipient), pool.cost(1));
        vm.expectRevert(NotFunded.selector);
        pool.claim(3);
        uint256 leftover = pool.totalWeight() - pool.spent();
        vm.prank(owner);
        pool.sweep(owner);
        assertEq(token.balanceOf(owner), leftover);
        pool.claim(0);
        pool.claim(2);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_abandonAfterGraceFromClosing() public {
        vm.warp(DEADLINE);
        vm.expectRevert(SealedPool.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + ABANDON_GRACE);
        pool.abandon(); // from Closing: close never ran
        assertEq(uint256(pool.finality()), uint256(SealedPool.Finality.Abandoned));
        assertEq(pool.fundedProjects().length, 0);
        vm.prank(owner);
        pool.sweep(owner);
        assertEq(token.balanceOf(owner), pool.totalWeight());
    }

    function test_abandonFromTally() public {
        closeAll(1000);
        vm.expectRevert(SealedPool.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + ABANDON_GRACE);
        pool.abandon();
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Done));
    }

    function test_abandonNotBeforeDeadline() public {
        vm.expectRevert(WrongPhase.selector);
        pool.abandon();
    }
}
```

- [ ] **Step 4: Run, fix, commit**

Run: `forge test --match-path "test/zisk/SealedPool*.t.sol" -vv`
Expected: all pass. The `voterChain` / `inputsHash` equalities in `SealedPoolCloseTest` are the load-bearing checks of this task: they prove the Solidity commitment equals the Python and Rust ones for all three fixtures. If they fail while `replayVoters`'s own assertions pass, print `pool.voterChain()` after closing one voter at a time on `nodirect` (smallest roster) and compare with a Python loop over `commitments.voter_chain` prefixes.

Then the whole suite and the commit:

```bash
forge test && forge fmt && git add src/SealedPool.sol test/zisk
git commit -m "Add SealedPool: shared ledger, ballots, keccak commitment and finalisation"
```

---

### Task 5: `ZiskRankedShares`, the mock verifier, and finalisation tests with the real proof

**Files:**
- Create: `src/zisk/ZiskRankedShares.sol`, `test/mocks/MockZiskVerifier.sol`, `test/zisk/ZiskFinalize.t.sol`

**Interfaces:**
- Produces `ZiskRankedShares is SealedPool`: constructor `(IERC20 token, address owner, uint64 votingDeadline, bytes tallierPk, bytes32 keySalt, uint256 minDirectVote, uint64 abandonGrace, IZiskVerifier verifier, bytes32 programVK, bytes32 rootC)`; immutables `verifier`, `programVK`, `rootC`; error `PublicValuesMismatch`; `kind() == "zisk"`; `expectedOutputHash(uint256[] fundedOrder) view returns (bytes32)`; `finalize(uint256[] fundedOrder, bytes publicValues, bytes proofBytes)`.
- Produces `MockZiskVerifier is IZiskVerifier` with `setAccept(bool)`; it reverts `InvalidProof()` when not accepting (the real verifier's behaviour).
- Consumed by Tasks 7, 9, 11.

- [ ] **Step 1: Contract and mock**

```solidity
// src/zisk/ZiskRankedShares.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedPool} from "../SealedPool.sol";
import {IZiskVerifier} from "./IZiskVerifier.sol";

/// @title ZiskRankedShares
/// @notice A sealed-ballot pool whose whole tally is proven in a ZisK guest. `finalize`
///         accepts one PLONK proof whose committed public value is
///         `keccak256(abi.encode(inputsHash, tallierPk, fundedOrder))`: the pool
///         recomputes that hash from its own storage, so a proof over other inputs or
///         another key cannot match (spec Z5).
contract ZiskRankedShares is SealedPool {
    error PublicValuesMismatch();

    /// @dev ZisK's on-chain public values: 64 slots of 8 bytes, each a `u32` written as a
    ///      little-endian `u64`. The guest commits 32 bytes, so slots 0..8 carry them four
    ///      bytes at a time and everything else is zero.
    uint256 internal constant PUBLIC_VALUES_LENGTH = 512;

    IZiskVerifier public immutable verifier;
    bytes32 public immutable programVK;
    bytes32 public immutable rootC;

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_,
        IZiskVerifier verifier_,
        bytes32 programVK_,
        bytes32 rootC_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {
        if (address(verifier_).code.length == 0 || programVK_ == bytes32(0) || rootC_ == bytes32(0)) {
            revert InvalidConfig();
        }
        verifier = verifier_;
        programVK = programVK_;
        rootC = rootC_;
    }

    function kind() external pure override returns (string memory) {
        return "zisk";
    }

    /// @notice The 32 bytes the guest must have committed for `fundedOrder` to be accepted.
    function expectedOutputHash(uint256[] calldata fundedOrder) public view returns (bytes32) {
        return keccak256(abi.encode(inputsHash, tallierPk, fundedOrder));
    }

    /// @notice Finalise with a ZisK proof. Anyone may call; the proof, not the caller, is
    ///         the authority. Reverts `PublicValuesMismatch` when `publicValues` do not
    ///         encode exactly `expectedOutputHash(fundedOrder)`, and with the verifier's
    ///         `InvalidProof` when the proof does not verify.
    function finalize(uint256[] calldata fundedOrder, bytes calldata publicValues, bytes calldata proofBytes)
        external
        inPhase(Phase.Tally)
    {
        if (!_encodesHash(publicValues, expectedOutputHash(fundedOrder))) revert PublicValuesMismatch();
        verifier.verifySnarkProof(programVK, rootC, publicValues, proofBytes);
        _finalize(fundedOrder, Finality.Proven);
    }

    /// @dev `pv[8i .. 8i+4] == h[4i .. 4i+4]` for `i < 8`, every other byte zero.
    function _encodesHash(bytes calldata pv, bytes32 h) internal pure returns (bool) {
        if (pv.length != PUBLIC_VALUES_LENGTH) return false;
        for (uint256 i = 0; i < PUBLIC_VALUES_LENGTH; i++) {
            bytes1 want = (i < 64 && i % 8 < 4) ? h[(i / 8) * 4 + (i % 8)] : bytes1(0);
            if (pv[i] != want) return false;
        }
        return true;
    }
}
```

```solidity
// test/mocks/MockZiskVerifier.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IZiskVerifier} from "../../src/zisk/IZiskVerifier.sol";

/// @dev Accepts every proof, or rejects every proof by reverting `InvalidProof()` the way
///      the real verifier does. `verifySnarkProof` is `view` in the interface, so the
///      mock cannot record calls; tests assert on the pool's state.
contract MockZiskVerifier is IZiskVerifier {
    error InvalidProof();

    bool public accept = true;

    function setAccept(bool value) external {
        accept = value;
    }

    function verifySnarkProof(bytes32, bytes32, bytes calldata, bytes calldata) external view {
        if (!accept) revert InvalidProof();
    }
}
```

- [ ] **Step 2: Tests**

```solidity
// test/zisk/ZiskFinalize.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskRankedShares} from "../../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../../src/zisk/IZiskVerifier.sol";
import {MockZiskVerifier} from "../mocks/MockZiskVerifier.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract ZiskFinalizeTest is ZiskFixtureLoader {
    using stdJson for string;

    string internal calldataJson;
    MockZiskVerifier internal mock;
    ZiskVerifier internal real;
    ZiskRankedShares internal zpool;

    bytes32 internal programVK;
    bytes32 internal rootC;
    bytes internal publicValues;
    bytes internal proofBytes;
    uint256[] internal fundedOrder;

    function setUp() public {
        loadFixture("main");
        calldataJson = vm.readFile("zisk/fixtures/main-calldata.json");
        programVK = calldataJson.readBytes32(".programVK");
        rootC = calldataJson.readBytes32(".rootCVadcopFinal");
        publicValues = calldataJson.readBytes(".publicValues");
        proofBytes = calldataJson.readBytes(".proofBytes");
        fundedOrder = fxUintArray(".funded");
        newMocks();
        mock = new MockZiskVerifier();
        real = new ZiskVerifier();
    }

    function deployWith(IZiskVerifier v) internal {
        deployAt(
            "ZiskRankedShares.sol:ZiskRankedShares",
            abi.encode(
                token,
                owner,
                DEADLINE,
                json.readBytes(".pk"),
                fxBytes32(".keySalt"),
                fxWord(".minDirectVote"),
                ABANDON_GRACE,
                v,
                programVK,
                rootC
            )
        );
        zpool = ZiskRankedShares(address(pool));
    }

    function test_kindAndImmutables() public {
        deployWith(IZiskVerifier(address(mock)));
        assertEq(zpool.kind(), "zisk");
        assertEq(address(zpool.verifier()), address(mock));
        assertEq(zpool.programVK(), programVK);
        assertEq(zpool.rootC(), rootC);
    }

    function test_constructorNeedsAVerifierWithCode() public {
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new ZiskRankedShares(
            token, owner, DEADLINE, json.readBytes(".pk"), bytes32(0), 0, 1 days, IZiskVerifier(makeAddr("eoa")), programVK, rootC
        );
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new ZiskRankedShares(
            token, owner, DEADLINE, json.readBytes(".pk"), bytes32(0), 0, 1 days, IZiskVerifier(address(mock)), bytes32(0), rootC
        );
    }

    function test_expectedOutputHashMatchesTheFixture() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        assertEq(zpool.inputsHash(), fixtureInputsHash());
        assertEq(zpool.expectedOutputHash(fundedOrder), fxBytes32(".outputHash"));
    }

    function test_finalizeOnlyInTally() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        vm.expectRevert(WrongPhase.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    function test_finalizeRejectsWrongOrderOrMalformedPublicValues() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        uint256[] memory other = new uint256[](1);
        other[0] = 3;
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(other, publicValues, proofBytes);

        bytes memory shortPv = new bytes(511);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, shortPv, proofBytes);

        bytes memory padded = publicValues;
        padded[5] = 0x01; // padding byte inside slot 0
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, padded, proofBytes);

        bytes memory tail = publicValues;
        tail[511] = 0x01;
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, tail, proofBytes);

        bytes memory flipped = publicValues;
        flipped[0] = bytes1(uint8(flipped[0]) ^ 0x01);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, flipped, proofBytes);
    }

    function test_finalizeSurfacesVerifierRejection() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        mock.setAccept(false);
        vm.expectRevert(MockZiskVerifier.InvalidProof.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    function test_finalizeWithMockSetsEverything() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Proven, fundedOrder);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
        assertEq(uint256(zpool.finality()), uint256(SealedPool.Finality.Proven));
        assertEq(zpool.fundedProjects(), fundedOrder);
        vm.expectRevert(WrongPhase.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    /// @dev The whole chain: fixture replayed at the fixture address, closed, and the
    ///      committed proof accepted by the real PLONK verifier.
    function test_finalizeWithTheRealProof() public {
        deployWith(IZiskVerifier(address(real)));
        replayVoters();
        closeAll(7);
        uint256 before = gasleft();
        zpool.finalize(fundedOrder, publicValues, proofBytes);
        uint256 used = before - gasleft();
        emit log_named_uint("finalize gas with the real verifier", used);
        assertLt(used, 600_000);
        assertEq(uint256(zpool.finality()), uint256(SealedPool.Finality.Proven));
        assertTrue(zpool.funded(0) && zpool.funded(1) && zpool.funded(2));
        assertFalse(zpool.funded(3));
        zpool.claim(1);
        assertEq(token.balanceOf(recipient), zpool.cost(1));
    }

    function test_realVerifierRejectsAProofForAnotherPool() public {
        // Same proof, a pool whose roster differs by one silent voter: inputsHash changes,
        // the expected hash changes, and the public values no longer encode it.
        deployWith(IZiskVerifier(address(real)));
        replayVoters();
        address extra = makeAddr("extra");
        token.mint(extra, 1);
        vm.startPrank(extra);
        token.approve(address(pool), 1);
        pool.contribute(1);
        vm.stopPrank();
        closeAll(1000);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }
}
```

- [ ] **Step 3: Run and commit**

Run: `forge test --match-contract ZiskFinalizeTest -vv`
Expected: 9 passed, with the real-proof gas printed (about 400k: verifier plus four `funded` writes). If `test_finalizeWithTheRealProof` fails with `PublicValuesMismatch`, `expectedOutputHash` differs from the fixture's `outputHash`: compare `zpool.inputsHash()` with the fixture first (Task 4's close tests must pass), then the ABI encoding of `tallierPk` (33 bytes) against `reference/zisk/commitments.py`. If it fails with the verifier's `InvalidProof`, the calldata is stale relative to the fixture: redo Task 2.

```bash
forge fmt && forge test && git add src/zisk/ZiskRankedShares.sol test/mocks/MockZiskVerifier.sol test/zisk/ZiskFinalize.t.sol
git commit -m "Add ZiskRankedShares: finalise a pool with one ZisK proof"
```

---

### Task 6: `CreRankedShares`

**Files:**
- Create: `src/cre/CreRankedShares.sol`, `test/cre/CreReport.t.sol`

**Interfaces:**
- Produces `CreRankedShares is SealedPool, IReceiver`: constructor `(IERC20 token, address owner, uint64 votingDeadline, bytes tallierPk, bytes32 keySalt, uint256 minDirectVote, uint64 abandonGrace, address forwarder)`; immutable `forwarder`; errors `NotForwarder, UnknownReport, InputMismatch`; `kind() == "cre"`; `onReport(bytes metadata, bytes report)` with kind 1 `RESULT` = `abi.encode(bytes32 inputsHash, uint256[] fundedOrder)` finalising as `Attested`, kind 2 `CLOSE` = `abi.encode(uint256 maxVoters)`; `supportsInterface`.

- [ ] **Step 1: Contract**

```solidity
// src/cre/CreRankedShares.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SealedPool} from "../SealedPool.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";

/// @title CreRankedShares
/// @notice A sealed-ballot pool tallied inside a Chainlink CRE confidential workflow. The
///         DON's report is the result: `onReport` kind 1 finalises the pool as `Attested`
///         once `inputsHash` matches, kind 2 drives `close` from the workflow. Same
///         ballots, commitment and encryption as the zisk pool (spec Z5).
contract CreRankedShares is SealedPool, IReceiver {
    error NotForwarder();
    error UnknownReport();
    error InputMismatch();

    uint8 internal constant KIND_RESULT = 1;
    uint8 internal constant KIND_CLOSE = 2;

    address public immutable forwarder;

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_,
        address forwarder_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {
        if (forwarder_ == address(0)) revert InvalidConfig();
        forwarder = forwarder_;
    }

    function kind() external pure override returns (string memory) {
        return "cre";
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Entry point for the CRE forwarder.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint8 reportKind, bytes memory payload) = abi.decode(report, (uint8, bytes));
        if (reportKind == KIND_CLOSE) {
            if (phase() != Phase.Closing) revert WrongPhase();
            _close(abi.decode(payload, (uint256)));
            return;
        }
        if (reportKind != KIND_RESULT) revert UnknownReport();
        if (phase() != Phase.Tally) revert WrongPhase();
        (bytes32 reported, uint256[] memory order) = abi.decode(payload, (bytes32, uint256[]));
        if (reported != inputsHash) revert InputMismatch();
        _finalize(order, Finality.Attested);
    }
}
```

`WrongPhase` is the file-scope error of `PoolBase.sol`; import it: `import {SealedPool} from "../SealedPool.sol";` plus `import {WrongPhase} from "../PoolBase.sol";`.

- [ ] **Step 2: Tests**

```solidity
// test/cre/CreReport.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {CreRankedShares} from "../../src/cre/CreRankedShares.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {ZiskFixtureLoader} from "../zisk/ZiskFixtureLoader.sol";

contract CreReportTest is ZiskFixtureLoader {
    address forwarder = makeAddr("forwarder");
    CreRankedShares cpool;

    function setUp() public {
        loadFixture("main");
        newMocks();
        deployAt(
            "CreRankedShares.sol:CreRankedShares",
            abi.encode(
                token, owner, DEADLINE, json.readBytes(".pk"), fxBytes32(".keySalt"), fxWord(".minDirectVote"), ABANDON_GRACE, forwarder
            )
        );
        cpool = CreRankedShares(address(pool));
        replayVoters();
    }

    function resultReport(bytes32 h, uint256[] memory order) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), abi.encode(h, order));
    }

    function test_kindAndInterface() public view {
        assertEq(cpool.kind(), "cre");
        assertEq(cpool.forwarder(), forwarder);
        assertTrue(cpool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(cpool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(cpool.supportsInterface(0xffffffff));
    }

    function test_constructorNeedsAForwarder() public {
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new CreRankedShares(token, owner, DEADLINE, json.readBytes(".pk"), bytes32(0), 0, 1 days, address(0));
    }

    function test_onlyForwarderAndKnownKinds() public {
        vm.expectRevert(CreRankedShares.NotForwarder.selector);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(1))));
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.UnknownReport.selector);
        cpool.onReport("", abi.encode(uint8(9), ""));
    }

    function test_kindTwoClosesInChunks() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(5))));
        assertEq(cpool.closeCursor(), 5);
        assertFalse(cpool.closed());
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(100))));
        vm.stopPrank();
        assertTrue(cpool.closed());
        assertEq(cpool.inputsHash(), fixtureInputsHash());
    }

    function test_kindTwoOnlyInClosing() public {
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    function test_kindOneNeedsTallyAndMatchingHash() public {
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        closeAll(1000);
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.InputMismatch.selector);
        cpool.onReport("", resultReport(bytes32(uint256(1)), order));
        uint256[] memory bad = new uint256[](1);
        bad[0] = 7;
        vm.prank(forwarder);
        vm.expectRevert(SealedPool.InvalidResult.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), bad));
    }

    function test_kindOneFinalisesAsAttestedOnce() public {
        closeAll(1000);
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Attested, order);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Attested));
        assertEq(cpool.fundedProjects(), order);
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        cpool.claim(2);
        assertEq(token.balanceOf(recipient), cpool.cost(2));
    }

    function test_abandonStillWorks() public {
        closeAll(1000);
        vm.warp(DEADLINE + ABANDON_GRACE);
        cpool.abandon();
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Abandoned));
    }
}
```

- [ ] **Step 3: Run and commit**

Run: `forge test --match-contract CreReportTest -vv` then `forge test`.
Expected: all pass.

```bash
forge fmt && git add src/cre test/cre && git commit -m "Add CreRankedShares: the DON's report finalises the pool"
```

---

### Task 7: Deploy scripts

**Files:**
- Create: `script/DeployZiskVerifier.s.sol`, `script/DeployZisk.s.sol`, `script/DeployCre.s.sol`

**Interfaces:**
- Produces three `forge script` entry points driven by environment variables (documented in each file's header). `DeployZisk` reads `rootC` from the deployed verifier (`getRootCVadcopFinal()`), so a pool can never be paired with a verifier built for another PLONK key.
- Consumed by Task 10's runbook and Task 11's anvil script (which uses `E2EAnvil.s.sol`, its own script, but the same constructor arguments).

- [ ] **Step 1: Write the three scripts**

```solidity
// script/DeployZiskVerifier.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";

/// @notice Deploys the ZisK PLONK verifier once per chain.
///
///   forge script script/DeployZiskVerifier.s.sol --rpc-url $RPC_URL --broadcast
///
/// The verifier is tied to the PLONK key it was generated with (`getRootCVadcopFinal`);
/// a new ZisK release means a new verifier and new pools.
contract DeployZiskVerifier is Script {
    function run() external returns (ZiskVerifier verifier) {
        vm.startBroadcast();
        verifier = new ZiskVerifier();
        vm.stopBroadcast();
        console.log("ZiskVerifier deployed at", address(verifier));
        console.log("VERSION:", verifier.VERSION());
        console.log("rootCVadcopFinal:");
        console.logBytes32(verifier.getRootCVadcopFinal());
    }
}
```

```solidity
// script/DeployZisk.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZiskRankedShares} from "../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../src/zisk/IZiskVerifier.sol";

/// @notice Deploys a ZiskRankedShares pool against an already deployed verifier.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> \
///   TALLIER_PK=0x<33 bytes> KEY_SALT=0x<32 bytes> MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 \
///   VERIFIER=0x… PROGRAM_VK=0x<32 bytes> \
///   forge script script/DeployZisk.s.sol --rpc-url $RPC_URL --broadcast
///
/// `TALLIER_PK` comes from `tally-prover keys --salt $KEY_SALT` (the operator's master
/// secret in `TALLIER_MASTER`); `PROGRAM_VK` from `zisk/fixtures/main-calldata.json` or
/// any export of a proof of the current guest. `rootC` is read from the verifier itself.
contract DeployZisk is Script {
    function run() external returns (ZiskRankedShares pool) {
        ZiskVerifier verifier = ZiskVerifier(vm.envAddress("VERIFIER"));
        bytes32 rootC = verifier.getRootCVadcopFinal();
        vm.startBroadcast();
        pool = new ZiskRankedShares(
            IERC20(vm.envAddress("TOKEN")),
            vm.envAddress("OWNER"),
            uint64(vm.envUint("VOTING_DEADLINE")),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            vm.envUint("MIN_DIRECT_VOTE"),
            uint64(vm.envUint("ABANDON_GRACE")),
            IZiskVerifier(address(verifier)),
            vm.envBytes32("PROGRAM_VK"),
            rootC
        );
        vm.stopBroadcast();
        console.log("ZiskRankedShares deployed at", address(pool));
        console.log("rootC (from verifier):");
        console.logBytes32(rootC);
    }
}
```

```solidity
// script/DeployCre.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreRankedShares} from "../src/cre/CreRankedShares.sol";

/// @notice Deploys a CreRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> \
///   TALLIER_PK=0x<33 bytes> KEY_SALT=0x<32 bytes> MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 \
///   FORWARDER=0x… \
///   forge script script/DeployCre.s.sol --rpc-url $RPC_URL --broadcast
///
/// The CRE forwarder on Arc testnet is 0x76c9cf548b4179F8901cda1f8623568b58215E62.
contract DeployCre is Script {
    function run() external returns (CreRankedShares pool) {
        vm.startBroadcast();
        pool = new CreRankedShares(
            IERC20(vm.envAddress("TOKEN")),
            vm.envAddress("OWNER"),
            uint64(vm.envUint("VOTING_DEADLINE")),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            vm.envUint("MIN_DIRECT_VOTE"),
            uint64(vm.envUint("ABANDON_GRACE")),
            vm.envAddress("FORWARDER")
        );
        vm.stopBroadcast();
        console.log("CreRankedShares deployed at", address(pool));
    }
}
```

- [ ] **Step 2: Dry-run the three against a throwaway anvil**

```bash
anvil --silent & ANVIL=$!; sleep 1
export RPC=http://127.0.0.1:8545 PK0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
forge script script/DeployZiskVerifier.s.sol --rpc-url $RPC --private-key $PK0 --broadcast 2>&1 | grep -E "deployed at|rootC|0x564c"
```
Take the verifier address printed, then (values from `reference/vectors/zisk/fixture_main.json` and `zisk/fixtures/main-calldata.json`):

```bash
TOKEN=0x0000000000000000000000000000000000000001 OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 VOTING_DEADLINE=4102444800 \
TALLIER_PK=$(python3 -c "import json;print(json.load(open('reference/vectors/zisk/fixture_main.json'))['pk'])") \
KEY_SALT=$(python3 -c "import json;print(json.load(open('reference/vectors/zisk/fixture_main.json'))['keySalt'])") \
MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 VERIFIER=<address> \
PROGRAM_VK=$(python3 -c "import json;print(json.load(open('zisk/fixtures/main-calldata.json'))['programVK'])") \
forge script script/DeployZisk.s.sol --rpc-url $RPC --private-key $PK0 --broadcast 2>&1 | grep -E "deployed at|rootC"
FORWARDER=0x76c9cf548b4179F8901cda1f8623568b58215E62 TOKEN=… OWNER=… VOTING_DEADLINE=… TALLIER_PK=… KEY_SALT=… MIN_DIRECT_VOTE=… ABANDON_GRACE=… \
forge script script/DeployCre.s.sol --rpc-url $RPC --private-key $PK0 --broadcast 2>&1 | grep "deployed at"
kill $ANVIL
```
Expected: three deployments, the printed `rootC` equal to `0x564c2b1b…4f84382f`. (`TOKEN` may be any address for a dry run: the constructor only rejects the zero address.) Remove the `broadcast/` directory afterwards if it was created (it is git-ignored, but keep the tree clean).

- [ ] **Step 3: Commit**

```bash
forge fmt && forge build && git add script/DeployZiskVerifier.s.sol script/DeployZisk.s.sol script/DeployCre.s.sol
git commit -m "Add deploy scripts for the ZisK verifier and the zisk and cre pools"
```

---

### Task 8: `tally-prover` part 1: keys, encrypt, fetch, check

**Files:**
- Create: `zisk/crates/sealed/src/keys.rs`, `zisk/prover/Cargo.toml`, `zisk/prover/src/lib.rs`, `zisk/prover/src/main.rs`, `zisk/prover/src/chain.rs`, `zisk/prover/src/native.rs`, `zisk/prover/tests/native.rs`
- Modify: `zisk/crates/sealed/src/lib.rs` (`pub mod keys;`), `zisk/crates/sealed/tests/vectors.rs` (key derivation test), `zisk/Cargo.toml` (`members` and `default-members` gain `"prover"`)

**Interfaces:**
- Produces `sealed::keys::{derive_sk(master: &[u8; 32], salt: &[u8; 32]) -> [u8; 32], reduce_mod_n(x: &[u8; 32]) -> [u8; 32]}` (spec Z3: `keccak256(master ‖ salt) mod n`), compiled for both targets (no dependencies).
- Produces the `tally-prover` binary with subcommands `keys`, `encrypt`, `fetch`, `check` (this task) and `prove`, `wrap`, `export`, `submit`, `run` (Task 9). Library API in `tally_prover`: `keys::{master_from_env() -> Result<[u8;32]>, pk_for(master, salt) -> Result<[u8;33]>}`, `native::{check(input_path) -> Result<Report>}` where `Report { inputs_hash: [u8;32], pk: [u8;33], funded_order: Vec<u8>, output_hash: [u8;32] }`, `chain::{fetch(rpc, pool, master) -> Result<TallyInput>, inputs_hash(rpc, pool) -> Result<[u8;32]>}`.
- Environment: `TALLIER_MASTER` = 32-byte hex (the operator's master secret).

- [ ] **Step 1: `sealed::keys` with a test against the fixtures**

Append to `zisk/crates/sealed/tests/vectors.rs`:

```rust
#[test]
fn derive_sk_matches_the_vectors_and_fixtures() {
    let v = load_json("sealed.json");
    for case in v["vectors"].as_array().unwrap() {
        let master: [u8; 32] = hex_arr(case["master"].as_str().unwrap());
        let salt: [u8; 32] = hex_arr(case["keySalt"].as_str().unwrap());
        let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
        assert_eq!(sealed::keys::derive_sk(&master, &salt), sk);
    }
    for s in ["main", "nosealed", "nodirect"] {
        let fx = load_json(&format!("fixture_{s}.json"));
        let master: [u8; 32] = hex_arr(fx["master"].as_str().unwrap());
        let salt: [u8; 32] = hex_arr(fx["keySalt"].as_str().unwrap());
        let sk: [u8; 32] = hex_arr(fx["sk"].as_str().unwrap());
        assert_eq!(sealed::keys::derive_sk(&master, &salt), sk, "{s}");
        let pk: [u8; 33] = hex_arr(fx["pk"].as_str().unwrap());
        assert_eq!(sealed::curve::pubkey(&sk), Some(pk), "{s}");
    }
}

#[test]
fn reduce_mod_n_edges() {
    use sealed::keys::reduce_mod_n;
    let n = hex::decode("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141").unwrap();
    let n: [u8; 32] = n.try_into().unwrap();
    assert_eq!(reduce_mod_n(&[0u8; 32]), [0u8; 32]);
    assert_eq!(reduce_mod_n(&n), [0u8; 32]);
    let mut n_minus_1 = n;
    n_minus_1[31] -= 1;
    assert_eq!(reduce_mod_n(&n_minus_1), n_minus_1);
    let mut n_plus_1 = n;
    n_plus_1[31] += 1;
    let mut one = [0u8; 32];
    one[31] = 1;
    assert_eq!(reduce_mod_n(&n_plus_1), one);
    let mut two = [0u8; 32];
    two[31] = 2;
    // 2^256 − 1 ≡ 2^256 − 1 − n·1 = (2^256 − n) − 1 mod n; check via the identity x = q·n + r with q = 1
    let all_ones = [0xffu8; 32];
    let r = reduce_mod_n(&all_ones);
    // (2^256 − 1) − n fits in 256 bits and is below n, so r must be exactly that difference.
    let mut expected = [0u8; 32];
    let mut borrow = 0u16;
    for i in (0..32).rev() {
        let a = all_ones[i] as i16 - n[i] as i16 - borrow as i16;
        let (val, b) = if a < 0 { (a + 256, 1) } else { (a, 0) };
        expected[i] = val as u8;
        borrow = b;
    }
    assert_eq!(r, expected);
    let _ = two;
}
```

Run `cd zisk && cargo test -p sealed --test vectors` to see the two new tests fail to compile, then write:

```rust
// zisk/crates/sealed/src/keys.rs
//! Tallier key derivation (spec Z3): `sk = keccak256(master ‖ keySalt) mod n`, with n the
//! secp256k1 group order. Dependency-free so it compiles on both targets; the reduction
//! is a shift-and-subtract over four little-endian u64 limbs.

use crate::hash::keccak256;

/// secp256k1 group order, little-endian u64 limbs.
const N: [u64; 4] = [0xBFD25E8CD0364141, 0xBAAEDCE6AF48A03B, 0xFFFFFFFFFFFFFFFE, 0xFFFFFFFFFFFFFFFF];

pub fn derive_sk(master: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(master);
    buf[32..].copy_from_slice(salt);
    reduce_mod_n(&keccak256(&buf))
}

fn geq(a: &[u64; 4], b: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

fn sub_assign(a: &mut [u64; 4], b: &[u64; 4]) {
    let mut borrow = 0u64;
    for i in 0..4 {
        let (d, b1) = a[i].overflowing_sub(b[i]);
        let (d, b2) = d.overflowing_sub(borrow);
        a[i] = d;
        borrow = (b1 | b2) as u64;
    }
}

/// `x mod n` for a 256-bit big-endian `x`. Since `x < 2^256 < 2n`, one conditional
/// subtraction is exact.
pub fn reduce_mod_n(x: &[u8; 32]) -> [u8; 32] {
    let mut limbs = [0u64; 4];
    for i in 0..4 {
        limbs[i] = u64::from_be_bytes(x[32 - 8 * (i + 1)..32 - 8 * i].try_into().unwrap());
    }
    if geq(&limbs, &N) {
        sub_assign(&mut limbs, &N);
    }
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[32 - 8 * (i + 1)..32 - 8 * i].copy_from_slice(&limbs[i].to_be_bytes());
    }
    out
}
```

(`2^256 < 2n` holds for secp256k1: n > 2^255, so a single subtraction is a full reduction; the edge test above checks `2^256 − 1`.) Add `pub mod keys;` to `lib.rs`. Run the tests: green.

- [ ] **Step 2: Prover crate skeleton**

```toml
# zisk/prover/Cargo.toml
[package]
name = "tally-prover"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Takes a closed zisk pool to a Finalized(Proven) transaction"

[lib]
path = "src/lib.rs"

[[bin]]
name = "tally-prover"
path = "src/main.rs"

[dependencies]
sealed = { path = "../crates/sealed" }
pbear = { path = "../crates/pbear" }
alloy = { version = "2.4", features = ["full"] }
clap = { version = "4.5", features = ["derive"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
eyre = "0.6"
hex = "0.4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rand = "0.8"
```

Add `"prover"` to both `members` and `default-members` in `zisk/Cargo.toml`.

```rust
// zisk/prover/src/lib.rs
//! The operator's prover for the zisk variant (spec Z6). `main.rs` is the clap surface;
//! everything it does lives here so tests and the future service can call it.

pub mod chain;
pub mod keys;
pub mod native;
pub mod pipeline;

pub use eyre::{eyre, Result};
```

(`pipeline` is Task 9's; create it as an empty file with a doc comment now so the crate compiles, or add the line in Task 9. Add it in Task 9.)

```rust
// zisk/prover/src/keys.rs
//! Operator key material: the master secret from `TALLIER_MASTER`, per-pool keys by salt.

use crate::{eyre, Result};

pub const MASTER_ENV: &str = "TALLIER_MASTER";

pub fn parse_hex32(s: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(s.trim().trim_start_matches("0x"))?;
    bytes.try_into().map_err(|_| eyre!("expected 32 bytes"))
}

pub fn master_from_env() -> Result<[u8; 32]> {
    let raw = std::env::var(MASTER_ENV).map_err(|_| eyre!("{MASTER_ENV} is not set"))?;
    parse_hex32(&raw)
}

pub fn sk_for(master: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    sealed::keys::derive_sk(master, salt)
}

pub fn pk_for(master: &[u8; 32], salt: &[u8; 32]) -> Result<[u8; 33]> {
    sealed::curve::pubkey(&sk_for(master, salt)).ok_or_else(|| eyre!("derived key is zero; choose another salt"))
}

/// A fresh random nonce below the group order, for `encrypt`.
pub fn random_scalar() -> [u8; 32] {
    use rand::RngCore;
    loop {
        let mut k = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut k);
        let k = sealed::keys::reduce_mod_n(&k);
        if k != [0u8; 32] {
            return k;
        }
    }
}
```

```rust
// zisk/prover/src/native.rs
//! Native execution of the guest logic on an input file: what `check` prints and what
//! `export` and `submit` use to know the funded order.

use crate::{eyre, Result};
use sealed::types::TallyInput;
use sealed::{io, tally};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub inputs_hash: [u8; 32],
    pub pk: [u8; 33],
    pub funded_order: Vec<u8>,
    pub output_hash: [u8; 32],
    pub voters: usize,
}

/// Reads a framed input file (`u64 LE length ‖ bincode ‖ padding`) back into a `TallyInput`.
pub fn read_input(path: &Path) -> Result<TallyInput> {
    let framed = std::fs::read(path)?;
    if framed.len() < 8 {
        return Err(eyre!("input file too short"));
    }
    let len = u64::from_le_bytes(framed[..8].try_into().unwrap()) as usize;
    if framed.len() < 8 + len {
        return Err(eyre!("input file truncated"));
    }
    io::decode_input(&framed[8..8 + len]).map_err(|e| eyre!("cannot decode input: {e}"))
}

pub fn write_input(path: &Path, input: &TallyInput) -> Result<()> {
    std::fs::write(path, io::frame(&io::encode_input(input)))?;
    Ok(())
}

pub fn check(path: &Path) -> Result<Report> {
    let input = read_input(path)?;
    let out = tally::run(&input).map_err(|e| eyre!("guest logic rejected the input: {e}"))?;
    Ok(Report {
        inputs_hash: out.inputs_hash,
        pk: out.pk,
        funded_order: out.funded_order,
        output_hash: out.output_hash,
        voters: input.voters.len(),
    })
}

impl Report {
    pub fn print(&self) {
        println!("voters      {}", self.voters);
        println!("inputsHash  0x{}", hex::encode(self.inputs_hash));
        println!("pk          0x{}", hex::encode(self.pk));
        println!("fundedOrder {:?}", self.funded_order);
        println!("outputHash  0x{}", hex::encode(self.output_hash));
    }
}
```

```rust
// zisk/prover/src/chain.rs
//! Chain access: rebuild the witness from a pool's public reads, read its inputsHash,
//! send `finalize`.

use crate::{eyre, Result};
use alloy::primitives::{Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use sealed::types::{TallyInput, VoterIn};

sol! {
    #[sol(rpc)]
    interface ISealedPool {
        function votersFrom(uint256 start, uint256 count) external view returns (address[] memory who, uint256[] memory direct, uint256[] memory seats, bytes[] memory ballots, bytes[] memory cts);
        function costs() external view returns (uint256[] memory);
        function totalWeight() external view returns (uint256);
        function keySalt() external view returns (bytes32);
        function inputsHash() external view returns (bytes32);
        function closed() external view returns (bool);
        function tallierPk() external view returns (bytes memory);
        function finality() external view returns (uint8);
        function fundedProjects() external view returns (uint256[] memory);
        function finalize(uint256[] calldata fundedOrder, bytes calldata publicValues, bytes calldata proofBytes) external;
    }
}

const PAGE: u64 = 200;

fn u64_of(v: U256) -> Result<u64> {
    u64::try_from(v).map_err(|_| eyre!("value {v} does not fit u64; the pool caps weights at 2^64 - 1"))
}

/// Every input the guest needs, read from the pool. The private key is derived from the
/// master secret and the pool's `keySalt`; nothing else is secret.
pub async fn fetch(rpc: &str, pool: Address, master: &[u8; 32]) -> Result<TallyInput> {
    let provider = ProviderBuilder::new().connect_http(rpc.parse()?);
    let chain_id = provider.get_chain_id().await?;
    let c = ISealedPool::new(pool, &provider);
    let salt: [u8; 32] = c.keySalt().call().await?.0;
    let costs: Vec<u64> = c.costs().call().await?.into_iter().map(u64_of).collect::<Result<_>>()?;
    let total_weight = u64_of(c.totalWeight().call().await?)?;
    let mut voters = Vec::new();
    let mut start = 0u64;
    loop {
        let page = c.votersFrom(U256::from(start), U256::from(PAGE)).call().await?;
        if page.who.is_empty() {
            break;
        }
        for i in 0..page.who.len() {
            voters.push(VoterIn {
                addr: page.who[i].into_array(),
                direct_weight: u64_of(page.direct[i])?,
                seat_weight: u64_of(page.seats[i])?,
                direct_ballot: page.ballots[i].to_vec(),
                ciphertext: page.cts[i].to_vec(),
            });
        }
        start += page.who.len() as u64;
    }
    Ok(TallyInput {
        chain_id,
        pool: pool.into_array(),
        sk: crate::keys::sk_for(master, &salt),
        costs,
        total_weight,
        voters,
    })
}

pub struct PoolState {
    pub closed: bool,
    pub inputs_hash: [u8; 32],
    pub finality: u8,
    pub tallier_pk: Vec<u8>,
}

pub async fn state(rpc: &str, pool: Address) -> Result<PoolState> {
    let provider = ProviderBuilder::new().connect_http(rpc.parse()?);
    let c = ISealedPool::new(pool, &provider);
    Ok(PoolState {
        closed: c.closed().call().await?,
        inputs_hash: c.inputsHash().call().await?.0,
        finality: c.finality().call().await?,
        tallier_pk: c.tallierPk().call().await?.to_vec(),
    })
}

/// Sends `finalize`. Returns the transaction hash; errors if the receipt is not a success.
pub async fn finalize(
    rpc: &str,
    pool: Address,
    key_hex: &str,
    funded_order: &[u8],
    public_values: &[u8],
    proof_bytes: &[u8],
) -> Result<String> {
    let signer: PrivateKeySigner = key_hex.trim().parse()?;
    let provider = ProviderBuilder::new().wallet(signer).connect_http(rpc.parse()?);
    let c = ISealedPool::new(pool, &provider);
    let order: Vec<U256> = funded_order.iter().map(|&id| U256::from(id)).collect();
    let receipt = c
        .finalize(order, Bytes::copy_from_slice(public_values), Bytes::copy_from_slice(proof_bytes))
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        return Err(eyre!("finalize reverted in {}", receipt.transaction_hash));
    }
    Ok(format!("{}", receipt.transaction_hash))
}
```

If alloy 2.4's generated bindings differ (for instance `call()` on a multi-return function returning the tuple struct under a different name, or `Bytes::from(vec)` instead of `copy_from_slice`), adapt to the real API: `cargo doc -p alloy --no-deps` is slow, so read the generated code's compile errors, which name the types. Do not change the observable behaviour.

```rust
// zisk/prover/src/main.rs
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tally_prover::{chain, keys, native, Result};

#[derive(Parser)]
#[command(name = "tally-prover", about = "Prove a zisk pool's tally and finalise it on chain")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the tallier public key for a pool salt (master secret from TALLIER_MASTER).
    Keys {
        #[arg(long)]
        salt: String,
    },
    /// Encrypt a ballot for a pool: prints the ciphertext to pass to voteSealed.
    Encrypt {
        #[arg(long)]
        pk: String,
        #[arg(long)]
        voter: String,
        /// Competition ranks, one per project, e.g. 1,2,2,0
        #[arg(long)]
        ranks: String,
    },
    /// Read a closed pool and write the guest input.
    Fetch {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        out: PathBuf,
    },
    /// Run the guest logic natively on an input file; with --rpc/--pool, compare inputsHash with the chain.
    Check {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        rpc: Option<String>,
        #[arg(long)]
        pool: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Keys { salt } => {
            let master = keys::master_from_env()?;
            let pk = keys::pk_for(&master, &keys::parse_hex32(&salt)?)?;
            println!("0x{}", hex::encode(pk));
        }
        Cmd::Encrypt { pk, voter, ranks } => {
            let pk: [u8; 33] = hex::decode(pk.trim_start_matches("0x"))?
                .try_into()
                .map_err(|_| tally_prover::eyre!("pk must be 33 bytes"))?;
            let voter: [u8; 20] = hex::decode(voter.trim_start_matches("0x"))?
                .try_into()
                .map_err(|_| tally_prover::eyre!("voter must be 20 bytes"))?;
            let ranks: Vec<u8> = ranks.split(',').map(|r| r.trim().parse::<u8>()).collect::<std::result::Result<_, _>>()?;
            let ct = sealed::ballot::encrypt(&pk, &voter, &ranks, &keys::random_scalar())
                .ok_or_else(|| tally_prover::eyre!("invalid public key"))?;
            println!("0x{}", hex::encode(ct));
        }
        Cmd::Fetch { rpc, pool, out } => {
            let master = keys::master_from_env()?;
            let input = chain::fetch(&rpc, pool.parse()?, &master).await?;
            native::write_input(&out, &input)?;
            println!("wrote {} ({} voters, {} projects)", out.display(), input.voters.len(), input.costs.len());
        }
        Cmd::Check { input, rpc, pool } => {
            let report = native::check(&input)?;
            report.print();
            if let (Some(rpc), Some(pool)) = (rpc, pool) {
                let st = chain::state(&rpc, pool.parse()?).await?;
                if !st.closed {
                    return Err(tally_prover::eyre!("pool is not closed yet; run close() first"));
                }
                if st.inputs_hash != report.inputs_hash {
                    return Err(tally_prover::eyre!(
                        "inputsHash mismatch: chain 0x{} vs input 0x{}",
                        hex::encode(st.inputs_hash),
                        hex::encode(report.inputs_hash)
                    ));
                }
                if st.tallier_pk != report.pk {
                    return Err(tally_prover::eyre!("the pool's tallierPk is not the key derived from TALLIER_MASTER"));
                }
                println!("chain       inputsHash and tallierPk match");
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Native test**

```rust
// zisk/prover/tests/native.rs
use sealed::fixture::{hex_arr, hex_bytes, input_of, load_json};
use tally_prover::{keys, native};

#[test]
fn check_reproduces_the_fixture_and_keys_match() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    let dir = std::env::temp_dir().join(format!("tally-prover-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("main.bin");
    native::write_input(&path, &input).unwrap();
    let report = native::check(&path).unwrap();
    assert_eq!(hex::encode(report.output_hash), fx["outputHash"].as_str().unwrap().trim_start_matches("0x"));
    assert_eq!(report.voters, 18);

    let master: [u8; 32] = hex_arr(fx["master"].as_str().unwrap());
    let salt: [u8; 32] = hex_arr(fx["keySalt"].as_str().unwrap());
    assert_eq!(keys::pk_for(&master, &salt).unwrap().to_vec(), hex_bytes(fx["pk"].as_str().unwrap()));
    assert_eq!(keys::sk_for(&master, &salt), input.sk);

    // encrypt with a fresh nonce round-trips through the fixture key
    let pk: [u8; 33] = hex_arr(fx["pk"].as_str().unwrap());
    let voter: [u8; 20] = hex_arr(fx["voters"][0]["addr"].as_str().unwrap());
    let ranks = vec![1u8, 2, 3, 0];
    let ct = sealed::ballot::encrypt(&pk, &voter, &ranks, &keys::random_scalar()).unwrap();
    assert_eq!(sealed::ballot::decrypt(&input.sk, &voter, &ct, 4), Some(ranks));
    std::fs::remove_dir_all(dir).unwrap();
}
```

- [ ] **Step 4: Build, test, try the CLI, commit**

```bash
cd zisk && cargo build -p tally-prover && cargo test
TALLIER_MASTER=$(python3 -c "import json;print(json.load(open('../reference/vectors/zisk/fixture_main.json'))['master'])") \
  cargo run -q -p tally-prover -- keys --salt $(python3 -c "import json;print(json.load(open('../reference/vectors/zisk/fixture_main.json'))['keySalt'])")
cargo run -q -p tally-prover -- check --input proofs/main.bin
```
Expected: the `keys` output equals the fixture's `pk`; `check` prints the fixture's `outputHash` and `fundedOrder [1, 2, 0]`. The first alloy build takes several minutes. `fetch` and `check --rpc` are exercised end to end in Task 11.

```bash
git add zisk/Cargo.toml zisk/Cargo.lock zisk/crates/sealed zisk/prover
git commit -m "Add tally-prover: keys, encrypt, fetch and native check"
```

---

### Task 9: `tally-prover` part 2: prove, wrap, export, submit, run

**Files:**
- Create: `zisk/prover/src/pipeline.rs`, `zisk/prover/tests/pipeline.rs`
- Modify: `zisk/prover/src/lib.rs` (`pub mod pipeline;`), `zisk/prover/src/main.rs` (five subcommands)

**Interfaces:**
- Produces `tally_prover::pipeline::{Tools, prove(&Tools, input, elf, out) -> Result<()>, wrap(&Tools, stark, out) -> Result<()>, export(&Tools, plonk, input, out) -> Result<Calldata>, load_calldata(path) -> Result<Calldata>, expected_public_values(hash) -> Vec<u8>}` and the serde struct `Calldata { program_vk: String, root_c_vadcop_final: String, public_values: String, proof_bytes: String, funded_order: Vec<u8>, inputs_hash: String, output_hash: String }` (JSON keys `programVK`, `rootCVadcopFinal`, `publicValues`, `proofBytes`, `fundedOrder`, `inputsHash`, `outputHash`; the first four exactly as `cargo-zisk-dev export-solidity-calldata` writes them, so `zisk/fixtures/main-calldata.json` loads with the last three absent).
- `Tools` resolves the binaries and keys: env `CARGO_ZISK` (default `~/.zisk/bin/cargo-zisk`), `CARGO_ZISK_DEV` (default `~/.zisk/bin/cargo-zisk-dev`), `ZISK_PROVING_KEY` (default `~/.zisk/provingKey`), `ZISK_PROVING_KEY_SNARK` (default `~/.zisk/provingKeySnark`), `TALLY_GUEST_ELF` (default `<workspace>/target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest`); every spawned process gets `HWLOC_COMPONENTS=-gl` and `GLIBC_TUNABLES=glibc.rtld.execstack=2`.
- CLI: `prove --input --out [--elf]`, `wrap --proof --out`, `export --proof --input --out`, `submit --rpc --pool --calldata --key-env NAME [--input]`, `run --rpc --pool --workdir DIR --key-env NAME [--skip-prove]` (fetch → check → prove → wrap → export → submit; `--skip-prove` reuses `DIR/calldata.json` if present, for a pool whose proof already exists).

- [ ] **Step 1: Failing tests for the pure parts**

```rust
// zisk/prover/tests/pipeline.rs
use tally_prover::pipeline::{expected_public_values, load_calldata};

#[test]
fn committed_calldata_loads_and_matches_the_fixture_layout() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cd = load_calldata(&root.join("zisk/fixtures/main-calldata.json")).unwrap();
    assert_eq!(cd.public_values.len(), 2 + 1024);
    assert!(cd.funded_order.is_empty(), "the exporter's file carries no fundedOrder");
    let fx = sealed::fixture::load_json("fixture_main.json");
    let hash: [u8; 32] = sealed::fixture::hex_arr(fx["outputHash"].as_str().unwrap());
    let pv = hex::decode(cd.public_values.trim_start_matches("0x")).unwrap();
    assert_eq!(pv, expected_public_values(&hash));
}

#[test]
fn expected_public_values_layout() {
    let mut h = [0u8; 32];
    for (i, b) in h.iter_mut().enumerate() {
        *b = i as u8 + 1;
    }
    let pv = expected_public_values(&h);
    assert_eq!(pv.len(), 512);
    assert_eq!(&pv[..8], &[1, 2, 3, 4, 0, 0, 0, 0]);
    assert_eq!(&pv[56..64], &[29, 30, 31, 32, 0, 0, 0, 0]);
    assert!(pv[64..].iter().all(|&b| b == 0));
}
```

- [ ] **Step 2: Implement**

```rust
// zisk/prover/src/pipeline.rs
//! The proving pipeline as processes: `cargo-zisk prove`, `cargo-zisk wrap`,
//! `cargo-zisk-dev export-solidity-calldata`, with the environment this machine needs.
//! Prove and wrap are separate processes on purpose: together they exhaust a 30 GB box.

use crate::{eyre, native, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Tools {
    pub cargo_zisk: PathBuf,
    pub cargo_zisk_dev: PathBuf,
    pub proving_key: PathBuf,
    pub proving_key_snark: PathBuf,
    pub guest_elf: PathBuf,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

fn env_path(name: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(name).map(PathBuf::from).unwrap_or(default)
}

impl Tools {
    pub fn from_env() -> Self {
        let zisk = home().join(".zisk");
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        Tools {
            cargo_zisk: env_path("CARGO_ZISK", zisk.join("bin/cargo-zisk")),
            cargo_zisk_dev: env_path("CARGO_ZISK_DEV", zisk.join("bin/cargo-zisk-dev")),
            proving_key: env_path("ZISK_PROVING_KEY", zisk.join("provingKey")),
            proving_key_snark: env_path("ZISK_PROVING_KEY_SNARK", zisk.join("provingKeySnark")),
            guest_elf: env_path(
                "TALLY_GUEST_ELF",
                workspace.join("target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest"),
            ),
        }
    }
}

fn run(cmd: &mut Command, what: &str) -> Result<()> {
    cmd.env("HWLOC_COMPONENTS", "-gl").env("GLIBC_TUNABLES", "glibc.rtld.execstack=2");
    eprintln!("$ {cmd:?}");
    let status = cmd.status().map_err(|e| eyre!("cannot start {what}: {e}"))?;
    if !status.success() {
        return Err(eyre!("{what} failed with {status}"));
    }
    Ok(())
}

pub fn prove(t: &Tools, input: &Path, out: &Path) -> Result<()> {
    if !t.guest_elf.exists() {
        return Err(eyre!("guest ELF not found at {}; build it with cargo-zisk", t.guest_elf.display()));
    }
    run(
        Command::new(&t.cargo_zisk)
            .args(["prove", "-e"])
            .arg(&t.guest_elf)
            .arg("-i")
            .arg(input)
            .arg("-k")
            .arg(&t.proving_key)
            .arg("-o")
            .arg(out)
            .arg("-y"),
        "cargo-zisk prove",
    )
}

pub fn wrap(t: &Tools, stark: &Path, out: &Path) -> Result<()> {
    run(
        Command::new(&t.cargo_zisk)
            .args(["wrap", "-p"])
            .arg(stark)
            .arg("-k")
            .arg(&t.proving_key)
            .arg("-w")
            .arg(&t.proving_key_snark)
            .arg("--plonk")
            .arg("-o")
            .arg(out),
        "cargo-zisk wrap",
    )
}

/// The four fields the verifier takes plus what `submit` needs. Loads the exporter's
/// own file (four fields) as well as ours.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Calldata {
    #[serde(rename = "programVK")]
    pub program_vk: String,
    #[serde(rename = "rootCVadcopFinal")]
    pub root_c_vadcop_final: String,
    #[serde(rename = "publicValues")]
    pub public_values: String,
    #[serde(rename = "proofBytes")]
    pub proof_bytes: String,
    #[serde(rename = "fundedOrder", default)]
    pub funded_order: Vec<u8>,
    #[serde(rename = "inputsHash", default)]
    pub inputs_hash: String,
    #[serde(rename = "outputHash", default)]
    pub output_hash: String,
}

pub fn load_calldata(path: &Path) -> Result<Calldata> {
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

/// ZisK's on-chain form of 32 committed bytes (spec Z5 step 2).
pub fn expected_public_values(hash: &[u8; 32]) -> Vec<u8> {
    let mut pv = vec![0u8; 512];
    for i in 0..8 {
        pv[8 * i..8 * i + 4].copy_from_slice(&hash[4 * i..4 * i + 4]);
    }
    pv
}

/// Exports the calldata of a wrapped proof and adds the native run's result, refusing
/// to write a file whose public values do not encode that result.
pub fn export(t: &Tools, plonk: &Path, input: &Path, out: &Path) -> Result<Calldata> {
    let tmp = out.with_extension("exporter.json");
    run(
        Command::new(&t.cargo_zisk_dev).args(["export-solidity-calldata", "-p"]).arg(plonk).arg("-o").arg(&tmp),
        "cargo-zisk-dev export-solidity-calldata",
    )?;
    let mut cd = load_calldata(&tmp)?;
    std::fs::remove_file(&tmp).ok();
    let report = native::check(input)?;
    let pv = hex::decode(cd.public_values.trim_start_matches("0x"))?;
    if pv != expected_public_values(&report.output_hash) {
        return Err(eyre!("the proof's public values do not encode this input's output hash"));
    }
    if cd.root_c_vadcop_final == cd.program_vk {
        return Err(eyre!("rootCVadcopFinal equals programVK: cargo-zisk lacks the fix of ZisK PR #1299"));
    }
    cd.funded_order = report.funded_order;
    cd.inputs_hash = format!("0x{}", hex::encode(report.inputs_hash));
    cd.output_hash = format!("0x{}", hex::encode(report.output_hash));
    std::fs::write(out, serde_json::to_string_pretty(&cd)? + "\n")?;
    Ok(cd)
}
```

Extend `main.rs` with the new subcommands (add to `Cmd` and the `match`):

```rust
    /// STARK-prove an input file with the guest (about 16 minutes and 26 GB on the reference machine).
    Prove {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Wrap a STARK proof into a PLONK proof (about 11 minutes).
    Wrap {
        #[arg(long)]
        proof: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Export the Solidity calldata of a PLONK proof, with the funded order of the input.
    Export {
        #[arg(long)]
        proof: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Send finalize() with a calldata file. The signing key is read from the named env var.
    Submit {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        calldata: PathBuf,
        #[arg(long, default_value = "SUBMITTER_KEY")]
        key_env: String,
        /// Needed when the calldata file has no fundedOrder (the exporter's raw file).
        #[arg(long)]
        input: Option<PathBuf>,
    },
    /// fetch, check, prove, wrap, export, submit in one go inside --workdir.
    Run {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        workdir: PathBuf,
        #[arg(long, default_value = "SUBMITTER_KEY")]
        key_env: String,
        /// Reuse <workdir>/calldata.json instead of proving.
        #[arg(long)]
        skip_prove: bool,
    },
```

```rust
        Cmd::Prove { input, out } => pipeline::prove(&pipeline::Tools::from_env(), &input, &out)?,
        Cmd::Wrap { proof, out } => pipeline::wrap(&pipeline::Tools::from_env(), &proof, &out)?,
        Cmd::Export { proof, input, out } => {
            let cd = pipeline::export(&pipeline::Tools::from_env(), &proof, &input, &out)?;
            println!("wrote {} (fundedOrder {:?}, programVK {})", out.display(), cd.funded_order, cd.program_vk);
        }
        Cmd::Submit { rpc, pool, calldata, key_env, input } => {
            let mut cd = pipeline::load_calldata(&calldata)?;
            if cd.funded_order.is_empty() {
                let input = input.ok_or_else(|| tally_prover::eyre!("calldata has no fundedOrder; pass --input"))?;
                cd.funded_order = native::check(&input)?.funded_order;
            }
            let key = std::env::var(&key_env).map_err(|_| tally_prover::eyre!("{key_env} is not set"))?;
            let tx = chain::finalize(
                &rpc,
                pool.parse()?,
                &key,
                &cd.funded_order,
                &hex::decode(cd.public_values.trim_start_matches("0x"))?,
                &hex::decode(cd.proof_bytes.trim_start_matches("0x"))?,
            )
            .await?;
            println!("finalized in {tx}");
        }
        Cmd::Run { rpc, pool, workdir, key_env, skip_prove } => {
            std::fs::create_dir_all(&workdir)?;
            let tools = pipeline::Tools::from_env();
            let master = keys::master_from_env()?;
            let pool_addr = pool.parse()?;
            let input = workdir.join("input.bin");
            native::write_input(&input, &chain::fetch(&rpc, pool_addr, &master).await?)?;
            let report = native::check(&input)?;
            report.print();
            let st = chain::state(&rpc, pool_addr).await?;
            if !st.closed || st.inputs_hash != report.inputs_hash {
                return Err(tally_prover::eyre!("pool not closed or inputsHash mismatch; refusing to prove"));
            }
            let calldata = workdir.join("calldata.json");
            if !(skip_prove && calldata.exists()) {
                let stark = workdir.join("stark.bin");
                let plonk = workdir.join("plonk.bin");
                pipeline::prove(&tools, &input, &stark)?;
                pipeline::wrap(&tools, &stark, &plonk)?;
                pipeline::export(&tools, &plonk, &input, &calldata)?;
            }
            let cd = pipeline::load_calldata(&calldata)?;
            let pv = hex::decode(cd.public_values.trim_start_matches("0x"))?;
            if pv != pipeline::expected_public_values(&report.output_hash) {
                return Err(tally_prover::eyre!("{} does not belong to this pool's input", calldata.display()));
            }
            let key = std::env::var(&key_env).map_err(|_| tally_prover::eyre!("{key_env} is not set"))?;
            let order = if cd.funded_order.is_empty() { report.funded_order.clone() } else { cd.funded_order.clone() };
            let tx = chain::finalize(&rpc, pool_addr, &key, &order, &pv, &hex::decode(cd.proof_bytes.trim_start_matches("0x"))?).await?;
            println!("finalized in {tx}");
        }
```

- [ ] **Step 3: Test and commit**

```bash
cd zisk && cargo test -p tally-prover && cargo build -p tally-prover
cargo run -q -p tally-prover -- export --help
```
Expected: both pipeline tests pass. The process-spawning functions are exercised by Task 11's slow path and by the operator; do not run `prove` here.

```bash
git add zisk/prover && git commit -m "Add the tally-prover pipeline: prove, wrap, export, submit, run"
```

---

### Task 10: Arc testnet precompile probe and the deployment runbook

**Files:**
- Create: `src/zisk/VerifierProbe.sol`, `script/ArcProbe.s.sol`, `zisk/scripts/arc-probe.sh`, `docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md`

**Interfaces:**
- Produces `zisk/scripts/arc-probe.sh [RPC_URL]` (default `https://rpc.testnet.arc.io`): exits 0 iff the chain's EVM verifies the committed proof, using `cast call --create` on a contract whose constructor deploys the verifier and calls it, so no funds or deployment are needed (spec Z10.3).
- Produces the runbook for the funded steps (verifier and pool deployment on Arc, a vote, `close`, `tally-prover run`) that nobody can run without a faucet-funded key.

- [ ] **Step 1: The probe contract and its script**

```solidity
// src/zisk/VerifierProbe.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ZiskVerifier} from "./ZiskVerifier.sol";

/// @dev Deploys the verifier and verifies one proof inside its own constructor, then
///      returns `1` as its runtime code. `eth_call` of its creation code therefore answers
///      "does this chain's EVM (BN254 precompiles included) accept ZisK proofs?" without
///      a funded account: the result is 32 bytes ending in 0x01, or a revert.
contract VerifierProbe {
    constructor(bytes32 programVK, bytes32 rootC, bytes memory publicValues, bytes memory proofBytes) {
        ZiskVerifier verifier = new ZiskVerifier();
        verifier.verifySnarkProof(programVK, rootC, publicValues, proofBytes);
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}
```

```solidity
// script/ArcProbe.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {VerifierProbe} from "../src/zisk/VerifierProbe.sol";

/// @notice Writes the creation bytecode of a VerifierProbe for the committed proof to
///         zisk/proofs/arc-probe.hex; zisk/scripts/arc-probe.sh sends it with
///         `cast call --create`. Runs locally, no RPC, no broadcast.
contract ArcProbe is Script {
    using stdJson for string;

    function run() external {
        string memory json = vm.readFile("zisk/fixtures/main-calldata.json");
        bytes memory initcode = abi.encodePacked(
            type(VerifierProbe).creationCode,
            abi.encode(
                json.readBytes32(".programVK"),
                json.readBytes32(".rootCVadcopFinal"),
                json.readBytes(".publicValues"),
                json.readBytes(".proofBytes")
            )
        );
        vm.writeFile("zisk/proofs/arc-probe.hex", vm.toString(initcode));
        console.log("initcode bytes:", initcode.length);
    }
}
```

```bash
#!/usr/bin/env bash
# zisk/scripts/arc-probe.sh [RPC_URL]
# Asks a chain's EVM to verify the committed ZisK proof without deploying anything:
# eth_call of a creation transaction whose constructor runs the verifier. Prints the
# returned code (32 bytes ending in 01 on success) and exits non-zero on a revert.
set -euo pipefail
rpc=${1:-https://rpc.testnet.arc.io}
here=$(cd "$(dirname "$0")/../.." && pwd)
cd "$here"
mkdir -p zisk/proofs
forge script script/ArcProbe.s.sol -q >/dev/null
code=$(cat zisk/proofs/arc-probe.hex)
echo "rpc      $rpc"
echo "initcode $(( (${#code} - 2) / 2 )) bytes"
out=$(cast call --rpc-url "$rpc" --create "$code")
echo "returned $out"
[ "$out" = "0x0000000000000000000000000000000000000000000000000000000000000001" ]
```

`chmod +x zisk/scripts/arc-probe.sh`.

- [ ] **Step 2: Run it against anvil first, then Arc testnet**

```bash
anvil --silent & ANVIL=$!; sleep 1
zisk/scripts/arc-probe.sh http://127.0.0.1:8545; echo "anvil exit=$?"
kill $ANVIL
zisk/scripts/arc-probe.sh; echo "arc exit=$?"
```
Expected: `returned 0x…01`, exit 0 on both. If Arc returns a revert while anvil succeeds, capture the error and record it in the runbook: that is the spike's finding (a missing BN254 precompile or a gas cap on `eth_call`), and plan B's Arc deployment is blocked until it is understood. If the initcode exceeds the EIP-3860 limit (49 152 bytes), the probe cannot be used on chains enforcing it; check `initcode bytes` in the output first (it should be about 20 KB).

- [ ] **Step 3: The runbook**

Write `docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md`:

```markdown
# zisk variant on Arc testnet: runbook

Everything here needs a key funded from https://faucet.circle.com (Arc testnet, chain id
5042002, gas paid in USDC; the ERC-20 view of USDC is 0x3600000000000000000000000000000000000000
with 6 decimals). Until then, `zisk/scripts/arc-probe.sh` is the only Arc step that runs;
its result on <date>: <paste the `returned` line>.

Environment for every command: `export RPC=https://rpc.testnet.arc.io`, the deployer key in
`DEPLOYER_KEY`, the operator's `TALLIER_MASTER` (32-byte hex, kept off the repo), and the
ZisK machine variables of `zisk/README.md`.

1. Verifier, once per chain:
   `forge script script/DeployZiskVerifier.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast`
   Note the address as `VERIFIER`; the printed rootC must be 0x564c2b1b…4f84382f.
2. Pool key: `KEY_SALT=$(cast keccak "pool-1")` (any fresh 32 bytes), then
   `TALLIER_PK=$(cd zisk && cargo run -q -p tally-prover -- keys --salt $KEY_SALT)`.
3. Pool: `TOKEN=0x3600000000000000000000000000000000000000 OWNER=<deployer> VOTING_DEADLINE=<unix> TALLIER_PK=… KEY_SALT=… MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 VERIFIER=… PROGRAM_VK=$(jq -r .programVK zisk/fixtures/main-calldata.json) forge script script/DeployZisk.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast`
   (`PROGRAM_VK` is the VK of the guest that produced the committed proof; a rebuilt guest means a new VK and a new pool.)
4. Setup: `cast send $POOL "addProject(uint256,address)" 50000000 <recipient>` per project, then `cast send $POOL "openVoting()"`.
5. Votes: contributions with `cast send $TOKEN "approve(address,uint256)"` + `cast send $POOL "contribute(uint256)"`, public ballots `cast send $POOL "vote(bytes)" 0x01020300`, seats `cast send $POOL "sponsor(uint256,address[])" 30000000 "[<member>]"`, sealed ballots `CT=$(cd zisk && cargo run -q -p tally-prover -- encrypt --pk $TALLIER_PK --voter <member> --ranks 1,2,3,0)` then `cast send $POOL "voteSealed(bytes)" $CT` from the member.
6. After the deadline: `cast send $POOL "close(uint256)" 200` until `cast call $POOL "closed()(bool)"` is true.
7. On the operator machine: `SUBMITTER_KEY=$DEPLOYER_KEY cargo run -p tally-prover -- run --rpc $RPC --pool $POOL --workdir /tmp/pool-1` (about 30 minutes; fetch, check, prove, wrap, export, submit).
8. `cast call $POOL "finality()(uint8)"` is 1 (`Proven`); `cast call $POOL "fundedProjects()(uint256[])"`; `cast send $POOL "claim(uint256)" 0`.

Evidence for the submission: the `Finalized` event on https://testnet.arcscan.app and `/tmp/pool-1/calldata.json`.
```

Fill in the date and the probe's result line.

- [ ] **Step 4: Commit**

```bash
forge fmt && forge build && git add src/zisk/VerifierProbe.sol script/ArcProbe.s.sol zisk/scripts/arc-probe.sh docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md
git commit -m "Probe Arc testnet's EVM with the committed proof and write the Arc runbook"
```

---

### Task 11: End to end on anvil with the committed proof

**Files:**
- Create: `script/E2EAnvil.s.sol`, `zisk/scripts/e2e-anvil.sh`

**Interfaces:**
- Produces `zisk/scripts/e2e-anvil.sh [--prove]`: starts anvil, deploys token, NFT, verifier and pool at the fixture address, replays the `main` roster through `cast` with impersonated voters, closes, runs `tally-prover fetch` and `check --rpc`, then finalises with the committed calldata (`--prove` proves afresh instead, about 30 minutes) and checks `finality == Proven` and a claim. Exit 0 on success; anvil is stopped on exit.
- `E2EAnvil.s.sol` deploys the four contracts from anvil's account 0 in the fixed order (nonces 0..3) and asserts the pool landed at the fixture address; it reads `fixture_main.json` and `main-calldata.json` for parameters and `VOTING_DEADLINE` from the environment.

- [ ] **Step 1: The deploy script**

```solidity
// script/E2EAnvil.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZiskRankedShares} from "../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../src/zisk/IZiskVerifier.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockERC721} from "../test/mocks/MockERC721.sol";

/// @notice Local end-to-end setup: on a fresh anvil, from account 0, deploys the mock
///         token (nonce 0), the mock NFT (1), the verifier (2) and the pool (3), so the
///         pool lands at the fixture's address and the committed proof verifies against it.
///
///   VOTING_DEADLINE=<unix> forge script script/E2EAnvil.s.sol --rpc-url http://127.0.0.1:8545 \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
contract E2EAnvil is Script {
    using stdJson for string;

    error PoolAddressMismatch(address got, address want);

    function run() external {
        string memory fx = vm.readFile("reference/vectors/zisk/fixture_main.json");
        string memory cd = vm.readFile("zisk/fixtures/main-calldata.json");
        address want = fx.readAddress(".pool");
        uint64 deadline = uint64(vm.envUint("VOTING_DEADLINE"));

        vm.startBroadcast();
        MockERC20 token = new MockERC20();
        MockERC721 nft = new MockERC721();
        ZiskVerifier verifier = new ZiskVerifier();
        ZiskRankedShares pool = new ZiskRankedShares(
            IERC20(address(token)),
            msg.sender,
            deadline,
            fx.readBytes(".pk"),
            fx.readBytes32(".keySalt"),
            uint256(fx.readBytes32(".minDirectVote")),
            7 days,
            IZiskVerifier(address(verifier)),
            cd.readBytes32(".programVK"),
            verifier.getRootCVadcopFinal()
        );
        if (address(pool) != want) revert PoolAddressMismatch(address(pool), want);
        bytes32[] memory costs = fx.readBytes32Array(".costs");
        for (uint256 c = 0; c < costs.length; c++) {
            pool.addProject(uint256(costs[c]), msg.sender);
        }
        pool.openVoting();
        vm.stopBroadcast();

        console.log("TOKEN", address(token));
        console.log("NFT", address(nft));
        console.log("VERIFIER", address(verifier));
        console.log("POOL", address(pool));
    }
}
```

- [ ] **Step 2: The shell driver**

```bash
#!/usr/bin/env bash
# zisk/scripts/e2e-anvil.sh [--prove]
# Replays the main fixture on a fresh anvil and finalises it with the committed proof
# (or a fresh one with --prove). Needs anvil, cast, forge, python3, cargo.
set -euo pipefail
prove=0; [ "${1:-}" = "--prove" ] && prove=1
root=$(cd "$(dirname "$0")/../.." && pwd); cd "$root"
FX=reference/vectors/zisk/fixture_main.json
RPC=http://127.0.0.1:8545
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
work=$(mktemp -d); trap 'kill ${ANVIL:-} 2>/dev/null || true; rm -rf "$work"' EXIT

anvil --silent --chain-id 31337 > "$work/anvil.log" 2>&1 & ANVIL=$!
for _ in $(seq 1 50); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.2; done

now=$(cast block latest --rpc-url $RPC -f timestamp)
export VOTING_DEADLINE=$((now + 3600))
forge script script/E2EAnvil.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast -q > "$work/deploy.log" 2>&1 || { cat "$work/deploy.log"; exit 1; }
TOKEN=$(awk '/^  TOKEN/ {print $2}' "$work/deploy.log"); NFT=$(awk '/^  NFT/ {print $2}' "$work/deploy.log"); POOL=$(awk '/^  POOL/ {print $2}' "$work/deploy.log")
[ -n "$POOL" ] || { grep -E "TOKEN|NFT|POOL" "$work/deploy.log" || cat "$work/deploy.log"; exit 1; }
echo "token $TOKEN  nft $NFT  pool $POOL"

send() { cast send --rpc-url $RPC --private-key $DEPLOYER_KEY "$@" > /dev/null; }
sendas() { local from=$1; shift; cast send --rpc-url $RPC --unlocked --from "$from" "$@" > /dev/null; }
impersonate() { cast rpc --rpc-url $RPC anvil_impersonateAccount "$1" > /dev/null; cast rpc --rpc-url $RPC anvil_setBalance "$1" 0x1000000000000000000 > /dev/null; }

# Roster lines: addr direct seat directBallot ciphertext (hex or "-")
python3 - "$FX" > "$work/roster.txt" <<'PY'
import json, sys
fx = json.load(open(sys.argv[1]))
t = fx["nftTakeover"] or {}
print("TAKEOVER", t.get("from", "-"), t.get("to", "-"), int(t.get("sponsorshipAmount", "0x0"), 16))
for v in fx["voters"]:
    print(v["addr"], int(v["directWeight"], 16), int(v["seatWeight"], 16), v["directBallot"] or "-", v["ciphertext"] or "-")
print("TOTAL", int(fx["totalWeight"], 16))
PY
read -r _ TFROM TTO TAMOUNT < <(head -1 "$work/roster.txt")
TOTAL=$(awk '/^TOTAL/ {print $2}' "$work/roster.txt")
granted=0; nftSponsorship=""
send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 18446744073709551615
send "$TOKEN" "approve(address,uint256)" "$POOL" 18446744073709551615
while read -r addr direct seat ballot ct; do
  [ "$addr" = TAKEOVER ] || [ "$addr" = TOTAL ] && continue
  impersonate "$addr"
  if [ "$direct" != 0 ]; then
    send "$TOKEN" "mint(address,uint256)" "$addr" "$direct"
    sendas "$addr" "$TOKEN" "approve(address,uint256)" "$POOL" "$direct"
    sendas "$addr" "$POOL" "contribute(uint256)" "$direct"
    granted=$((granted + direct))
  fi
  if [ "$addr" = "$TFROM" ]; then
    nftSponsorship=$(cast call --rpc-url $RPC "$POOL" "sponsorshipCount()(uint256)")
    send "$POOL" "sponsorNFT(uint256,address,uint256)" "$TAMOUNT" "$NFT" 1
    send "$NFT" "mint(address,uint256)" "$addr" 1
    sendas "$addr" "$POOL" "claimSeat(uint256,uint256)" "$nftSponsorship" 1
    granted=$((granted + TAMOUNT))
  elif [ "$seat" != 0 ]; then
    list=$seat; [ "$addr" = "$TTO" ] && list=$((seat - TAMOUNT))
    send "$POOL" "sponsor(uint256,address[])" "$list" "[$addr]"
    granted=$((granted + list))
  fi
done < "$work/roster.txt"
while read -r addr direct seat ballot ct; do
  [ "$addr" = TAKEOVER ] || [ "$addr" = TOTAL ] && continue
  [ "$ballot" != - ] && sendas "$addr" "$POOL" "vote(bytes)" "$ballot"
  [ "$ct" != - ] && sendas "$addr" "$POOL" "voteSealed(bytes)" "$ct"
done < "$work/roster.txt"
if [ "$TFROM" != - ]; then
  sendas "$TFROM" "$NFT" "transferFrom(address,address,uint256)" "$TFROM" "$TTO" 1
  sendas "$TTO" "$POOL" "claimSeat(uint256,uint256)" "$nftSponsorship" 1
fi
dust=$((TOTAL - granted))
[ "$dust" -gt 0 ] && send "$POOL" "sponsorNFT(uint256,address,uint256)" "$dust" "$NFT" "$dust"
echo "totalWeight on chain $(cast call --rpc-url $RPC "$POOL" "totalWeight()(uint256)") expected $TOTAL"

cast rpc --rpc-url $RPC evm_increaseTime 3601 > /dev/null; cast rpc --rpc-url $RPC evm_mine > /dev/null
send "$POOL" "close(uint256)" 100
echo "inputsHash on chain $(cast call --rpc-url $RPC "$POOL" "inputsHash()(bytes32)")"
echo "inputsHash fixture  $(python3 -c "import json;print(json.load(open('$FX'))['inputsHash'])")"

export TALLIER_MASTER=$(python3 -c "import json;print(json.load(open('$FX'))['master'])")
export SUBMITTER_KEY=$DEPLOYER_KEY
(cd zisk && cargo build -q -p tally-prover)
TP=zisk/target/debug/tally-prover
$TP fetch --rpc $RPC --pool "$POOL" --out "$work/input.bin"
$TP check --input "$work/input.bin" --rpc $RPC --pool "$POOL"
if [ $prove = 1 ]; then
  $TP run --rpc $RPC --pool "$POOL" --workdir "$work/run"
else
  $TP submit --rpc $RPC --pool "$POOL" --calldata zisk/fixtures/main-calldata.json --input "$work/input.bin"
fi
fin=$(cast call --rpc-url $RPC "$POOL" "finality()(uint8)")
funded=$(cast call --rpc-url $RPC "$POOL" "fundedProjects()(uint256[])")
echo "finality $fin  funded $funded"
send "$POOL" "claim(uint256)" 1
echo "recipient balance after claim(1): $(cast call --rpc-url $RPC "$TOKEN" "balanceOf(address)(uint256)" "$DEPLOYER")"
[ "$fin" = 1 ]
```

`chmod +x zisk/scripts/e2e-anvil.sh`. Notes for the implementer: `cast send` with `--unlocked --from` needs the account impersonated on anvil (done in `impersonate`); `cast` prints `uint256` results as plain decimals (possibly with a `[1e18]` annotation in newer versions: if `cast call … (uint256)` prints something like `18446744073709551615 [1.844e19]`, pipe through `awk '{print $1}'`); the console output format of `forge script` for `console.log("POOL", addr)` is `  POOL 0x…` (two leading spaces), which the `awk` patterns match; adjust the patterns if the log looks different.

- [ ] **Step 3: Run the fast path**

Run: `zisk/scripts/e2e-anvil.sh`
Expected output ends with `finality 1  funded [1, 2, 0]` and exit 0, and the two `inputsHash` lines are equal. If `PoolAddressMismatch` fires, something else was deployed from account 0 first (a stale anvil: the script starts its own, so check nothing is already listening on 8545). If `check --rpc` reports a mismatch, compare the printed `totalWeight` and the roster replay against Task 4's Foundry loader; the two must do the same transactions.

- [ ] **Step 4: Run the slow path** (about 30 minutes, the machine's memory; nothing else heavy meanwhile)

Run: `zisk/scripts/e2e-anvil.sh --prove`
Expected: same ending, after a fresh prove/wrap/export in the temp workdir. This is the full operator flow of spec Z6 against a live chain. Record both wall times in the README (Task 12).

- [ ] **Step 5: Commit**

```bash
forge fmt && git add script/E2EAnvil.s.sol zisk/scripts/e2e-anvil.sh
git commit -m "Add the anvil end-to-end: replay the main fixture, prove, finalise"
```

---

### Task 12: Documentation

**Files:**
- Modify: `zisk/README.md`, `README.md`

- [ ] **Step 1: `zisk/README.md`**

Add, after the crate table, a row for `prover` (`tally-prover: keys, encrypt, fetch, check, prove, wrap, export, submit, run`), and new sections:

```markdown
## Prover

    export TALLIER_MASTER=0x…          # 32 bytes; the operator's master secret
    cargo run -p tally-prover -- keys --salt 0x…                       # pk for a pool's keySalt
    cargo run -p tally-prover -- encrypt --pk 0x… --voter 0x… --ranks 1,2,3,0
    cargo run -p tally-prover -- run --rpc $RPC --pool $POOL --workdir /tmp/pool  # after close()

`run` = fetch → check → prove → wrap → export → submit, with `SUBMITTER_KEY` holding the
key that pays for `finalize` (anyone may call it). Steps are also available one by one.
Environment overrides: `CARGO_ZISK`, `CARGO_ZISK_DEV`, `ZISK_PROVING_KEY`,
`ZISK_PROVING_KEY_SNARK`, `TALLY_GUEST_ELF`.

## End to end

    scripts/e2e-anvil.sh            # fresh anvil, main fixture replayed, committed proof, Finalized(Proven): <time>
    scripts/e2e-anvil.sh --prove    # the same with a fresh proof: <time>
    scripts/arc-probe.sh            # Arc testnet's EVM verifies the committed proof: <result and date>

The Arc deployment itself needs a funded key: see
`docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md`.

## Contracts

`src/SealedPool.sol` (shared by cre and zisk), `src/zisk/ZiskRankedShares.sol`,
`src/cre/CreRankedShares.sol`, the vendored `src/zisk/ZiskVerifier.sol` (AGPL-3.0, from
the ZisK v1.2.0-alpha PLONK key). `finalize` with the real verifier costs about <gas> gas
(`test/zisk/ZiskFinalize.t.sol`).
```

with the measured values filled in.

- [ ] **Step 2: Root `README.md`**

In the Layout block add `src/SealedPool.sol`, `src/zisk/`, `src/cre/` lines with one-phrase descriptions, and replace the `### zisk variant` subsection's last sentence with a short paragraph: the three variants (cre, noir, zisk) and their finality (`Attested`, `Proven` over a transcript, `Proven` over the whole tally), a pointer to `zisk/README.md` for the prover and the end-to-end scripts, and to the Arc runbook. Keep it under fifteen lines.

- [ ] **Step 3: Final full run and commit**

```bash
python3 -m unittest discover reference && (cd zisk && cargo test) && forge test
git add README.md zisk/README.md && git commit -m "Document the zisk contracts, prover and end-to-end runs"
```

---

## Self-review notes

- Spec coverage: Z1/Z2/Z5 → Tasks 4–6; Z6 → Tasks 8–9; Z8 Foundry bullets → Tasks 3–6 (ledger, ballots, closing with chunking and fixture equality, `finalize` with mock and real verifier, `onReport`, `abandon`, claims; the fork test against Arc is replaced by the fundless probe of Task 10, which is a stronger check of the chain's EVM); Z9 gas numbers → Tasks 3, 5, 12; Z10.3 → Task 10; Z11 → Tasks 3, 7, 12; the end-to-end of Z8 → Task 11 (anvil) and the runbook (Arc, needs funds).
- Deviations from the spec, all deliberate: weights stored as `uint256` capped at `2^64 − 1` rather than `uint64`; `votersFrom` paging added for the prover; `tally-prover vk` dropped (the program VK comes from any export); the fixture's pool address is the anvil nonce-3 address and the fixture carries `nftTakeover` so the roster can be replayed on chain.
- Tasks 2 and 11 (slow path) each take about thirty minutes of machine time; nothing else heavy may run alongside them.
