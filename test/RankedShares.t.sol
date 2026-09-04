// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PBEAR} from "../src/PBEAR.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC721, MockERC721Enumerable} from "./mocks/MockERC721.sol";

contract RankedSharesTest is Test {
    MockERC20 token;
    RankedShares pool;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address org = makeAddr("org");
    address recipientA = makeAddr("recipientA");
    address recipientB = makeAddr("recipientB");

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
    }

    function openWithProjects() internal {
        vm.startPrank(owner);
        pool.addProject(50, recipientA);
        pool.addProject(30, recipientB);
        pool.openVoting();
        vm.stopPrank();
    }

    function members(address a, address b) internal pure returns (address[] memory out) {
        out = new address[](2);
        out[0] = a;
        out[1] = b;
    }

    // ---- setup phase ----

    function test_startsInSetup() public view {
        assertEq(uint256(pool.phase()), uint256(RankedShares.Phase.Setup));
        assertEq(address(pool.token()), address(token));
        assertEq(pool.owner(), owner);
        assertEq(pool.votingDeadline(), DEADLINE);
    }

    function test_ownerAddsProjectsWithRecipients() public {
        vm.prank(owner);
        uint256 id = pool.addProject(50, recipientA);
        assertEq(id, 0);
        assertEq(pool.cost(0), 50);
        assertEq(pool.recipientOf(0), recipientA);
    }

    function test_addProjectRejectsNonOwnerAndZeroRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        pool.addProject(50, recipientA);
        vm.expectRevert(RankedShares.ZeroAddress.selector);
        vm.prank(owner);
        pool.addProject(50, address(0));
    }

    function test_openVotingRequiresProjects() public {
        vm.prank(owner);
        vm.expectRevert(PBEAR.NoProjects.selector);
        pool.openVoting();
    }

    function test_openVotingMovesToOpen() public {
        openWithProjects();
        assertEq(uint256(pool.phase()), uint256(RankedShares.Phase.Open));
        vm.prank(owner);
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.addProject(1, recipientA);
    }

    function test_contributeRejectedInSetup() public {
        vm.prank(alice);
        vm.expectRevert(RankedShares.WrongPhase.selector);
        pool.contribute(10);
    }

    // ---- contributions ----

    function test_contributeMovesTokensAndGrantsWeight() public {
        openWithProjects();
        vm.prank(alice);
        pool.contribute(40);
        assertEq(token.balanceOf(address(pool)), 40);
        assertEq(pool.weightOf(alice), 40);
        assertEq(pool.totalWeight(), 40);
        assertEq(pool.abstainingWeight(), 0);
        vm.prank(alice);
        pool.contribute(5);
        assertEq(pool.weightOf(alice), 45);
    }

    function test_contributeRejectsZero() public {
        openWithProjects();
        vm.prank(alice);
        vm.expectRevert(RankedShares.ZeroAmount.selector);
        pool.contribute(0);
    }

    function test_contributeRejectedAfterDeadline() public {
        openWithProjects();
        vm.warp(DEADLINE);
        vm.prank(alice);
        vm.expectRevert(RankedShares.DeadlinePassed.selector);
        pool.contribute(10);
    }

    // ---- explicit-list sponsorship ----

    function test_sponsorSplitsEquallyLeavingDustAbstaining() public {
        openWithProjects();
        vm.prank(org);
        uint256 id = pool.sponsor(101, members(alice, bob));
        assertEq(id, 0);
        assertEq(pool.weightOf(alice), 50);
        assertEq(pool.weightOf(bob), 50);
        assertEq(pool.totalWeight(), 101);
        assertEq(pool.abstainingWeight(), 1);
        (address sponsor_, uint256 amount, uint256 perSeat, uint256 seats, uint256 claimed, address nft) =
            pool.sponsorships(id);
        assertEq(sponsor_, org);
        assertEq(amount, 101);
        assertEq(perSeat, 50);
        assertEq(seats, 2);
        assertEq(claimed, 2);
        assertEq(nft, address(0));
    }

    function test_sponsorRejectsEmptyMembers() public {
        openWithProjects();
        vm.prank(org);
        vm.expectRevert(RankedShares.NoSeats.selector);
        pool.sponsor(100, new address[](0));
    }

    // ---- NFT sponsorship ----

    function test_sponsorNFTWithExplicitSeats() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        (,, uint256 perSeat, uint256 seats, uint256 claimed, address nftAddr) = pool.sponsorships(id);
        assertEq(perSeat, 30);
        assertEq(seats, 3);
        assertEq(claimed, 0);
        assertEq(nftAddr, address(nft));
        assertEq(pool.abstainingWeight(), 90);
    }

    function test_sponsorNFTFallsBackToTotalSupply() public {
        openWithProjects();
        MockERC721Enumerable nft = new MockERC721Enumerable();
        nft.mint(alice, 1);
        nft.mint(bob, 2);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(100, IERC721(address(nft)), 0);
        (,, uint256 perSeat, uint256 seats,,) = pool.sponsorships(id);
        assertEq(seats, 2);
        assertEq(perSeat, 50);
    }

    function test_sponsorNFTRevertsWhenSupplyUnknown() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        vm.prank(org);
        vm.expectRevert(RankedShares.SeatsUnknown.selector);
        pool.sponsorNFT(100, IERC721(address(nft)), 0);
    }

    function test_sponsorNFTRevertsOnZeroSupply() public {
        openWithProjects();
        MockERC721Enumerable nft = new MockERC721Enumerable();
        vm.prank(org);
        vm.expectRevert(RankedShares.SeatsUnknown.selector);
        pool.sponsorNFT(100, IERC721(address(nft)), 0);
    }

    function test_claimSeatGrantsPerSeatWeight() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        assertEq(pool.weightOf(alice), 30);
        assertEq(pool.abstainingWeight(), 60);
        assertEq(pool.seatHolder(id, 7), alice);
        (,,,, uint256 claimed,) = pool.sponsorships(id);
        assertEq(claimed, 1);
    }

    function test_claimSeatRequiresTokenOwnership() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        vm.prank(bob);
        vm.expectRevert(RankedShares.NotTokenOwner.selector);
        pool.claimSeat(id, 7);
    }

    function test_claimSeatTwiceReverts() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        vm.startPrank(alice);
        pool.claimSeat(id, 7);
        vm.expectRevert(RankedShares.AlreadyHeld.selector);
        pool.claimSeat(id, 7);
        vm.stopPrank();
    }

    function test_claimSeatRespectsSeatCount() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 1);
        nft.mint(alice, 2);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 1);
        vm.startPrank(alice);
        pool.claimSeat(id, 1);
        vm.expectRevert(RankedShares.NoSeatsLeft.selector);
        pool.claimSeat(id, 2);
        vm.stopPrank();
    }

    function test_transferredTokenMovesSeatToNewHolder() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 7);
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        vm.prank(alice);
        pool.claimSeat(id, 7);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 7);
        vm.prank(bob);
        pool.claimSeat(id, 7);
        assertEq(pool.weightOf(alice), 0);
        assertEq(pool.weightOf(bob), 30);
        assertEq(pool.seatHolder(id, 7), bob);
        (,,,, uint256 claimed,) = pool.sponsorships(id);
        assertEq(claimed, 1);
    }

    function test_claimSeatRejectsListSponsorship() public {
        openWithProjects();
        vm.prank(org);
        uint256 id = pool.sponsor(100, members(alice, bob));
        vm.prank(alice);
        vm.expectRevert(RankedShares.NotNFTSponsorship.selector);
        pool.claimSeat(id, 1);
    }

    // ---- ballots ----

    function test_voteStoresBallotEvenWithZeroWeight() public {
        openWithProjects();
        vm.prank(alice);
        pool.vote(hex"0102");
        assertEq(pool.ballotOf(alice), hex"0102");
        vm.prank(alice);
        pool.contribute(10);
        assertEq(pool.weightOf(alice), 10);
    }

    function test_voteRejectedAfterDeadline() public {
        openWithProjects();
        vm.warp(DEADLINE);
        vm.prank(alice);
        vm.expectRevert(RankedShares.DeadlinePassed.selector);
        pool.vote(hex"0102");
    }

    function test_addressWeightIsSumOfAllSources() public {
        openWithProjects();
        MockERC721 nft = new MockERC721();
        nft.mint(alice, 1);
        vm.prank(alice);
        pool.contribute(10);
        vm.prank(org);
        pool.sponsor(40, members(alice, bob));
        vm.prank(org);
        uint256 id = pool.sponsorNFT(90, IERC721(address(nft)), 3);
        vm.prank(alice);
        pool.claimSeat(id, 1);
        assertEq(pool.weightOf(alice), 10 + 20 + 30);
        assertEq(pool.totalWeight(), 140);
        assertEq(pool.abstainingWeight(), 60);
    }
}
