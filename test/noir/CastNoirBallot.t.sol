// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SealedLedgerTest} from "./SealedLedger.t.sol";
import {PoolBase} from "../../src/PoolBase.sol";
import {NoirRankedShares} from "../../src/noir/NoirRankedShares.sol";

contract CastNoirBallotTest is SealedLedgerTest {
    function test_castNoirPublicAndEncrypted() public {
        vm.prank(owner); pool.enableArkivBallots();
        openWithProjects();
        PoolBase.Permit memory p;
        vm.prank(alice); pool.castBallot(10 * USDC, false, hex"0102", 0, p);
        assertEq(pool.directWeight(alice), 10 * USDC);
        vm.prank(alice); vm.expectRevert(NoirRankedShares.BallotAlreadyCast.selector);
        pool.castBallot(10 * USDC, false, hex"0201", 1, p);
        assertEq(pool.directWeight(alice), 10 * USDC);
        vm.prank(org); pool.sponsor(10 * USDC, one(bob));
        uint256 balance = token.balanceOf(bob);
        vm.prank(bob); pool.castBallot(0, true, abi.encode(GX, GY, uint256(1)), 0, p);
        vm.prank(bob); pool.castBallot(0, true, abi.encode(GX, GY, uint256(2)), 1, p);
        assertEq(token.balanceOf(bob), balance);
        assertEq(pool.sealedCount(), 1);
        assertEq(pool.ballotRefOf(bob, true).revision, 2);
    }
}
