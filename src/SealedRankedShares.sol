// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolBase, WrongPhase} from "./PoolBase.sol";
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
    event Closed(bytes32 inputsRoot, uint256 sealedCount);

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

    function _closed() internal view returns (bool) {
        return closed;
    }

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
