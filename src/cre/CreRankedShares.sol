// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SealedPool} from "../SealedPool.sol";
import {WrongPhase} from "../PoolBase.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";
import {checkWorkflow, deriveWorkflowName} from "../lib/CreMetadata.sol";

/// @title CreRankedShares
/// @notice A sealed-ballot pool tallied inside a Chainlink CRE confidential workflow. The
///         DON's report is the result: `onReport` kind 1 finalises the pool as `Attested`
///         once `inputsHash` matches, kind 2 drives `close` from the workflow. Same
///         ballots, commitment and encryption as the zisk pool (spec Z5).
/// @dev The KeystoneForwarder is a per-chain singleton shared by every workflow, so
///      `onReport`'s `msg.sender == forwarder` check alone would let any workflow owner
///      registered with it deliver a report to this pool. `onReport` additionally checks
///      the forwarder's `metadata` — `abi.encodePacked(bytes32 workflowId, bytes10
///      workflowName, address workflowOwner)`, optionally followed by a `bytes2
///      reportId` — against the immutables `workflowOwner` and `workflowName` set at
///      construction. If `workflowOwner_` is `address(0)` this check is disabled: such a
///      pool accepts a report from any workflow that reaches the forwarder and must never
///      hold real funds. It exists only so `cre workflow simulate`'s MockForwarder, which
///      calls `onReport` with no metadata at all, can exercise a pool. This check binds
///      the report to a workflow owner (and optionally a name), not to a specific
///      workflow build: `workflowId` is not checked, so the owner can redeploy different
///      workflow code under the same name and still report; that is the trust boundary.
contract CreRankedShares is SealedPool, IReceiver {
    error NotForwarder();
    error UnknownReport();
    error InputMismatch();

    uint8 internal constant KIND_RESULT = 1;
    uint8 internal constant KIND_CLOSE = 2;

    address public immutable forwarder;
    /// @notice The workflow owner authorized to deliver reports, or `address(0)` to
    ///         disable the check (simulation only; see the contract-level dev note above).
    address public immutable workflowOwner;
    /// @notice The workflow name authorized to deliver reports, or `bytes10(0)` to accept
    ///         any name from `workflowOwner`. Derive it from a workflow's name string
    ///         with `workflowNameOf`.
    bytes10 public immutable workflowName;

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_,
        address forwarder_,
        address workflowOwner_,
        bytes10 workflowName_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {
        if (forwarder_ == address(0)) revert InvalidConfig();
        forwarder = forwarder_;
        workflowOwner = workflowOwner_;
        workflowName = workflowName_;
    }

    /// @notice Derives the `bytes10 workflowName` CRE embeds in `onReport`'s `metadata`
    ///         from a workflow's name string; see `deriveWorkflowName`.
    function workflowNameOf(string memory name) public pure returns (bytes10) {
        return deriveWorkflowName(name);
    }

    function kind() external pure override returns (string memory) {
        return "cre";
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Entry point for the CRE forwarder.
    /// @dev `metadata` is checked against `workflowOwner`/`workflowName` before the
    ///      report is decoded; see the contract-level dev note above for what that check
    ///      is and when it is disabled.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        checkWorkflow(metadata, workflowOwner, workflowName);
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
