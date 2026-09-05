// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract SealedPoolBallotsTest is ZiskFixtureLoader {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 minVote;

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
        minVote = pool.minDirectVote();
        token.mint(alice, minVote);
        vm.startPrank(alice);
        token.approve(address(pool), minVote);
        pool.contribute(minVote);
        vm.stopPrank();
        address[] memory members = new address[](1);
        members[0] = bob;
        vm.prank(org);
        pool.sponsor(30, members);
    }

    function test_directBallotOnceAndValidated() public {
        vm.startPrank(alice);
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"010203"); // length
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"01030000"); // gap
        vm.expectRevert(SealedPool.InvalidBallot.selector);
        pool.vote(hex"01020305"); // > m
        vm.expectEmit(true, false, false, true);
        emit SealedPool.Voted(alice);
        pool.vote(hex"01020200");
        assertEq(pool.directBallotOf(alice), hex"01020200");
        vm.expectRevert(SealedPool.BallotAlreadyCast.selector);
        pool.vote(hex"01020304");
        vm.stopPrank();
    }

    function test_directBallotNeedsMinimumWeight() public {
        address carol = makeAddr("carol");
        vm.prank(carol);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
        token.mint(carol, minVote - 1);
        vm.startPrank(carol);
        token.approve(address(pool), minVote - 1);
        pool.contribute(minVote - 1);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
        vm.stopPrank();
        // Seat weight alone does not open the public ballot.
        vm.prank(bob);
        vm.expectRevert(SealedPool.BelowMinimumVote.selector);
        pool.vote(hex"01020304");
    }

    function test_sealedBallotNeedsSeatWeightAndLength() public {
        bytes memory ct = new bytes(33 + 4);
        vm.prank(alice);
        vm.expectRevert(SealedPool.NoSeatWeight.selector);
        pool.voteSealed(ct);
        vm.startPrank(bob);
        vm.expectRevert(SealedPool.InvalidCiphertext.selector);
        pool.voteSealed(new bytes(36));
        vm.expectEmit(true, false, false, true);
        emit SealedPool.SealedVote(bob);
        pool.voteSealed(ct);
        bytes memory ct2 = new bytes(37);
        ct2[0] = 0x03;
        pool.voteSealed(ct2);
        assertEq(pool.sealedOf(bob), ct2);
        vm.stopPrank();
        assertEq(pool.voterCount(), 2);
    }

    function test_ballotsBlockedAfterDeadline() public {
        vm.warp(DEADLINE);
        vm.prank(alice);
        vm.expectRevert(WrongPhase.selector);
        pool.vote(hex"01020304");
        vm.prank(bob);
        vm.expectRevert(WrongPhase.selector);
        pool.voteSealed(new bytes(37));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Closing));
    }
}
