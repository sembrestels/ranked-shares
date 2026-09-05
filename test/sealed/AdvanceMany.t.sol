// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev `advanceMany` against mock verifiers: the batching, the restart rule and the
///      atomicity, with the fixture's public inputs standing in for real proofs.
///      `test/verifiers/RealProofs.t.sol` runs the same shapes against the generated
///      verifiers and real proof bytes.
contract AdvanceManyTest is FixtureLoader {
    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
    }

    // ---- batch builders ----

    /// @dev `n` empty proofs, one per element: the mock verifier accepts any bytes, so the
    ///      public inputs are what the pool is actually judged on here.
    function emptyProofs(uint256 n) internal pure returns (bytes[] memory proofs) {
        proofs = new bytes[](n);
    }

    function ingestBatch() internal view returns (bytes[] memory proofs, bytes32[][] memory pis) {
        uint256 n = fxCount(".ingestProofs");
        proofs = emptyProofs(n);
        pis = new bytes32[][](n);
        for (uint256 k = 0; k < n; k++) {
            pis[k] = ingestInputs(k);
        }
    }

    function tallyBatch() internal view returns (bytes[] memory proofs, bytes32[][] memory pis) {
        uint256 n = fxCount(".tallyProofs");
        proofs = emptyProofs(n);
        pis = new bytes32[][](n);
        for (uint256 g = 0; g < n; g++) {
            pis[g] = tallyInputs(g);
        }
    }

    function wholeChain() internal view returns (bytes[] memory proofs, bytes32[][] memory pis) {
        uint256 nI = fxCount(".ingestProofs");
        uint256 nT = fxCount(".tallyProofs");
        proofs = emptyProofs(nI + nT);
        pis = new bytes32[][](nI + nT);
        for (uint256 k = 0; k < nI; k++) {
            pis[k] = ingestInputs(k);
        }
        for (uint256 g = 0; g < nT; g++) {
            pis[nI + g] = tallyInputs(g);
        }
    }

    function assertFundedMatchesFixture() internal view {
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length, "funded length");
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i], "funded order");
        }
    }

    // ---- the happy path ----

    function test_wholeChainInOneCall() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        pool.advanceMany(proofs, pis, false);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
        assertEq(pool.ingestCursor(), fxCount(".ingestProofs"));
        assertFundedMatchesFixture();
    }

    /// @dev A batch is only a cheaper way to send what `advance` would: the same events, in
    ///      the same order, one `Ingested` per batch and one `Advanced` per tally group.
    function test_batchEmitsTheSameEventsAsOneAdvanceEach() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            vm.expectEmit(false, false, false, true);
            emit SealedRankedShares.Ingested(k);
        }
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 g = 0; g < nT; g++) {
            vm.expectEmit(false, false, false, false);
            emit SealedRankedShares.Advanced();
        }
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.Finalized(SealedRankedShares.Finality.Proven, fxUintArray(".funded"));
        pool.advanceMany(proofs, pis, false);
    }

    function test_batchOfIngestOnlyLeavesTheTallyForLater() public {
        (bytes[] memory proofs, bytes32[][] memory pis) = ingestBatch();
        pool.advanceMany(proofs, pis, false);
        uint256 nI = fxCount(".ingestProofs");
        assertEq(pool.ingestCursor(), nI);
        assertEq(pool.ingestedState(), uint256(ingestInputs(nI - 1)[9]));
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
        report();
        (bytes[] memory tProofs, bytes32[][] memory tPis) = tallyBatch();
        pool.advanceMany(tProofs, tPis, false);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    /// @dev Forward batches stay permissionless, exactly as `advance` does.
    function test_forwardBatchFromAStranger() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        vm.prank(makeAddr("stranger"));
        pool.advanceMany(proofs, pis, false);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    // ---- restart ----

    /// @dev `restart` reaches only the first tally proof of the batch: it rewinds
    ///      `stateCommit` to `ingestedState` once, and the groups after it chain forward
    ///      from there as usual.
    function test_restartAppliesToTheFirstTallyProofOnly() public {
        (bytes[] memory iProofs, bytes32[][] memory iPis) = ingestBatch();
        pool.advanceMany(iProofs, iPis, false);
        report();
        pool.advance("", tallyInputs(0), false);
        assertNotEq(pool.stateCommit(), pool.ingestedState());
        (bytes[] memory proofs, bytes32[][] memory pis) = tallyBatch();
        vm.expectEmit(false, false, false, false);
        emit SealedRankedShares.TallyRestarted();
        vm.prank(coordinator);
        pool.advanceMany(proofs, pis, true);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
        assertFundedMatchesFixture();
    }

    function test_restartingBatchFromANonCoordinatorReverts() public {
        (bytes[] memory iProofs, bytes32[][] memory iPis) = ingestBatch();
        pool.advanceMany(iProofs, iPis, false);
        report();
        pool.advance("", tallyInputs(0), false);
        uint256 before = pool.stateCommit();
        (bytes[] memory proofs, bytes32[][] memory pis) = tallyBatch();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(SealedRankedShares.NotCoordinator.selector);
        pool.advanceMany(proofs, pis, true);
        assertEq(pool.stateCommit(), before);
    }

    /// @dev A batch that starts with pending ingest never applies `restart`, so the
    ///      coordinator gate is never reached: an ingest-only batch with `restart: true`
    ///      from a stranger is a plain forward run, as `advance` treats the same call.
    function test_restartIsNeverAppliedToAnIngestProof() public {
        (bytes[] memory proofs, bytes32[][] memory pis) = ingestBatch();
        vm.prank(makeAddr("stranger"));
        pool.advanceMany(proofs, pis, true);
        uint256 nI = fxCount(".ingestProofs");
        assertEq(pool.ingestCursor(), nI);
        assertEq(pool.stateCommit(), uint256(ingestInputs(nI - 1)[9]));
    }

    /// @dev A whole-chain batch with `restart: true` from the coordinator: the rewind lands
    ///      on the first tally proof, where `ingestedState` is the state the ingest half of
    ///      this very batch just produced, so it is a no-op and the chain still proves.
    function test_restartOnAWholeChainBatchIsANoOp() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        vm.prank(coordinator);
        pool.advanceMany(proofs, pis, true);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    // ---- rejections ----

    function test_lengthMismatchReverts() public {
        (bytes[] memory proofs, bytes32[][] memory pis) = ingestBatch();
        bytes[] memory shortProofs = new bytes[](proofs.length - 1);
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advanceMany(shortProofs, pis, false);
    }

    function test_emptyBatchReverts() public {
        vm.expectRevert(SealedRankedShares.EmptyBatch.selector);
        pool.advanceMany(new bytes[](0), new bytes32[][](0), false);
    }

    /// @dev Atomicity: a bad element rolls the whole batch back, including the elements
    ///      before it that would each have been accepted on their own.
    function test_aBadElementRevertsTheWholeBatch() public {
        (bytes[] memory proofs, bytes32[][] memory pis) = ingestBatch();
        pis[1][8] = bytes32(uint256(pis[1][8]) + 1); // stateIn no longer chains
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advanceMany(proofs, pis, false);
        assertEq(pool.ingestCursor(), 0, "no batch landed");
        assertEq(pool.stateCommit(), 0, "state untouched");
    }

    function test_aRejectedProofRevertsTheWholeBatch() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        tallyVerifier.setAccept(false);
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advanceMany(proofs, pis, false);
        assertEq(pool.ingestCursor(), 0, "the ingest half rolled back too");
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
    }

    /// @dev The finalising `done` proof moves the pool to `Done` mid-loop; `inPhase` only
    ///      saw the phase the call started in, so the loop itself has to refuse the tail.
    function test_aProofAfterTheFinalisingOneReverts() public {
        report();
        (bytes[] memory chainProofs, bytes32[][] memory chainPis) = wholeChain();
        uint256 n = chainProofs.length;
        bytes[] memory proofs = new bytes[](n + 1);
        bytes32[][] memory pis = new bytes32[][](n + 1);
        for (uint256 i = 0; i < n; i++) {
            proofs[i] = chainProofs[i];
            pis[i] = chainPis[i];
        }
        proofs[n] = "";
        pis[n] = tallyInputs(0);
        vm.expectRevert(WrongPhase.selector);
        pool.advanceMany(proofs, pis, false);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None), "the whole batch rolled back");
    }

    function test_batchRejectedOnceDone() public {
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        pool.advanceMany(proofs, pis, false);
        (bytes[] memory again, bytes32[][] memory againPis) = tallyBatch();
        vm.expectRevert(WrongPhase.selector);
        pool.advanceMany(again, againPis, false);
    }

    function test_batchNeedsTheReportBeforeTheTally() public {
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChain();
        vm.expectRevert(SealedRankedShares.TranscriptPending.selector);
        pool.advanceMany(proofs, pis, false);
        assertEq(pool.ingestCursor(), 0);
    }
}
