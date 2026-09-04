// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PBEAR} from "../src/PBEAR.sol";
import {PBEARHarness} from "./PBEARHarness.sol";

contract PBEARStepTest is Test {
    PBEARHarness engine;
    uint256 nextVoter = 1;

    uint256 constant A = 0;
    uint256 constant B = 1;
    uint256 constant C = 2;
    uint256 constant D = 3;

    function setUp() public {
        engine = new PBEARHarness();
    }

    // ---- helpers ----

    function addCosts(uint256[] memory costs) internal {
        for (uint256 i = 0; i < costs.length; i++) {
            engine.addProject(costs[i]);
        }
    }

    function costs4(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory out) {
        out = new uint256[](4);
        out[0] = a;
        out[1] = b;
        out[2] = c;
        out[3] = d;
    }

    /// @dev Adds `count` voters, each with weight 1 and the given ballot.
    function addVoters(uint256 count, bytes memory ballot) internal {
        engine.increaseTotalWeight(count);
        for (uint256 i = 0; i < count; i++) {
            address voter = address(uint160(nextVoter++));
            engine.grantWeight(voter, 1);
            engine.setBallot(voter, ballot);
        }
    }

    function addVoter(uint256 weight, bytes memory ballot) internal returns (address voter) {
        voter = address(uint160(nextVoter++));
        engine.increaseTotalWeight(weight);
        engine.grantWeight(voter, weight);
        if (ballot.length != 0) engine.setBallot(voter, ballot);
    }

    function runAll() internal returns (uint256[] memory) {
        engine.startTally();
        engine.run(type(uint256).max);
        assertTrue(engine.tallyDone());
        return engine.fundedProjects();
    }

    function assertFunded(uint256[] memory actual, uint256[] memory expected) internal pure {
        assertEq(actual.length, expected.length, "funded count");
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(actual[i], expected[i], "funded order");
        }
    }

    function ids1(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function ids3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory out) {
        out = new uint256[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    function sumVoterWeights() internal view returns (uint256 total) {
        uint256 n = engine.voterCount();
        for (uint256 i = 0; i < n; i++) {
            total += engine.weightOf(engine.voterAt(i));
        }
    }

    // ---- paper examples (expected outputs cross-checked with reference/pbear.py) ----

    function test_example1_selectsAB() public {
        addCosts(costs4(3, 3, 3, 3));
        addVoters(6, hex"01020304"); // a b c d
        addVoters(2, hex"04030201"); // d c b a
        addVoters(1, hex"02030104"); // c a b d
        assertFunded(runAll(), ids3(A, B, C));
    }

    function test_example2() public {
        addCosts(costs4(50, 30, 30, 40));
        addVoters(30, hex"01020304");
        addVoters(70, hex"04030201");
        assertFunded(runAll(), ids3(D, B, C));
    }

    function test_example3_tiesInFirstGroup() public {
        addCosts(costs4(50, 30, 30, 40));
        addVoters(30, hex"01020204"); // a > b ~ c > d
        addVoters(70, hex"04030201");
        assertFunded(runAll(), ids3(D, C, B));
    }

    function test_example4_splitFirstGroup() public {
        addCosts(costs4(50, 30, 30, 40));
        addVoters(15, hex"01020304");
        addVoters(15, hex"02010304");
        addVoters(70, hex"04030201");
        assertFunded(runAll(), ids3(D, B, C));
    }

    function test_example5_combinedGroups() public {
        addCosts(costs4(90, 30, 80, 40));
        addVoters(14, hex"01020304"); // a b c d
        addVoters(16, hex"01030204"); // a c b d
        addVoters(70, hex"02030104"); // c a b d
        assertFunded(runAll(), ids1(A));
    }

    // ---- tie-breaks ----

    function test_tieBreakPrefersLowerCost() public {
        engine.addProject(6); // id 0, pricier
        engine.addProject(4); // id 1, cheaper
        addVoter(10, hex"0101"); // indifferent, supports both with 10
        engine.startTally();
        engine.step();
        assertEq(engine.fundedProjects()[0], 1);
    }

    function test_tieBreakPrefersLowerIdOnFullTie() public {
        engine.addProject(4);
        engine.addProject(4);
        addVoter(10, hex"0101");
        engine.startTally();
        engine.step();
        assertEq(engine.fundedProjects()[0], 0);
    }

    function test_higherSupportBeatsLowerCost() public {
        engine.addProject(5); // supported by both voters -> 10
        engine.addProject(3); // supported by one voter -> 4
        addVoter(6, hex"0102");
        addVoter(4, hex"0201");
        // Level 1: p0 has 6 >= 5, p1 has 4 >= 3; both eligible, p0 has more support.
        engine.startTally();
        engine.step();
        assertEq(engine.fundedProjects()[0], 0);
    }

    // ---- reweighting ----

    function test_fundingDeductsExactlyTheCost() public {
        addCosts(costs4(7, 30, 30, 40));
        addVoter(3, hex"01020304");
        addVoter(5, hex"01020304");
        addVoter(2, hex"01020304");
        engine.startTally();
        uint256 before = sumVoterWeights();
        engine.step();
        assertTrue(engine.funded(A));
        assertEq(before - sumVoterWeights(), 7);
        assertEq(engine.spent(), 7);
    }

    function test_deductionIsProportional() public {
        engine.addProject(50);
        engine.addProject(1000);
        address big = addVoter(80, hex"0102");
        address small = addVoter(20, hex"0102");
        engine.startTally();
        engine.step();
        assertEq(engine.weightOf(big), 40);
        assertEq(engine.weightOf(small), 10);
    }

    // ---- rank advancing and termination ----

    function test_advancesRankWhenNothingEligible() public {
        engine.addProject(10);
        engine.addProject(10);
        addVoter(6, hex"0102");
        addVoter(6, hex"0201");
        engine.startTally();
        vm.expectEmit();
        emit PBEAR.RankAdvanced(2);
        engine.step();
        assertEq(engine.rankLevel(), 2);
        assertEq(engine.fundedProjects().length, 0);
        engine.step();
        assertEq(engine.fundedProjects().length, 1);
    }

    function test_runStopsAtMaxStepsAndResumes() public {
        addCosts(costs4(50, 30, 30, 40));
        addVoters(30, hex"01020304");
        addVoters(70, hex"04030201");
        engine.startTally();
        engine.run(1);
        assertEq(engine.fundedProjects().length, 1);
        assertFalse(engine.tallyDone());
        engine.run(100);
        assertTrue(engine.tallyDone());
        assertEq(engine.fundedProjects().length, 3);
    }

    function test_stepRevertsBeforeStartAndAfterDone() public {
        engine.addProject(5);
        addVoter(5, hex"01");
        vm.expectRevert(PBEAR.TallyNotStarted.selector);
        engine.step();
        engine.startTally();
        engine.step();
        assertTrue(engine.tallyDone());
        vm.expectRevert(PBEAR.TallyAlreadyDone.selector);
        engine.step();
    }

    function test_endsExhaustedWithTallyDoneEvent() public {
        engine.addProject(5);
        addVoter(5, hex"01");
        engine.startTally();
        vm.expectEmit();
        emit PBEAR.TallyDone(5);
        engine.step();
        assertTrue(engine.isExhausted());
    }

    function test_abstainingWeightNeverFundsAnything() public {
        engine.addProject(5);
        engine.addProject(5);
        addVoter(5, hex"0102"); // funds project 0
        addVoter(5, ""); // weight but no ballot
        engine.increaseTotalWeight(3); // ungranted weight
        uint256[] memory result = runAll();
        assertFunded(result, ids1(0));
        assertFalse(engine.isExhausted()); // project 1 is affordable but unsupported
        assertEq(engine.rankLevel(), 2);
    }

    function test_remainingWeightInvariantHoldsAfterEachStep() public {
        addCosts(costs4(50, 30, 30, 40));
        addVoters(30, hex"01020204");
        addVoters(70, hex"04030201");
        addVoter(13, ""); // abstaining voter
        engine.increaseTotalWeight(4); // ungranted
        engine.startTally();
        while (!engine.tallyDone()) {
            engine.step();
            assertEq(sumVoterWeights() + engine.abstainingWeight(), engine.budget() - engine.spent());
        }
    }
}
