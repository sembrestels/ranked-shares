// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoolBase, WrongPhase} from "../PoolBase.sol";
import {IPoseidon2} from "./interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "./interfaces/IHonkVerifier.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";
import {Grumpkin} from "./lib/Grumpkin.sol";
import {checkWorkflow, deriveWorkflowName} from "../lib/CreMetadata.sol";

/// @title NoirRankedShares
/// @notice A RankedShares pool whose seat holders vote with sealed ballots. Direct
///         ballots are public and final; sealed ballots are encrypted to the tallier key
///         and replaceable. The tally runs off-chain: the CRE workflow reports a result
///         and a transcript, and a chain of Noir proofs over the sealed block makes it
///         final. See docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md.
/// @dev The KeystoneForwarder is a per-chain singleton shared by every workflow, so
///      `onReport`'s `msg.sender == forwarder` check alone would let any workflow owner
///      registered with it deliver a report to this pool — writing `_provisional` and
///      `transcriptHash`, starting the `proofGrace` clock and, once it elapses, letting
///      `acceptProvisional` finalise a forged result. `onReport` therefore also checks
///      the forwarder's `metadata` — `abi.encodePacked(bytes32 workflowId, bytes10
///      workflowName, address workflowOwner)`, optionally followed by a `bytes2
///      reportId` — against the immutables `workflowOwner` and `workflowName` set from
///      `Config`; see `checkWorkflow` in `lib/CreMetadata.sol` for the layout, the
///      `address(0)` opt-out and what the check does and does not bind.
contract NoirRankedShares is PoolBase, IReceiver {
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
    error SealedCountMismatch();
    error ResultMismatch();
    error ProofPending();
    error ResultPending();
    error EmptyBatch();

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
        /// @notice The workflow owner authorized to deliver reports, or `address(0)` to
        ///         disable the check (simulation only; see the contract-level dev note
        ///         above). Such a pool must never hold real funds.
        address workflowOwner;
        /// @notice The workflow name authorized to deliver reports, or `bytes10(0)` to
        ///         accept any name from `workflowOwner`. Derive it from a workflow's
        ///         name string with `workflowNameOf`.
        bytes10 workflowName;
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
    /// @dev Ceiling on both graces. They are `uint64` seconds, so a fat-fingered value is
    ///      not an overflow but a pool nobody can ever end.
    uint64 internal constant MAX_GRACE = 365 days;

    // ------------------------------------------------------------ immutables

    address public immutable forwarder;
    /// @notice The workflow owner authorized to deliver reports, or `address(0)` to
    ///         disable the check (simulation only; see the contract-level dev note
    ///         above). Such a pool must never hold real funds.
    address public immutable workflowOwner;
    /// @notice The workflow name authorized to deliver reports, or `bytes10(0)` to accept
    ///         any name from `workflowOwner`. Derive it from a workflow's name string
    ///         with `workflowNameOf`.
    bytes10 public immutable workflowName;
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
        // The three collaborators are checked for code, not merely for a non-zero address:
        // a call to an address with no code returns success with empty returndata, so an
        // EOA poseidon would silently hash everything to zero and an EOA verifier would
        // fail `_verify`'s decode rather than reading as a rejected proof.
        if (
            cfg.forwarder == address(0) || cfg.coordinator == address(0) || address(cfg.poseidon).code.length == 0
                || address(cfg.ingestVerifier).code.length == 0 || address(cfg.tallyVerifier).code.length == 0
                || cfg.nSealedMax == 0 || cfg.mMax == 0 || cfg.mMax > MAX_PROJECTS || cfg.batch == 0
                || cfg.abandonGrace <= cfg.proofGrace || cfg.proofGrace > MAX_GRACE || cfg.abandonGrace > MAX_GRACE
                || !Grumpkin.isOnCurve(cfg.tallierPkX, cfg.tallierPkY)
        ) revert InvalidConfig();
        forwarder = cfg.forwarder;
        workflowOwner = cfg.workflowOwner;
        workflowName = cfg.workflowName;
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

    /// @notice Derives the `bytes10 workflowName` CRE embeds in `onReport`'s `metadata`
    ///         from a workflow's name string; see `deriveWorkflowName`.
    function workflowNameOf(string memory name) public pure returns (bytes10) {
        return deriveWorkflowName(name);
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

    /// @notice The circuit profile this pool was built for. The verifiers are compiled for
    ///         one `(nSealedMax, mMax, batch)`, so a client that knows which profile its
    ///         proving keys belong to can refuse a pool whose profile is not that one
    ///         (spec B1).
    function profileId() public view returns (bytes32) {
        return keccak256(abi.encode(nSealedMax, mMax, batch));
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

    /// @notice One page of the tally roster in registration order: up to `count` entries
    ///         from `start`, fewer at the end and empty arrays past it. The workflow and
    ///         the prover rebuild the whole roster this way instead of one `eth_call` per
    ///         voter. `ballots[i]` is the packed direct ballot and is zero both for an
    ///         indifferent ballot and for no ballot at all, so `hasDirectFlags[i]` is what
    ///         tells the two apart; `cts[i]` is the ciphertext triple, zeros when none.
    function votersFrom(uint256 start, uint256 count)
        external
        view
        returns (
            address[] memory who,
            uint256[] memory direct,
            uint256[] memory ballots,
            uint256[] memory seats,
            uint256[3][] memory cts,
            bool[] memory hasDirectFlags
        )
    {
        uint256 n = voters.length;
        // `n - start > count` rather than `start + count > n`, which a huge `count` would
        // overflow.
        uint256 len = start >= n ? 0 : (n - start > count ? count : n - start);
        who = new address[](len);
        direct = new uint256[](len);
        ballots = new uint256[](len);
        seats = new uint256[](len);
        cts = new uint256[3][](len);
        hasDirectFlags = new bool[](len);
        for (uint256 i = 0; i < len; i++) {
            address a = voters[start + i];
            who[i] = a;
            direct[i] = directWeight[a];
            seats[i] = seatWeight[a];
            hasDirectFlags[i] = hasDirect[a];
            ballots[i] = hasDirectFlags[i] ? _directBallot[a] : 0;
            uint256[3] storage ct = _sealed[a];
            cts[i] = [ct[0], ct[1], ct[2]];
        }
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

    /// @dev Walks `voters` once, from `closeCursor`, keeping the keccak chain over the
    ///      public entries and the Poseidon2 chain over the sealed ones (spec B6.1). The
    ///      sealed chain is checkpointed every `batch` entries and at the last one, so
    ///      after `j` sealed entries the checkpoints written are `checkpoint[1 ..
    ///      ceil(j / batch)]`, which is what `_advanceIngest` reads as batch `k`'s `hIn`
    ///      and `hOut`. Chunking never moves a checkpoint: `j` counts sealed entries, not
    ///      calls.
    ///
    ///      Invariant asserted when the walk ends: the entries absorbed equal
    ///      `sealedCount` (`SealedCountMismatch`). It holds because `voteSealed` needs
    ///      seat weight and every seat grant registers the address in `voters`, but the
    ///      whole proof chain is anchored on those checkpoints, so `close` asserts it
    ///      rather than trusting three hops of reasoning.
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
            if (j != sc) revert SealedCountMismatch();
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
    /// @dev `metadata` is checked against `workflowOwner`/`workflowName` before the report
    ///      is decoded; see the contract-level dev note above for what that check is and
    ///      when it is disabled.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        checkWorkflow(metadata, workflowOwner, workflowName);
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
        _advanceOne(proof, publicInputs, restart);
    }

    /// @notice Verify several proofs of the chain in one transaction, in order. Each element
    ///         is subject to exactly the rules `advance` applies to it, so a batch is only a
    ///         cheaper way to send what would otherwise be one transaction each: the ingest
    ///         batches still land in order and the tally groups still chain through
    ///         `stateCommit`. `restart` is applied to the first *tally* proof of the batch and
    ///         never to an ingest proof — a batch that starts with pending ingest is a forward
    ///         run of the whole chain, where a rewind to `ingestedState` would be a no-op at
    ///         best — and, as in `advance`, only the `coordinator` may ask for it.
    ///
    ///         The batch is atomic: one rejected proof reverts the whole call, so a caller
    ///         either lands every proof it sent or none of them.
    function advanceMany(bytes[] calldata proofs, bytes32[][] calldata publicInputs, bool restart)
        external
        inPhase(Phase.Tally)
    {
        if (proofs.length != publicInputs.length) revert InputMismatch();
        if (proofs.length == 0) revert EmptyBatch();
        // `inPhase` only sees the phase this call started in. The finalising `done` proof
        // moves the pool to `Done` mid-loop, and everything after it would be an `advance`
        // on a finished pool: refuse the batch rather than silently ignoring its tail.
        bool restartUsed;
        for (uint256 i = 0; i < proofs.length; i++) {
            if (i > 0 && finality != Finality.None) revert WrongPhase();
            bool r = restart && !restartUsed && ingestCursor == numBatches;
            if (r) restartUsed = true;
            _advanceOne(proofs[i], publicInputs[i], r);
        }
    }

    /// @dev The routing `advance` and every element of `advanceMany` share: ingest batches
    ///      first, then tally groups.
    function _advanceOne(bytes calldata proof, bytes32[] calldata pi, bool restart) internal {
        if (ingestCursor < numBatches) {
            _advanceIngest(proof, pi);
        } else {
            _advanceTally(proof, pi, restart);
        }
    }

    /// @dev One ingest batch (spec B6.5). Every public input is pinned to storage before
    ///      the proof is even looked at: the batch index to `ingestCursor`, so batches
    ///      land in order; the roster size, project count, budget and key to the closed
    ///      pool; `hIn`/`hOut` to `checkpoint[k]` and `checkpoint[k + 1]`, so each batch
    ///      is checked against the sealed chain the moment it arrives; and `stateIn` to
    ///      the running `stateCommit`. `restart` has no meaning here: the ingest chain is
    ///      a deterministic function of committed inputs and a key tied to `pk`, so it
    ///      cannot go wrong in a way starting over would fix.
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

    /// @dev One group of transcript steps (spec B6.5). Needs the kind-1 report, because
    ///      `transcriptHash` is legitimately zero for a pool exhausted before its first
    ///      step; `resultReported` is what distinguishes that from no report at all.
    ///      `restart` rewinds `stateCommit` to the state the ingest chain ended at, and
    ///      only the coordinator may ask for it. The last proof of the chain (`done`)
    ///      must carry the reported transcript's hash and unpack to the reported result:
    ///      the transcript determines the result, so a difference is a bug on one side,
    ///      not a disagreement to resolve, and it reverts rather than finalising.
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

    /// @dev Unpacks `fundedOrderPacked`, one project id per byte, little-endian. It does
    ///      not validate the ids: a byte can be any project id or garbage. Its safety
    ///      rests entirely on the caller comparing the result with `_provisional`, which
    ///      `_validateResult` already checked for distinct in-range ids within budget —
    ///      so a byte that decodes to nonsense cannot match and the call reverts before
    ///      the ids reach `funded` or `_costs`. `count` is bounded here only to keep a
    ///      huge count from allocating; the equality does the real work.
    function _unpackFunded(uint256 count, uint256 packed) internal view returns (uint256[] memory order) {
        if (count > _costs.length) revert ResultMismatch();
        order = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            order[j] = (packed >> (8 * j)) & 0xff;
        }
    }

    /// @dev The one way the pool ends, from all three paths (proof, grace, abandon). It
    ///      is what moves the pool to `Done`, so it refuses to run twice; `order` must
    ///      already have been validated (`_validateResult`, or an equality with something
    ///      that was), since it is indexed straight into `_costs` and written to `funded`.
    ///      `spent` is the sum of the funded costs and is what `sweep` leaves behind for
    ///      the claims.
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
