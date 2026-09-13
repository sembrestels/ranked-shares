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
        if (arkivBallots) revert ArkivBallotsRequired();
        return _directBallot[voter];
    }

    function sealedOf(address voter) external view returns (bytes memory) {
        if (arkivBallots) revert ArkivBallotsRequired();
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
        if (arkivBallots) revert ArkivBallotsRequired();
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
        if (arkivBallots) revert ArkivBallotsRequired();
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
        if (arkivBallots) revert ArkivBallotsRequired();
        if (!_canVoteSealed(msg.sender)) revert NoSeatWeight();
        if (ciphertext.length != PK_LENGTH + _costs.length) revert InvalidCiphertext();
        _sealed[msg.sender] = ciphertext;
        _register(msg.sender);
        emit SealedVote(msg.sender);
    }

    function voteArkiv(bytes32 entityKey, bytes calldata payload, uint256 expectedRevision)
        public
        inPhase(Phase.Open)
        beforeDeadline
    {
        if (_publicRefs[msg.sender].revision != 0) revert BallotAlreadyCast();
        uint256 w = directWeight[msg.sender];
        if (w == 0 || w < minDirectVote) revert BelowMinimumVote();
        _validate(payload);
        _storeBallot(msg.sender, false, entityKey, payload, expectedRevision);
        _register(msg.sender);
        emit Voted(msg.sender);
    }

    function voteSealedArkiv(bytes32 entityKey, bytes calldata payload, uint256 expectedRevision)
        public
        inPhase(Phase.Open)
        beforeDeadline
    {
        if (!_canVoteSealed(msg.sender)) revert NoSeatWeight();
        if (payload.length != PK_LENGTH + _costs.length) revert InvalidCiphertext();
        _storeBallot(msg.sender, true, entityKey, payload, expectedRevision);
        _register(msg.sender);
        emit SealedVote(msg.sender);
    }

    function _castBallot(bytes32 id, bytes calldata payload, bool isSealed, uint256 expectedRevision) internal override {
        if (isSealed) voteSealedArkiv(id, payload, expectedRevision);
        else voteArkiv(id, payload, expectedRevision);
    }

    function voterRefsFrom(uint256 start, uint256 count)
        external
        view
        returns (
            address[] memory who,
            uint256[] memory direct,
            uint256[] memory seats,
            BallotRef[] memory publicRefs,
            BallotRef[] memory sealedRefs
        )
    {
        uint256 len = start >= voters.length ? 0 : voters.length - start;
        if (count < len) len = count;
        who = new address[](len);
        direct = new uint256[](len);
        seats = new uint256[](len);
        publicRefs = new BallotRef[](len);
        sealedRefs = new BallotRef[](len);
        for (uint256 i; i < len; i++) {
            address a = voters[start + i];
            who[i] = a;
            direct[i] = directWeight[a];
            seats[i] = seatWeight[a];
            publicRefs[i] = _publicRefs[a];
            sealedRefs[i] = _sealedRefs[a];
        }
    }

    function closeArkiv(uint256 expectedCursor, BallotData[] calldata ballots) external inPhase(Phase.Closing) {
        _closeArkiv(expectedCursor, ballots);
    }

    function _closeArkiv(uint256 expectedCursor, BallotData[] memory ballots) internal {
        if (!arkivBallots) revert ArkivNotEnabled();
        if (expectedCursor != closeCursor) revert StaleCloseCursor();
        if (ballots.length > voters.length - closeCursor) revert InvalidBallotWitness();
        _closeResolved(ballots.length, ballots);
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
        if (arkivBallots) revert ArkivBallotsRequired();
        _closeResolved(maxVoters, new BallotData[](0));
    }

    function _closeResolved(uint256 maxVoters, BallotData[] memory ballots) internal {
        _beforeClose();
        if (closeCursor == 0) _requireBalanceCoversBudget();
        uint256 n = voters.length;
        uint256 end = closeCursor + maxVoters;
        if (end > n) end = n;
        bytes32 h = voterChain;
        for (uint256 i = closeCursor; i < end; i++) {
            address a = voters[i];
            bytes memory pub = _directBallot[a];
            bytes memory sealedData = _sealed[a];
            if (arkivBallots) {
                pub = ballots[i - closeCursor].publicBallot;
                sealedData = ballots[i - closeCursor].sealedBallot;
                _checkBallot(a, false, pub);
                _checkBallot(a, true, sealedData);
            }
            h = keccak256(abi.encodePacked(h, a, directWeight[a], seatWeight[a], keccak256(pub), keccak256(sealedData)));
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

    function _canVoteSealed(address who) internal view virtual returns (bool) {
        return seatWeight[who] > 0;
    }

    function _beforeClose() internal view virtual {}

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
