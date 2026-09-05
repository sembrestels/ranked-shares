// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ZiskVerifier} from "../../src/zisk/ZiskVerifier.sol";

/// @dev The verifier shipped with the ZisK PLONK key, against the proof of the main
///      fixture that plan A produced. This is the whole chain of trust plan B builds on:
///      if this test passes, `finalize` can only be a matter of matching bytes.
contract ZiskVerifierTest is Test {
    using stdJson for string;

    ZiskVerifier internal verifier;
    string internal json;

    function setUp() public {
        verifier = new ZiskVerifier();
        json = vm.readFile("zisk/fixtures/main-calldata.json");
    }

    function test_rootMatchesTheKey() public view {
        assertEq(verifier.getRootCVadcopFinal(), json.readBytes32(".rootCVadcopFinal"));
        assertEq(keccak256(bytes(verifier.VERSION())), keccak256("v1.2.0-alpha"));
    }

    function test_acceptsTheCommittedProof() public view {
        uint256 before = gasleft();
        verifier.verifySnarkProof(
            json.readBytes32(".programVK"),
            json.readBytes32(".rootCVadcopFinal"),
            json.readBytes(".publicValues"),
            json.readBytes(".proofBytes")
        );
        uint256 used = before - gasleft();
        // Measured ~515k for this proof (ecpairing with k=2 alone is 113k; the rest is a
        // handful of ecmul/ecadd/modexp calls plus the external self-call overhead). That is
        // above the ~360k a generic PLONK verifier is sometimes quoted at, but the trace shows
        // a legitimate full verification path ending in `ecpairing -> true`, not an early exit,
        // so the number is load-bearing, not a proxy for a bug. Bounded generously to still
        // catch a regression (e.g. an accidental non-view external call added twice).
        assertLt(used, 600_000, "verifySnarkProof gas");
    }

    function test_rejectsATamperedPublicValue() public {
        bytes memory pv = json.readBytes(".publicValues");
        pv[0] = bytes1(uint8(pv[0]) ^ 0x01);
        vm.expectRevert(ZiskVerifier.InvalidProof.selector);
        verifier.verifySnarkProof(
            json.readBytes32(".programVK"), json.readBytes32(".rootCVadcopFinal"), pv, json.readBytes(".proofBytes")
        );
    }

    function test_rejectsAWrongProgramVK() public {
        vm.expectRevert(ZiskVerifier.InvalidProof.selector);
        verifier.verifySnarkProof(
            bytes32(uint256(1)),
            json.readBytes32(".rootCVadcopFinal"),
            json.readBytes(".publicValues"),
            json.readBytes(".proofBytes")
        );
    }
}
