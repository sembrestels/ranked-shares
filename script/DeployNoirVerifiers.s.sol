// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IngestVerifier} from "../src/noir/verifiers/IngestVerifier.sol";
import {TallyVerifier} from "../src/noir/verifiers/TallyVerifier.sol";

/// @notice Deploys the default-profile Honk verifiers once per chain.
///   forge script script/DeployNoirVerifiers.s.sol --rpc-url $RPC_URL --broadcast
/// Pass the two addresses to DeployNoir as INGEST_VERIFIER and TALLY_VERIFIER.
contract DeployNoirVerifiers is Script {
    function run() external returns (IngestVerifier ingest, TallyVerifier tally) {
        vm.startBroadcast();
        ingest = new IngestVerifier();
        tally = new TallyVerifier();
        vm.stopBroadcast();
        console.log("IngestVerifier deployed at", address(ingest));
        console.log("TallyVerifier deployed at", address(tally));
    }
}
