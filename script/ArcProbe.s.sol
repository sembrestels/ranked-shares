// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {VerifierProbe} from "../src/zisk/VerifierProbe.sol";

/// @notice Writes the creation bytecode of a VerifierProbe for the committed proof to
///         zisk/proofs/arc-probe.hex; zisk/scripts/arc-probe.sh sends it with
///         `cast call --create`. Runs locally, no RPC, no broadcast.
contract ArcProbe is Script {
    using stdJson for string;

    function run() external {
        string memory json = vm.readFile("zisk/fixtures/main-calldata.json");
        bytes memory initcode = abi.encodePacked(
            type(VerifierProbe).creationCode,
            abi.encode(
                json.readBytes32(".programVK"),
                json.readBytes32(".rootCVadcopFinal"),
                json.readBytes(".publicValues"),
                json.readBytes(".proofBytes")
            )
        );
        vm.writeFile("zisk/proofs/arc-probe.hex", vm.toString(initcode));
        console.log("initcode bytes:", initcode.length);
    }
}
