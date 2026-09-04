// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PBEAR} from "../src/PBEAR.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC721} from "./mocks/MockERC721.sol";

contract RankedSharesTallyTest is Test {
    MockERC20 token;
    RankedShares pool;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address org = makeAddr("org");
    address recipientA = makeAddr("recipientA");
    address recipientB = makeAddr("recipientB");
    address recipientC = makeAddr("recipientC");
    address treasury = makeAddr("treasury");

    uint64 constant DEADLINE = 1_000_000;

    function setUp() public {
        vm.warp(1);
        token = new MockERC20();
        pool = new RankedShares(token, owner, DEADLINE);
        address[4] memory holders = [alice, bob, carol, org];
        for (uint256 i = 0; i < holders.length; i++) {
            token.mint(holders[i], 1_000);
            vm.prank(holders[i]);
            token.approve(address(pool), type(uint256).max);
        }
        vm.startPrank(owner);
        pool.addProject(50, recipientA); // 0
        pool.addProject(30, recipientB); // 1
        pool.addProject(30, recipientC); // 2
        pool.openVoting();
        vm.stopPrank();
    }

    function contributeAndVote(address who, uint256 amount, bytes memory ranks) internal {
        vm.startPrank(who);
        pool.contribute(amount);
        pool.vote(ranks);
        vm.stopPrank();
    }

    function finishRound() internal {
        vm.warp(DEADLINE);
        pool.startTally();
        pool.run(100);
    }

    // ---- start ----

    function test_startTallyBeforeDeadlineReverts() public {
        contributeAndVote(alice, 50, hex"010203");
        vm.expectRevert(RankedShares.DeadlineNotReached.selector);
        pool.startTally();
    }

    function test_startTallyFreezesBudgetAsTotalWeight() public {
        contributeAndVote(alice, 50, hex"010203");
        token.mint(address(pool), 500); // stray transfer is not budget
        vm.warp(DEADLINE);
        pool.startTally();
        assertEq(uint256(pool.phase()), uint256(RankedShares.Phase.Tally));
        assertEq(pool.budget(), 50);
        assertEq(pool.totalWeight(), 50);
    }

    function test_startTallyRevertsIfBalanceBelowTotalWeight() public {
        contributeAndVote(alice, 50, hex"010203");
        // Simulate a fee-on-transfer token by removing balance from the pool.
        vm.prank(address(pool));
        token.transfer(bob, 1);
        vm.warp(DEADLINE);
        vm.expectRevert(RankedShares.BalanceBelowTotalWeight.selector);
        pool.startTally();
    }

    function test_openActionsRevertDuringTally() public {
        contributeAndVote(alice, 50, hex"010203");
        vm.warp(DEADLINE);
        pool.startTally();
        vm.prank(alice);
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.contribute(1);
        vm.prank(alice);
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.vote(hex"010203");
    }

    // ---- end to end ----

    function test_fullRoundPaysWinnersAndSweepsLeftover() public {
        // Budget 100: alice 30 (a > b > c), bob 30 via org seat (c > b > a),
        // carol 30 (b > c > a), org sponsors 40 split between bob and a member
        // who never votes (20 abstaining).
        contributeAndVote(alice, 30, hex"010203");
        contributeAndVote(carol, 30, hex"030102");
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = makeAddr("silent");
        vm.prank(org);
        pool.sponsor(40, members);
        vm.prank(bob);
        pool.vote(hex"030201");
        assertEq(pool.totalWeight(), 100);
        assertEq(pool.weightOf(bob), 20);

        finishRound();
        assertEq(uint256(pool.phase()), uint256(RankedShares.Phase.Done));
        // Level 1: b has 30 >= 30 -> funded (carol pays). a: 30 < 50, c: 20 < 30.
        // Level 2: a has alice 30, c has bob 20 -> advance.
        // Level 3: a and c both have alice 30 + bob 20 = 50; c is cheaper -> funded.
        //          Remaining budget 40 < 50 -> exhausted.
        uint256[] memory fundedIds = pool.fundedProjects();
        assertEq(fundedIds.length, 2);
        assertEq(fundedIds[0], 1);
        assertEq(fundedIds[1], 2);
        assertEq(pool.spent(), 60);

        pool.claim(1);
        pool.claim(2);
        assertEq(token.balanceOf(recipientB), 30);
        assertEq(token.balanceOf(recipientC), 30);

        vm.prank(owner);
        pool.sweep(treasury);
        assertEq(token.balanceOf(treasury), 40);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    // ---- claims ----

    function test_claimBeforeDoneReverts() public {
        contributeAndVote(alice, 50, hex"010203");
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.claim(0);
    }

    function test_claimUnfundedReverts() public {
        contributeAndVote(alice, 50, hex"010203");
        finishRound();
        assertTrue(pool.funded(0));
        vm.expectRevert(RankedShares.NotFunded.selector);
        pool.claim(1);
    }

    function test_claimTwiceReverts() public {
        contributeAndVote(alice, 50, hex"010203");
        finishRound();
        pool.claim(0);
        assertEq(token.balanceOf(recipientA), 50);
        vm.expectRevert(RankedShares.AlreadyClaimed.selector);
        pool.claim(0);
    }

    function test_anyoneCanTriggerClaimForRecipient() public {
        contributeAndVote(alice, 50, hex"010203");
        finishRound();
        vm.prank(bob);
        pool.claim(0);
        assertEq(token.balanceOf(recipientA), 50);
        assertEq(token.balanceOf(bob), 1_000);
    }

    // ---- sweep ----

    function test_sweepLeavesUnclaimedFundedCosts() public {
        contributeAndVote(alice, 50, hex"010203");
        contributeAndVote(bob, 30, hex"020103");
        token.mint(address(pool), 7); // stray transfer, sweepable
        finishRound();
        // a funded by alice (50), b funded by bob (30). Nothing claimed yet.
        assertEq(pool.spent(), 80);
        vm.prank(owner);
        pool.sweep(treasury);
        assertEq(token.balanceOf(treasury), 7);
        assertEq(token.balanceOf(address(pool)), 80);
        pool.claim(0);
        pool.claim(1);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_sweepOnlyOwnerAndOnlyWhenDone() public {
        contributeAndVote(alice, 50, hex"010203");
        vm.prank(owner);
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.sweep(treasury);
        finishRound();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.sweep(treasury);
        vm.prank(owner);
        vm.expectRevert(RankedShares.ZeroAddress.selector);
        pool.sweep(address(0));
    }
}
