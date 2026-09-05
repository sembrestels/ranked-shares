// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SealedPool} from "../SealedPool.sol";
import {WrongPhase} from "../PoolBase.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";

/// @title CreRankedShares
/// @notice A sealed-ballot pool tallied inside a Chainlink CRE confidential workflow. The
///         DON's report is the result: `onReport` kind 1 finalises the pool as `Attested`
///         once `inputsHash` matches, kind 2 drives `close` from the workflow. Same
///         ballots, commitment and encryption as the zisk pool (spec Z5).
/// @dev DO NOT deploy a cre pool until the workflow owner/name in `onReport`'s `metadata`
///      is checked against an immutable: the KeystoneForwarder is a per-chain singleton
///      shared by every workflow, and `onReport` below currently ignores `metadata`, so
///      any workflow owner could deliver a kind-1 report to this contract.
contract CreRankedShares is SealedPool, IReceiver {
    error NotForwarder();
    error UnknownReport();
    error InputMismatch();

    uint8 internal constant KIND_RESULT = 1;
    uint8 internal constant KIND_CLOSE = 2;

    address public immutable forwarder;

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_,
        address forwarder_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {
        if (forwarder_ == address(0)) revert InvalidConfig();
        forwarder = forwarder_;
    }

    function kind() external pure override returns (string memory) {
        return "cre";
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Entry point for the CRE forwarder.
    /// @dev `metadata` (the first argument) is ignored. The KeystoneForwarder is a
    ///      per-chain singleton shared by every workflow, so until this checks
    ///      `metadata`'s workflow owner/name against an immutable, any workflow owner
    ///      registered with the forwarder can deliver a kind-1 report to this pool.
    ///      DO NOT deploy a cre pool before that check exists.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
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
