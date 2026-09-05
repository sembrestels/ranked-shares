// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {IngestVerifierTest} from "./IngestVerifierTest.sol";
import {TallyVerifierTest} from "./TallyVerifierTest.sol";
import {FixtureLoader} from "../sealed/FixtureLoader.sol";

/// @dev The whole chain with the generated Honk verifiers and proofs made by bb from
///      the fixture witnesses: the strongest evidence the circuits, the Python
///      reference and the contract agree.
contract RealProofsTest is FixtureLoader {
    function makeVerifiers() internal override returns (IHonkVerifier, IHonkVerifier) {
        return (IHonkVerifier(address(new IngestVerifierTest())), IHonkVerifier(address(new TallyVerifierTest())));
    }

    function loadProof(string memory fixture, string memory kind, uint256 i)
        internal
        view
        returns (bytes memory proof, bytes32[] memory inputs)
    {
        string memory base = string.concat("noir/proofs/", fixture, "/", kind, "-", vm.toString(i));
        proof = vm.readFileBinary(string.concat(base, ".proof"));
        bytes memory raw = vm.readFileBinary(string.concat(base, ".pub"));
        inputs = new bytes32[](raw.length / 32);
        for (uint256 w = 0; w < inputs.length; w++) {
            bytes32 word;
            assembly {
                word := mload(add(add(raw, 32), mul(w, 32)))
            }
            inputs[w] = word;
        }
    }

    function runFixture(string memory name) internal {
        loadFixture(name);
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            (bytes memory proof, bytes32[] memory inputs) = loadProof(name, "ingest", k);
            assertEq(inputs.length, 10, "ingest public inputs");
            uint256 g = gasleft();
            pool.advance(proof, inputs, false);
            emit log_named_uint(string.concat(name, " ingest advance gas"), g - gasleft());
        }
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 j = 0; j < nT; j++) {
            (bytes memory proof, bytes32[] memory inputs) = loadProof(name, "tally", j);
            assertEq(inputs.length, 7, "tally public inputs");
            uint256 g = gasleft();
            pool.advance(proof, inputs, false);
            emit log_named_uint(string.concat(name, " tally advance gas"), g - gasleft());
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven with real proofs");
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length);
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i]);
        }
    }

    function test_realProofs_testMain() public {
        runFixture("test_main");
    }

    function test_realProofs_restartByCoordinatorWithRealProof() public {
        // Apply tally group 0 twice: forward, then again as a coordinator restart from the
        // ingested state. The chain must end Proven either way.
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            (bytes memory p, bytes32[] memory pi) = loadProof("test_main", "ingest", k);
            pool.advance(p, pi, false);
        }
        (bytes memory p0, bytes32[] memory pi0) = loadProof("test_main", "tally", 0);
        pool.advance(p0, pi0, false);
        vm.prank(coordinator);
        pool.advance(p0, pi0, true);
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 j = 1; j < nT; j++) {
            (bytes memory p, bytes32[] memory pi) = loadProof("test_main", "tally", j);
            pool.advance(p, pi, false);
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    /// @dev The whole `test_main` chain as a single `advanceMany`. The gas comparison with
    ///      six `advance` calls is not made here: `gasleft()` in a test frame that has just
    ///      replayed a fixture is dominated by warming and memory artefacts, and it cannot
    ///      see the per-transaction intrinsic and calldata costs that are the whole point of
    ///      batching. `forge test --gas-report` measures the call frames, and
    ///      prover/test/e2e.test.ts measures real receipts on anvil; both are in the README.
    ///      What is logged here is the one thing that is exact either way: the calldata a
    ///      sender pays for on each route.
    function test_realProofs_wholeChainInOneAdvanceMany() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        (bytes[] memory proofs, bytes32[][] memory pis) = wholeChainProofs("test_main");
        uint256 callBytes;
        for (uint256 i = 0; i < proofs.length; i++) {
            callBytes += abi.encodeCall(SealedRankedShares.advance, (proofs[i], pis[i], false)).length;
        }
        emit log_named_uint("test_main advanceMany calldata bytes", abi.encodeCall(SealedRankedShares.advanceMany, (proofs, pis, false)).length);
        emit log_named_uint("test_main 6x advance calldata bytes", callBytes);

        pool.advanceMany(proofs, pis, false);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven from one advanceMany");
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length);
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i]);
        }
    }

    /// @dev A mixed run: the ingest half and one tally group land one `advance` at a time,
    ///      then the coordinator batches the whole tally chain with `restart`, which rewinds
    ///      to `ingestedState` so group 0 applies a second time.
    function test_realProofs_restartingBatchFromTheCoordinator() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        landIngestAndFirstGroup();
        (bytes[] memory proofs, bytes32[][] memory pis) = tallyProofs("test_main");
        vm.prank(coordinator);
        pool.advanceMany(proofs, pis, true);
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven after a restarting batch");
    }

    function test_realProofs_restartingBatchFromAStrangerReverts() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        landIngestAndFirstGroup();
        uint256 before = pool.stateCommit();
        (bytes[] memory proofs, bytes32[][] memory pis) = tallyProofs("test_main");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(SealedRankedShares.NotCoordinator.selector);
        pool.advanceMany(proofs, pis, true);
        assertEq(pool.stateCommit(), before);
    }

    /// @dev Every ingest batch and tally group 0, one `advance` each.
    function landIngestAndFirstGroup() internal {
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            (bytes memory p, bytes32[] memory pi) = loadProof("test_main", "ingest", k);
            pool.advance(p, pi, false);
        }
        (bytes memory p0, bytes32[] memory pi0) = loadProof("test_main", "tally", 0);
        pool.advance(p0, pi0, false);
    }

    function tallyProofs(string memory name) internal view returns (bytes[] memory proofs, bytes32[][] memory pis) {
        uint256 nT = fxCount(".tallyProofs");
        proofs = new bytes[](nT);
        pis = new bytes32[][](nT);
        for (uint256 j = 0; j < nT; j++) {
            (proofs[j], pis[j]) = loadProof(name, "tally", j);
        }
    }

    function wholeChainProofs(string memory name) internal view returns (bytes[] memory proofs, bytes32[][] memory pis) {
        uint256 nI = fxCount(".ingestProofs");
        uint256 nT = fxCount(".tallyProofs");
        proofs = new bytes[](nI + nT);
        pis = new bytes32[][](nI + nT);
        for (uint256 k = 0; k < nI; k++) {
            (proofs[k], pis[k]) = loadProof(name, "ingest", k);
        }
        for (uint256 j = 0; j < nT; j++) {
            (proofs[nI + j], pis[nI + j]) = loadProof(name, "tally", j);
        }
    }

    function test_realProofs_testSmallm() public {
        runFixture("test_smallm");
    }

    function test_realProofs_testNosealed() public {
        runFixture("test_nosealed");
    }

    function test_tamperedProofReverts() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        (bytes memory proof, bytes32[] memory inputs) = loadProof("test_main", "ingest", 0);
        proof[100] ^= 0x01;
        // The generated verifier reverts with its own error; advance wraps that into InvalidProof.
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance(proof, inputs, false);
    }

    function test_profileIdMatchesTheTestProfile() public {
        loadFixture("test_main");
        deployFromFixture();
        assertEq(pool.profileId(), keccak256(abi.encode(uint256(8), uint256(4), uint256(2))));
    }

    function test_proofForOtherBatchRejected() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        (bytes memory proof, bytes32[] memory inputs) = loadProof("test_main", "ingest", 1);
        vm.expectRevert(SealedRankedShares.ProofOutOfOrder.selector);
        pool.advance(proof, inputs, false);
    }
}
