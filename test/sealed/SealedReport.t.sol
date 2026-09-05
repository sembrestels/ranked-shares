// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {IPoseidon2} from "../../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockHonkVerifier} from "../mocks/MockHonkVerifier.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedReportTest is FixtureLoader {
    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
    }

    function resultReport(bytes32 root, uint256[] memory order, uint256[] memory transcript)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(uint8(1), abi.encode(root, order, transcript));
    }

    function fixtureTranscript() internal view returns (uint256[] memory flat) {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) {
                flat[s * width + w] = step[w];
            }
        }
    }

    function test_supportsReceiverInterface() public view {
        assertTrue(pool.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(pool.supportsInterface(type(IERC165).interfaceId));
        assertFalse(pool.supportsInterface(0xffffffff));
    }

    function test_onlyForwarder() public {
        vm.expectRevert(SealedRankedShares.NotForwarder.selector);
        pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(1))));
    }

    function test_unknownKind() public {
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.UnknownReport.selector);
        pool.onReport("", abi.encode(uint8(9), ""));
    }

    function test_kindTwoClosesInChunks() public {
        vm.warp(DEADLINE);
        vm.startPrank(forwarder);
        while (!pool.closed()) pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(3))));
        vm.stopPrank();
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"));
    }

    function test_kindTwoRequiresClosingPhase() public {
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        pool.onReport("", abi.encode(uint8(2), abi.encode(uint256(3))));
    }

    function test_resultAcceptedOnceWithMatchingRootAndTranscriptHash() public {
        closeAll(100);
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory transcript = fixtureTranscript();
        vm.prank(forwarder);
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.ProvisionalResult(order);
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.Transcript(transcript);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, transcript));
        assertTrue(pool.resultReported());
        assertEq(pool.transcriptHash(), fxWord(".transcriptHash"));
        assertEq(pool.provisionalResult().length, order.length);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.ResultAlreadyReported.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, transcript));
    }

    function test_resultRejectsWrongRoot() public {
        closeAll(100);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.onReport("", resultReport(bytes32(uint256(1)), fxUintArray(".funded"), fixtureTranscript()));
    }

    function test_resultRejectsBeforeClose() public {
        vm.warp(DEADLINE);
        vm.prank(forwarder);
        vm.expectRevert(WrongPhase.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), fxUintArray(".funded"), fixtureTranscript()));
    }

    function test_resultRejectsInvalidFundedList() public {
        closeAll(100);
        uint256[] memory order = new uint256[](2);
        order[0] = 0;
        order[1] = 0;
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidResult.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, fixtureTranscript()));
        order[1] = fxUint(".m");
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidResult.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, fixtureTranscript()));
    }

    function test_resultRejectsFundedOrderOverBudget() public {
        // The fixture's projects' costs never exceed its totalWeight even all funded, so
        // exercise the budget check on a small standalone pool sized to violate it.
        MockERC20 token2 = new MockERC20();
        Poseidon2 poseidon2 = new Poseidon2();
        MockHonkVerifier ingest2 = new MockHonkVerifier();
        MockHonkVerifier tally2 = new MockHonkVerifier();
        uint256[] memory pk = fxWords(".pk");
        SealedRankedShares.Config memory cfg = SealedRankedShares.Config({
            forwarder: forwarder,
            poseidon: IPoseidon2(address(poseidon2)),
            ingestVerifier: IHonkVerifier(address(ingest2)),
            tallyVerifier: IHonkVerifier(address(tally2)),
            tallierPkX: pk[0],
            tallierPkY: pk[1],
            keySalt: keccak256("budget-test"),
            nSealedMax: 1,
            mMax: 2,
            batch: 1,
            minDirectVote: 0,
            proofGrace: 1 days,
            abandonGrace: 7 days
        });
        SealedRankedShares small = new SealedRankedShares(token2, owner, DEADLINE, cfg);
        vm.startPrank(owner);
        small.addProject(100, recipient);
        small.addProject(100, recipient);
        small.openVoting();
        vm.stopPrank();
        token2.mint(org, 10);
        vm.startPrank(org);
        token2.approve(address(small), 10);
        small.contribute(10);
        vm.stopPrank();
        vm.warp(DEADLINE);
        while (!small.closed()) small.close(10);
        uint256[] memory order = new uint256[](2);
        order[0] = 0;
        order[1] = 1;
        uint256[] memory none = new uint256[](0);
        bytes32 root = small.inputsRoot();
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidResult.selector);
        small.onReport("", resultReport(root, order, none));
    }

    function test_resultRejectsMalformedTranscript() public {
        closeAll(100);
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory transcript = fixtureTranscript();
        uint256 width = fxUint(".m") + 3;
        // wrong length
        uint256[] memory cut = new uint256[](transcript.length - 1);
        for (uint256 i = 0; i < cut.length; i++) {
            cut[i] = transcript[i];
        }
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, cut));
        // funded order disagrees with the transcript
        uint256[] memory swapped = new uint256[](order.length);
        for (uint256 i = 0; i < order.length; i++) {
            swapped[i] = order[order.length - 1 - i];
        }
        if (order.length > 1) {
            vm.prank(forwarder);
            vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
            pool.onReport("", resultReport(fxBytes32(".inputsRoot"), swapped, transcript));
        }
        // best out of range
        uint256[] memory bad = transcript;
        bad[width - 2] = fxUint(".m") + 1;
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, bad));
        // too many steps
        uint256[] memory long_ = new uint256[]((2 * fxUint(".m") + 1) * width);
        for (uint256 i = 0; i < long_.length; i++) {
            long_[i] = (i % width == width - 2) ? pool.NONE() : 0;
        }
        uint256[] memory none = new uint256[](0);
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), none, long_));
    }

    function test_resultRejectsTranscriptWordOutsideField() public {
        closeAll(100);
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory transcript = fixtureTranscript();
        uint256 width = fxUint(".m") + 3;
        // step 0's `total` field set to the field modulus itself.
        transcript[width - 1] = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        vm.prank(forwarder);
        vm.expectRevert(SealedRankedShares.InvalidTranscript.selector);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), order, transcript));
    }

    function test_emptyTranscriptHashesToZero() public {
        closeAll(100);
        uint256[] memory none = new uint256[](0);
        vm.prank(forwarder);
        pool.onReport("", resultReport(fxBytes32(".inputsRoot"), none, none));
        assertTrue(pool.resultReported());
        assertEq(pool.transcriptHash(), 0);
    }
}
