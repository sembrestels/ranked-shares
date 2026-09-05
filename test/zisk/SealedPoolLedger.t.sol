// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";
import {SealedPoolHarness} from "./SealedPoolHarness.sol";

contract SealedPoolLedgerTest is ZiskFixtureLoader {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        loadFixture("main");
        deployHarnessFromFixture();
    }

    function test_kindAndConfig() public view {
        assertEq(pool.kind(), "harness");
        assertEq(pool.tallierPk(), fxPk());
        assertEq(pool.keySalt(), fxBytes32(".keySalt"));
        assertEq(pool.minDirectVote(), fxWord(".minDirectVote"));
        assertEq(uint256(pool.phase()), uint256(SealedPool.Phase.Open));
    }

    function test_constructorRejectsBadConfig() public {
        bytes memory pk = fxPk();
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, new bytes(32), bytes32(0), 0, 1 days);
        bytes memory badPrefix = pk;
        badPrefix[0] = 0x04;
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, badPrefix, bytes32(0), 0, 1 days);
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, pk, bytes32(0), 0, 0);
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new SealedPoolHarness(token, owner, DEADLINE, pk, bytes32(0), 0, 366 days);
    }

    function test_contributionAndSeatsRegisterInOrder() public {
        token.mint(alice, 100);
        vm.startPrank(alice);
        token.approve(address(pool), 100);
        pool.contribute(100);
        vm.stopPrank();
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = alice;
        vm.prank(org);
        pool.sponsor(50, members);
        assertEq(pool.voterCount(), 2);
        assertEq(pool.voters(0), alice);
        assertEq(pool.voters(1), bob);
        assertEq(pool.directWeight(alice), 100);
        assertEq(pool.seatWeight(alice), 25);
        assertEq(pool.seatWeight(bob), 25);
        assertEq(pool.totalSeatWeight(), 50);
        assertEq(pool.totalWeight(), 150);
    }

    function test_nftTakeoverMovesSeatWeight() public {
        vm.prank(org);
        uint256 id = pool.sponsorNFT(30, IERC721(address(nft)), 1);
        nft.mint(alice, 7);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 30);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 7);
        vm.prank(bob);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 0);
        assertEq(pool.seatWeight(bob), 30);
        assertEq(pool.totalSeatWeight(), 30);
        assertEq(pool.voterCount(), 2);
    }

    function test_weightCapAndProjectLimits() public {
        // Push totalWeight to 1 first: contributing exactly MAX_WEIGHT from a totalWeight
        // of 0 would land exactly on the cap, not over it.
        token.mint(org, 1);
        vm.startPrank(org);
        pool.contribute(1);
        vm.expectRevert(SealedPool.WeightOverflow.selector);
        pool.contribute(type(uint64).max);
        vm.stopPrank();
        // A fresh pool for the project limits: this one is already open.
        SealedPoolHarness p = new SealedPoolHarness(token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days);
        vm.startPrank(owner);
        vm.expectRevert(SealedPool.ZeroCost.selector);
        p.addProject(0, recipient);
        vm.expectRevert(SealedPool.CostTooLarge.selector);
        p.addProject(uint256(type(uint64).max) + 1, recipient);
        for (uint256 i = 0; i < 31; i++) {
            p.addProject(1, recipient);
        }
        vm.expectRevert(SealedPool.TooManyProjects.selector);
        p.addProject(1, recipient);
        vm.stopPrank();
    }

    function test_openVotingNeedsAProject() public {
        SealedPoolHarness p = new SealedPoolHarness(token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days);
        vm.prank(owner);
        vm.expectRevert(SealedPool.NoProjects.selector);
        p.openVoting();
    }

    function test_votersFromPages() public {
        replayVoters();
        uint256 n = pool.voterCount();
        (address[] memory who,,,, bytes[] memory cts) = pool.votersFrom(0, 5);
        assertEq(who.length, 5);
        assertEq(who[0], pool.voters(0));
        assertEq(cts[0].length, pool.sealedOf(who[0]).length);
        (address[] memory tail, uint256[] memory direct, uint256[] memory seats, bytes[] memory ballots,) =
            pool.votersFrom(n - 2, 100);
        assertEq(tail.length, 2);
        assertEq(tail[1], pool.voters(n - 1));
        assertEq(direct[1], pool.directWeight(tail[1]));
        assertEq(seats[1], pool.seatWeight(tail[1]));
        assertEq(ballots[1], pool.directBallotOf(tail[1]));
        (address[] memory none,,,,) = pool.votersFrom(n, 10);
        assertEq(none.length, 0);
    }
}
