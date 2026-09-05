// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, BalanceBelowTotalWeight} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolCloseTest is ZiskFixtureLoader {
    function runFixture(string memory name, uint256 chunk) internal {
        loadFixture(name);
        deployHarnessFromFixture();
        replayVoters();
        closeAll(chunk);
        assertEq(pool.voterChain(), fxBytes32(".voterChain"), "voterChain");
        assertEq(pool.inputsHash(), fixtureInputsHash(), "inputsHash");
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Tally));
    }

    function test_mainInOneCall() public {
        runFixture("main", 1000);
    }

    function test_mainOneVoterPerCall() public {
        runFixture("main", 1);
    }

    function test_mainInChunksOfFive() public {
        runFixture("main", 5);
    }

    function test_nosealed() public {
        runFixture("nosealed", 3);
    }

    function test_nodirect() public {
        runFixture("nodirect", 2);
    }

    function test_closeOnlyInClosing() public {
        loadFixture("main");
        deployHarnessFromFixture();
        vm.expectRevert(WrongPhase.selector);
        pool.close(10);
        closeAll(1000);
        vm.expectRevert(WrongPhase.selector);
        pool.close(10);
    }

    function test_closeEmitsAndNeedsBalance() public {
        loadFixture("main");
        deployHarnessFromFixture();
        replayVoters();
        vm.warp(DEADLINE);
        // Drain one token: the first chunk must refuse.
        vm.prank(address(pool));
        token.transfer(org, 1);
        vm.expectRevert(BalanceBelowTotalWeight.selector);
        pool.close(1000);
        token.mint(address(pool), 1);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Closed(fixtureInputsHash(), pool.voterCount());
        pool.close(1000);
    }

    function test_zeroVotersCloses() public {
        loadFixture("main");
        deployHarnessFromFixture();
        vm.warp(DEADLINE);
        pool.close(0);
        assertTrue(pool.closed());
        assertEq(pool.voterChain(), bytes32(0));
    }
}
