// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZiskRankedShares} from "../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../src/zisk/IZiskVerifier.sol";

/// @notice Deploys a ZiskRankedShares pool against an already deployed verifier.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> \
///   TALLIER_PK=0x<33 bytes> KEY_SALT=0x<32 bytes> MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 \
///   VERIFIER=0x… PROGRAM_VK=0x<32 bytes> \
///   forge script script/DeployZisk.s.sol --rpc-url $RPC_URL --broadcast
///
/// `TALLIER_PK` comes from `tally-prover keys --salt $KEY_SALT` (the operator's master
/// secret in `TALLIER_MASTER`); `PROGRAM_VK` from `zisk/fixtures/main-calldata.json` or
/// any export of a proof of the current guest. `rootC` is read from the verifier itself.
contract DeployZisk is Script {
    function run() external returns (ZiskRankedShares pool) {
        ZiskVerifier verifier = ZiskVerifier(vm.envAddress("VERIFIER"));
        bytes32 rootC = verifier.getRootCVadcopFinal();
        vm.startBroadcast();
        pool = new ZiskRankedShares(
            IERC20(vm.envAddress("TOKEN")),
            vm.envAddress("OWNER"),
            uint64(vm.envUint("VOTING_DEADLINE")),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            vm.envUint("MIN_DIRECT_VOTE"),
            uint64(vm.envUint("ABANDON_GRACE")),
            IZiskVerifier(address(verifier)),
            vm.envBytes32("PROGRAM_VK"),
            rootC
        );
        vm.stopBroadcast();
        console.log("ZiskRankedShares deployed at", address(pool));
        console.log("rootC (from verifier):");
        console.logBytes32(rootC);
    }
}
