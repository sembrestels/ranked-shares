// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ArkivBallots} from "../src/ArkivBallots.sol";
import {WrongPhase} from "../src/PoolBase.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract ArkivPublicTest is Test {
    function test_replacementHashesAndIdenticalTally() public {
        vm.warp(1);
        MockERC20 token = new MockERC20();
        RankedShares legacy = new RankedShares(token, address(this), 100);
        RankedShares pool = new RankedShares(token, address(this), 100);
        pool.enableArkivBallots();
        for (uint256 j; j < 2; j++) {
            RankedShares p = j == 0 ? legacy : pool;
            p.addProject(50, address(10));
            p.addProject(30, address(11));
            p.openVoting();
            for (uint256 i; i < 3; i++) {
                address voter = address(uint160(i + 100));
                token.mint(voter, 40);
                vm.startPrank(voter);
                token.approve(address(p), 40);
                p.contribute(40);
                bytes memory ranks = i == 1 ? bytes(hex"0201") : bytes(hex"0102");
                if (j == 0) p.vote(ranks);
                else p.voteArkiv(bytes32(i + 1), ranks, 0);
                vm.stopPrank();
            }
        }
        vm.startPrank(address(100));
        pool.voteArkiv(bytes32(uint256(9)), hex"0102", 1);
        ArkivBallots.BallotRef memory ref = pool.ballotRefOf(address(100), false);
        assertEq(ref.revision, 2);
        assertEq(ref.payloadHash, keccak256(hex"0102"));
        assertEq(ref.blockNumber, block.number);
        assertEq(ref.entityKey, bytes32(uint256(9)));
        vm.expectRevert(ArkivBallots.ArkivBallotsRequired.selector);
        pool.ballotOf(address(100));
        vm.expectRevert(ArkivBallots.StaleBallotRevision.selector);
        pool.voteArkiv(bytes32(uint256(10)), hex"0201", 1);
        vm.expectRevert(ArkivBallots.ArkivBallotsRequired.selector);
        pool.vote(hex"0102");
        vm.stopPrank();
        vm.expectRevert(WrongPhase.selector);
        pool.enableArkivBallots();
        vm.warp(100);
        pool.startTally();
        legacy.startTally();
        bytes[] memory ballots = new bytes[](3);
        ballots[0] = hex"0102";
        ballots[1] = hex"0102";
        ballots[2] = hex"0102";
        vm.expectRevert(ArkivBallots.InvalidBallotWitness.selector);
        pool.runArkiv(10, ballots);
        ballots[1] = hex"0201";
        vm.expectRevert(ArkivBallots.ArkivBallotsRequired.selector);
        pool.step();
        pool.runArkiv(1, ballots);
        pool.runArkiv(20, ballots);
        legacy.run(20);
        assertEq(pool.fundedProjects(), legacy.fundedProjects());
        assertEq(pool.spent(), legacy.spent());
    }

    function test_onlyOwnerCanEnableAndLegacyPoolsStayLegacy() public {
        RankedShares pool = new RankedShares(new MockERC20(), address(this), uint64(block.timestamp + 100));
        vm.prank(address(1));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(1)));
        pool.enableArkivBallots();
        assertFalse(pool.arkivBallots());
        pool.addProject(1, address(1));
        pool.openVoting();
        vm.expectRevert(ArkivBallots.ArkivNotEnabled.selector);
        pool.voteArkiv(bytes32(uint256(1)), hex"01", 0);
    }
}
