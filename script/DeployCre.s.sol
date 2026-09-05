// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreRankedShares} from "../src/cre/CreRankedShares.sol";

/// @notice Deploys a CreRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> \
///   TALLIER_PK=0x<33 bytes> KEY_SALT=0x<32 bytes> MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 \
///   FORWARDER=0x… \
///   forge script script/DeployCre.s.sol --rpc-url $RPC_URL --broadcast
///
/// The CRE forwarder on Arc testnet is 0x76c9cf548b4179F8901cda1f8623568b58215E62.
contract DeployCre is Script {
    function run() external returns (CreRankedShares pool) {
        vm.startBroadcast();
        pool = new CreRankedShares(
            IERC20(vm.envAddress("TOKEN")),
            vm.envAddress("OWNER"),
            uint64(vm.envUint("VOTING_DEADLINE")),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            vm.envUint("MIN_DIRECT_VOTE"),
            uint64(vm.envUint("ABANDON_GRACE")),
            vm.envAddress("FORWARDER")
        );
        vm.stopBroadcast();
        console.log("CreRankedShares deployed at", address(pool));
    }
}
