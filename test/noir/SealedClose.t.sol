// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, BalanceBelowTotalWeight} from "../../src/PoolBase.sol";
import {NoirRankedShares} from "../../src/noir/NoirRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedCloseTest is FixtureLoader {
    function assertCommitments() internal view {
        assertEq(pool.hPub(), fxBytes32(".hPub"), "hPub");
        assertEq(pool.hSealed(), fxWord(".hSealed"), "hSealed");
        assertEq(pool.sealedCount(), fxUint(".sealedCount"), "sealedCount");
        assertEq(pool.numBatches(), fxUint(".numBatches"), "numBatches");
        uint256[] memory checkpoints = fxWords(".checkpoints");
        for (uint256 k = 0; k < checkpoints.length; k++) {
            assertEq(pool.checkpoint(k), checkpoints[k], string.concat("checkpoint ", vm.toString(k)));
        }
        assertEq(pool.costsHash(), fxWord(".costsHash"), "costsHash");
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"), "inputsRoot");
        assertEq(uint256(pool.phase()), uint256(NoirRankedShares.Phase.Tally));
    }

    function test_mainFixtureInOneCall() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        vm.warp(DEADLINE);
        vm.expectEmit(false, false, false, true);
        emit NoirRankedShares.Closed(fxBytes32(".inputsRoot"), fxUint(".sealedCount"));
        pool.close(1000);
        assertCommitments();
    }

    function test_mainFixtureChunkedByOne() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(1);
        assertCommitments();
    }

    function test_smallmFixture() public {
        loadFixture("test_smallm");
        deployFromFixture();
        replayVoters();
        closeAll(3);
        assertCommitments();
    }

    function test_nosealedFixtureHasZeroCheckpointOne() public {
        loadFixture("test_nosealed");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        assertCommitments();
        assertEq(pool.numBatches(), 1);
        assertEq(pool.checkpoint(1), 0);
    }

    function test_defaultFixture() public {
        loadFixture("default_main");
        deployFromFixture();
        replayVoters();
        closeAll(25);
        assertCommitments();
    }

    function test_closeRequiresClosingPhaseAndBalance() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        vm.expectRevert(WrongPhase.selector);
        pool.close(10);
        vm.warp(DEADLINE);
        // Drain one wei so the balance no longer covers the budget.
        vm.prank(address(pool));
        token.transfer(org, 1);
        vm.expectRevert(BalanceBelowTotalWeight.selector);
        pool.close(10);
    }

    function test_closeIsIdempotentAfterCompletion() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(1000);
        vm.expectRevert(WrongPhase.selector);
        pool.close(1);
    }
}
