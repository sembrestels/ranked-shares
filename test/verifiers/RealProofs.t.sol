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
