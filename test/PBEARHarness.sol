// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PBEAR} from "../src/PBEAR.sol";

/// @dev Exposes the engine's internal API for tests.
contract PBEARHarness is PBEAR {
    function addProject(uint256 cost_) external returns (uint256) {
        return _addProject(cost_);
    }

    function increaseTotalWeight(uint256 amount) external {
        _increaseTotalWeight(amount);
    }

    function grantWeight(address voter, uint256 amount) external {
        _grantWeight(voter, amount);
    }

    function revokeWeight(address voter, uint256 amount) external {
        _revokeWeight(voter, amount);
    }

    function setBallot(address voter, bytes calldata ranks) external {
        _setBallot(voter, ranks);
    }

    function startTally() external {
        _startTally();
    }
}
