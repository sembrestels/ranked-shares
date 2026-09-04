// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RankedShares} from "../src/RankedShares.sol";

/// @notice Deploys a RankedShares pool.
///
///   TOKEN=0x... OWNER=0x... VOTING_DEADLINE=<unix timestamp> \
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
contract Deploy is Script {
    function run() external returns (RankedShares pool) {
        IERC20 token = IERC20(vm.envAddress("TOKEN"));
        address owner = vm.envAddress("OWNER");
        uint64 votingDeadline = uint64(vm.envUint("VOTING_DEADLINE"));

        vm.startBroadcast();
        pool = new RankedShares(token, owner, votingDeadline);
        vm.stopBroadcast();

        console.log("RankedShares deployed at", address(pool));
    }
}
