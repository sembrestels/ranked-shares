// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ArkivBallots} from "../../src/ArkivBallots.sol";
import {CreRankedShares} from "../../src/cre/CreRankedShares.sol";
import {ZiskFixtureLoader} from "../zisk/ZiskFixtureLoader.sol";

contract ArkivCreTest is ZiskFixtureLoader {
    function useArkiv() internal pure override returns (bool) {
        return true;
    }

    function test_closeAndReportMatchFixture() public {
        loadFixture("main");
        newMocks();
        address forwarder = address(0x1234);
        deployAt(
            "CreRankedShares.sol:CreRankedShares",
            abi.encode(
                token,
                owner,
                DEADLINE,
                fxPk(),
                fxBytes32(".keySalt"),
                fxWord(".minDirectVote"),
                ABANDON_GRACE,
                forwarder,
                address(0),
                bytes10(0)
            )
        );
        replayVoters();
        vm.warp(DEADLINE);
        CreRankedShares cre = CreRankedShares(address(pool));
        vm.expectRevert(ArkivBallots.ArkivBallotsRequired.selector);
        pool.close(1);
        bytes memory report = abi.encode(uint8(3), abi.encode(uint256(0), witnesses(0, 3)));
        vm.prank(forwarder);
        cre.onReport("", report);
        assertEq(pool.closeCursor(), 3);
        vm.prank(forwarder);
        vm.expectRevert(ArkivBallots.StaleCloseCursor.selector);
        cre.onReport("", report);
        ArkivBallots.BallotData[] memory changed = witnesses(3, 1);
        changed[0].sealedBallot = hex"bad0";
        vm.expectRevert(ArkivBallots.InvalidBallotWitness.selector);
        pool.closeArkiv(3, changed);
        closeAll(2);
        assertEq(pool.inputsHash(), fixtureInputsHash());
        bytes memory result = abi.encode(uint8(1), abi.encode(fixtureInputsHash(), fxUintArray(".funded")));
        vm.prank(forwarder);
        cre.onReport("", result);
        assertEq(pool.fundedProjects(), fxUintArray(".funded"));
    }
}
