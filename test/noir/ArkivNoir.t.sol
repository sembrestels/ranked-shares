// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ArkivBallots} from "../../src/ArkivBallots.sol";
import {NoirRankedShares} from "../../src/noir/NoirRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract ArkivNoirTest is FixtureLoader {
    function useArkiv() internal pure override returns (bool) {
        return true;
    }

    function test_fixtureCommitmentsWithWitnesses() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        vm.warp(DEADLINE);
        vm.expectRevert(ArkivBallots.ArkivBallotsRequired.selector);
        pool.close(1);
        ArkivBallots.BallotData[] memory data = witnesses(0, 1);
        vm.expectRevert(ArkivBallots.StaleCloseCursor.selector);
        pool.closeArkiv(1, data);
        data[0].publicBallot = hex"ff";
        vm.expectRevert(ArkivBallots.InvalidBallotWitness.selector);
        pool.closeArkiv(0, data);
        bytes memory closeReport = abi.encode(uint8(3), abi.encode(uint256(0), witnesses(0, 1)));
        vm.prank(forwarder);
        pool.onReport("", closeReport);
        assertEq(pool.closeCursor(), 1);
        closeAll(1);
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"));
        assertEq(pool.hPub(), fxBytes32(".hPub"));
        assertEq(pool.hSealed(), fxWord(".hSealed"));
        uint256[] memory checkpoints = fxWords(".checkpoints");
        for (uint256 k; k < checkpoints.length; k++) {
            assertEq(pool.checkpoint(k), checkpoints[k]);
        }
        report();
        assertEq(pool.provisionalResult(), fxUintArray(".funded"));
    }

    function test_directFinalSealedReplaceableAndCountStable() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        for (uint256 i; i < fxCount(".voters"); i++) {
            address voter = fxAddress(voterKey(i, "addr"));
            if (fxBool(voterKey(i, "hasDirect"))) {
                vm.prank(voter);
                vm.expectRevert(NoirRankedShares.BallotAlreadyCast.selector);
                pool.voteArkiv(bytes32(uint256(99)), ranksBytes(fxUintArray(voterKey(i, "directRanks"))), 1);
            }
            if (fxBool(voterKey(i, "hasSealed"))) {
                uint256[] memory ct = fxWords(voterKey(i, "ciphertext"));
                uint256 count = pool.sealedCount();
                vm.startPrank(voter);
                pool.voteSealedArkiv(bytes32(uint256(99)), abi.encode(ct[0], ct[1], ct[2]), 1);
                vm.expectRevert(ArkivBallots.StaleBallotRevision.selector);
                pool.voteSealedArkiv(bytes32(uint256(100)), abi.encode(ct[0], ct[1], ct[2]), 1);
                vm.stopPrank();
                assertEq(pool.sealedCount(), count);
                assertEq(pool.ballotRefOf(voter, true).revision, 2);
            }
        }
    }
}
