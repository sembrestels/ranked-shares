// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WrongPhase, AlreadyClaimed, NotFunded} from "../../src/PoolBase.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

contract SealedAdvanceTest is FixtureLoader {
    string constant INGEST_KEYS = "k,nSealed,m,budget,pkX,pkY,hIn,hOut,stateIn,stateOut";
    string constant TALLY_KEYS = "costsHash,stateIn,stateOut,done,tHashOut,fundedCount,fundedOrderPacked";

    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
    }

    function report() internal {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) {
                flat[s * width + w] = step[w];
            }
        }
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat)));
    }

    function ingestInputs(uint256 k) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".ingestProofs[", vm.toString(k), "].");
        out = new bytes32[](10);
        out[0] = bytes32(fxUint(string.concat(p, "k")));
        out[1] = bytes32(fxUint(string.concat(p, "nSealed")));
        out[2] = bytes32(fxUint(string.concat(p, "m")));
        out[3] = fxBytes32(string.concat(p, "budget"));
        out[4] = fxBytes32(string.concat(p, "pkX"));
        out[5] = fxBytes32(string.concat(p, "pkY"));
        out[6] = fxBytes32(string.concat(p, "hIn"));
        out[7] = fxBytes32(string.concat(p, "hOut"));
        out[8] = fxBytes32(string.concat(p, "stateIn"));
        out[9] = fxBytes32(string.concat(p, "stateOut"));
    }

    function tallyInputs(uint256 g) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".tallyProofs[", vm.toString(g), "].");
        out = new bytes32[](7);
        out[0] = fxBytes32(string.concat(p, "costsHash"));
        out[1] = fxBytes32(string.concat(p, "stateIn"));
        out[2] = fxBytes32(string.concat(p, "stateOut"));
        out[3] = bytes32(fxUint(string.concat(p, "done")));
        out[4] = fxBytes32(string.concat(p, "tHashOut"));
        out[5] = bytes32(fxUint(string.concat(p, "fundedCount")));
        out[6] = fxBytes32(string.concat(p, "fundedOrderPacked"));
    }

    function ingestAll() internal {
        uint256 n = fxCount(".ingestProofs");
        for (uint256 k = 0; k < n; k++) {
            pool.advance("", ingestInputs(k));
        }
        assertEq(pool.ingestCursor(), n);
        assertEq(pool.ingestedState(), uint256(ingestInputs(n - 1)[9]));
    }

    function tallyAll() internal {
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g < n; g++) {
            pool.advance("", tallyInputs(g));
        }
    }

    // ---- ingest ----

    function test_ingestChainFollowsCheckpoints() public {
        uint256 n = fxCount(".ingestProofs");
        assertGt(n, 1);
        for (uint256 k = 0; k < n; k++) {
            vm.expectEmit(false, false, false, true);
            emit SealedRankedShares.Ingested(k);
            pool.advance("", ingestInputs(k));
            assertEq(pool.stateCommit(), uint256(ingestInputs(k)[9]));
        }
    }

    function test_ingestRejectsOutOfOrderAndTampered() public {
        bytes32[] memory second = ingestInputs(1);
        vm.expectRevert(SealedRankedShares.ProofOutOfOrder.selector);
        pool.advance("", second);
        bytes32[] memory first = ingestInputs(0);
        first[7] = bytes32(uint256(first[7]) + 1); // hOut
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        first = ingestInputs(0);
        first[4] = bytes32(uint256(first[4]) + 1); // pkX
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        first = ingestInputs(0);
        first[8] = bytes32(uint256(1)); // stateIn must be zero for batch 0
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", first);
        bytes32[] memory short_ = new bytes32[](9);
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", short_);
    }

    function test_ingestRejectsWhenVerifierRejects() public {
        ingestVerifier.setAccept(false);
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance("", ingestInputs(0));
    }

    // ---- tally ----

    function test_tallyRequiresIngestAndReport() public {
        bytes32[] memory t0 = tallyInputs(0);
        // With ingest pending the inputs are read as an ingest proof and rejected.
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        ingestAll();
        vm.expectRevert(SealedRankedShares.TranscriptPending.selector);
        pool.advance("", t0);
    }

    function test_tallyChainFinalizes() public {
        ingestAll();
        report();
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g + 1 < n; g++) {
            pool.advance("", tallyInputs(g));
            assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.None));
        }
        uint256[] memory order = fxUintArray(".funded");
        vm.expectEmit(false, false, false, true);
        emit SealedRankedShares.Finalized(SealedRankedShares.Finality.Proven, order);
        pool.advance("", tallyInputs(n - 1));
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
        assertEq(uint256(pool.phase()), uint256(SealedRankedShares.Phase.Done));
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length);
        uint256 expectedSpent;
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i]);
            assertTrue(pool.funded(order[i]));
            expectedSpent += pool.cost(order[i]);
        }
        assertEq(pool.spent(), expectedSpent);
    }

    function test_tallyRejectsTamperedInputs() public {
        ingestAll();
        report();
        bytes32[] memory t0 = tallyInputs(0);
        t0[0] = bytes32(uint256(t0[0]) + 1); // costsHash
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        t0 = tallyInputs(0);
        t0[1] = bytes32(uint256(t0[1]) + 1); // stateIn
        vm.expectRevert(SealedRankedShares.InputMismatch.selector);
        pool.advance("", t0);
        tallyVerifier.setAccept(false);
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance("", tallyInputs(0));
    }

    function test_finalProofChecksTranscriptHashAndResult() public {
        ingestAll();
        report();
        uint256 n = fxCount(".tallyProofs");
        for (uint256 g = 0; g + 1 < n; g++) {
            pool.advance("", tallyInputs(g));
        }
        bytes32[] memory last = tallyInputs(n - 1);
        last[4] = bytes32(uint256(last[4]) + 1); // tHashOut
        vm.expectRevert(SealedRankedShares.TranscriptMismatch.selector);
        pool.advance("", last);
        last = tallyInputs(n - 1);
        last[5] = bytes32(uint256(last[5]) + 1); // fundedCount
        vm.expectRevert(SealedRankedShares.ResultMismatch.selector);
        pool.advance("", last);
    }

    function test_restartTallyResetsToIngestedState() public {
        vm.expectRevert(SealedRankedShares.IngestPending.selector);
        pool.restartTally();
        ingestAll();
        report();
        pool.advance("", tallyInputs(0));
        assertNotEq(pool.stateCommit(), pool.ingestedState());
        vm.expectEmit(false, false, false, false);
        emit SealedRankedShares.TallyRestarted();
        pool.restartTally();
        assertEq(pool.stateCommit(), pool.ingestedState());
        tallyAll();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    function test_advanceRejectedOnceDone() public {
        ingestAll();
        report();
        tallyAll();
        vm.expectRevert(WrongPhase.selector);
        pool.advance("", tallyInputs(0));
    }

    // ---- grace paths ----

    function test_acceptProvisionalAfterGrace() public {
        report();
        vm.expectRevert(SealedRankedShares.ProofPending.selector);
        pool.acceptProvisional();
        vm.warp(DEADLINE + 1 days);
        pool.acceptProvisional();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Attested));
        assertEq(pool.fundedProjects().length, fxUintArray(".funded").length);
    }

    function test_acceptProvisionalNeedsAReport() public {
        vm.warp(DEADLINE + 1 days);
        vm.expectRevert(SealedRankedShares.ResultPending.selector);
        pool.acceptProvisional();
    }

    function test_abandonAfterGraceWithoutReport() public {
        vm.warp(DEADLINE + 7 days - 1);
        vm.expectRevert(SealedRankedShares.ResultPending.selector);
        pool.abandon();
        vm.warp(DEADLINE + 7 days);
        pool.abandon();
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Abandoned));
        assertEq(pool.fundedProjects().length, 0);
        assertEq(pool.spent(), 0);
    }

    function test_abandonRefusedWhenReported() public {
        report();
        vm.warp(DEADLINE + 7 days);
        vm.expectRevert(SealedRankedShares.ResultAlreadyReported.selector);
        pool.abandon();
    }

    function test_claimsAndSweepAfterProof() public {
        ingestAll();
        report();
        tallyAll();
        uint256[] memory order = fxUintArray(".funded");
        uint256 before = token.balanceOf(recipient);
        pool.claim(order[0]);
        assertEq(token.balanceOf(recipient) - before, pool.cost(order[0]));
        vm.expectRevert(AlreadyClaimed.selector);
        pool.claim(order[0]);
        uint256 unfunded;
        for (uint256 id = 0; id < pool.projectCount(); id++) {
            if (!pool.funded(id)) {
                unfunded = id;
                break;
            }
        }
        if (order.length < pool.projectCount()) {
            vm.expectRevert(NotFunded.selector);
            pool.claim(unfunded);
        }
        address treasury = makeAddr("treasury");
        vm.prank(owner);
        pool.sweep(treasury);
        assertEq(token.balanceOf(address(pool)), pool.spent() - pool.claimedTotal());
    }
}
