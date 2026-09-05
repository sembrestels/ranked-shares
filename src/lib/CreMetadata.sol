// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The report's `metadata` names a workflow this pool does not authorize.
error WrongWorkflow();
/// @notice The report's `metadata` is too short to carry a workflow name and owner.
error BadMetadata();

/// @notice Derives the `bytes10 workflowName` CRE embeds in `onReport`'s `metadata`
///         from a workflow's name string: SHA-256 the name, hex-encode the digest, take
///         the first 10 hex characters, and return their ASCII bytes. A file-scope
///         function so `script/DeployCre.s.sol` can compute the same value without a
///         chicken-and-egg on the deployed pool.
function deriveWorkflowName(string memory name) pure returns (bytes10) {
    bytes32 digest = sha256(bytes(name));
    bytes memory hexAlphabet = "0123456789abcdef";
    bytes memory out = new bytes(10);
    for (uint256 i = 0; i < 5; i++) {
        uint8 b = uint8(digest[i]);
        out[2 * i] = hexAlphabet[b >> 4];
        out[2 * i + 1] = hexAlphabet[b & 0x0f];
    }
    return bytes10(out);
}

/// @notice Checks a KeystoneForwarder report's `metadata` — `abi.encodePacked(bytes32
///         workflowId, bytes10 workflowName, address workflowOwner)`, optionally
///         followed by a `bytes2 reportId` — against the workflow a pool authorizes.
/// @dev The forwarder is a per-chain singleton shared by every workflow, so a pool that
///      only checks `msg.sender == forwarder` accepts a report from any workflow owner
///      registered with it. `owner == address(0)` disables the check: such a pool
///      accepts a report from any workflow that reaches the forwarder and must never
///      hold real funds. It exists only so `cre workflow simulate`'s MockForwarder,
///      which calls `onReport` with no metadata at all, can exercise a pool. `name ==
///      bytes10(0)` accepts any workflow name from `owner`. The check binds a report to
///      a workflow owner (and optionally a name), not to a specific workflow build:
///      `workflowId` is not checked, so the owner can redeploy different workflow code
///      under the same name and still report; that is the trust boundary.
function checkWorkflow(bytes calldata metadata, address owner, bytes10 name) pure {
    if (owner == address(0)) return;
    if (metadata.length < 62) revert BadMetadata();
    if (address(bytes20(metadata[42:62])) != owner) revert WrongWorkflow();
    if (name != bytes10(0) && bytes10(metadata[32:42]) != name) {
        revert WrongWorkflow();
    }
}
