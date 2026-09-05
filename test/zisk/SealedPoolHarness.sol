// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedPool} from "../../src/SealedPool.sol";

/// @dev A concrete SealedPool with `_finalize` exposed, for testing the shared base.
contract SealedPoolHarness is SealedPool {
    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {}

    function kind() external pure override returns (string memory) {
        return "harness";
    }

    function finalizeFor(uint256[] memory order, Finality how) external {
        _finalize(order, how);
    }
}
