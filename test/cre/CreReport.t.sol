// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {CreRankedShares} from "../../src/cre/CreRankedShares.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {ZiskFixtureLoader} from "../zisk/ZiskFixtureLoader.sol";

contract CreReportTest is ZiskFixtureLoader {
    address forwarder = makeAddr("forwarder");
    CreRankedShares cpool;

    function setUp() public {
        loadFixture("main");
        newMocks();
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
                forwarder
            )
        );
        cpool = CreRankedShares(address(pool));
        replayVoters();
    }

    function resultReport(bytes32 h, uint256[] memory order) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), abi.encode(h, order));
    }

    function test_kindAndInterface() public view {
        assertEq(cpool.kind(), "cre");
        assertEq(cpool.forwarder(), forwarder);
        assertTrue(cpool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(cpool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(cpool.supportsInterface(0xffffffff));
    }

    function test_constructorNeedsAForwarder() public {
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new CreRankedShares(token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days, address(0));
    }

    function test_onlyForwarderAndKnownKinds() public {
        vm.expectRevert(CreRankedShares.NotForwarder.selector);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(1))));
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.UnknownReport.selector);
        cpool.onReport("", abi.encode(uint8(9), ""));
    }

    function test_kindTwoClosesInChunks() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(5))));
        assertEq(cpool.closeCursor(), 5);
        assertFalse(cpool.closed());
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(100))));
        vm.stopPrank();
        assertTrue(cpool.closed());
        assertEq(cpool.inputsHash(), fixtureInputsHash());
    }

    function test_kindTwoOnlyInClosing() public {
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    function test_kindOneNeedsTallyAndMatchingHash() public {
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        closeAll(1000);
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.InputMismatch.selector);
        cpool.onReport("", resultReport(bytes32(uint256(1)), order));
        uint256[] memory bad = new uint256[](1);
        bad[0] = 7;
        vm.prank(forwarder);
        vm.expectRevert(SealedPool.InvalidResult.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), bad));
    }

    function test_kindOneFinalisesAsAttestedOnce() public {
        closeAll(1000);
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Attested, order);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Attested));
        assertEq(cpool.fundedProjects(), order);
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport("", resultReport(fixtureInputsHash(), order));
        cpool.claim(2);
        assertEq(token.balanceOf(recipient), cpool.cost(2));
    }

    function test_abandonStillWorks() public {
        closeAll(1000);
        vm.warp(DEADLINE + ABANDON_GRACE);
        cpool.abandon();
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Abandoned));
    }
}
