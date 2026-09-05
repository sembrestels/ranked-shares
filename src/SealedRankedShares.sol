// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoolBase, WrongPhase} from "./PoolBase.sol";
import {IPoseidon2} from "./interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "./interfaces/IHonkVerifier.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {Grumpkin} from "./lib/Grumpkin.sol";

/// @title SealedRankedShares
/// @notice A RankedShares pool whose seat holders vote with sealed ballots. Direct
///         ballots are public and final; sealed ballots are encrypted to the tallier key
///         and replaceable. The tally runs off-chain: the CRE workflow reports a result
///         and a transcript, and a chain of Noir proofs over the sealed block makes it
///         final. See docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md.
contract SealedRankedShares is PoolBase, IReceiver {
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
    error NotForwarder();
    error UnknownReport();
    error ResultAlreadyReported();
    error InputMismatch();
    error InvalidResult();
    error InvalidTranscript();
    error ProofOutOfOrder();
    error InvalidProof();
    error TranscriptPending();
    error TranscriptMismatch();
    error NotCoordinator();
    error ResultMismatch();
    error ProofPending();
    error ResultPending();

    // ---------------------------------------------------------------- events

    event Voted(address indexed voter);
    event SealedVote(address indexed voter);
    event Closed(bytes32 inputsRoot, uint256 sealedCount);
    event ProvisionalResult(uint256[] fundedOrder);
    event Transcript(uint256[] transcript);
    event Ingested(uint256 k);
    event Advanced();
    event TallyRestarted();
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

    struct Config {
        address forwarder;
        address coordinator;
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
        uint256 minSealedVote;
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
    /// @notice The only address allowed to restart the tally chain (spec B6.5).
    address public immutable coordinator;
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
    uint256 public immutable minSealedVote;
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

    // report (spec B6.2)
    bool public resultReported;
    uint256[] internal _provisional;
    uint256 public transcriptHash;
    uint64 public reportedAt;

    // proofs (spec B6.5)
    uint256 public ingestCursor;
    uint256 public stateCommit;
    uint256 public ingestedState;

    // result
    mapping(uint256 => bool) public funded;
    uint256[] internal _fundedOrder;
    uint256 public spent;

    // ----------------------------------------------------------- constructor

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_, Config memory cfg)
        PoolBase(token_, owner_, votingDeadline_)
    {
        if (
            cfg.forwarder == address(0) || cfg.coordinator == address(0) || address(cfg.poseidon) == address(0)
                || address(cfg.ingestVerifier) == address(0) || address(cfg.tallyVerifier) == address(0)
                || cfg.nSealedMax == 0 || cfg.mMax == 0 || cfg.mMax > MAX_PROJECTS || cfg.batch == 0
                || cfg.abandonGrace <= cfg.proofGrace || !Grumpkin.isOnCurve(cfg.tallierPkX, cfg.tallierPkY)
        ) revert InvalidConfig();
        forwarder = cfg.forwarder;
        coordinator = cfg.coordinator;
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
        minSealedVote = cfg.minSealedVote;
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

    /// @notice Cast the caller's public ballot. One per address, never replaced. A
    ///         zero-weight ballot is refused whatever `minDirectVote` is: it would only
    ///         enlarge `voters` and the work every close and tally pays for (spec B2).
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        if (hasDirect[msg.sender]) revert BallotAlreadyCast();
        uint256 w = directWeight[msg.sender];
        if (w == 0 || w < minDirectVote) revert BelowMinimumVote();
        _directBallot[msg.sender] = _validateAndPack(ranks);
        hasDirect[msg.sender] = true;
        _register(msg.sender);
        emit Voted(msg.sender);
    }

    /// @notice Cast or replace the caller's sealed ballot: a Grumpkin point R and a
    ///         masked field element c (spec B4). Filling one of the `nSealedMax` slots
    ///         costs `minSealedVote` of seat weight, as `minDirectVote` does on the public
    ///         side; a zero-weight sealed ballot is refused whatever the minimum is.
    function voteSealed(uint256 rx, uint256 ry, uint256 c) external inPhase(Phase.Open) beforeDeadline {
        uint256 w = seatWeight[msg.sender];
        if (w == 0 || w < minSealedVote) revert NoSeatWeight();
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

    // ---------------------------------------------------------------- reports

    function provisionalResult() external view returns (uint256[] memory) {
        return _provisional;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

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
        reportedAt = uint64(block.timestamp);
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

    function fundedProjects() external view returns (uint256[] memory) {
        return _fundedOrder;
    }

    // ---------------------------------------------------------------- proofs

    /// @notice Verify the next proof of the chain: ingest batches first, then tally groups.
    ///         `restart` is honoured in the tally branch only, and there only from
    ///         `coordinator`: proofs are public once submitted, so a permissionless restart
    ///         would let anyone replay the first tally group and rewind the chain at will.
    ///         Forward calls stay permissionless (spec B6.5).
    function advance(bytes calldata proof, bytes32[] calldata publicInputs, bool restart)
        external
        inPhase(Phase.Tally)
    {
        if (ingestCursor < numBatches) {
            _advanceIngest(proof, publicInputs);
        } else {
            _advanceTally(proof, publicInputs, restart);
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
        _verify(ingestVerifier, proof, pi);
        stateCommit = uint256(pi[9]);
        ingestCursor = k + 1;
        if (k + 1 == numBatches) ingestedState = stateCommit;
        emit Ingested(k);
    }

    function _advanceTally(bytes calldata proof, bytes32[] calldata pi, bool restart) internal {
        if (restart && msg.sender != coordinator) revert NotCoordinator();
        if (!resultReported) revert TranscriptPending();
        if (pi.length != 7) revert InputMismatch();
        if (restart) stateCommit = ingestedState;
        if (uint256(pi[0]) != costsHash || uint256(pi[1]) != stateCommit) revert InputMismatch();
        _verify(tallyVerifier, proof, pi);
        stateCommit = uint256(pi[2]);
        emit Advanced();
        if (restart) emit TallyRestarted();
        if (uint256(pi[3]) == 1) {
            if (uint256(pi[4]) != transcriptHash) revert TranscriptMismatch();
            uint256[] memory order = _unpackFunded(uint256(pi[5]), uint256(pi[6]));
            if (keccak256(abi.encode(order)) != keccak256(abi.encode(_provisional))) revert ResultMismatch();
            _finalize(order, Finality.Proven);
        }
    }

    /// @dev A verifier that reverts on a malformed proof rather than returning false must
    ///      still read as a rejected proof, never as a failed `advance` of unclear cause.
    function _verify(IHonkVerifier verifier, bytes calldata proof, bytes32[] calldata pi) internal view {
        try verifier.verify(proof, pi) returns (bool ok) {
            if (!ok) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
    }

    // ----------------------------------------------------------------- grace

    /// @notice Apply the DON's provisional result once `proofGrace` has elapsed since the
    ///         report, so the prover always gets the full window however late `close` or
    ///         the report were (spec B6.6).
    function acceptProvisional() external inPhase(Phase.Tally) {
        if (!resultReported) revert ResultPending();
        if (block.timestamp < uint256(reportedAt) + proofGrace) revert ProofPending();
        _finalize(_provisional, Finality.Attested);
    }

    /// @notice End the pool with nothing funded once `abandonGrace` has elapsed with no result.
    function abandon() external {
        Phase p = phase();
        if (p != Phase.Tally && p != Phase.Closing) revert WrongPhase();
        if (resultReported) revert ResultAlreadyReported();
        if (block.timestamp < uint256(votingDeadline) + abandonGrace) revert ResultPending();
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
        if (finality != Finality.None) revert WrongPhase();
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
