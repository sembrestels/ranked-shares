// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @title SignedBallots
/// @notice DRAFT. Records signed public ballots for an off-chain PB-EAR tally. Nothing
///         about a ballot is kept in storage beyond the voter's nonce.
///
///         A voter signs `Vote(nonce, ballot)` once. That signature can be recorded in
///         two ways:
///
///         - `record`: the ballot bytes are in calldata. Anyone may call it. The contract
///           hashes the ballot itself and emits it, so the record is self-contained.
///         - `recordBlob`: only the ballot's hash is in calldata; the bytes are in an
///           EIP-4844 blob attached to the same transaction. The contract cannot read a
///           blob, so the record counts only if that blob really contains bytes hashing
///           to `ballotHash`; this is checked off-chain (or in a proof). Because a wrong
///           blob would burn the voter's nonce without casting their vote, only
///           `blobSubmitter` may use this path.
///
///         Contract accounts (a Safe, for example) have no key to recover, so they
///         vote in one of two other ways, both with the ballot in calldata: `vote`,
///         called by the account itself, or `recordFor`, where anyone submits a
///         signature the account approves through ERC-1271.
///
///         A voter may replace their ballot by signing a higher nonce. Each (voter,
///         nonce) is recorded at most once. The tally takes, for each voter, the record
///         with the highest nonce whose ballot bytes are available and form a valid
///         ranking in the `PBEAR` encoding (one rank byte per project).
contract SignedBallots is EIP712 {
    error VotingClosed();
    error NoVotes();
    error WrongLength();
    error NoBlob();
    error NotBlobSubmitter();
    error StaleNonce(address voter, uint64 nonce);
    error InvalidSignature();

    event BallotRecorded(address indexed voter, uint64 nonce, bytes ballot);
    event BlobBallotRecorded(address indexed voter, uint64 nonce, bytes32 ballotHash, bytes32 indexed blobHash);

    /// @dev `r` and `vs` are the EIP-2098 compact form of the voter's signature.
    struct Vote {
        uint64 nonce;
        bytes32 r;
        bytes32 vs;
        bytes ballot;
    }

    /// @dev The same signature as in `Vote`, with the ballot replaced by its hash.
    struct BlobVote {
        uint64 nonce;
        bytes32 r;
        bytes32 vs;
        bytes32 ballotHash;
    }

    bytes32 public constant VOTE_TYPEHASH = keccak256("Vote(uint64 nonce,bytes ballot)");

    uint64 public immutable votingDeadline;
    uint256 public immutable projectCount;
    /// @notice Commitment to what the round is about (projects, costs, voter weights).
    bytes32 public immutable roundConfig;
    address public immutable blobSubmitter;

    /// @notice Highest nonce recorded for a voter; 0 means no ballot yet.
    mapping(address => uint64) public nonceOf;
    /// @notice Hash chain over every record, in order: (previous, voter, nonce,
    ///         ballotHash, blobHash), with a zero blobHash for calldata records. A proof
    ///         of the tally can take this as its public input.
    bytes32 public transcript;
    uint256 public recordCount;

    constructor(uint64 votingDeadline_, uint256 projectCount_, bytes32 roundConfig_, address blobSubmitter_)
        EIP712("SignedBallots", "1")
    {
        votingDeadline = votingDeadline_;
        projectCount = projectCount_;
        roundConfig = roundConfig_;
        blobSubmitter = blobSubmitter_;
    }

    /// @notice Records `votes` with their ballots in calldata. Reverts if any vote's
    ///         nonce is not above the voter's last one.
    function record(Vote[] calldata votes) external {
        _open(votes.length);
        bytes32 acc = transcript;
        for (uint256 i; i < votes.length; i++) {
            Vote calldata v = votes[i];
            if (v.ballot.length != projectCount) revert WrongLength();
            bytes32 ballotHash = keccak256(v.ballot);
            address voter = _accept(v.nonce, ballotHash, v.r, v.vs);
            acc = keccak256(abi.encode(acc, voter, v.nonce, ballotHash, bytes32(0)));
            emit BallotRecorded(voter, v.nonce, v.ballot);
        }
        transcript = acc;
        recordCount += votes.length;
    }

    /// @notice Records the caller's own ballot. No signature: the call is the vote.
    function vote(uint64 nonce, bytes calldata ballot) external {
        _open(1);
        _recordOne(msg.sender, nonce, ballot);
    }

    /// @notice Records a ballot for a contract account that approves `signature` over
    ///         the same `Vote` digest through ERC-1271. Anyone may call it.
    function recordFor(address voter, uint64 nonce, bytes calldata ballot, bytes calldata signature) external {
        _open(1);
        bytes32 digest = digestOf(nonce, keccak256(ballot));
        (bool ok, bytes memory result) =
            voter.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        if (!ok || result.length != 32 || bytes4(result) != IERC1271.isValidSignature.selector) {
            revert InvalidSignature();
        }
        _recordOne(voter, nonce, ballot);
    }

    /// @notice Records `votes` whose ballots are in blob `blobIndex` of this transaction.
    function recordBlob(uint256 blobIndex, BlobVote[] calldata votes) external {
        if (msg.sender != blobSubmitter) revert NotBlobSubmitter();
        _open(votes.length);
        bytes32 blobHash = blobhash(blobIndex);
        if (blobHash == bytes32(0)) revert NoBlob();
        bytes32 acc = transcript;
        for (uint256 i; i < votes.length; i++) {
            BlobVote calldata v = votes[i];
            address voter = _accept(v.nonce, v.ballotHash, v.r, v.vs);
            acc = keccak256(abi.encode(acc, voter, v.nonce, v.ballotHash, blobHash));
            emit BlobBallotRecorded(voter, v.nonce, v.ballotHash, blobHash);
        }
        transcript = acc;
        recordCount += votes.length;
    }

    function digestOf(uint64 nonce, bytes32 ballotHash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOTE_TYPEHASH, nonce, ballotHash)));
    }

    function _open(uint256 count) private view {
        if (block.timestamp >= votingDeadline) revert VotingClosed();
        if (count == 0) revert NoVotes();
    }

    function _accept(uint64 nonce, bytes32 ballotHash, bytes32 r, bytes32 vs) private returns (address voter) {
        voter = ECDSA.recover(digestOf(nonce, ballotHash), r, vs);
        _bump(voter, nonce);
    }

    function _bump(address voter, uint64 nonce) private {
        if (nonce <= nonceOf[voter]) revert StaleNonce(voter, nonce);
        nonceOf[voter] = nonce;
    }

    function _recordOne(address voter, uint64 nonce, bytes calldata ballot) private {
        if (ballot.length != projectCount) revert WrongLength();
        _bump(voter, nonce);
        transcript = keccak256(abi.encode(transcript, voter, nonce, keccak256(ballot), bytes32(0)));
        recordCount++;
        emit BallotRecorded(voter, nonce, ballot);
    }
}
