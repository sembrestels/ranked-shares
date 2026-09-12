// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Arkiv holds payloads; pool storage binds the accepted revision to exact bytes.
/// @dev See docs/decisions/2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md.
abstract contract ArkivBallots {
    error ArkivBallotsRequired();
    error ArkivNotEnabled();
    error EmptyBallotReference();
    error StaleBallotRevision();
    error InvalidBallotWitness();
    error StaleCloseCursor();

    struct BallotRef {
        bytes32 entityKey;
        bytes32 payloadHash;
        uint256 revision;
        uint256 blockNumber;
    }

    struct BallotData {
        bytes publicBallot;
        bytes sealedBallot;
    }

    bool public arkivBallots;
    mapping(address => BallotRef) internal _publicRefs;
    mapping(address => BallotRef) internal _sealedRefs;

    event ArkivBallotsEnabled();
    event BallotStored(
        address indexed voter, bool indexed isSealed, bytes32 indexed entityKey, bytes32 payloadHash, uint256 revision
    );

    function ballotRefOf(address voter, bool isSealed) external view returns (BallotRef memory) {
        return isSealed ? _sealedRefs[voter] : _publicRefs[voter];
    }

    function _storeBallot(
        address voter,
        bool isSealed,
        bytes32 entityKey,
        bytes memory payload,
        uint256 expectedRevision
    ) internal {
        if (!arkivBallots) revert ArkivNotEnabled();
        if (entityKey == bytes32(0)) revert EmptyBallotReference();
        BallotRef storage ref = isSealed ? _sealedRefs[voter] : _publicRefs[voter];
        if (ref.revision != expectedRevision) revert StaleBallotRevision();
        ref.entityKey = entityKey;
        ref.payloadHash = keccak256(payload);
        ref.revision++;
        ref.blockNumber = block.number;
        emit BallotStored(voter, isSealed, entityKey, ref.payloadHash, ref.revision);
    }

    function _checkBallot(address voter, bool isSealed, bytes memory payload) internal view {
        BallotRef storage ref = isSealed ? _sealedRefs[voter] : _publicRefs[voter];
        if (ref.revision == 0) {
            if (payload.length != 0) revert InvalidBallotWitness();
        } else if (keccak256(payload) != ref.payloadHash) {
            revert InvalidBallotWitness();
        }
    }
}
