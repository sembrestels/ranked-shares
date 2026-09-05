// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";

/// @notice Deploys the ZisK PLONK verifier once per chain.
///
///   forge script script/DeployZiskVerifier.s.sol --rpc-url $RPC_URL --broadcast
///
/// The verifier is tied to the PLONK key it was generated with (`getRootCVadcopFinal`);
/// a new ZisK release means a new verifier and new pools.
contract DeployZiskVerifier is Script {
    function run() external returns (ZiskVerifier verifier) {
        vm.startBroadcast();
        verifier = new ZiskVerifier();
        vm.stopBroadcast();
        console.log("ZiskVerifier deployed at", address(verifier));
        console.log("VERSION:", verifier.VERSION());
        console.log("rootCVadcopFinal:");
        console.logBytes32(verifier.getRootCVadcopFinal());
    }
}
