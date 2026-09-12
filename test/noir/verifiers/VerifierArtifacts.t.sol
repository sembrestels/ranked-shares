// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {IngestVerifierTest} from "./IngestVerifierTest.sol";
import {TallyVerifierTest} from "./TallyVerifierTest.sol";

// Build the generated verifier artifacts separately from the IR-compiled pool.
contract VerifierArtifactsTest is Test {
    function test_poseidonArtifactRemainsDeployable() public view {
        assertLt(vm.getDeployedCode("Poseidon2.sol:Poseidon2").length, 24576);
    }

    function test_verifiersRemainDeployable() public {
        assertLt(address(new IngestVerifierTest()).code.length, 24576);
        assertLt(address(new TallyVerifierTest()).code.length, 24576);
    }
}
