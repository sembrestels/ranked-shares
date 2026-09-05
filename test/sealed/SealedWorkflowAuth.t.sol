// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {BadMetadata, WrongWorkflow, deriveWorkflowName} from "../../src/lib/CreMetadata.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev `onReport`'s workflow authorization on the Noir pool. The KeystoneForwarder is a
///      per-chain singleton, so `msg.sender == forwarder` alone would let any workflow
///      owner registered with it report a forged result to this pool; these tests are the
///      sibling of `test/cre/CreReport.t.sol`'s "workflow authorization" section.
contract SealedWorkflowAuthTest is FixtureLoader {
    function workflowConfig() internal view override returns (address, bytes10) {
        return (workflowAuthor, WORKFLOW_NAME);
    }

    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
    }

    /// @dev The forwarder's real metadata layout: `abi.encodePacked(bytes32 workflowId,
    ///      bytes10 workflowName, address workflowOwner)` plus a `bytes2 reportId` on
    ///      verified delivery — 64 bytes in all.
    function metadata(address author, bytes10 name) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), name, author, bytes2(0x0001));
    }

    function meta() internal view returns (bytes memory) {
        return metadata(workflowAuthor, WORKFLOW_NAME);
    }

    function closeReport(uint256 maxVoters) internal pure returns (bytes memory) {
        return abi.encode(uint8(2), abi.encode(maxVoters));
    }

    function fixtureResultReport() internal view returns (bytes memory) {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) {
                flat[s * width + w] = step[w];
            }
        }
        return abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat));
    }

    // ---- the immutables and the name derivation ----

    function test_immutablesRecordTheAuthorizedWorkflow() public view {
        assertEq(pool.workflowOwner(), workflowAuthor);
        assertEq(pool.workflowName(), WORKFLOW_NAME);
    }

    function test_workflowNameOfMatchesTheDerivation() public view {
        assertEq(pool.workflowNameOf("ranked-shares-tally"), WORKFLOW_NAME);
        assertEq(deriveWorkflowName("ranked-shares-tally"), pool.workflowNameOf("ranked-shares-tally"));
    }

    // ---- the authorized workflow is accepted ----

    function test_kindTwoAcceptedFromTheRightWorkflow() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        pool.onReport(meta(), closeReport(5));
        assertEq(pool.closeCursor(), 5);
        assertFalse(pool.closed());
        pool.onReport(meta(), closeReport(100));
        vm.stopPrank();
        assertTrue(pool.closed());
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"));
    }

    function test_kindOneAcceptedFromTheRightWorkflow() public {
        closeAll(1000);
        vm.prank(forwarder);
        pool.onReport(meta(), fixtureResultReport());
        assertTrue(pool.resultReported());
        assertEq(pool.provisionalResult(), fxUintArray(".funded"));
    }

    /// @dev `meta()` is the full 64 bytes the forwarder sends on verified delivery
    ///      (`workflowId ‖ workflowName ‖ workflowOwner ‖ reportId`); the trailing
    ///      `reportId` must not disturb the fixed offsets the check reads.
    function test_64ByteMetadataWithATrailingReportIdIsAccepted() public {
        assertEq(meta().length, 64);
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        pool.onReport(meta(), closeReport(5));
        assertEq(pool.closeCursor(), 5);
    }

    function test_62ByteMetadataAcceptedWithoutReportId() public {
        bytes memory md = abi.encodePacked(bytes32(uint256(1)), WORKFLOW_NAME, workflowAuthor);
        assertEq(md.length, 62);
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        pool.onReport(md, closeReport(5));
        assertEq(pool.closeCursor(), 5);
    }

    // ---- everything else is rejected ----

    function test_wrongOwnerReverts() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        pool.onReport(metadata(makeAddr("someoneElse"), WORKFLOW_NAME), closeReport(5));
    }

    function test_wrongNameReverts() public {
        vm.warp(DEADLINE);
        bytes10 wrongName = pool.workflowNameOf("some-other-workflow");
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        pool.onReport(metadata(workflowAuthor, wrongName), closeReport(5));
    }

    /// @dev The hole this closes: a kind-1 report from another workflow owner would write
    ///      `_provisional`/`transcriptHash` and start the `proofGrace` clock, so a forged
    ///      result could be finalised by `acceptProvisional` once the grace elapsed.
    function test_kindOneFromAnotherWorkflowOwnerReverts() public {
        closeAll(1000);
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        pool.onReport(metadata(makeAddr("someoneElse"), WORKFLOW_NAME), fixtureResultReport());
        assertFalse(pool.resultReported());
    }

    function test_61ByteMetadataReverts() public {
        vm.warp(DEADLINE);
        bytes memory md = new bytes(61);
        vm.prank(forwarder);
        vm.expectRevert(BadMetadata.selector);
        pool.onReport(md, closeReport(5));
    }

    function test_emptyMetadataReverts() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        vm.expectRevert(BadMetadata.selector);
        pool.onReport("", closeReport(5));
    }

    /// @dev Builds the 62-byte metadata by hand at the absolute offsets `checkWorkflow`
    ///      reads — `workflowName` at 32..42, `workflowOwner` at 42..62 — rather than
    ///      through the `metadata` helper, so the test pins those offsets independently.
    function test_wrongOwnerRevertsAtThePinnedOffsets() public {
        vm.warp(DEADLINE);
        bytes memory md = new bytes(62);
        for (uint256 i = 0; i < 10; i++) {
            md[32 + i] = WORKFLOW_NAME[i];
        }
        bytes20 wrongOwner = bytes20(makeAddr("someoneElse"));
        for (uint256 i = 0; i < 20; i++) {
            md[42 + i] = wrongOwner[i];
        }
        assertEq(md.length, 62);
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        pool.onReport(md, closeReport(5));
    }

    /// @dev The same bytes with the right owner at 42..62 are accepted, so the revert
    ///      above is the owner comparison and not the hand-built layout.
    function test_rightOwnerAcceptedAtThePinnedOffsets() public {
        vm.warp(DEADLINE);
        bytes memory md = new bytes(62);
        for (uint256 i = 0; i < 10; i++) {
            md[32 + i] = WORKFLOW_NAME[i];
        }
        bytes20 rightOwner = bytes20(workflowAuthor);
        for (uint256 i = 0; i < 20; i++) {
            md[42 + i] = rightOwner[i];
        }
        vm.prank(forwarder);
        pool.onReport(md, closeReport(5));
        assertEq(pool.closeCursor(), 5);
    }

    function test_forwarderCheckStillComesFirst() public {
        vm.warp(DEADLINE);
        vm.expectRevert(SealedRankedShares.NotForwarder.selector);
        pool.onReport(meta(), closeReport(5));
    }
}

/// @dev A pool deployed with `workflowOwner == address(0)`: the check is off, and
///      `cre workflow simulate`'s MockForwarder — which calls `onReport` with no metadata
///      at all — can still drive it. Such a pool must never hold real funds.
contract SealedWorkflowOptOutTest is FixtureLoader {
    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
    }

    function test_zeroWorkflowOwnerDisablesTheCheck() public {
        assertEq(pool.workflowOwner(), address(0));
        assertEq(pool.workflowName(), bytes10(0));
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(1000))));
        assertTrue(pool.closed());
    }

    function test_zeroWorkflowOwnerAcceptsAnyMetadata() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        pool.onReport(
            abi.encodePacked(bytes32(uint256(9)), bytes10(uint80(0xdead)), makeAddr("anyone")),
            abi.encode(uint8(2), abi.encode(uint256(1000)))
        );
        assertTrue(pool.closed());
    }
}
