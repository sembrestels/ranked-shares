// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, NotFunded} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {SealedPoolHarness} from "./SealedPoolHarness.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolEndTest is ZiskFixtureLoader {
    SealedPoolHarness h;

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
        replayVoters();
        h = SealedPoolHarness(address(pool));
    }

    function test_finalizeValidatesTheList() public {
        closeAll(1000);
        uint256[] memory bad = new uint256[](2);
        bad[0] = 1;
        bad[1] = 1;
        vm.expectRevert(SealedPool.InvalidResult.selector);
        h.finalizeFor(bad, SealedPool.Finality.Proven);
        bad[1] = 9;
        vm.expectRevert(SealedPool.InvalidResult.selector);
        h.finalizeFor(bad, SealedPool.Finality.Proven);
        // All four projects cost 500 USDC, within the fixture's budget: a list within
        // budget is accepted even when the tally would not have funded it. The proof,
        // not this check, ties the list to the ballots.
        uint256[] memory all = new uint256[](4);
        for (uint256 i = 0; i < 4; i++) {
            all[i] = i;
        }
        h.finalizeFor(all, SealedPool.Finality.Proven);
        assertEq(pool.spent(), 500_000_000);
    }

    function test_finalizeRecordsAndEndsThePool() public {
        closeAll(1000);
        uint256[] memory order = fxUintArray(".funded");
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Proven, order);
        h.finalizeFor(order, SealedPool.Finality.Proven);
        assertEq(uint256(pool.finality()), uint256(SealedPool.Finality.Proven));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Done));
        assertEq(pool.fundedProjects(), order);
        assertTrue(pool.funded(1));
        assertFalse(pool.funded(3));
        assertEq(pool.spent(), pool.cost(0) + pool.cost(1) + pool.cost(2));
        vm.expectRevert(WrongPhase.selector);
        h.finalizeFor(order, SealedPool.Finality.Proven);
    }

    function test_claimsAndSweepAfterProven() public {
        closeAll(1000);
        h.finalizeFor(fxUintArray(".funded"), SealedPool.Finality.Proven);
        pool.claim(1);
        assertEq(token.balanceOf(recipient), pool.cost(1));
        vm.expectRevert(NotFunded.selector);
        pool.claim(3);
        uint256 leftover = pool.totalWeight() - pool.spent();
        vm.prank(owner);
        pool.sweep(owner);
        assertEq(token.balanceOf(owner), leftover);
        pool.claim(0);
        pool.claim(2);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_abandonAfterGraceFromClosing() public {
        vm.warp(DEADLINE);
        vm.expectRevert(SealedPool.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + ABANDON_GRACE);
        pool.abandon(); // from Closing: close never ran
        assertEq(uint256(pool.finality()), uint256(SealedPool.Finality.Abandoned));
        assertEq(pool.fundedProjects().length, 0);
        vm.prank(owner);
        pool.sweep(owner);
        assertEq(token.balanceOf(owner), pool.totalWeight());
    }

    function test_abandonFromTally() public {
        closeAll(1000);
        vm.expectRevert(SealedPool.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + ABANDON_GRACE);
        pool.abandon();
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Done));
    }

    function test_abandonNotBeforeDeadline() public {
        vm.expectRevert(WrongPhase.selector);
        pool.abandon();
    }
}
