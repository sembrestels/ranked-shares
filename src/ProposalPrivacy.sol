// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IProposalPool {
    function owner() external view returns (address);
    function votingOpen() external view returns (bool);
    function votingDeadline() external view returns (uint64);
    function openVoting() external;
}

/// @notice Per-round key commitments and publication. The pool alone records
/// revisions and acceptances; its owner registers the Swarm ACT sharing key.
/// See docs/decisions/2026-09-13-encrypt-proposals-through-private-review.md.
contract ProposalPrivacy {
    error Unauthorized();
    error InvalidOrganizerKey();
    error OrganizerKeyLocked();
    error PrivateProposalsRequired();
    error OrganizerKeyRequired();
    error InvalidPublication();

    event OrganizerKeyRegistered(bytes publicKey);
    event ProposalKeyCommitted(uint256 indexed proposalId, bytes32 keyHash);
    event ProposalKeyPublished(uint256 indexed proposalId, uint256 indexed projectId, bytes32 key);

    address public immutable pool;
    bytes public organizerPublicKey;
    bool public started;
    bool public published;
    mapping(uint256 => bytes32) public keyCommitment;
    mapping(uint256 => bytes32) public proposalKey;
    mapping(uint256 => bytes32) public projectKey;
    uint256[] private _accepted;
    mapping(uint256 => uint256) private _projectOf;

    constructor() {
        pool = msg.sender;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert Unauthorized();
        _;
    }

    function setOrganizerKey(bytes calldata publicKey) external {
        IProposalPool round = IProposalPool(pool);
        if (msg.sender != round.owner()) revert Unauthorized();
        if (started || round.votingOpen() || block.timestamp >= round.votingDeadline()) revert OrganizerKeyLocked();
        if (publicKey.length != 33 || (publicKey[0] != 0x02 && publicKey[0] != 0x03)) {
            revert InvalidOrganizerKey();
        }
        organizerPublicKey = publicKey;
        emit OrganizerKeyRegistered(publicKey);
    }

    function record(uint256 id, bytes32 commitment) external onlyPool {
        if (organizerPublicKey.length == 0) {
            if (commitment != bytes32(0)) revert OrganizerKeyRequired();
        } else if (commitment == bytes32(0)) {
            revert PrivateProposalsRequired();
        }
        started = true;
        keyCommitment[id] = commitment;
        emit ProposalKeyCommitted(id, commitment);
    }

    function accept(uint256 id, uint256 projectId) external onlyPool {
        if (keyCommitment[id] == bytes32(0)) return;
        _accepted.push(id);
        _projectOf[id] = projectId;
    }

    function acceptedProposals() external view returns (uint256[] memory) {
        return _accepted;
    }

    /// @notice The ordered acceptance list prevents opening with a stale or
    /// incomplete selection. Keys become public in transaction calldata, including
    /// pending/reverted transactions; callers must intend to publish before sending.
    function requirePublished() external view {
        if (_accepted.length != 0 && !published) revert InvalidPublication();
    }

    function openVoting(uint256[] calldata ids, bytes32[] calldata keys) external {
        if (msg.sender != IProposalPool(pool).owner()) revert Unauthorized();
        if (published || ids.length != _accepted.length || keys.length != ids.length) revert InvalidPublication();
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            bytes32 key = keys[i];
            if (id != _accepted[i] || key == bytes32(0) || keccak256(abi.encodePacked(key)) != keyCommitment[id]) {
                revert InvalidPublication();
            }
            proposalKey[id] = key;
            projectKey[_projectOf[id]] = key;
            emit ProposalKeyPublished(id, _projectOf[id], key);
        }
        published = true;
        IProposalPool(pool).openVoting();
    }
}
