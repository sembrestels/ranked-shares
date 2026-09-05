// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {PoolBase, WrongPhase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IPoseidon2} from "../../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MockHonkVerifier} from "../mocks/MockHonkVerifier.sol";

contract SealedLedgerTest is Test {
    MockERC20 token;
    MockERC721 nft;
    Poseidon2 poseidon;
    MockHonkVerifier ingestVerifier;
    MockHonkVerifier tallyVerifier;
    SealedRankedShares pool;

    address owner = makeAddr("owner");
    address forwarder = makeAddr("forwarder");
    address coordinator = makeAddr("coordinator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address org = makeAddr("org");
    address recipientA = makeAddr("recipientA");
    address recipientB = makeAddr("recipientB");

    uint64 constant DEADLINE = 1_000_000;
    uint256 constant GX = 1;
    uint256 constant GY = 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C;
    uint256 constant USDC = 1_000_000;

    function config() internal view returns (SealedRankedShares.Config memory) {
        return SealedRankedShares.Config({
            forwarder: forwarder,
            coordinator: coordinator,
            poseidon: IPoseidon2(address(poseidon)),
            ingestVerifier: IHonkVerifier(address(ingestVerifier)),
            tallyVerifier: IHonkVerifier(address(tallyVerifier)),
            tallierPkX: GX,
            tallierPkY: GY,
            keySalt: keccak256("salt"),
            nSealedMax: 8,
            mMax: 4,
            batch: 2,
            minDirectVote: 10 * USDC,
            minSealedVote: 10 * USDC,
            proofGrace: 1 days,
            abandonGrace: 7 days
        });
    }

    function setUp() public {
        vm.warp(1);
        token = new MockERC20();
        nft = new MockERC721();
        poseidon = new Poseidon2();
        ingestVerifier = new MockHonkVerifier();
        tallyVerifier = new MockHonkVerifier();
        pool = new SealedRankedShares(token, owner, DEADLINE, config());
        address[4] memory holders = [alice, bob, carol, org];
        for (uint256 i = 0; i < holders.length; i++) {
            token.mint(holders[i], 1_000 * USDC);
            vm.prank(holders[i]);
            token.approve(address(pool), type(uint256).max);
        }
    }

    function openWithProjects() internal {
        vm.startPrank(owner);
        pool.addProject(50 * USDC, recipientA);
        pool.addProject(30 * USDC, recipientB);
        pool.openVoting();
        vm.stopPrank();
    }

    function one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    // ---- setup and limits ----

    function test_startsInSetupWithConfig() public view {
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Setup));
        assertEq(pool.tallierPkX(), GX);
        assertEq(pool.nSealedMax(), 8);
        assertEq(pool.minDirectVote(), 10 * USDC);
        assertEq(pool.minSealedVote(), 10 * USDC);
        assertEq(pool.coordinator(), coordinator);
        assertEq(pool.profileId(), keccak256(abi.encode(uint256(8), uint256(4), uint256(2))));
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
    }

    function test_constructorRejectsBadConfig() public {
        SealedRankedShares.Config memory cfg = config();
        cfg.abandonGrace = cfg.proofGrace;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
        cfg = config();
        cfg.mMax = 32;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
        cfg = config();
        cfg.tallierPkX = 1;
        cfg.tallierPkY = 1;
        vm.expectRevert(SealedRankedShares.InvalidConfig.selector);
        new SealedRankedShares(token, owner, DEADLINE, cfg);
    }

    function test_addProjectEnforcesCostAndCount() public {
        vm.startPrank(owner);
        vm.expectRevert(SealedRankedShares.ZeroCost.selector);
        pool.addProject(0, recipientA);
        vm.expectRevert(SealedRankedShares.CostTooLarge.selector);
        pool.addProject(uint256(type(uint64).max) + 1, recipientA);
        for (uint256 i = 0; i < 4; i++) {
            pool.addProject(1, recipientA);
        }
        vm.expectRevert(SealedRankedShares.TooManyProjects.selector);
        pool.addProject(1, recipientA);
        vm.stopPrank();
        assertEq(pool.projectCount(), 4);
        assertEq(pool.cost(3), 1);
    }

    function test_openVotingRequiresProjects() public {
        vm.prank(owner);
        vm.expectRevert(SealedRankedShares.NoProjects.selector);
        pool.openVoting();
    }

    function test_depositsCapTotalWeight() public {
        openWithProjects();
        token.mint(alice, type(uint64).max);
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.WeightOverflow.selector);
        pool.contribute(uint256(type(uint64).max) + 1);
    }

    // ---- ledger ----

    function test_ledgerTracksDirectAndSeatWeight() public {
        openWithProjects();
        vm.prank(alice);
        pool.contribute(40 * USDC);
        vm.prank(org);
        pool.sponsor(60 * USDC, one(bob));
        vm.prank(org);
        pool.sponsor(30 * USDC, one(alice));
        assertEq(pool.directWeight(alice), 40 * USDC);
        assertEq(pool.seatWeight(alice), 30 * USDC);
        assertEq(pool.seatWeight(bob), 60 * USDC);
        assertEq(pool.totalSeatWeight(), 90 * USDC);
        assertEq(pool.totalWeight(), 130 * USDC);
        assertEq(pool.voterCount(), 2);
        assertEq(pool.voters(0), alice);
        assertEq(pool.voters(1), bob);
    }

    function test_nftSeatTakeoverMovesSeatWeight() public {
        openWithProjects();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(50 * USDC, IERC721(address(nft)), 5);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 10 * USDC);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 7);
        vm.prank(bob);
        pool.claimSeat(id, 7);
        assertEq(pool.seatWeight(alice), 0);
        assertEq(pool.seatWeight(bob), 10 * USDC);
        assertEq(pool.totalSeatWeight(), 10 * USDC);
        assertEq(pool.totalWeight(), 50 * USDC);
    }

    // ---- direct ballots ----

    function test_directBallotIsPackedAndFinal() public {
        openWithProjects();
        vm.startPrank(alice);
        pool.contribute(40 * USDC);
        pool.vote(hex"0201");
        vm.expectRevert(SealedRankedShares.BallotAlreadyCast.selector);
        pool.vote(hex"0102");
        vm.stopPrank();
        assertTrue(pool.hasDirect(alice));
        assertEq(pool.directBallotOf(alice), 2 + (1 << 8));
    }

    function test_directBallotRequiresMinimumWeightAndValidRanks() public {
        openWithProjects();
        vm.startPrank(alice);
        pool.contribute(5 * USDC);
        vm.expectRevert(SealedRankedShares.BelowMinimumVote.selector);
        pool.vote(hex"0102");
        pool.contribute(5 * USDC);
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"010203");
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"0103");
        vm.expectRevert(SealedRankedShares.InvalidBallot.selector);
        pool.vote(hex"0202");
        pool.vote(hex"0000");
        vm.stopPrank();
        assertEq(pool.directBallotOf(alice), 0);
        assertTrue(pool.hasDirect(alice));
    }

    // ---- sealed ballots ----

    function test_sealedVoteRequiresSeatWeightAndValidPoint() public {
        openWithProjects();
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.NoSeatWeight.selector);
        pool.voteSealed(GX, GY, 5);
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.startPrank(alice);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(0, GY, 5);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(GX, GY + 1, 5);
        vm.expectRevert(SealedRankedShares.InvalidCiphertext.selector);
        pool.voteSealed(GX, GY, 21888242871839275222246405745257275088548364400416034343698204186575808495617);
        vm.expectEmit(true, false, false, false);
        emit SealedRankedShares.SealedVote(alice);
        pool.voteSealed(GX, GY, 5);
        vm.stopPrank();
        (uint256 rx, uint256 ry, uint256 c) = pool.sealedOf(alice);
        assertEq(rx, GX);
        assertEq(ry, GY);
        assertEq(c, 5);
        assertEq(pool.sealedCount(), 1);
    }

    function test_sealedVoteRequiresMinimumSeatWeight() public {
        openWithProjects();
        vm.prank(org);
        pool.sponsor(9 * USDC, one(bob));
        vm.prank(bob);
        vm.expectRevert(SealedRankedShares.NoSeatWeight.selector);
        pool.voteSealed(GX, GY, 5);
        vm.prank(org);
        pool.sponsor(1 * USDC, one(bob)); // exactly at the minimum
        assertEq(pool.seatWeight(bob), 10 * USDC);
        vm.prank(bob);
        pool.voteSealed(GX, GY, 5);
        assertEq(pool.sealedCount(), 1);
    }

    /// @dev The `!= 0` clause of both minimums, which a zero minimum must not switch off:
    ///      a weightless ballot only enlarges `voters` and the work close and tally pay for.
    function test_zeroWeightCannotVoteWithMinimumsOff() public {
        SealedRankedShares.Config memory cfg = config();
        cfg.minDirectVote = 0;
        cfg.minSealedVote = 0;
        SealedRankedShares p = new SealedRankedShares(token, owner, DEADLINE, cfg);
        vm.startPrank(owner);
        p.addProject(50 * USDC, recipientA);
        p.openVoting();
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.BelowMinimumVote.selector);
        p.vote(hex"01");
        vm.prank(alice);
        vm.expectRevert(SealedRankedShares.NoSeatWeight.selector);
        p.voteSealed(GX, GY, 5);
        assertEq(p.voterCount(), 0);
    }

    function test_sealedVoteReplacementDoesNotCountTwice() public {
        openWithProjects();
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.startPrank(alice);
        pool.voteSealed(GX, GY, 5);
        pool.voteSealed(GX, GY, 6);
        vm.stopPrank();
        (,, uint256 c) = pool.sealedOf(alice);
        assertEq(c, 6);
        assertEq(pool.sealedCount(), 1);
    }

    /// @dev Each seat is 10 USDC, exactly `minSealedVote`, so the cap is what bites.
    function test_sealedVoterCap() public {
        openWithProjects();
        address[] memory members = new address[](9);
        for (uint256 i = 0; i < 9; i++) {
            members[i] = address(uint160(0x2000 + i));
        }
        vm.prank(org);
        pool.sponsor(90 * USDC, members);
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(members[i]);
            pool.voteSealed(GX, GY, i);
        }
        vm.prank(members[8]);
        vm.expectRevert(SealedRankedShares.TooManySealedVoters.selector);
        pool.voteSealed(GX, GY, 8);
    }

    // ---- phases ----

    function test_closingPhaseAfterDeadlineBlocksVotes() public {
        openWithProjects();
        vm.prank(org);
        pool.sponsor(60 * USDC, one(alice));
        vm.warp(DEADLINE);
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Closing));
        // `inPhase(Phase.Open)` runs before `beforeDeadline`, so Closing reports WrongPhase.
        vm.prank(alice);
        vm.expectRevert(WrongPhase.selector);
        pool.voteSealed(GX, GY, 5);
        vm.prank(alice);
        vm.expectRevert(WrongPhase.selector);
        pool.contribute(1);
    }
}
