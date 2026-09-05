# Sealed ballots, plan 2 of 4: contracts

> **Historical.** The Noir variant's paths and its contract name were moved and renamed
> on 2026-09-05: `SealedRankedShares` is now `NoirRankedShares`, its Solidity lives under
> `src/noir/` and `test/noir/`, its Python under `reference/noir/` and its vectors under
> `reference/vectors/noir/`. Paths below are as they were when the plan was written; see
> the README's Layout section for the current ones.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `SealedRankedShares`, the pool that takes public and sealed ballots, commits to them, accepts the DON's result and transcript, and finalises through a chain of Honk proofs, plus everything it needs on-chain: the `PoolBase` extraction, a Poseidon2 hasher contract, the Grumpkin check, mock verifiers and deploy scripts.

**Architecture:** `PoolBase` holds custody, projects, deposits, sponsorships, seats, claims and sweep, and calls abstract hooks for phases, budget, weights and results; `RankedShares` (on-chain PB-EAR) and `SealedRankedShares` implement those hooks. Poseidon2 lives in its own contract, generated from the reference constants and called through an interface, so the pool stays well under the 24 KB limit. The Python fixtures of plan 1 are replayed through the public API in a Foundry test that checks every commitment, the transcript hash and the full proof chain against the oracle, with mock verifiers standing in for the Honk verifiers that plan 3 produces.

**Tech Stack:** Solidity 0.8.28, Foundry (forge-std `stdJson`, `vm.ffi` already enabled), OpenZeppelin 5, Python 3.14 for the Poseidon2 code generator.

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (B1, B2, B4, B5, B6, B10, B13) and, for the sections it inherits unchanged, `docs/superpowers/specs/2026-09-04-sealed-seat-ballots-design.md` (A1 hooks, A3 seat ledger, A5 phases, A6.2 report kinds, A6.5 grace paths, A6.6 claims). Plan 1 (`docs/superpowers/plans/2026-09-05-sealed-ballots-1-reference.md`) describes the fixtures this plan replays.

## Global Constraints

- Solidity `0.8.28`, optimizer on, 200 runs (`foundry.toml` as is). `forge fmt` before every commit. No attribution lines in commit messages.
- `PBEAR.sol` is not modified. The existing suites (`PBEAR*.t.sol`, `RankedShares*.t.sol`, `Gas.t.sol`) must pass unchanged after the `PoolBase` extraction; `RankedShares.WrongPhase`, `RankedShares.ZeroAddress` and the other selectors the tests use keep resolving because the errors are inherited from `PoolBase`.
- BN254 scalar field modulus `FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. Grumpkin: `y² = x³ − 17 mod FIELD`.
- Poseidon2: t = 4, rate 3, sponge with the capacity element initialised to `n << 64`; a permutation is applied before absorbing element `i` whenever `i > 0 && i % 3 == 0`, and once more at the end; output is state element 0. This is what `reference/poseidon2.py` computes and what `reference/vectors/poseidon2.json` pins.
- Weights, costs, budgets fit 64 bits: `totalWeight ≤ 2^64 − 1` after every deposit, every cost `< 2^64`. `NONE = 2^64 − 1`.
- Sealed chain: `h = Poseidon2([h, uint160(addr), seatWeight, rx, ry, c])` starting at 0, checkpoint stored at index `ceil(j / batch)` when `j % batch == 0 || j == sealedCount` where `j` counts sealed entries absorbed so far; `checkpoint[0] = 0`; `numBatches = max(1, ceil(sealedCount / batch))`. Public chain: `hPub = keccak256(abi.encodePacked(hPub, addr, directWeight, packedBallot))` starting at `bytes32(0)`. `costsHash = Poseidon2(costs)`. `inputsRoot = keccak256(abi.encodePacked(hPub, hSealed, sealedCount, costsHash, totalWeight))`.
- Transcript: `m + 3` words per step, at most `2m` steps; hash chain `t = Poseidon2([t, step…])` (`m + 4` elements) from 0.
- Ballot packing: `packed = Σ ranks[c] · 256^c`; validation identical to `PBEAR._setBallot`.
- Public inputs: ingest `[k, nSealed, m, budget, pkX, pkY, hIn, hOut, stateIn, stateOut]`; tally `[costsHash, stateIn, stateOut, done, tHashOut, fundedCount, fundedOrderPacked]`; `fundedOrderPacked = Σ fundedOrder[j] · 256^j`.
- Verifier interface: `verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool)`.
- Fixtures in `reference/vectors/fixture_{test_main,test_smallm,test_nosealed,default_main}.json` are the oracle; `foundry.toml` already grants read access to `./reference`.
- Run `forge test` (about 15 s, includes the ffi differential fuzz) before every commit.

## File structure

```
src/PoolBase.sol                     extracted base (Task 1)
src/RankedShares.sol                 trimmed to PBEAR glue (Task 1)
src/interfaces/IPoseidon2.sol        hash(uint256[]) (Task 2)
src/interfaces/IHonkVerifier.sol     verify(bytes, bytes32[]) (Task 3)
src/interfaces/IReceiver.sol         Chainlink CRE receiver (Task 5)
src/lib/Poseidon2.sol                generated hasher contract (Task 2)
src/lib/Grumpkin.sol                 isOnCurve (Task 3)
src/SealedRankedShares.sol           the pool (Tasks 3–6)
reference/tools/gen_poseidon2_sol.py generator (Task 2)
test/Poseidon2.t.sol, test/Grumpkin.t.sol
test/mocks/MockHonkVerifier.sol
test/sealed/FixtureLoader.sol        reads a fixture JSON and drives the pool (Task 4)
test/sealed/SealedLedger.t.sol, SealedClose.t.sol, SealedReport.t.sol,
test/sealed/SealedAdvance.t.sol, SealedFixture.t.sol, SealedGas.t.sol
script/DeploySealed.s.sol
```

---

### Task 0: Expose `hasSealed` in the fixtures

**Files:**
- Modify: `reference/tools/make_fixture.py` (`_encode`, voter dict)
- Modify: `reference/test_fixture.py`
- Regenerate: `reference/vectors/fixture_*.json`

**Interfaces:**
- Produces: every `voters[i]` object in the fixtures carries `"hasSealed": bool` (true iff `ciphertext` is not null). Solidity's JSON reader cannot test for `null`, so the loader of Task 4 needs the boolean.

- [ ] **Step 1: Write the failing test**

Add to `reference/test_fixture.py`, in `FixtureTest`:

```python
    def test_voters_carry_hasSealed(self):
        for name in FIXTURES:
            for v in load(name)["voters"]:
                self.assertIn("hasSealed", v)
                self.assertEqual(v["hasSealed"], v["ciphertext"] is not None)
```

(`FIXTURES` and `load` already exist in that file.)

Run: `cd reference && python3 -m unittest test_fixture.FixtureTest.test_voters_carry_hasSealed`
Expected: FAIL, `KeyError: 'hasSealed'` or assertion on the missing key.

- [ ] **Step 2: Add the field**

In `reference/tools/make_fixture.py`, in `_encode`, where each voter dict is emitted, add `"hasSealed": v["ciphertext"] is not None,` right after `"hasDirect": v["hasDirect"],`. Regenerate:

```bash
python3 reference/tools/make_fixture.py --profile test
python3 reference/tools/make_fixture.py --profile default
```

- [ ] **Step 3: Run the reference suite**

Run: `python3 -W error -m unittest discover reference`
Expected: OK (the determinism test regenerates and compares, so the committed files must be the regenerated ones).

- [ ] **Step 4: Commit**

```bash
git add reference/tools/make_fixture.py reference/test_fixture.py reference/vectors/
git commit -m "Expose hasSealed on fixture voters"
```

---

### Task 1: Extract `PoolBase` from `RankedShares`

**Files:**
- Create: `src/PoolBase.sol`
- Modify: `src/RankedShares.sol` (whole file replaced by the version below)
- Test: existing `test/RankedShares.t.sol`, `test/RankedSharesTally.t.sol`, `test/Gas.t.sol` unchanged

**Interfaces:**
- Produces `PoolBase` (abstract, `is Ownable`) with these hooks a pool must implement:
  - `_isSetup() / _isOpen() / _isDone() internal view returns (bool)`
  - `_registerProject(uint256 cost) internal returns (uint256 id)`, `_beforeOpen() internal view`
  - `_addBudget(uint256 amount) internal`, `_budget() internal view returns (uint256)`
  - `_onContribution(address who, uint256 amount)`, `_onSeatGranted(address who, uint256 perSeat)`, `_onSeatRevoked(address who, uint256 perSeat)` (all `internal`)
  - `_isFunded(uint256 id) internal view returns (bool)`, `_costOf(uint256 id) internal view returns (uint256)`, `_spent() internal view returns (uint256)`
- Produces for pools: modifiers `onlySetup`, `onlyOpen`, `onlyDone`, `beforeDeadline`; `_requireBalanceCoversBudget()`; the errors `WrongPhase, DeadlinePassed, ZeroAmount, ZeroAddress, NoSeats, SeatsUnknown, NoSeatsLeft, NotTokenOwner, AlreadyHeld, NotNFTSponsorship, BalanceBelowTotalWeight, NotFunded, AlreadyClaimed`; the events `ProjectAdded, VotingOpened, Contributed, Sponsored, SeatClaimed, Claimed, Swept`; public `token, votingDeadline, votingOpen, recipientOf, seatHolder, claimed, claimedTotal, sponsorships(id), sponsorshipCount()`; external `addProject, openVoting, contribute, sponsor, sponsorNFT, claimSeat, claim, sweep`.

- [ ] **Step 1: Run the existing suites to record the baseline**

Run: `forge test --match-path "test/RankedShares*.t.sol" -q`
Expected: all pass (35 tests). This is the bar the refactor must keep.

- [ ] **Step 2: Write `PoolBase`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PoolBase
/// @notice What every RankedShares pool does around the tally: token custody, projects,
///         deposits, sponsorships, NFT seats, claims and sweep. How weight is accounted,
///         when each phase holds and what got funded are left to the concrete pool
///         through the hooks at the bottom.
abstract contract PoolBase is Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors

    error WrongPhase();
    error DeadlinePassed();
    error ZeroAmount();
    error ZeroAddress();
    error NoSeats();
    error SeatsUnknown();
    error NoSeatsLeft();
    error NotTokenOwner();
    error AlreadyHeld();
    error NotNFTSponsorship();
    error BalanceBelowTotalWeight();
    error NotFunded();
    error AlreadyClaimed();

    // ---------------------------------------------------------------- events

    event ProjectAdded(uint256 indexed projectId, uint256 cost, address recipient);
    event VotingOpened();
    event Contributed(address indexed contributor, uint256 amount);
    event Sponsored(uint256 indexed sponsorshipId, address indexed sponsor, uint256 amount, uint256 seats, address nft);
    event SeatClaimed(uint256 indexed sponsorshipId, uint256 indexed tokenId, address indexed holder, address previous);
    event Claimed(uint256 indexed projectId, address indexed recipient, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    // ----------------------------------------------------------------- types

    struct Sponsorship {
        address sponsor;
        uint256 amount;
        uint256 perSeat;
        uint256 seats;
        uint256 claimed;
        address nft; // address(0) for explicit-list sponsorships
    }

    // --------------------------------------------------------------- storage

    IERC20 public immutable token;
    uint64 public immutable votingDeadline;

    bool public votingOpen;
    mapping(uint256 => address) public recipientOf;

    Sponsorship[] internal _sponsorships;
    /// @notice Current holder of the seat keyed by an NFT token id.
    mapping(uint256 => mapping(uint256 => address)) public seatHolder;

    mapping(uint256 => bool) public claimed;
    uint256 public claimedTotal;

    // ----------------------------------------------------------- constructor

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        votingDeadline = votingDeadline_;
    }

    // ------------------------------------------------------------- modifiers

    modifier onlySetup() {
        if (!_isSetup()) revert WrongPhase();
        _;
    }

    modifier onlyOpen() {
        if (!_isOpen()) revert WrongPhase();
        _;
    }

    modifier onlyDone() {
        if (!_isDone()) revert WrongPhase();
        _;
    }

    modifier beforeDeadline() {
        if (block.timestamp >= votingDeadline) revert DeadlinePassed();
        _;
    }

    // ----------------------------------------------------------------- views

    function sponsorships(uint256 id)
        external
        view
        returns (address sponsor, uint256 amount, uint256 perSeat, uint256 seats, uint256 claimedSeats, address nft)
    {
        Sponsorship storage s = _sponsorships[id];
        return (s.sponsor, s.amount, s.perSeat, s.seats, s.claimed, s.nft);
    }

    function sponsorshipCount() external view returns (uint256) {
        return _sponsorships.length;
    }

    // ----------------------------------------------------------------- setup

    function addProject(uint256 cost_, address recipient) external onlyOwner onlySetup returns (uint256 id) {
        if (recipient == address(0)) revert ZeroAddress();
        id = _registerProject(cost_);
        recipientOf[id] = recipient;
        emit ProjectAdded(id, cost_, recipient);
    }

    function openVoting() external onlyOwner onlySetup beforeDeadline {
        _beforeOpen();
        votingOpen = true;
        emit VotingOpened();
    }

    // -------------------------------------------------------------- deposits

    /// @notice Deposit `amount` and vote with it yourself.
    function contribute(uint256 amount) external onlyOpen beforeDeadline {
        _deposit(amount);
        _onContribution(msg.sender, amount);
        emit Contributed(msg.sender, amount);
    }

    /// @notice Deposit `amount` split equally among `members`, one seat per entry.
    function sponsor(uint256 amount, address[] calldata members) external onlyOpen beforeDeadline returns (uint256 id) {
        if (members.length == 0) revert NoSeats();
        _deposit(amount);
        uint256 perSeat = amount / members.length;
        id = _sponsorships.length;
        _sponsorships.push(
            Sponsorship({
                sponsor: msg.sender,
                amount: amount,
                perSeat: perSeat,
                seats: members.length,
                claimed: members.length,
                nft: address(0)
            })
        );
        for (uint256 i = 0; i < members.length; i++) {
            _onSeatGranted(members[i], perSeat);
        }
        emit Sponsored(id, msg.sender, amount, members.length, address(0));
    }

    /// @notice Deposit `amount` split equally across `seats` seats claimable by holders of
    ///         `nft`. Pass `seats = 0` to use the collection's `totalSupply()`.
    function sponsorNFT(uint256 amount, IERC721 nft, uint256 seats) external onlyOpen beforeDeadline returns (uint256 id) {
        if (address(nft) == address(0)) revert ZeroAddress();
        if (seats == 0) seats = _totalSupplyOf(nft);
        _deposit(amount);
        id = _sponsorships.length;
        _sponsorships.push(
            Sponsorship({sponsor: msg.sender, amount: amount, perSeat: amount / seats, seats: seats, claimed: 0, nft: address(nft)})
        );
        emit Sponsored(id, msg.sender, amount, seats, address(nft));
    }

    /// @notice Occupy the seat keyed by `tokenId` with the caller, who must own the token.
    function claimSeat(uint256 sponsorshipId, uint256 tokenId) external onlyOpen beforeDeadline {
        Sponsorship storage s = _sponsorships[sponsorshipId];
        if (s.nft == address(0)) revert NotNFTSponsorship();
        if (IERC721(s.nft).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        address previous = seatHolder[sponsorshipId][tokenId];
        if (previous == msg.sender) revert AlreadyHeld();
        if (previous == address(0)) {
            if (s.claimed >= s.seats) revert NoSeatsLeft();
            s.claimed++;
        } else {
            _onSeatRevoked(previous, s.perSeat);
        }
        seatHolder[sponsorshipId][tokenId] = msg.sender;
        _onSeatGranted(msg.sender, s.perSeat);
        emit SeatClaimed(sponsorshipId, tokenId, msg.sender, previous);
    }

    // --------------------------------------------------------------- payouts

    /// @notice Pay a funded project's cost to its recipient. Anyone may trigger it.
    function claim(uint256 projectId) external onlyDone {
        if (!_isFunded(projectId)) revert NotFunded();
        if (claimed[projectId]) revert AlreadyClaimed();
        claimed[projectId] = true;
        uint256 amount = _costOf(projectId);
        claimedTotal += amount;
        address recipient = recipientOf[projectId];
        emit Claimed(projectId, recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    /// @notice Withdraw everything beyond the funded projects' unclaimed costs.
    function sweep(address to) external onlyOwner onlyDone {
        if (to == address(0)) revert ZeroAddress();
        uint256 owed = _spent() - claimedTotal;
        uint256 amount = token.balanceOf(address(this)) - owed;
        emit Swept(to, amount);
        token.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------- internals

    function _deposit(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _addBudget(amount);
    }

    function _requireBalanceCoversBudget() internal view {
        if (token.balanceOf(address(this)) < _budget()) revert BalanceBelowTotalWeight();
    }

    function _totalSupplyOf(IERC721 nft) private view returns (uint256 supply) {
        (bool ok, bytes memory data) = address(nft).staticcall(abi.encodeCall(IERC721Enumerable.totalSupply, ()));
        if (!ok || data.length < 32) revert SeatsUnknown();
        supply = abi.decode(data, (uint256));
        if (supply == 0) revert SeatsUnknown();
    }

    // ----------------------------------------------------------------- hooks

    function _isSetup() internal view virtual returns (bool);
    function _isOpen() internal view virtual returns (bool);
    function _isDone() internal view virtual returns (bool);
    function _registerProject(uint256 cost_) internal virtual returns (uint256 id);
    function _beforeOpen() internal view virtual;
    function _addBudget(uint256 amount) internal virtual;
    function _budget() internal view virtual returns (uint256);
    function _onContribution(address who, uint256 amount) internal virtual;
    function _onSeatGranted(address who, uint256 perSeat) internal virtual;
    function _onSeatRevoked(address who, uint256 perSeat) internal virtual;
    function _isFunded(uint256 projectId) internal view virtual returns (bool);
    function _costOf(uint256 projectId) internal view virtual returns (uint256);
    function _spent() internal view virtual returns (uint256);
}
```

- [ ] **Step 3: Rewrite `RankedShares` on top of it**

Replace `src/RankedShares.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PBEAR} from "./PBEAR.sol";
import {PoolBase} from "./PoolBase.sol";

/// @title RankedShares
/// @notice A contribution-weighted participatory budgeting pool that tallies PB-EAR
///         on-chain. Deposits, sponsorships, seats, claims and sweep come from PoolBase;
///         ballots and the tally come from PBEAR.
contract RankedShares is PoolBase, PBEAR {
    error DeadlineNotReached();

    event Voted(address indexed voter);

    enum Phase {
        Setup,
        Open,
        Tally,
        Done
    }

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_) PoolBase(token_, owner_, votingDeadline_) {}

    modifier inPhase(Phase expected) {
        if (phase() != expected) revert WrongPhase();
        _;
    }

    function phase() public view returns (Phase) {
        if (tallyDone) return Phase.Done;
        if (tallyStarted) return Phase.Tally;
        if (votingOpen) return Phase.Open;
        return Phase.Setup;
    }

    /// @notice Cast or replace the caller's ballot. See `PBEAR` for the encoding.
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        _setBallot(msg.sender, ranks);
        emit Voted(msg.sender);
    }

    /// @notice Close the voting window and start the tally once the deadline has passed.
    function startTally() external inPhase(Phase.Open) {
        if (block.timestamp < votingDeadline) revert DeadlineNotReached();
        _requireBalanceCoversBudget();
        _startTally();
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

    function _registerProject(uint256 cost_) internal override returns (uint256) {
        return _addProject(cost_);
    }

    function _beforeOpen() internal view override {
        if (projectCount() == 0) revert NoProjects();
    }

    function _addBudget(uint256 amount) internal override {
        _increaseTotalWeight(amount);
    }

    function _budget() internal view override returns (uint256) {
        return totalWeight;
    }

    function _onContribution(address who, uint256 amount) internal override {
        _grantWeight(who, amount);
    }

    function _onSeatGranted(address who, uint256 perSeat) internal override {
        _grantWeight(who, perSeat);
    }

    function _onSeatRevoked(address who, uint256 perSeat) internal override {
        _revokeWeight(who, perSeat);
    }

    function _isFunded(uint256 projectId) internal view override returns (bool) {
        return funded[projectId];
    }

    function _costOf(uint256 projectId) internal view override returns (uint256) {
        return cost(projectId);
    }

    function _spent() internal view override returns (uint256) {
        return spent;
    }
}
```

- [ ] **Step 4: Build and run the untouched suites**

Run: `forge build && forge test -q`
Expected: build succeeds; every pre-existing test passes (72 tests). If the compiler rejects `RankedShares.WrongPhase.selector` in a test, the error is not being inherited as a member of the derived contract type: in that case move the thirteen error declarations into an `interface IPoolErrors` in `src/PoolBase.sol`, have `PoolBase is Ownable, IPoolErrors`, and rebuild; the tests must not change.

Also check the `Sponsorship` getter tuple: `test/RankedShares.t.sol` destructures `pool.sponsorships(id)` positionally, so the field order above must stay `(sponsor, amount, perSeat, seats, claimed, nft)`.

- [ ] **Step 5: Snapshot and commit**

Run: `forge snapshot --match-contract GasTest` and confirm `test_stepGasAt100VotersAnd20Projects` is within 1% of the committed `.gas-snapshot` value (the refactor adds one internal call per deposit, none per step).

```bash
forge fmt
git add src/PoolBase.sol src/RankedShares.sol .gas-snapshot
git commit -m "Extract PoolBase from RankedShares behind weight and phase hooks"
```

---

### Task 2: Poseidon2 hasher contract

**Files:**
- Create: `reference/tools/gen_poseidon2_sol.py`
- Create: `src/interfaces/IPoseidon2.sol`
- Create: `src/lib/Poseidon2.sol` (generated, committed)
- Test: `test/Poseidon2.t.sol`

**Interfaces:**
- Produces `IPoseidon2 { function hash(uint256[] calldata inputs) external pure returns (uint256); function permutation(uint256[4] calldata state) external pure returns (uint256[4] memory); }` and the `Poseidon2` contract implementing it. Inputs must be below `FIELD` (`NotInField` otherwise).

- [ ] **Step 1: Write the failing test**

```solidity
// test/Poseidon2.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Poseidon2} from "../src/lib/Poseidon2.sol";

contract Poseidon2Test is Test {
    using stdJson for string;

    Poseidon2 poseidon;
    string json;

    function setUp() public {
        poseidon = new Poseidon2();
        json = vm.readFile("reference/vectors/poseidon2.json");
    }

    function count(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function toUints(bytes32[] memory b) internal pure returns (uint256[] memory out) {
        out = new uint256[](b.length);
        for (uint256 i = 0; i < b.length; i++) out[i] = uint256(b[i]);
    }

    function test_permutationMatchesVectors() public view {
        uint256 n = count(".permutation");
        assertGt(n, 0);
        for (uint256 i = 0; i < n; i++) {
            string memory key = string.concat(".permutation[", vm.toString(i), "]");
            uint256[] memory input = toUints(json.readBytes32Array(string.concat(key, ".input")));
            uint256[] memory expected = toUints(json.readBytes32Array(string.concat(key, ".output")));
            uint256[4] memory state = [input[0], input[1], input[2], input[3]];
            uint256[4] memory got = poseidon.permutation(state);
            for (uint256 j = 0; j < 4; j++) assertEq(got[j], expected[j]);
        }
    }

    function test_hashMatchesVectors() public view {
        uint256 n = count(".hash");
        assertGt(n, 0);
        for (uint256 i = 0; i < n; i++) {
            string memory key = string.concat(".hash[", vm.toString(i), "]");
            uint256[] memory input = toUints(json.readBytes32Array(string.concat(key, ".input")));
            uint256 expected = uint256(json.readBytes32(string.concat(key, ".output")));
            assertEq(poseidon.hash(input), expected);
        }
    }

    function test_hashDependsOnLength() public view {
        uint256[] memory a = new uint256[](1);
        a[0] = 1;
        uint256[] memory b = new uint256[](2);
        b[0] = 1;
        assertNotEq(poseidon.hash(a), poseidon.hash(b));
    }

    function test_rejectsInputsOutsideField() public {
        uint256[] memory a = new uint256[](1);
        a[0] = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        vm.expectRevert(Poseidon2.NotInField.selector);
        poseidon.hash(a);
    }

    function test_gasOfSixElementHash() public view {
        uint256[] memory a = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) a[i] = i + 1;
        uint256 before = gasleft();
        poseidon.hash(a);
        uint256 used = before - gasleft();
        emit log_named_uint("Poseidon2.hash(6 elements) gas", used);
        assertLt(used, 120_000);
    }
}
```

Run: `forge test --match-contract Poseidon2Test`
Expected: compilation fails, `src/lib/Poseidon2.sol` not found.

- [ ] **Step 2: Write the generator**

```python
# reference/tools/gen_poseidon2_sol.py
"""Emit src/lib/Poseidon2.sol from reference/poseidon2_params.py.

Usage (from the repository root): python3 reference/tools/gen_poseidon2_sol.py
The constants blob is 64 rounds x 4 round constants followed by the 4 internal-matrix
diagonal terms, 32-byte big-endian words, so word i of the blob is at byte offset 32*i.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from poseidon2_params import INTERNAL_DIAG, ROUND_CONSTANTS  # noqa: E402

TEMPLATE = '''// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoseidon2} from "../interfaces/IPoseidon2.sol";

/// @title Poseidon2 over the BN254 scalar field, t = 4, Barretenberg parameters.
/// @notice Generated by reference/tools/gen_poseidon2_sol.py; do not edit by hand.
///         The sponge is Barretenberg's FieldSponge: capacity element = n << 64, a
///         permutation before absorbing element i whenever i > 0 and i % 3 == 0, and a
///         final permutation; output is state element 0. `reference/poseidon2.py` is the
///         executable definition and `reference/vectors/poseidon2.json` the vectors.
contract Poseidon2 is IPoseidon2 {
    error NotInField();

    uint256 internal constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant RATE = 3;
    uint256 internal constant ROUNDS_F_HALF = 4;
    uint256 internal constant ROUNDS_P = 56;
    /// @dev 260 words: round constants [r][i] at word 4r + i, diagonal at words 256..259.
    bytes internal constant PARAMS = hex"%(blob)s";

    function hash(uint256[] calldata inputs) external pure returns (uint256) {
        uint256 n = inputs.length;
        uint256[4] memory s;
        s[3] = n << 64;
        for (uint256 i = 0; i < n; i++) {
            uint256 x = inputs[i];
            if (x >= P) revert NotInField();
            if (i > 0 && i %% RATE == 0) s = _permute(s);
            s[i %% RATE] = addmod(s[i %% RATE], x, P);
        }
        return _permute(s)[0];
    }

    function permutation(uint256[4] calldata state) external pure returns (uint256[4] memory) {
        uint256[4] memory s = state;
        for (uint256 i = 0; i < 4; i++) {
            if (s[i] >= P) revert NotInField();
        }
        return _permute(s);
    }

    function _permute(uint256[4] memory s) internal pure returns (uint256[4] memory out) {
        bytes memory params = PARAMS;
        assembly ("memory-safe") {
            function ext(a, b, c, d) -> na, nb, nc, nd {
                let t0 := addmod(a, b, P)
                let t1 := addmod(c, d, P)
                let t2 := addmod(addmod(b, b, P), t1, P)
                let t3 := addmod(addmod(d, d, P), t0, P)
                let t4 := addmod(mulmod(4, t1, P), t3, P)
                let t5 := addmod(mulmod(4, t0, P), t2, P)
                na := addmod(t3, t5, P)
                nb := t5
                nc := addmod(t2, t4, P)
                nd := t4
            }
            function sbox(x) -> y {
                let x2 := mulmod(x, x, P)
                let x4 := mulmod(x2, x2, P)
                y := mulmod(x4, x, P)
            }
            let rc := add(params, 32)
            let a := mload(s)
            let b := mload(add(s, 32))
            let c := mload(add(s, 64))
            let d := mload(add(s, 96))
            a, b, c, d := ext(a, b, c, d)
            // first half of the full rounds
            for { let r := 0 } lt(r, ROUNDS_F_HALF) { r := add(r, 1) } {
                let base := add(rc, mul(r, 128))
                a := sbox(addmod(a, mload(base), P))
                b := sbox(addmod(b, mload(add(base, 32)), P))
                c := sbox(addmod(c, mload(add(base, 64)), P))
                d := sbox(addmod(d, mload(add(base, 96)), P))
                a, b, c, d := ext(a, b, c, d)
            }
            // partial rounds: constant and S-box on element 0, internal matrix J + diag
            let d0 := mload(add(rc, 8192))
            let d1 := mload(add(rc, 8224))
            let d2 := mload(add(rc, 8256))
            let d3 := mload(add(rc, 8288))
            for { let r := ROUNDS_F_HALF } lt(r, add(ROUNDS_F_HALF, ROUNDS_P)) { r := add(r, 1) } {
                a := sbox(addmod(a, mload(add(rc, mul(r, 128))), P))
                let sum := addmod(addmod(a, b, P), addmod(c, d, P), P)
                a := addmod(mulmod(a, d0, P), sum, P)
                b := addmod(mulmod(b, d1, P), sum, P)
                c := addmod(mulmod(c, d2, P), sum, P)
                d := addmod(mulmod(d, d3, P), sum, P)
            }
            // second half of the full rounds
            for { let r := add(ROUNDS_F_HALF, ROUNDS_P) } lt(r, add(mul(ROUNDS_F_HALF, 2), ROUNDS_P)) { r := add(r, 1) } {
                let base := add(rc, mul(r, 128))
                a := sbox(addmod(a, mload(base), P))
                b := sbox(addmod(b, mload(add(base, 32)), P))
                c := sbox(addmod(c, mload(add(base, 64)), P))
                d := sbox(addmod(d, mload(add(base, 96)), P))
                a, b, c, d := ext(a, b, c, d)
            }
            mstore(out, a)
            mstore(add(out, 32), b)
            mstore(add(out, 64), c)
            mstore(add(out, 96), d)
        }
    }
}
'''


def main():
    words = [c for row in ROUND_CONSTANTS for c in row] + list(INTERNAL_DIAG)
    assert len(words) == 260
    blob = "".join(format(w, "064x") for w in words)
    path = os.path.join(HERE, "..", "..", "src", "lib", "Poseidon2.sol")
    with open(path, "w") as f:
        f.write(TEMPLATE % {"blob": blob})
    print(path, len(blob) // 2, "bytes of constants")


if __name__ == "__main__":
    main()
```

Note the `%%` in the template: it is a `%`-formatted string, so the Solidity `%` operators are doubled.

```solidity
// src/interfaces/IPoseidon2.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoseidon2 {
    function hash(uint256[] calldata inputs) external pure returns (uint256);
    function permutation(uint256[4] calldata state) external pure returns (uint256[4] memory);
}
```

Run: `python3 reference/tools/gen_poseidon2_sol.py && forge build`
Expected: `src/lib/Poseidon2.sol` written with 8320 bytes of constants; the build succeeds. Inline-assembly access to `P`, `RATE`, `ROUNDS_F_HALF`, `ROUNDS_P` works because they are literal constants.

- [ ] **Step 3: Run the tests**

Run: `forge test --match-contract Poseidon2Test -vv`
Expected: 5 tests pass; the gas line prints. If `test_permutationMatchesVectors` fails, compare `ext` and the partial-round block against `_external` and `_internal` in `reference/poseidon2.py` term by term; the vectors are the authority. If `hash` passes and `permutation` fails on the first vector only, check the initial `ext` call before round 0.

- [ ] **Step 4: Commit**

```bash
forge fmt
git add reference/tools/gen_poseidon2_sol.py src/interfaces/IPoseidon2.sol src/lib/Poseidon2.sol test/Poseidon2.t.sol
git commit -m "Add a generated Poseidon2 hasher contract matching the reference vectors"
```

---

### Task 3: `SealedRankedShares` skeleton: ledger, ballots, phases, Grumpkin, verifier interface

**Files:**
- Create: `src/lib/Grumpkin.sol`, `src/interfaces/IHonkVerifier.sol`, `src/SealedRankedShares.sol`
- Create: `test/mocks/MockHonkVerifier.sol`
- Test: `test/Grumpkin.t.sol`, `test/sealed/SealedLedger.t.sol`

**Interfaces:**
- Produces `Grumpkin.isOnCurve(uint256 x, uint256 y) internal pure returns (bool)` (library).
- Produces `IHonkVerifier { function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool); }`.
- Produces `MockHonkVerifier` with `setAccept(bool)`, `lastProof()`, `lastPublicInputs()`, `calls()`.
- Produces `SealedRankedShares` constructor `(IERC20 token, address owner, uint64 votingDeadline, SealedRankedShares.Config memory cfg)` where

```solidity
struct Config {
    address forwarder;
    IPoseidon2 poseidon;
    IHonkVerifier ingestVerifier;
    IHonkVerifier tallyVerifier;
    uint256 tallierPkX;
    uint256 tallierPkY;
    bytes32 keySalt;
    uint256 nSealedMax;
    uint256 mMax;
    uint256 batch;
    uint256 minDirectVote;
    uint64 proofGrace;
    uint64 abandonGrace;
}
```

  and, after this task: `enum Phase { Setup, Open, Closing, Tally, Done }`, `enum Finality { None, Proven, Attested, Abandoned }`, `phase()`, `finality`, `totalWeight`, `projectCount()`, `cost(id)`, `voters(i)`, `voterCount()`, `directWeight(a)`, `seatWeight(a)`, `totalSeatWeight`, `hasDirect(a)`, `directBallotOf(a) returns (uint256 packed)`, `sealedOf(a) returns (uint256 rx, uint256 ry, uint256 c)`, `sealedCount`, `vote(bytes)`, `voteSealed(uint256,uint256,uint256)`, the errors `ZeroCost, TooManyProjects, NoProjects, InvalidBallot, CostTooLarge, WeightOverflow, BallotAlreadyCast, BelowMinimumVote, NoSeatWeight, InvalidCiphertext, TooManySealedVoters, InvalidConfig`, the events `Voted(address indexed)`, `SealedVote(address indexed)`. Later tasks add the rest to the same file.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/Grumpkin.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Grumpkin} from "../src/lib/Grumpkin.sol";

contract GrumpkinTest is Test {
    uint256 constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function test_generatorIsOnCurve() public pure {
        assertTrue(Grumpkin.isOnCurve(1, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }

    function test_negatedGeneratorIsOnCurve() public pure {
        assertTrue(Grumpkin.isOnCurve(1, P - 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }

    function test_rejectsOffCurveAndOutOfField() public pure {
        assertFalse(Grumpkin.isOnCurve(1, 1));
        assertFalse(Grumpkin.isOnCurve(0, 0));
        assertFalse(Grumpkin.isOnCurve(P, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
        assertFalse(Grumpkin.isOnCurve(1, P + 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }
}
```

```solidity
// test/sealed/SealedLedger.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {PoolBase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IPoseidon2} from "../../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MockHonkVerifier} from "../mocks/MockHonkVerifier.sol";

contract SealedLedgerTest is Test {
    MockERC20 token;
    MockERC721 nft;
    Poseidon2 poseidon;
    MockHonkVerifier ingestVerifier;
    MockHonkVerifier tallyVerifier;
    SealedRankedShares pool;

    address owner = makeAddr("owner");
    address forwarder = makeAddr("forwarder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address org = makeAddr("org");
    address recipientA = makeAddr("recipientA");
    address recipientB = makeAddr("recipientB");

    uint64 constant DEADLINE = 1_000_000;
    uint256 constant GX = 1;
    uint256 constant GY = 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C;
    uint256 constant USDC = 1_000_000;

    function config() internal view returns (SealedRankedShares.Config memory) {
        return SealedRankedShares.Config({
            forwarder: forwarder,
            poseidon: IPoseidon2(address(poseidon)),
            ingestVerifier: IHonkVerifier(address(ingestVerifier)),
            tallyVerifier: IHonkVerifier(address(tallyVerifier)),
            tallierPkX: GX,
            tallierPkY: GY,
            keySalt: keccak256("salt"),
            nSealedMax: 8,
            mMax: 4,
            batch: 2,
            minDirectVote: 10 * USDC,
            proofGrace: 1 days,
            abandonGrace: 7 days
        });
    }

    function setUp() public {
        vm.warp(1);
        token = new MockERC20();
        nft = new MockERC721();
        poseidon = new Poseidon2();
        ingestVerifier = new MockHonkVerifier();
        tallyVerifier = new MockHonkVerifier();
        pool = new SealedRankedShares(token, owner, DEADLINE, config());
        address[4] memory holders = [alice, bob, carol, org];
        for (uint256 i = 0; i < holders.length; i++) {
            token.mint(holders[i], 1_000 * USDC);
            vm.prank(holders[i]);
            token.approve(address(pool), type(uint256).max);
        }
    }

    function openWithProjects() internal {
        vm.startPrank(owner);
        pool.addProject(50 * USDC, recipientA);
        pool.addProject(30 * USDC, recipientB);
        pool.openVoting();
        vm.stopPrank();
    }

    function one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    // ---- setup and limits ----

    function test_startsInSetupWithConfig() public view {
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Setup));
        assertEq(pool.tallierPkX(), GX);
        assertEq(pool.nSealedMax(), 8);
        assertEq(pool.minDirectVote(), 10 * USDC);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
    }

    function test_constructorRejectsBadConfig() public {
        SealedRankedShares.Config memory cfg = config();
        cfg.abandonGrace = cfg.proofGrace;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
        cfg = config();
        cfg.mMax = 32;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
        cfg = config();
        cfg.tallierPkX = 1;
        cfg.tallierPkY = 1;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
    }

    function test_addProjectEnforcesCostAndCount() public {
        vm.startPrank(owner);
        vm.expectRevert(SealedRankedShares.ZeroCost.selector);
        pool.addProject(0, recipientA);
        vm.expectRevert(SealedRankedShares.CostTooLarge.selector);
        pool.addProject(uint256(type(uint64).max) + 1, recipientA);
        for (uint256 i = 0; i < 4; i++) pool.addProject(1, recipientA);
        vm.expectRevert(SealedRankedShares.TooManyProjects.selector);
        pool.addProject(1, recipientA);
        vm.stopPrank();
        assertEq(pool.projectCount(), 4);
        assertEq(pool.cost(3), 1);
    }

    function test_openVotingRequiresProjects() public {
        vm.prank(owner);
        vm.expectRevert(SealedRankedShares.NoProjects.selector);
        pool.openVoting();
    }

    function test_depositsCapTotalWeight() public {
        openWithProjects();
        token.mint(alice, type(uint64).max);
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.WeightOverflow.selector);
        pool.contribute(uint256(type(uint64).max) + 1);
    }

    // ---- ledger ----

    function test_ledgerTracksDirectAndSeatWeight() public {
        openWithProjects();
        vm.prank(alice);
        pool.contribute(40 * USDC);
        vm.prank(org);
        pool.sponsor(60 * USDC, one(bob));
        vm.prank(org);
        pool.sponsor(30 * USDC, one(alice));
        assertEq(pool.directWeight(alice), 40 * USDC);
        assertEq(pool.seatWeight(alice), 30 * USDC);
        assertEq(pool.seatWeight(bob), 60 * USDC);
        assertEq(pool.totalSeatWeight(), 90 * USDC);
        assertEq(pool.totalWeight(), 130 * USDC);
        assertEq(pool.voterCount(), 2);
        assertEq(pool.voters(0), alice);
        assertEq(pool.voters(1), bob);
    }

    function test_nftSeatTakeoverMovesSeatWeight() public {
        openWithProjects();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(50 * USDC, IERC721(address(nft)), 5);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 10 * USDC);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 7);
        vm.prank(bob);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 0);
        assertEq(pool.seatWeight(bob), 10 * USDC);
        assertEq(pool.totalSeatWeight(), 10 * USDC);
        assertEq(pool.totalWeight(), 50 * USDC);
    }

    // ---- direct ballots ----

    function test_directBallotIsPackedAndFinal() public {
        openWithProjects();
        vm.startPrank(alice);
        pool.contribute(40 * USDC);
        pool.vote(hex"0201");
        vm.expectRevert(SealedRankedShares.BallotAlreadyCast.selector);
        pool.vote(hex"0102");
        vm.stopPrank();
        assertTrue(pool.hasDirect(alice));
        assertEq(pool.directBallotOf(alice), 2 + (1 << 8));
    }

    function test_directBallotRequiresMinimumWeightAndValidRanks() public {
        openWithProjects();
        vm.startPrank(alice);
        pool.contribute(5 * USDC);
        vm.expectRevert(SealedRankedShares.BelowMinimumVote.selector);
        pool.vote(hex"0102");
        pool.contribute(5 * USDC);
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"010203");
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"0103");
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"0202");
        pool.vote(hex"0000");
        vm.stopPrank();
        assertEq(pool.directBallotOf(alice), 0);
        assertTrue(pool.hasDirect(alice));
    }

    // ---- sealed ballots ----

    function test_sealedVoteRequiresSeatWeightAndValidPoint() public {
        openWithProjects();
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.NoSeatWeight.selector);
        pool.voteSealed(GX, GY, 5);
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.startPrank(alice);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(0, GY, 5);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(GX, GY + 1, 5);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(GX, GY, 21888242871839275222246405745257275088548364400416034343698204186575808495617);
        vm.expectEmit(true, false, false, false);
        emit SealedRankedShares.SealedVote(alice);
        pool.voteSealed(GX, GY, 5);
        vm.stopPrank();
        (uint256 rx, uint256 ry, uint256 c) = pool.sealedOf(alice);
        assertEq(rx, GX);
        assertEq(ry, GY);
        assertEq(c, 5);
        assertEq(pool.sealedCount(), 1);
    }

    function test_sealedVoteReplacementDoesNotCountTwice() public {
        openWithProjects();
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.startPrank(alice);
        pool.voteSealed(GX, GY, 5);
        pool.voteSealed(GX, GY, 6);
        vm.stopPrank();
        (,, uint256 c) = pool.sealedOf(alice);
        assertEq(c, 6);
        assertEq(pool.sealedCount(), 1);
    }

    function test_sealedVoterCap() public {
        openWithProjects();
        address[] memory members = new address[](9);
        for (uint256 i = 0; i < 9; i++) members[i] = address(uint160(0x2000 + i));
        vm.prank(org);
        pool.sponsor(90 * USDC, members);
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(members[i]);
            pool.voteSealed(GX, GY, i);
        }
        vm.prank(members[8]);
        vm.expectRevert(SealedRankedShares.TooManySealedVoters.selector);
        pool.voteSealed(GX, GY, 8);
    }

    // ---- phases ----

    function test_closingPhaseAfterDeadlineBlocksVotes() public {
        openWithProjects();
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.warp(DEADLINE);
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Closing));
        // `inPhase(Phase.Open)` runs before `beforeDeadline`, so Closing reports WrongPhase.
        vm.prank(alice);
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.voteSealed(GX, GY, 5);
        vm.prank(alice);
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.contribute(1);
    }
}
```

```solidity
// test/mocks/MockHonkVerifier.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";

/// @dev Accepts or rejects every proof. `verify` is `view` in the interface, so the mock
///      cannot record calls; tests assert on the pool's state changes instead.
contract MockHonkVerifier is IHonkVerifier {
    bool public accept = true;

    function setAccept(bool value) external {
        accept = value;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return accept;
    }
}
```

Run: `forge test --match-path "test/sealed/SealedLedger.t.sol"`
Expected: compilation fails, `SealedRankedShares` not found.

- [ ] **Step 2: Write `Grumpkin.sol` and `IHonkVerifier.sol`**

```solidity
// src/lib/Grumpkin.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Grumpkin: y^2 = x^3 - 17 over the BN254 scalar field.
library Grumpkin {
    uint256 internal constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant B = P - 17;

    function isOnCurve(uint256 x, uint256 y) internal pure returns (bool) {
        if (x >= P || y >= P) return false;
        uint256 lhs = mulmod(y, y, P);
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), B, P);
        return lhs == rhs;
    }
}
```

```solidity
// src/interfaces/IHonkVerifier.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev The interface of the verifiers `bb write_solidity_verifier` emits.
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
```

- [ ] **Step 3: Write the skeleton of `SealedRankedShares`**

```solidity
// src/SealedRankedShares.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolBase} from "./PoolBase.sol";
import {IPoseidon2} from "./interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "./interfaces/IHonkVerifier.sol";
import {Grumpkin} from "./lib/Grumpkin.sol";

/// @title SealedRankedShares
/// @notice A RankedShares pool whose seat holders vote with sealed ballots. Direct
///         ballots are public and final; sealed ballots are encrypted to the tallier key
///         and replaceable. The tally runs off-chain: the CRE workflow reports a result
///         and a transcript, and a chain of Noir proofs over the sealed block makes it
///         final. See docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md.
contract SealedRankedShares is PoolBase {
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
    error TooManySealedVoters();

    // ---------------------------------------------------------------- events

    event Voted(address indexed voter);
    event SealedVote(address indexed voter);

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

    struct Config {
        address forwarder;
        IPoseidon2 poseidon;
        IHonkVerifier ingestVerifier;
        IHonkVerifier tallyVerifier;
        uint256 tallierPkX;
        uint256 tallierPkY;
        bytes32 keySalt;
        uint256 nSealedMax;
        uint256 mMax;
        uint256 batch;
        uint256 minDirectVote;
        uint64 proofGrace;
        uint64 abandonGrace;
    }

    // ------------------------------------------------------------- constants

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant MAX_WEIGHT = type(uint64).max;
    uint256 public constant NONE = type(uint64).max;
    uint256 internal constant MAX_PROJECTS = 31; // one byte per project must pack into one field element

    // ------------------------------------------------------------ immutables

    address public immutable forwarder;
    IPoseidon2 public immutable poseidon;
    IHonkVerifier public immutable ingestVerifier;
    IHonkVerifier public immutable tallyVerifier;
    uint256 public immutable tallierPkX;
    uint256 public immutable tallierPkY;
    bytes32 public immutable keySalt;
    uint256 public immutable nSealedMax;
    uint256 public immutable mMax;
    uint256 public immutable batch;
    uint256 public immutable minDirectVote;
    uint64 public immutable proofGrace;
    uint64 public immutable abandonGrace;

    // --------------------------------------------------------------- storage

    uint256 public totalWeight;
    uint256[] internal _costs;

    address[] public voters;
    mapping(address => bool) internal _isVoter;
    mapping(address => uint256) public directWeight;
    mapping(address => uint256) public seatWeight;
    uint256 public totalSeatWeight;
    mapping(address => uint256) internal _directBallot;
    mapping(address => bool) public hasDirect;
    mapping(address => uint256[3]) internal _sealed;
    uint256 public sealedCount;

    Finality public finality;

    // ----------------------------------------------------------- constructor

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_, Config memory cfg)
        PoolBase(token_, owner_, votingDeadline_)
    {
        if (
            cfg.forwarder == address(0) || address(cfg.poseidon) == address(0)
                || address(cfg.ingestVerifier) == address(0) || address(cfg.tallyVerifier) == address(0)
                || cfg.nSealedMax == 0 || cfg.mMax == 0 || cfg.mMax > MAX_PROJECTS || cfg.batch == 0
                || cfg.abandonGrace <= cfg.proofGrace || !Grumpkin.isOnCurve(cfg.tallierPkX, cfg.tallierPkY)
        ) revert InvalidConfig();
        forwarder = cfg.forwarder;
        poseidon = cfg.poseidon;
        ingestVerifier = cfg.ingestVerifier;
        tallyVerifier = cfg.tallyVerifier;
        tallierPkX = cfg.tallierPkX;
        tallierPkY = cfg.tallierPkY;
        keySalt = cfg.keySalt;
        nSealedMax = cfg.nSealedMax;
        mMax = cfg.mMax;
        batch = cfg.batch;
        minDirectVote = cfg.minDirectVote;
        proofGrace = cfg.proofGrace;
        abandonGrace = cfg.abandonGrace;
    }

    // ------------------------------------------------------------- modifiers

    modifier inPhase(Phase expected) {
        if (phase() != expected) revert WrongPhase();
        _;
    }

    // ----------------------------------------------------------------- views

    function phase() public view returns (Phase) {
        if (finality != Finality.None) return Phase.Done;
        if (_closed()) return Phase.Tally;
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

    function directBallotOf(address voter) external view returns (uint256) {
        return _directBallot[voter];
    }

    function sealedOf(address voter) external view returns (uint256 rx, uint256 ry, uint256 c) {
        uint256[3] storage ct = _sealed[voter];
        return (ct[0], ct[1], ct[2]);
    }

    // --------------------------------------------------------------- ballots

    /// @notice Cast the caller's public ballot. One per address, never replaced.
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        if (hasDirect[msg.sender]) revert BallotAlreadyCast();
        if (directWeight[msg.sender] < minDirectVote) revert BelowMinimumVote();
        _directBallot[msg.sender] = _validateAndPack(ranks);
        hasDirect[msg.sender] = true;
        _register(msg.sender);
        emit Voted(msg.sender);
    }

    /// @notice Cast or replace the caller's sealed ballot: a Grumpkin point R and a
    ///         masked field element c (spec B4).
    function voteSealed(uint256 rx, uint256 ry, uint256 c) external inPhase(Phase.Open) beforeDeadline {
        if (seatWeight[msg.sender] == 0) revert NoSeatWeight();
        if (rx == 0 || c >= FIELD || !Grumpkin.isOnCurve(rx, ry)) revert InvalidCiphertext();
        uint256[3] storage ct = _sealed[msg.sender];
        if (ct[0] == 0) {
            if (sealedCount >= nSealedMax) revert TooManySealedVoters();
            sealedCount++;
        }
        ct[0] = rx;
        ct[1] = ry;
        ct[2] = c;
        emit SealedVote(msg.sender);
    }

    // ------------------------------------------------------------- internals

    function _register(address voter) internal {
        if (!_isVoter[voter]) {
            _isVoter[voter] = true;
            voters.push(voter);
        }
    }

    /// @dev Competition-ranking check identical to PBEAR._setBallot, then packing.
    function _validateAndPack(bytes calldata ranks) internal view returns (uint256 packed) {
        uint256 m = _costs.length;
        if (ranks.length != m) revert InvalidBallot();
        uint256[] memory counts = new uint256[](m + 1);
        for (uint256 c = 0; c < m; c++) {
            uint8 r = uint8(ranks[c]);
            if (r > m) revert InvalidBallot();
            counts[r]++;
            packed |= uint256(r) << (8 * c);
        }
        uint256 seen = 0;
        for (uint256 r = 1; r <= m; r++) {
            if (counts[r] != 0 && r != seen + 1) revert InvalidBallot();
            seen += counts[r];
        }
    }

    /// @dev Set by Task 4 once `close` completes; false until then.
    function _closed() internal view virtual returns (bool) {
        return false;
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
        if (_costs.length >= mMax) revert TooManyProjects();
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

    function _isFunded(uint256) internal view virtual override returns (bool) {
        return false;
    }

    function _costOf(uint256 projectId) internal view override returns (uint256) {
        return _costs[projectId];
    }

    function _spent() internal view virtual override returns (uint256) {
        return 0;
    }
}
```

`_closed`, `_isFunded` and `_spent` are placeholders that Task 4 and Task 6 replace with real storage; they are marked `virtual` only so this task compiles and is testable on its own. Task 4 replaces `_closed` with the `closed` flag; Task 6 replaces `_isFunded` / `_spent` with the funded mapping and `spent`.

- [ ] **Step 4: Run the tests**

Run: `forge test --match-path "test/sealed/SealedLedger.t.sol" --match-path "test/Grumpkin.t.sol" -vv`
Expected: 3 Grumpkin tests and 12 ledger tests pass.

- [ ] **Step 5: Commit**

```bash
forge fmt
git add src/lib/Grumpkin.sol src/interfaces/IHonkVerifier.sol src/SealedRankedShares.sol test/mocks/MockHonkVerifier.sol test/Grumpkin.t.sol test/sealed/SealedLedger.t.sol
git commit -m "Add SealedRankedShares ledger, public and sealed ballots, phases"
```

---

### Task 4: Closing and the commitment, with the fixture loader

**Files:**
- Modify: `src/SealedRankedShares.sol`
- Create: `test/sealed/FixtureLoader.sol`
- Test: `test/sealed/SealedClose.t.sol`

**Interfaces:**
- Produces on the pool: `close(uint256 maxVoters)`, `closed`, `closeCursor`, `sealedCursor`, `hPub`, `hSealed`, `checkpoint(uint256)`, `costsHash`, `inputsRoot`, `numBatches`, event `Closed(bytes32 inputsRoot, uint256 sealedCount)`, and `_close(uint256)` internal (used by the kind-2 report in Task 5).
- Produces `FixtureLoader` (abstract test contract) with:
  - `loadFixture(string memory name)` → reads `reference/vectors/fixture_<name>.json` into `json`;
  - `deployFromFixture()` → deploys token, nft, Poseidon2, two `MockHonkVerifier`s and the pool with `nSealedMax/mMax/batch` from `.profile`, `minDirectVote` from `.minDirectVote`, `tallierPkX/Y` from `.pk`, and adds the projects from `.costs`;
  - `replayVoters()` → for every voter in `.voters`, in order: contribute `directWeight` (mint + approve + prank), sponsor `seatWeight` through `org` with a one-member list, then `vote` if `hasDirect`; afterwards `voteSealed` for every voter with `hasSealed`; finally sponsor the dust (`totalWeight − Σ(direct + seat)`) as an unclaimed NFT sponsorship; asserts `pool.totalWeight()` equals `.totalWeight`;
  - `closeAll(uint256 chunk)` → warps to the deadline and calls `close(chunk)` until `closed`;
  - helpers `fxUint(key)`, `fxBytes32(key)`, `fxUintArray(key)`, `fxCount(prefix)`, `fxAddress(key)`, `fxBool(key)`; `ranksBytes(uint256[] memory)`.

- [ ] **Step 1: Write the loader and the failing tests**

```solidity
// test/sealed/FixtureLoader.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IPoseidon2} from "../../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MockHonkVerifier} from "../mocks/MockHonkVerifier.sol";

/// @dev Rebuilds a pool from one of the Python fixtures through the public API, so the
///      contract's commitments can be compared with the reference oracle.
abstract contract FixtureLoader is Test {
    using stdJson for string;

    string internal json;
    MockERC20 internal token;
    MockERC721 internal nft;
    Poseidon2 internal poseidon;
    MockHonkVerifier internal ingestVerifier;
    MockHonkVerifier internal tallyVerifier;
    SealedRankedShares internal pool;

    address internal owner = makeAddr("owner");
    address internal forwarder = makeAddr("forwarder");
    address internal org = makeAddr("org");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant DEADLINE = 1_000_000;

    function loadFixture(string memory name) internal {
        json = vm.readFile(string.concat("reference/vectors/fixture_", name, ".json"));
    }

    // ---- JSON helpers ----

    function fxUint(string memory key) internal view returns (uint256) {
        return json.readUint(key);
    }

    function fxBytes32(string memory key) internal view returns (bytes32) {
        return json.readBytes32(key);
    }

    function fxWord(string memory key) internal view returns (uint256) {
        return uint256(json.readBytes32(key));
    }

    function fxBool(string memory key) internal view returns (bool) {
        return json.readBool(key);
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
        for (uint256 i = 0; i < b.length; i++) out[i] = uint256(b[i]);
    }

    function fxCount(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function voterKey(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".voters[", vm.toString(i), "].", field);
    }

    function ranksBytes(uint256[] memory ranks) internal pure returns (bytes memory out) {
        out = new bytes(ranks.length);
        for (uint256 i = 0; i < ranks.length; i++) out[i] = bytes1(uint8(ranks[i]));
    }

    // ---- pool construction ----

    function deployFromFixture() internal {
        vm.warp(1);
        token = new MockERC20();
        nft = new MockERC721();
        poseidon = new Poseidon2();
        ingestVerifier = new MockHonkVerifier();
        tallyVerifier = new MockHonkVerifier();
        uint256[] memory pk = fxWords(".pk");
        SealedRankedShares.Config memory cfg = SealedRankedShares.Config({
            forwarder: forwarder,
            poseidon: IPoseidon2(address(poseidon)),
            ingestVerifier: IHonkVerifier(address(ingestVerifier)),
            tallyVerifier: IHonkVerifier(address(tallyVerifier)),
            tallierPkX: pk[0],
            tallierPkY: pk[1],
            keySalt: fxBytes32(".keySalt"),
            nSealedMax: fxUint(".profile.nSealedMax"),
            mMax: fxUint(".profile.mMax"),
            batch: fxUint(".profile.batch"),
            minDirectVote: fxWord(".minDirectVote"),
            proofGrace: 1 days,
            abandonGrace: 7 days
        });
        pool = new SealedRankedShares(token, owner, DEADLINE, cfg);
        uint256[] memory costs = fxWords(".costs");
        vm.startPrank(owner);
        for (uint256 c = 0; c < costs.length; c++) pool.addProject(costs[c], recipient);
        pool.openVoting();
        vm.stopPrank();
        token.mint(org, type(uint64).max);
        vm.prank(org);
        token.approve(address(pool), type(uint256).max);
    }

    function replayVoters() internal {
        uint256 n = fxCount(".voters");
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
            if (seat > 0) {
                address[] memory members = new address[](1);
                members[0] = a;
                vm.prank(org);
                pool.sponsor(seat, members);
            }
            if (fxBool(voterKey(i, "hasDirect"))) {
                vm.prank(a);
                pool.vote(ranksBytes(fxUintArray(voterKey(i, "directRanks"))));
            }
            granted += direct + seat;
        }
        for (uint256 i = 0; i < n; i++) {
            if (!fxBool(voterKey(i, "hasSealed"))) continue;
            uint256[] memory ct = fxWords(voterKey(i, "ciphertext"));
            vm.prank(fxAddress(voterKey(i, "addr")));
            pool.voteSealed(ct[0], ct[1], ct[2]);
        }
        uint256 dust = fxWord(".totalWeight") - granted;
        if (dust > 0) {
            vm.prank(org);
            pool.sponsorNFT(dust, IERC721(address(nft)), dust);
        }
        assertEq(pool.totalWeight(), fxWord(".totalWeight"), "fixture totalWeight");
        assertEq(pool.voterCount(), n, "fixture voter count");
        for (uint256 i = 0; i < n; i++) {
            assertEq(pool.voters(i), fxAddress(voterKey(i, "addr")), "registration order");
        }
    }

    function closeAll(uint256 chunk) internal {
        vm.warp(DEADLINE);
        while (!pool.closed()) pool.close(chunk);
    }
}
```

```solidity
// test/sealed/SealedClose.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolBase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedCloseTest is FixtureLoader {
    function assertCommitments() internal view {
        assertEq(pool.hPub(), fxBytes32(".hPub"), "hPub");
        assertEq(pool.hSealed(), fxWord(".hSealed"), "hSealed");
        assertEq(pool.sealedCount(), fxUint(".sealedCount"), "sealedCount");
        assertEq(pool.numBatches(), fxUint(".numBatches"), "numBatches");
        uint256[] memory checkpoints = fxWords(".checkpoints");
        for (uint256 k = 0; k < checkpoints.length; k++) {
            assertEq(pool.checkpoint(k), checkpoints[k], string.concat("checkpoint ", vm.toString(k)));
        }
        assertEq(pool.costsHash(), fxWord(".costsHash"), "costsHash");
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"), "inputsRoot");
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Tally));
    }

    function test_mainFixtureInOneCall() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        vm.warp(DEADLINE);
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.Closed(fxBytes32(".inputsRoot"), fxUint(".sealedCount"));
        pool.close(1000);
        assertCommitments();
    }

    function test_mainFixtureChunkedByOne() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(1);
        assertCommitments();
    }

    function test_smallmFixture() public {
        loadFixture("test_smallm");
        deployFromFixture();
        replayVoters();
        closeAll(3);
        assertCommitments();
    }

    function test_nosealedFixtureHasZeroCheckpointOne() public {
        loadFixture("test_nosealed");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        assertCommitments();
        assertEq(pool.numBatches(), 1);
        assertEq(pool.checkpoint(1), 0);
    }

    function test_defaultFixture() public {
        loadFixture("default_main");
        deployFromFixture();
        replayVoters();
        closeAll(25);
        assertCommitments();
    }

    function test_closeRequiresClosingPhaseAndBalance() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.close(10);
        vm.warp(DEADLINE);
        // Drain one wei so the balance no longer covers the budget.
        vm.prank(address(pool));
        token.transfer(org, 1);
        vm.expectRevert(PoolBase.BalanceBelowTotalWeight.selector);
        pool.close(10);
    }

    function test_closeIsIdempotentAfterCompletion() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(1000);
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.close(1);
    }
}
```

Run: `forge test --match-path "test/sealed/SealedClose.t.sol"`
Expected: compilation fails (`close`, `closed`, `hPub` … missing).

- [ ] **Step 2: Implement closing**

In `src/SealedRankedShares.sol` add the event and storage (no `AlreadyClosed` error: phase gating covers a second close):

```solidity
    event Closed(bytes32 inputsRoot, uint256 sealedCount);

    // closing (spec B6.1)
    bool public closed;
    uint256 public closeCursor;
    uint256 public sealedCursor;
    bytes32 public hPub;
    uint256 public hSealed;
    mapping(uint256 => uint256) public checkpoint;
    uint256 public costsHash;
    bytes32 public inputsRoot;
    uint256 public numBatches;
```

Replace the placeholder `_closed()` with `return closed;` (drop `virtual`). Add:

```solidity
    // --------------------------------------------------------------- closing

    /// @notice Walk the voters and commit to every input, at most `maxVoters` per call.
    function close(uint256 maxVoters) external inPhase(Phase.Closing) {
        _close(maxVoters);
    }

    function _close(uint256 maxVoters) internal {
        if (closeCursor == 0) _requireBalanceCoversBudget();
        uint256 n = voters.length;
        uint256 end = closeCursor + maxVoters;
        if (end > n) end = n;
        bytes32 hp = hPub;
        uint256 hs = hSealed;
        uint256 j = sealedCursor;
        uint256 sc = sealedCount;
        for (uint256 i = closeCursor; i < end; i++) {
            address a = voters[i];
            if (hasDirect[a]) {
                hp = keccak256(abi.encodePacked(hp, a, directWeight[a], _directBallot[a]));
            }
            uint256[3] storage ct = _sealed[a];
            if (ct[0] != 0) {
                uint256[] memory in6 = new uint256[](6);
                in6[0] = hs;
                in6[1] = uint256(uint160(a));
                in6[2] = seatWeight[a];
                in6[3] = ct[0];
                in6[4] = ct[1];
                in6[5] = ct[2];
                hs = poseidon.hash(in6);
                j++;
                if (j % batch == 0 || j == sc) checkpoint[(j + batch - 1) / batch] = hs;
            }
        }
        closeCursor = end;
        hPub = hp;
        hSealed = hs;
        sealedCursor = j;
        if (end == n) {
            costsHash = poseidon.hash(_costs);
            inputsRoot = keccak256(abi.encodePacked(hp, hs, sc, costsHash, totalWeight));
            numBatches = sc == 0 ? 1 : (sc + batch - 1) / batch;
            closed = true;
            emit Closed(inputsRoot, sc);
        }
    }
```

`poseidon.hash(_costs)` passes the storage array as calldata to the external call; Solidity copies it. `checkpoint[0]` is never written and reads as zero, as does `checkpoint[1]` when `sc == 0`.

- [ ] **Step 3: Run the tests**

Run: `forge test --match-path "test/sealed/SealedClose.t.sol" -vv`
Expected: 7 tests pass. The default fixture test walks 70 voters with 65 Poseidon2 calls; it takes a few seconds.

If `hPub` mismatches while `hSealed` matches, check `abi.encodePacked(hp, a, directWeight[a], _directBallot[a])`: `a` must be the 20-byte address, the other two 32-byte words, matching `public_chain` in `reference/commitments.py`.

- [ ] **Step 4: Commit**

```bash
forge fmt
git add src/SealedRankedShares.sol test/sealed/FixtureLoader.sol test/sealed/SealedClose.t.sol
git commit -m "Commit sealed pool inputs in close with per-batch checkpoints"
```

---

### Task 5: DON reports: result, transcript, kind-2 close

**Files:**
- Create: `src/interfaces/IReceiver.sol`
- Modify: `src/SealedRankedShares.sol`
- Test: `test/sealed/SealedReport.t.sol`

**Interfaces:**
- Produces `IReceiver is IERC165 { function onReport(bytes calldata metadata, bytes calldata report) external; }` and `SealedRankedShares is PoolBase, IReceiver` with `supportsInterface`.
- Produces on the pool: `resultReported`, `transcriptHash`, `provisionalResult() returns (uint256[] memory)`, events `ProvisionalResult(uint256[] fundedOrder)`, `Transcript(uint256[] transcript)`, errors `NotForwarder, UnknownReport, ResultAlreadyReported, InputMismatch, InvalidResult, InvalidTranscript`. Report encoding: `abi.encode(uint8 kind, bytes payload)`; kind 1 payload `abi.encode(bytes32 inputsRoot, uint256[] fundedOrder, uint256[] transcript)`; kind 2 payload `abi.encode(uint256 maxVoters)`.
- Produces internal `_validateResult(uint256[] memory order) view` (distinct ids below `m`, costs sum ≤ `totalWeight`).

- [ ] **Step 1: Write the failing tests**

```solidity
// test/sealed/SealedReport.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoolBase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedReportTest is FixtureLoader {
    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
    }

    function resultReport(bytes32 root, uint256[] memory order, uint256[] memory transcript)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(uint8(1), abi.encode(root, order, transcript));
    }

    function fixtureTranscript() internal view returns (uint256[] memory flat) {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) flat[s * width + w] = step[w];
        }
    }

    function test_supportsReceiverInterface() public view {
        assertTrue(pool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(pool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(pool.supportsInterface(0xffffffff));
    }

    function test_onlyForwarder() public {
        vm.expectRevert(SealedRankedShares.NotForwarder.selector);
        pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(1))));
    }

    function test_unknownKind() public {
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.UnknownReport.selector);
        pool.onReport("", abi.encode(uint8(9), ""));
    }

    function test_kindTwoClosesInChunks() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        while (!pool.closed()) pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(3))));
        vm.stopPrank();
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"));
    }

    function test_kindTwoRequiresClosingPhase() public {
        vm.prank(forwarder);
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(3))));
    }

    function test_resultAcceptedOnceWithMatchingRootAndTranscriptHash() public {
        closeAll(100);
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory transcript = fixtureTranscript();
        vm.prank(forwarder);
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.ProvisionalResult(order);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, transcript));
        assertTrue(pool.resultReported());
        assertEq(pool.transcriptHash(), fxWord(".transcriptHash"));
        assertEq(pool.provisionalResult().length, order.length);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.ResultAlreadyReported.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, transcript));
    }

    function test_resultRejectsWrongRoot() public {
        closeAll(100);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.onReport("", resultReport(bytes32(uint256(1)), fxUintArray(".funded"), fixtureTranscript()));
    }

    function test_resultRejectsBeforeClose() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), fxUintArray(".funded"), fixtureTranscript()));
    }

    function test_resultRejectsInvalidFundedList() public {
        closeAll(100);
        uint256[] memory order = new uint256[](2);
        order[0] = 0;
        order[1] = 0;
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidResult.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, fixtureTranscript()));
        order[1] = fxUint(".m");
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidResult.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, fixtureTranscript()));
    }

    function test_resultRejectsMalformedTranscript() public {
        closeAll(100);
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory transcript = fixtureTranscript();
        uint256 width = fxUint(".m") + 3;
        // wrong length
        uint256[] memory cut = new uint256[](transcript.length - 1);
        for (uint256 i = 0; i < cut.length; i++) cut[i] = transcript[i];
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, cut));
        // funded order disagrees with the transcript
        uint256[] memory swapped = new uint256[](order.length);
        for (uint256 i = 0; i < order.length; i++) swapped[i] = order[order.length - 1 - i];
        if (order.length > 1) {
            vm.prank(forwarder);
            vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
            pool.onReport("", resultReport(fxBytes32(".inputsRoot"), swapped, transcript));
        }
        // best out of range
        uint256[] memory bad = transcript;
        bad[width - 2] = fxUint(".m") + 1;
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, bad));
        // too many steps
        uint256[] memory long_ = new uint256[]((2 * fxUint(".m") + 1) * width);
        for (uint256 i = 0; i < long_.length; i++) long_[i] = (i % width == width - 2) ? pool.NONE() : 0;
        uint256[] memory none = new uint256[](0);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), none, long_));
    }

    function test_emptyTranscriptHashesToZero() public {
        closeAll(100);
        uint256[] memory none = new uint256[](0);
        vm.prank(forwarder);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), none, none));
        assertTrue(pool.resultReported());
        assertEq(pool.transcriptHash(), 0);
    }
}
```

The last test reports an empty transcript for a pool that in truth had steps; the contract cannot know that, which is exactly why the tally proofs of Task 6 check the transcript hash and why the flag, not the hash, gates them.

Run: `forge test --match-path "test/sealed/SealedReport.t.sol"`
Expected: compilation fails (`onReport`, `IReceiver` missing).

- [ ] **Step 2: Implement the receiver**

```solidity
// src/interfaces/IReceiver.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @dev Chainlink CRE report receiver: the KeystoneForwarder calls onReport with the
///      workflow metadata and the report bytes the workflow produced.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
```

In `SealedRankedShares.sol`: import `IReceiver` and `IERC165`, declare `contract SealedRankedShares is PoolBase, IReceiver`, and add:

```solidity
    error NotForwarder();
    error UnknownReport();
    error ResultAlreadyReported();
    error InputMismatch();
    error InvalidResult();
    error InvalidTranscript();

    event ProvisionalResult(uint256[] fundedOrder);
    event Transcript(uint256[] transcript);

    // report (spec B6.2)
    bool public resultReported;
    uint256[] internal _provisional;
    uint256 public transcriptHash;

    function provisionalResult() external view returns (uint256[] memory) {
        return _provisional;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // --------------------------------------------------------------- reports

    /// @notice Entry point for the CRE forwarder: kind 1 delivers the provisional result
    ///         and the transcript, kind 2 drives `close` from the workflow.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint8 kind, bytes memory payload) = abi.decode(report, (uint8, bytes));
        if (kind == 2) {
            if (phase() != Phase.Closing) revert WrongPhase();
            _close(abi.decode(payload, (uint256)));
            return;
        }
        if (kind != 1) revert UnknownReport();
        if (phase() != Phase.Tally) revert WrongPhase();
        if (resultReported) revert ResultAlreadyReported();
        (bytes32 root, uint256[] memory order, uint256[] memory transcript) =
            abi.decode(payload, (bytes32, uint256[], uint256[]));
        if (root != inputsRoot) revert InputMismatch();
        _validateResult(order);
        transcriptHash = _hashTranscript(transcript, order);
        _provisional = order;
        resultReported = true;
        emit ProvisionalResult(order);
        emit Transcript(transcript);
    }

    /// @dev Distinct valid project ids whose costs fit the budget (spec A6.2).
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

    /// @dev Parses the transcript of spec B6.3 and returns its Poseidon2 chain hash.
    function _hashTranscript(uint256[] memory transcript, uint256[] memory order) internal view returns (uint256 h) {
        uint256 m = _costs.length;
        uint256 width = m + 3;
        if (transcript.length % width != 0) revert InvalidTranscript();
        uint256 steps = transcript.length / width;
        if (steps > 2 * m) revert InvalidTranscript();
        uint256[] memory elems = new uint256[](m + 4);
        uint256 fundedSeen;
        for (uint256 s = 0; s < steps; s++) {
            uint256 best = transcript[s * width + m + 1];
            if (best != NONE) {
                if (best >= m || fundedSeen >= order.length || order[fundedSeen] != best) revert InvalidTranscript();
                fundedSeen++;
            }
            elems[0] = h;
            for (uint256 w = 0; w < width; w++) {
                uint256 x = transcript[s * width + w];
                if (x >= FIELD) revert InvalidTranscript();
                elems[w + 1] = x;
            }
            h = poseidon.hash(elems);
        }
        if (fundedSeen != order.length) revert InvalidTranscript();
    }
```

- [ ] **Step 3: Run the tests**

Run: `forge test --match-path "test/sealed/SealedReport.t.sol" -vv`
Expected: 11 tests pass. If `transcriptHash` mismatches the fixture, compare against `transcript_hash` in `reference/commitments.py`: the element list is `[h, level, pubSupport…, best, total]`, `m + 4` elements.

- [ ] **Step 4: Commit**

```bash
forge fmt
git add src/interfaces/IReceiver.sol src/SealedRankedShares.sol test/sealed/SealedReport.t.sol
git commit -m "Accept the DON result and transcript through the CRE forwarder"
```

---

### Task 6: Proof chain, finalisation, restart and grace paths

**Files:**
- Modify: `src/SealedRankedShares.sol`
- Test: `test/sealed/SealedAdvance.t.sol`, `test/sealed/SealedFixture.t.sol`

**Interfaces:**
- Produces on the pool: `advance(bytes proof, bytes32[] publicInputs)`, `restartTally()`, `acceptProvisional()`, `abandon()`, `ingestCursor`, `stateCommit`, `ingestedState`, `funded(id)`, `fundedProjects()`, `spent`, events `Ingested(uint256 k)`, `Advanced()`, `TallyRestarted()`, `Finalized(Finality finality, uint256[] fundedOrder)`, errors `ProofOutOfOrder, InvalidProof, TranscriptPending, TranscriptMismatch, ResultMismatch, IngestPending, ProofPending, ResultPending`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/sealed/SealedAdvance.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolBase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedAdvanceTest is FixtureLoader {
    string constant INGEST_KEYS = "k,nSealed,m,budget,pkX,pkY,hIn,hOut,stateIn,stateOut";
    string constant TALLY_KEYS = "costsHash,stateIn,stateOut,done,tHashOut,fundedCount,fundedOrderPacked";

    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
    }

    function report() internal {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) flat[s * width + w] = step[w];
        }
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat)));
    }

    function ingestInputs(uint256 k) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".ingestProofs[", vm.toString(k), "].");
        out = new bytes32[](10);
        out[0] = bytes32(fxUint(string.concat(p, "k")));
        out[1] = bytes32(fxUint(string.concat(p, "nSealed")));
        out[2] = bytes32(fxUint(string.concat(p, "m")));
        out[3] = fxBytes32(string.concat(p, "budget"));
        out[4] = fxBytes32(string.concat(p, "pkX"));
        out[5] = fxBytes32(string.concat(p, "pkY"));
        out[6] = fxBytes32(string.concat(p, "hIn"));
        out[7] = fxBytes32(string.concat(p, "hOut"));
        out[8] = fxBytes32(string.concat(p, "stateIn"));
        out[9] = fxBytes32(string.concat(p, "stateOut"));
    }

    function tallyInputs(uint256 g) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".tallyProofs[", vm.toString(g), "].");
        out = new bytes32[](7);
        out[0] = fxBytes32(string.concat(p, "costsHash"));
        out[1] = fxBytes32(string.concat(p, "stateIn"));
        out[2] = fxBytes32(string.concat(p, "stateOut"));
        out[3] = bytes32(fxUint(string.concat(p, "done")));
        out[4] = fxBytes32(string.concat(p, "tHashOut"));
        out[5] = bytes32(fxUint(string.concat(p, "fundedCount")));
        out[6] = fxBytes32(string.concat(p, "fundedOrderPacked"));
    }

    function ingestAll() internal {
        uint256 n = fxCount(".ingestProofs");
        for (uint256 k = 0; k < n; k++) pool.advance("", ingestInputs(k));
        assertEq(pool.ingestCursor(), n);
        assertEq(pool.ingestedState(), uint256(ingestInputs(n - 1)[9]));
    }

    function tallyAll() internal {
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g < n; g++) pool.advance("", tallyInputs(g));
    }

    // ---- ingest ----

    function test_ingestChainFollowsCheckpoints() public {
        uint256 n = fxCount(".ingestProofs");
        assertGt(n, 1);
        for (uint256 k = 0; k < n; k++) {
            vm.expectEmit(false, false, false, true);
            emit SealedRankedShares.Ingested(k);
            pool.advance("", ingestInputs(k));
            assertEq(pool.stateCommit(), uint256(ingestInputs(k)[9]));
        }
    }

    function test_ingestRejectsOutOfOrderAndTampered() public {
        bytes32[] memory second = ingestInputs(1);
        vm.expectRevert(SealedRankedShares.ProofOutOfOrder.selector);
        pool.advance("", second);
        bytes32[] memory first = ingestInputs(0);
        first[7] = bytes32(uint256(first[7]) + 1); // hOut
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        first = ingestInputs(0);
        first[4] = bytes32(uint256(first[4]) + 1); // pkX
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        first = ingestInputs(0);
        first[8] = bytes32(uint256(1)); // stateIn must be zero for batch 0
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        bytes32[] memory short_ = new bytes32[](9);
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", short_);
    }

    function test_ingestRejectsWhenVerifierRejects() public {
        ingestVerifier.setAccept(false);
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance("", ingestInputs(0));
    }

    // ---- tally ----

    function test_tallyRequiresIngestAndReport() public {
        bytes32[] memory t0 = tallyInputs(0);
        // With ingest pending the inputs are read as an ingest proof and rejected.
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        ingestAll();
        vm.expectRevert(SealedRankedShares.TranscriptPending.selector);
        pool.advance("", t0);
    }

    function test_tallyChainFinalizes() public {
        ingestAll();
        report();
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g + 1 < n; g++) {
            pool.advance("", tallyInputs(g));
            assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
        }
        uint256[] memory order = fxUintArray(".funded");
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.Finalized(SealedRankedShares.Finality.Proven, order);
        pool.advance("", tallyInputs(n - 1));
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Done));
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length);
        uint256 expectedSpent;
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i]);
            assertTrue(pool.funded(order[i]));
            expectedSpent += pool.cost(order[i]);
        }
        assertEq(pool.spent(), expectedSpent);
    }

    function test_tallyRejectsTamperedInputs() public {
        ingestAll();
        report();
        bytes32[] memory t0 = tallyInputs(0);
        t0[0] = bytes32(uint256(t0[0]) + 1); // costsHash
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        t0 = tallyInputs(0);
        t0[1] = bytes32(uint256(t0[1]) + 1); // stateIn
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        tallyVerifier.setAccept(false);
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance("", tallyInputs(0));
    }

    function test_finalProofChecksTranscriptHashAndResult() public {
        ingestAll();
        report();
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g + 1 < n; g++) pool.advance("", tallyInputs(g));
        bytes32[] memory last = tallyInputs(n - 1);
        last[4] = bytes32(uint256(last[4]) + 1); // tHashOut
        vm.expectRevert(SealedRankedShares.TranscriptMismatch.selector);
        pool.advance("", last);
        last = tallyInputs(n - 1);
        last[5] = bytes32(uint256(last[5]) + 1); // fundedCount
        vm.expectRevert(SealedRankedShares.ResultMismatch.selector);
        pool.advance("", last);
    }

    function test_restartTallyResetsToIngestedState() public {
        vm.expectRevert(SealedRankedShares.IngestPending.selector);
        pool.restartTally();
        ingestAll();
        report();
        pool.advance("", tallyInputs(0));
        assertNotEq(pool.stateCommit(), pool.ingestedState());
        vm.expectEmit(false, false, false, false);
        emit SealedRankedShares.TallyRestarted();
        pool.restartTally();
        assertEq(pool.stateCommit(), pool.ingestedState());
        tallyAll();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    function test_advanceRejectedOnceDone() public {
        ingestAll();
        report();
        tallyAll();
        vm.expectRevert(PoolBase.WrongPhase.selector);
        pool.advance("", tallyInputs(0));
    }

    // ---- grace paths ----

    function test_acceptProvisionalAfterGrace() public {
        report();
        vm.expectRevert(SealedRankedShares.ProofPending.selector);
        pool.acceptProvisional();
        vm.warp(DEADLINE + 1 days);
        pool.acceptProvisional();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Attested));
        assertEq(pool.fundedProjects().length, fxUintArray(".funded").length);
    }

    function test_acceptProvisionalNeedsAReport() public {
        vm.warp(DEADLINE + 1 days);
        vm.expectRevert(SealedRankedShares.ResultPending.selector);
        pool.acceptProvisional();
    }

    function test_abandonAfterGraceWithoutReport() public {
        vm.warp(DEADLINE + 7 days - 1);
        vm.expectRevert(SealedRankedShares.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + 7 days);
        pool.abandon();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Abandoned));
        assertEq(pool.fundedProjects().length, 0);
        assertEq(pool.spent(), 0);
    }

    function test_abandonRefusedWhenReported() public {
        report();
        vm.warp(DEADLINE + 7 days);
        vm.expectRevert(SealedRankedShares.ResultAlreadyReported.selector);
        pool.abandon();
    }

    function test_claimsAndSweepAfterProof() public {
        ingestAll();
        report();
        tallyAll();
        uint256[] memory order = fxUintArray(".funded");
        uint256 before = token.balanceOf(recipient);
        pool.claim(order[0]);
        assertEq(token.balanceOf(recipient) - before, pool.cost(order[0]));
        vm.expectRevert(PoolBase.AlreadyClaimed.selector);
        pool.claim(order[0]);
        uint256 unfunded;
        for (uint256 id = 0; id < pool.projectCount(); id++) {
            if (!pool.funded(id)) {
                unfunded = id;
                break;
            }
        }
        if (order.length < pool.projectCount()) {
            vm.expectRevert(PoolBase.NotFunded.selector);
            pool.claim(unfunded);
        }
        address treasury = makeAddr("treasury");
        vm.prank(owner);
        pool.sweep(treasury);
        assertEq(token.balanceOf(address(pool)), pool.spent() - pool.claimedTotal());
    }
}
```

```solidity
// test/sealed/SealedFixture.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev Every fixture end to end: replay, close, report, ingest, tally, Proven.
contract SealedFixtureTest is FixtureLoader {
    function runFixture(string memory name, uint256 chunk) internal {
        loadFixture(name);
        deployFromFixture();
        replayVoters();
        closeAll(chunk);
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"), "inputsRoot");

        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) flat[s * width + w] = step[w];
        }
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat)));
        assertEq(pool.transcriptHash(), fxWord(".transcriptHash"), "transcriptHash");

        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            string memory p = string.concat(".ingestProofs[", vm.toString(k), "].");
            bytes32[] memory pi = new bytes32[](10);
            pi[0] = bytes32(fxUint(string.concat(p, "k")));
            pi[1] = bytes32(fxUint(string.concat(p, "nSealed")));
            pi[2] = bytes32(fxUint(string.concat(p, "m")));
            pi[3] = fxBytes32(string.concat(p, "budget"));
            pi[4] = fxBytes32(string.concat(p, "pkX"));
            pi[5] = fxBytes32(string.concat(p, "pkY"));
            pi[6] = fxBytes32(string.concat(p, "hIn"));
            pi[7] = fxBytes32(string.concat(p, "hOut"));
            pi[8] = fxBytes32(string.concat(p, "stateIn"));
            pi[9] = fxBytes32(string.concat(p, "stateOut"));
            pool.advance("", pi);
        }
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 g = 0; g < nT; g++) {
            string memory p = string.concat(".tallyProofs[", vm.toString(g), "].");
            bytes32[] memory pi = new bytes32[](7);
            pi[0] = fxBytes32(string.concat(p, "costsHash"));
            pi[1] = fxBytes32(string.concat(p, "stateIn"));
            pi[2] = fxBytes32(string.concat(p, "stateOut"));
            pi[3] = bytes32(fxUint(string.concat(p, "done")));
            pi[4] = fxBytes32(string.concat(p, "tHashOut"));
            pi[5] = bytes32(fxUint(string.concat(p, "fundedCount")));
            pi[6] = fxBytes32(string.concat(p, "fundedOrderPacked"));
            pool.advance("", pi);
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven");
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length, "funded length");
        for (uint256 i = 0; i < order.length; i++) assertEq(got[i], order[i], "funded order");
    }

    function test_testMain() public {
        runFixture("test_main", 3);
    }

    function test_testSmallm() public {
        runFixture("test_smallm", 100);
    }

    function test_testNosealed() public {
        runFixture("test_nosealed", 2);
    }

    function test_defaultMain() public {
        runFixture("default_main", 40);
    }
}
```

Run: `forge test --match-path "test/sealed/SealedAdvance.t.sol"`
Expected: compilation fails (`advance` missing).

- [ ] **Step 2: Implement the proof chain and finalisation**

Add to `SealedRankedShares.sol`:

```solidity
    error ProofOutOfOrder();
    error InvalidProof();
    error TranscriptPending();
    error TranscriptMismatch();
    error ResultMismatch();
    error IngestPending();
    error ProofPending();
    error ResultPending();

    event Ingested(uint256 k);
    event Advanced();
    event TallyRestarted();
    event Finalized(Finality finality, uint256[] fundedOrder);

    // proofs (spec B6.5)
    uint256 public ingestCursor;
    uint256 public stateCommit;
    uint256 public ingestedState;

    // result
    mapping(uint256 => bool) public funded;
    uint256[] internal _fundedOrder;
    uint256 public spent;

    function fundedProjects() external view returns (uint256[] memory) {
        return _fundedOrder;
    }

    // ---------------------------------------------------------------- proofs

    /// @notice Verify the next proof of the chain: ingest batches first, then tally groups.
    function advance(bytes calldata proof, bytes32[] calldata publicInputs) external inPhase(Phase.Tally) {
        if (ingestCursor < numBatches) {
            _advanceIngest(proof, publicInputs);
        } else {
            _advanceTally(proof, publicInputs);
        }
    }

    function _advanceIngest(bytes calldata proof, bytes32[] calldata pi) internal {
        uint256 k = ingestCursor;
        if (pi.length != 10) revert InputMismatch();
        if (uint256(pi[0]) != k) revert ProofOutOfOrder();
        if (
            uint256(pi[1]) != sealedCount || uint256(pi[2]) != _costs.length || uint256(pi[3]) != totalWeight
                || uint256(pi[4]) != tallierPkX || uint256(pi[5]) != tallierPkY || uint256(pi[6]) != checkpoint[k]
                || uint256(pi[7]) != checkpoint[k + 1] || uint256(pi[8]) != stateCommit
        ) revert InputMismatch();
        if (!ingestVerifier.verify(proof, pi)) revert InvalidProof();
        stateCommit = uint256(pi[9]);
        ingestCursor = k + 1;
        if (k + 1 == numBatches) ingestedState = stateCommit;
        emit Ingested(k);
    }

    function _advanceTally(bytes calldata proof, bytes32[] calldata pi) internal {
        if (!resultReported) revert TranscriptPending();
        if (pi.length != 7) revert InputMismatch();
        if (uint256(pi[0]) != costsHash || uint256(pi[1]) != stateCommit) revert InputMismatch();
        if (!tallyVerifier.verify(proof, pi)) revert InvalidProof();
        stateCommit = uint256(pi[2]);
        emit Advanced();
        if (uint256(pi[3]) == 1) {
            if (uint256(pi[4]) != transcriptHash) revert TranscriptMismatch();
            uint256[] memory order = _unpackFunded(uint256(pi[5]), uint256(pi[6]));
            if (keccak256(abi.encode(order)) != keccak256(abi.encode(_provisional))) revert ResultMismatch();
            _finalize(order, Finality.Proven);
        }
    }

    /// @notice Reset the tally chain to the state after ingest, for a prover that fed a
    ///         transcript slice the DON did not publish.
    function restartTally() external inPhase(Phase.Tally) {
        if (ingestCursor != numBatches) revert IngestPending();
        stateCommit = ingestedState;
        emit TallyRestarted();
    }

    // ----------------------------------------------------------------- grace

    /// @notice Apply the DON's provisional result once `proofGrace` has elapsed with no proof.
    function acceptProvisional() external inPhase(Phase.Tally) {
        if (!resultReported) revert ResultPending();
        if (block.timestamp < votingDeadline + proofGrace) revert ProofPending();
        _finalize(_provisional, Finality.Attested);
    }

    /// @notice End the pool with nothing funded once `abandonGrace` has elapsed with no result.
    function abandon() external {
        Phase p = phase();
        if (p != Phase.Tally && p != Phase.Closing) revert WrongPhase();
        if (resultReported) revert ResultAlreadyReported();
        if (block.timestamp < votingDeadline + abandonGrace) revert ResultPending();
        _finalize(new uint256[](0), Finality.Abandoned);
    }

    // ------------------------------------------------------------- internals

    function _unpackFunded(uint256 count, uint256 packed) internal view returns (uint256[] memory order) {
        if (count > _costs.length) revert ResultMismatch();
        order = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            order[j] = (packed >> (8 * j)) & 0xff;
        }
    }

    function _finalize(uint256[] memory order, Finality how) internal {
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
```

Replace the placeholder hooks:

```solidity
    function _isFunded(uint256 projectId) internal view override returns (bool) {
        return funded[projectId];
    }

    function _spent() internal view override returns (uint256) {
        return spent;
    }
```

(drop `virtual` from both.) `abandon` in `Closing` covers a pool whose `close` never completes, as A6.5 requires; `_finalize` with an empty order leaves `spent = 0`, so `sweep` returns everything.

- [ ] **Step 3: Run the tests**

Run: `forge test --match-path "test/sealed/*.t.sol" -vv`
Expected: all sealed tests pass, including the four end-to-end fixture runs. `test_defaultMain` is the slow one (65 Poseidon2 calls in `close`, 23 transcript hashes, 6 proofs); allow a minute.

- [ ] **Step 4: Full suite, then commit**

Run: `forge test -q`
Expected: every suite passes.

```bash
forge fmt
git add src/SealedRankedShares.sol test/sealed/SealedAdvance.t.sol test/sealed/SealedFixture.t.sol
git commit -m "Verify the ingest and tally proof chain and finalise sealed pools"
```

---

### Task 7: Gas benchmark, deploy script, README

**Files:**
- Create: `test/sealed/SealedGas.t.sol`, `script/DeploySealed.s.sol`
- Modify: `README.md`, `.gas-snapshot`, `foundry.toml` (`gas_reports`)

**Interfaces:**
- Produces `script/DeploySealed.s.sol` reading `TOKEN, OWNER, VOTING_DEADLINE, FORWARDER, TALLIER_PK_X, TALLIER_PK_Y, KEY_SALT, N_SEALED_MAX, M_MAX, BATCH, MIN_DIRECT_VOTE, PROOF_GRACE, ABANDON_GRACE` and optionally `POSEIDON`, `INGEST_VERIFIER`, `TALLY_VERIFIER` (deployed fresh when unset: a `Poseidon2`, and `MockHonkVerifier`s that accept everything, logged loudly as mocks). Plan 3 supplies real verifier addresses.

- [ ] **Step 1: Gas benchmark**

```solidity
// test/sealed/SealedGas.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev Documents the sealed pool's costs on the default fixture (70 voters, 65 sealed,
///      16 projects). Numbers feed the README and spec B10.
contract SealedGasTest is FixtureLoader {
    function setUp() public {
        loadFixture("default_main");
        deployFromFixture();
        replayVoters();
    }

    function test_closeGasPerVoter() public {
        vm.warp(DEADLINE);
        uint256 before = gasleft();
        pool.close(1000);
        uint256 used = before - gasleft();
        emit log_named_uint("close() gas, 70 voters (65 sealed)", used);
        emit log_named_uint("close() gas per sealed voter (approx)", used / 65);
        assertLt(used, 12_000_000);
    }

    function test_reportGas() public {
        closeAll(1000);
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) flat[s * width + w] = step[w];
        }
        bytes memory report = abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat));
        vm.prank(forwarder);
        uint256 before = gasleft();
        pool.onReport("", report);
        uint256 used = before - gasleft();
        emit log_named_uint("onReport(kind 1) gas, 23 transcript steps", used);
        assertLt(used, 8_000_000);
    }

    function test_voteSealedGas() public {
        // A fresh seat holder: first sealed vote, then a replacement.
        address v = makeAddr("gasVoter");
        address[] memory members = new address[](1);
        members[0] = v;
        vm.prank(org);
        pool.sponsor(30_000_000, members);
        uint256[] memory ct = fxWords(".voters[3].ciphertext");
        vm.startPrank(v);
        uint256 before = gasleft();
        pool.voteSealed(ct[0], ct[1], ct[2]);
        emit log_named_uint("voteSealed gas, first", before - gasleft());
        before = gasleft();
        pool.voteSealed(ct[0], ct[1], ct[2] + 1);
        emit log_named_uint("voteSealed gas, replacement", before - gasleft());
        vm.stopPrank();
    }
}
```

`.voters[3]` is the first sealed voter of the default fixture (three public-only voters precede it); if the roster changes, pick any voter with `hasSealed`.

Run: `forge test --match-contract SealedGasTest -vv`
Expected: 3 tests pass and print the numbers. Add `"SealedRankedShares"` and `"Poseidon2"` to `gas_reports` in `foundry.toml` and run `forge snapshot` to refresh `.gas-snapshot`.

- [ ] **Step 2: Deploy script**

```solidity
// script/DeploySealed.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedRankedShares} from "../src/SealedRankedShares.sol";
import {IPoseidon2} from "../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../src/lib/Poseidon2.sol";
import {MockHonkVerifier} from "../test/mocks/MockHonkVerifier.sol";

/// @notice Deploys a SealedRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> FORWARDER=0x… \
///   TALLIER_PK_X=<uint> TALLIER_PK_Y=<uint> KEY_SALT=0x<32 bytes> \
///   N_SEALED_MAX=256 M_MAX=16 BATCH=32 MIN_DIRECT_VOTE=10000000 \
///   PROOF_GRACE=86400 ABANDON_GRACE=604800 \
///   [POSEIDON=0x…] [INGEST_VERIFIER=0x…] [TALLY_VERIFIER=0x…] \
///   forge script script/DeploySealed.s.sol --rpc-url $RPC_URL --broadcast
///
/// Unset POSEIDON deploys a fresh Poseidon2. Unset verifiers deploy MockHonkVerifiers
/// that accept every proof: fine for a demo of the DON path, never for a pool whose
/// `Proven` finality is meant to mean anything.
contract DeploySealed is Script {
    function run() external returns (SealedRankedShares pool) {
        SealedRankedShares.Config memory cfg;
        cfg.forwarder = vm.envAddress("FORWARDER");
        cfg.tallierPkX = vm.envUint("TALLIER_PK_X");
        cfg.tallierPkY = vm.envUint("TALLIER_PK_Y");
        cfg.keySalt = vm.envBytes32("KEY_SALT");
        cfg.nSealedMax = vm.envUint("N_SEALED_MAX");
        cfg.mMax = vm.envUint("M_MAX");
        cfg.batch = vm.envUint("BATCH");
        cfg.minDirectVote = vm.envUint("MIN_DIRECT_VOTE");
        cfg.proofGrace = uint64(vm.envUint("PROOF_GRACE"));
        cfg.abandonGrace = uint64(vm.envUint("ABANDON_GRACE"));

        vm.startBroadcast();
        address poseidon = vm.envOr("POSEIDON", address(0));
        if (poseidon == address(0)) {
            poseidon = address(new Poseidon2());
            console.log("Poseidon2 deployed at", poseidon);
        }
        cfg.poseidon = IPoseidon2(poseidon);
        address ingest = vm.envOr("INGEST_VERIFIER", address(0));
        address tally = vm.envOr("TALLY_VERIFIER", address(0));
        if (ingest == address(0) || tally == address(0)) {
            console.log("WARNING: deploying MockHonkVerifier; Proven finality is meaningless on this pool");
            if (ingest == address(0)) ingest = address(new MockHonkVerifier());
            if (tally == address(0)) tally = address(new MockHonkVerifier());
        }
        cfg.ingestVerifier = IHonkVerifier(ingest);
        cfg.tallyVerifier = IHonkVerifier(tally);
        pool = new SealedRankedShares(
            IERC20(vm.envAddress("TOKEN")), vm.envAddress("OWNER"), uint64(vm.envUint("VOTING_DEADLINE")), cfg
        );
        vm.stopBroadcast();

        console.log("SealedRankedShares deployed at", address(pool));
    }
}
```

Run: `forge build` (scripts compile with the project). Then a dry run against a local anvil to prove the script works end to end:

```bash
anvil --silent & sleep 2
TOKEN=0x0000000000000000000000000000000000000001 OWNER=0x0000000000000000000000000000000000000002 \
VOTING_DEADLINE=4102444800 FORWARDER=0x0000000000000000000000000000000000000003 \
TALLIER_PK_X=1 TALLIER_PK_Y=17631683881184975370165255887551781615748388533673675138860 \
KEY_SALT=0x0000000000000000000000000000000000000000000000000000000000000001 \
N_SEALED_MAX=256 M_MAX=16 BATCH=32 MIN_DIRECT_VOTE=10000000 PROOF_GRACE=86400 ABANDON_GRACE=604800 \
forge script script/DeploySealed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96a2f0e40e
kill %1
```

Expected: three deployments logged (Poseidon2, two mocks with the warning) and the pool address. `TALLIER_PK_Y` above is the decimal form of the Grumpkin generator's y; the constructor's on-curve check accepts it.

- [ ] **Step 3: README**

Add a "Sealed pools" section to `README.md` after the lifecycle table:

```markdown
## Sealed pools

`SealedRankedShares` is the pool of `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md`:
direct ballots are public and final, seat holders vote with sealed ballots, the tally runs
off-chain and is finalised by a chain of proofs.

| Phase | Who | Calls |
|---|---|---|
| Setup | owner | `addProject`, `openVoting` |
| Open | anyone | deposits as above, `vote(ranks)` (needs `minDirectVote` of own weight, one ballot, final), `voteSealed(rx, ry, c)` (seat holders, replaceable) |
| Closing (deadline passed) | anyone / DON | `close(maxVoters)` until `closed`; the CRE workflow may drive it with a kind-2 report |
| Tally | DON, coordinator, anyone | `onReport` (kind 1: result + transcript), `advance(proof, publicInputs)` for each ingest batch then each tally group, `restartTally`, `acceptProvisional` after `proofGrace`, `abandon` after `abandonGrace` |
| Done | anyone / owner | `claim`, `sweep`; `finality()` says which path ended the pool |

`Proven` means the sealed half was proven against the committed ciphertexts and the
public half was attested by the DON and can be replayed by anyone from chain data
(`python3 reference/pbear.py --transcript …` and, later, `prover/cli audit`).

Deploy with `script/DeploySealed.s.sol` (see its header for the environment). The
Poseidon2 hasher (`src/lib/Poseidon2.sol`) is generated from the reference constants by
`python3 reference/tools/gen_poseidon2_sol.py`; the Honk verifiers come from the Noir
circuits (plan 3) and are replaced by accept-all mocks until then.

Gas on the default fixture (70 voters, 65 sealed, 16 projects): see `forge test --match-contract SealedGasTest -vv`.
```

Replace the last line with the actual numbers printed in Step 1, as a three-row table (`close` total and per sealed voter, `onReport` kind 1, `voteSealed` first and replacement).

- [ ] **Step 4: Full suite and commit**

Run: `forge fmt && forge test -q && python3 -W error -m unittest discover reference`
Expected: everything green.

```bash
git add test/sealed/SealedGas.t.sol script/DeploySealed.s.sol README.md .gas-snapshot foundry.toml
git commit -m "Add sealed pool gas benchmark, deploy script and README"
```

---

### Verification (end to end)

```
forge build
forge test                                  # all suites, including the fixture replays
forge test --match-contract SealedGasTest -vv
python3 -W error -m unittest discover reference
forge script script/DeploySealed.s.sol ... # against anvil, as in Task 7
```

What the next plans need from this one: `src/interfaces/IHonkVerifier.sol` (plan 3 generates contracts with that `verify` signature and deploys them with `script/DeploySealed.s.sol`'s `INGEST_VERIFIER` / `TALLY_VERIFIER`), the public-input layouts enforced in `advance`, the report encoding of `onReport` (plan 4's workflow encodes kind 1 exactly as `SealedReportTest.resultReport`), the `sealedOf`, `directBallotOf`, `voters`, `checkpoint`, `stateCommit`, `ingestCursor` views (plan 4's prover reads them), and the Poseidon2 contract as a third implementation of the same sponge for the TypeScript port to cross-check.
