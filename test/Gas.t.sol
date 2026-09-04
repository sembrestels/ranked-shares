// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PBEARHarness} from "./PBEARHarness.sol";

/// @dev Documents how `step()` scales: 100 voters x 20 projects.
contract GasTest is Test {
    PBEARHarness engine;

    uint256 constant VOTERS = 100;
    uint256 constant PROJECTS = 20;

    function setUp() public {
        engine = new PBEARHarness();
        for (uint256 c = 0; c < PROJECTS; c++) {
            engine.addProject(50 + c);
        }
        for (uint256 i = 0; i < VOTERS; i++) {
            address voter = address(uint160(1000 + i));
            engine.increaseTotalWeight(10);
            engine.grantWeight(voter, 10);
            // Full strict ranking, rotated per voter so support is spread out.
            bytes memory ranks = new bytes(PROJECTS);
            for (uint256 c = 0; c < PROJECTS; c++) {
                ranks[c] = bytes1(uint8(1 + (c + i) % PROJECTS));
            }
            engine.setBallot(voter, ranks);
        }
        engine.startTally();
    }

    function test_stepGasAt100VotersAnd20Projects() public {
        uint256 before = gasleft();
        engine.step();
        uint256 used = before - gasleft();
        emit log_named_uint("step() gas (100 voters, 20 projects)", used);
        assertLt(used, 3_000_000);
    }

    function test_fullTallyGasAt100VotersAnd20Projects() public {
        uint256 before = gasleft();
        engine.run(100);
        uint256 used = before - gasleft();
        emit log_named_uint("full tally gas (100 voters, 20 projects)", used);
        assertTrue(engine.tallyDone());
    }
}
