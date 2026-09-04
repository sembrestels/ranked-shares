// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PBEAR} from "../src/PBEAR.sol";
import {PBEARHarness} from "./PBEARHarness.sol";

contract PBEARStateTest is Test {
    PBEARHarness engine;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        engine = new PBEARHarness();
    }

    function addProjects(uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            engine.addProject(10);
        }
    }

    // ---- projects ----

    function test_addProjectAssignsSequentialIds() public {
        assertEq(engine.addProject(50), 0);
        assertEq(engine.addProject(30), 1);
        assertEq(engine.projectCount(), 2);
        assertEq(engine.cost(0), 50);
        assertEq(engine.cost(1), 30);
    }

    function test_addProjectRejectsZeroCost() public {
        vm.expectRevert(PBEAR.ZeroCost.selector);
        engine.addProject(0);
    }

    function test_addProjectRejectsMoreThan255() public {
        addProjects(255);
        vm.expectRevert(PBEAR.TooManyProjects.selector);
        engine.addProject(10);
    }

    // ---- ballots ----

    function test_ballotAcceptsCompetitionRankings() public {
        addProjects(4);
        engine.setBallot(alice, hex"01020204");
        assertEq(engine.ballotOf(alice), hex"01020204");
        engine.setBallot(alice, hex"00000000");
        engine.setBallot(alice, hex"02020100");
        engine.setBallot(alice, hex"01000000");
        engine.setBallot(alice, hex"01020304");
    }

    function test_ballotRejectsWrongLength() public {
        addProjects(3);
        vm.expectRevert(PBEAR.InvalidBallot.selector);
        engine.setBallot(alice, hex"0102");
    }

    function test_ballotRejectsRankAboveProjectCount() public {
        addProjects(3);
        vm.expectRevert(PBEAR.InvalidBallot.selector);
        engine.setBallot(alice, hex"040102");
    }

    function test_ballotRejectsGapsInRanking() public {
        addProjects(3);
        vm.expectRevert(PBEAR.InvalidBallot.selector);
        engine.setBallot(alice, hex"010303");
        vm.expectRevert(PBEAR.InvalidBallot.selector);
        engine.setBallot(alice, hex"020202");
    }

    function test_effectiveRankFillsLastTier() public {
        addProjects(4);
        engine.setBallot(alice, hex"02000100");
        assertEq(engine.effectiveRank(alice, 0), 2);
        assertEq(engine.effectiveRank(alice, 1), 3);
        assertEq(engine.effectiveRank(alice, 2), 1);
        assertEq(engine.effectiveRank(alice, 3), 3);
    }

    function test_emptyBallotMeansIndifferent() public {
        addProjects(2);
        engine.setBallot(alice, hex"0000");
        assertEq(engine.effectiveRank(alice, 0), 1);
        assertEq(engine.effectiveRank(alice, 1), 1);
    }

    function test_ballotRegistersVoter() public {
        addProjects(1);
        assertEq(engine.voterCount(), 0);
        engine.setBallot(alice, hex"01");
        assertEq(engine.voterCount(), 1);
        engine.setBallot(alice, hex"00");
        assertEq(engine.voterCount(), 1);
    }

    // ---- weights ----

    function test_grantMovesWeightFromAbstaining() public {
        engine.increaseTotalWeight(100);
        assertEq(engine.totalWeight(), 100);
        assertEq(engine.abstainingWeight(), 100);
        engine.grantWeight(alice, 60);
        assertEq(engine.weightOf(alice), 60);
        assertEq(engine.totalWeight(), 100);
        assertEq(engine.abstainingWeight(), 40);
        assertEq(engine.voterCount(), 1);
    }

    function test_grantCannotExceedTotalWeight() public {
        engine.increaseTotalWeight(100);
        engine.grantWeight(alice, 60);
        vm.expectRevert(PBEAR.WeightExceedsTotal.selector);
        engine.grantWeight(bob, 50);
    }

    function test_revokeReturnsWeightToAbstaining() public {
        engine.increaseTotalWeight(100);
        engine.grantWeight(alice, 60);
        engine.revokeWeight(alice, 10);
        assertEq(engine.weightOf(alice), 50);
        assertEq(engine.abstainingWeight(), 50);
        vm.expectRevert(PBEAR.InsufficientWeight.selector);
        engine.revokeWeight(alice, 70);
    }

    // ---- start ----

    function test_startTallyFreezesBudgetAsTotalWeight() public {
        addProjects(1);
        engine.increaseTotalWeight(25);
        engine.startTally();
        assertTrue(engine.tallyStarted());
        assertEq(engine.budget(), 25);
        assertEq(engine.rankLevel(), 1);
        assertFalse(engine.tallyDone());
    }

    function test_startTallyRequiresProjects() public {
        vm.expectRevert(PBEAR.NoProjects.selector);
        engine.startTally();
    }

    function test_startTallyTwiceReverts() public {
        addProjects(1);
        engine.startTally();
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.startTally();
    }

    function test_startTallyWithNothingAffordableIsDoneImmediately() public {
        addProjects(1); // costs 10
        engine.increaseTotalWeight(5);
        engine.startTally();
        assertTrue(engine.tallyDone());
    }

    function test_mutatorsRevertAfterStart() public {
        addProjects(1);
        engine.increaseTotalWeight(10);
        engine.grantWeight(alice, 10);
        engine.startTally();
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.addProject(1);
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.increaseTotalWeight(1);
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.grantWeight(alice, 1);
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.revokeWeight(alice, 1);
        vm.expectRevert(PBEAR.TallyAlreadyStarted.selector);
        engine.setBallot(alice, hex"01");
    }
}
