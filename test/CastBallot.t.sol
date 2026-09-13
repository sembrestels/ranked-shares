// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {PoolBase, SealedContribution} from "../src/PoolBase.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {ArkivBallots} from "../src/ArkivBallots.sol";
import {MockPermitToken} from "./mocks/MockPermitToken.sol";

contract CastBallotTest is Test {
    MockPermitToken token;
    RankedShares pool;
    uint256 constant KEY = 123;
    address voter;
    function setUp() public {
        vm.warp(1);
        voter = vm.addr(KEY);
        token = new MockPermitToken();
        pool = new RankedShares(token, address(this), 1000);
        pool.enableArkivBallots();
        pool.addProject(50, address(11));
        pool.addProject(30, address(12));
        pool.openVoting();
        token.mint(voter, 100);
    }
    function permit(uint256 amount) internal view returns (PoolBase.Permit memory p) {
        p.deadline = 100;
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"), voter, address(pool), amount, token.nonces(voter), p.deadline
        ))));
        (p.v, p.r, p.s) = vm.sign(KEY, digest);
    }
    function test_permitDepositAndVoteAreOneCall() public {
        PoolBase.Permit memory p = permit(80);
        vm.prank(voter); pool.castBallot(80, false, hex"0102", 0, p);
        assertEq(token.balanceOf(voter), 20);
        assertEq(token.balanceOf(address(pool)), 80);
        assertEq(pool.weightOf(voter), 80);
        assertEq(token.nonces(voter), 1);
        assertEq(token.allowance(voter, address(pool)), 0);
        ArkivBallots.BallotRef memory ref = pool.ballotRefOf(voter, false);
        assertEq(ref.entityKey, keccak256(abi.encode(block.chainid, address(pool), voter, false, uint256(1), keccak256(hex"0102"))));
        assertEq(ref.revision, 1);
        vm.warp(1000); pool.startTally();
        bytes[] memory ballots = new bytes[](1); ballots[0] = hex"0102";
        pool.runArkiv(20, ballots);
        assertEq(pool.spent(), 80);
    }
    function test_invalidBallotRollsBackPermitTransferAndWeight() public {
        PoolBase.Permit memory p = permit(80);
        vm.prank(voter); vm.expectRevert(); pool.castBallot(80, false, hex"0301", 0, p);
        assertEq(token.nonces(voter), 0);
        assertEq(token.balanceOf(voter), 100);
        assertEq(token.balanceOf(address(pool)), 0);
        assertEq(pool.totalWeight(), 0);
        assertEq(pool.ballotRefOf(voter, false).revision, 0);
    }
    function test_frontRunPermitDoesNotBlockTheVote() public {
        PoolBase.Permit memory p = permit(80);
        token.permit(voter, address(pool), 80, p.deadline, p.v, p.r, p.s);
        vm.prank(voter); pool.castBallot(80, false, hex"0102", 0, p);
        assertEq(pool.weightOf(voter), 80);
    }
    function test_existingAllowanceAndZeroContributionReplacement() public {
        vm.startPrank(voter);
        token.approve(address(pool), 80);
        PoolBase.Permit memory p;
        pool.castBallot(80, false, hex"0102", 0, p);
        pool.castBallot(0, false, hex"0201", 1, p);
        PoolBase.Permit memory nextPermit = permit(20);
        vm.expectRevert(ArkivBallots.StaleBallotRevision.selector);
        pool.castBallot(20, false, hex"0102", 0, nextPermit);
        vm.stopPrank();
        assertEq(pool.weightOf(voter), 80);
        assertEq(token.balanceOf(voter), 20);
        assertEq(pool.ballotRefOf(voter, false).revision, 2);
    }
    function test_noContributionForSponsoredEncryptedVote() public {
        PoolBase.Permit memory p = permit(1);
        vm.prank(voter); vm.expectRevert(SealedContribution.selector);
        pool.castBallot(1, true, hex"01", 0, p);
    }
    function test_permitCannotAuthorizeAnotherVoter() public {
        PoolBase.Permit memory p = permit(80);
        vm.prank(address(99)); vm.expectRevert(); pool.castBallot(80, false, hex"0102", 0, p);
        assertEq(token.balanceOf(voter), 100);
        assertEq(pool.totalWeight(), 0);
    }
}
