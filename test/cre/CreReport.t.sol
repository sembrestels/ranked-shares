// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {CreRankedShares} from "../../src/cre/CreRankedShares.sol";
import {BadMetadata, WrongWorkflow, deriveWorkflowName} from "../../src/lib/CreMetadata.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {ZiskFixtureLoader} from "../zisk/ZiskFixtureLoader.sol";

contract CreReportTest is ZiskFixtureLoader {
    // python3 -c "import hashlib;h=hashlib.sha256(b'ranked-shares-tally').hexdigest()[:10];print(h, h.encode().hex())"
    // -> 3f9c6bb3be 33663963366262336265
    bytes10 internal constant WORKFLOW_NAME = bytes10(0x33663963366262336265);

    address forwarder = makeAddr("forwarder");
    address workflowAuthor = makeAddr("workflowAuthor");
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
                forwarder,
                workflowAuthor,
                WORKFLOW_NAME
            )
        );
        cpool = CreRankedShares(address(pool));
        replayVoters();
    }

    function resultReport(bytes32 h, uint256[] memory order) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), abi.encode(h, order));
    }

    /// @dev The forwarder's real metadata layout: `abi.encodePacked(bytes32 workflowId,
    ///      bytes10 workflowName, address workflowOwner)` plus a `bytes2 reportId` on
    ///      verified delivery.
    function metadata(address author, bytes10 name) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), name, author, bytes2(0x0001));
    }

    function meta() internal view returns (bytes memory) {
        return metadata(workflowAuthor, WORKFLOW_NAME);
    }

    function test_kindAndInterface() public view {
        assertEq(cpool.kind(), "cre");
        assertEq(cpool.forwarder(), forwarder);
        assertEq(cpool.workflowOwner(), workflowAuthor);
        assertEq(cpool.workflowName(), WORKFLOW_NAME);
        assertTrue(cpool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(cpool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(cpool.supportsInterface(0xffffffff));
    }

    function test_workflowNameOfMatchesTheDerivation() public view {
        assertEq(cpool.workflowNameOf("ranked-shares-tally"), WORKFLOW_NAME);
    }

    function test_workflowNameOfMatchesTheScriptsDerivation() public view {
        assertEq(deriveWorkflowName("ranked-shares-tally"), cpool.workflowNameOf("ranked-shares-tally"));
    }

    function test_constructorNeedsAForwarder() public {
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new CreRankedShares(
            token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days, address(0), workflowAuthor, WORKFLOW_NAME
        );
    }

    function test_onlyForwarderAndKnownKinds() public {
        vm.expectRevert(CreRankedShares.NotForwarder.selector);
        cpool.onReport(meta(), abi.encode(uint8(2), abi.encode(uint256(1))));
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.UnknownReport.selector);
        cpool.onReport(meta(), abi.encode(uint8(9), ""));
    }

    function test_kindTwoClosesInChunks() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        cpool.onReport(meta(), abi.encode(uint8(2), abi.encode(uint256(5))));
        assertEq(cpool.closeCursor(), 5);
        assertFalse(cpool.closed());
        cpool.onReport(meta(), abi.encode(uint8(2), abi.encode(uint256(100))));
        vm.stopPrank();
        assertTrue(cpool.closed());
        assertEq(cpool.inputsHash(), fixtureInputsHash());
    }

    function test_kindTwoOnlyInClosing() public {
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport(meta(), abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    function test_kindOneNeedsTallyAndMatchingHash() public {
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport(meta(), resultReport(fixtureInputsHash(), order));
        closeAll(1000);
        vm.prank(forwarder);
        vm.expectRevert(CreRankedShares.InputMismatch.selector);
        cpool.onReport(meta(), resultReport(bytes32(uint256(1)), order));
        uint256[] memory bad = new uint256[](1);
        bad[0] = 7;
        vm.prank(forwarder);
        vm.expectRevert(SealedPool.InvalidResult.selector);
        cpool.onReport(meta(), resultReport(fixtureInputsHash(), bad));
    }

    function test_kindOneFinalisesAsAttestedOnce() public {
        closeAll(1000);
        uint256[] memory order = fxUintArray(".funded");
        vm.prank(forwarder);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Attested, order);
        cpool.onReport(meta(), resultReport(fixtureInputsHash(), order));
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Attested));
        assertEq(cpool.fundedProjects(), order);
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        cpool.onReport(meta(), resultReport(fixtureInputsHash(), order));
        cpool.claim(2);
        assertEq(token.balanceOf(recipient), cpool.cost(2));
    }

    function test_abandonStillWorks() public {
        closeAll(1000);
        vm.warp(DEADLINE + ABANDON_GRACE);
        cpool.abandon();
        assertEq(uint256(cpool.finality()), uint256(SealedPool.Finality.Abandoned));
    }

    // ---- workflow authorization ----

    function test_wrongOwnerReverts() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        cpool.onReport(metadata(makeAddr("someoneElse"), WORKFLOW_NAME), abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    function test_wrongNameReverts() public {
        vm.warp(DEADLINE);
        bytes10 wrongName = cpool.workflowNameOf("some-other-workflow");
        vm.prank(forwarder);
        vm.expectRevert(WrongWorkflow.selector);
        cpool.onReport(metadata(workflowAuthor, wrongName), abi.encode(uint8(2), abi.encode(uint256(5))));
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
        cpool.onReport(md, abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    function test_62ByteMetadataAcceptedWithoutReportId() public {
        vm.warp(DEADLINE);
        bytes memory md = abi.encodePacked(bytes32(uint256(1)), WORKFLOW_NAME, workflowAuthor);
        assertEq(md.length, 62);
        vm.prank(forwarder);
        cpool.onReport(md, abi.encode(uint8(2), abi.encode(uint256(5))));
        assertEq(cpool.closeCursor(), 5);
    }

    function test_61ByteMetadataReverts() public {
        vm.warp(DEADLINE);
        bytes memory md = new bytes(61);
        vm.prank(forwarder);
        vm.expectRevert(BadMetadata.selector);
        cpool.onReport(md, abi.encode(uint8(2), abi.encode(uint256(5))));
    }

    /// @dev Deployed directly (not through `deployAt`) so it lands at a fresh address
    ///      instead of reusing the fixture's fixed pool address, which already carries
    ///      `cpool`'s storage from `setUp`. `org` funds the project's cost directly so
    ///      `_requireBalanceCoversBudget` is satisfied with no voters at all.
    function freshPool(address workflowOwner_, bytes10 workflowName_) internal returns (CreRankedShares fresh) {
        fresh = new CreRankedShares(
            token,
            owner,
            DEADLINE,
            fxPk(),
            fxBytes32(".keySalt"),
            fxWord(".minDirectVote"),
            ABANDON_GRACE,
            forwarder,
            workflowOwner_,
            workflowName_
        );
        vm.startPrank(owner);
        fresh.addProject(1, recipient);
        fresh.openVoting();
        vm.stopPrank();
        token.mint(address(fresh), 1);
    }

    function test_zeroWorkflowOwnerDisablesTheCheck() public {
        CreRankedShares simPool = freshPool(address(0), bytes10(0));
        assertEq(simPool.workflowOwner(), address(0));
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        simPool.onReport("", abi.encode(uint8(2), abi.encode(uint256(5))));
        assertTrue(simPool.closed());
    }

    function test_zeroWorkflowNameAcceptsAnyNameFromTheRightOwner() public {
        CreRankedShares anyNamePool = freshPool(workflowAuthor, bytes10(0));
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        anyNamePool.onReport(
            metadata(workflowAuthor, bytes10(uint80(0xdead))), abi.encode(uint8(2), abi.encode(uint256(5)))
        );
        assertTrue(anyNamePool.closed());
    }
}
