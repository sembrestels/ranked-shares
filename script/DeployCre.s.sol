// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreRankedShares} from "../src/cre/CreRankedShares.sol";

/// @notice Deploys a CreRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> \
///   TALLIER_PK=0x<33 bytes> KEY_SALT=0x<32 bytes> MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 \
///   FORWARDER=0x… WORKFLOW_OWNER=0x… WORKFLOW_NAME=ranked-shares-tally \
///   forge script script/DeployCre.s.sol --rpc-url $RPC_URL --broadcast
///
/// The CRE forwarder on Arc testnet is 0x76c9cf548b4179F8901cda1f8623568b58215E62.
///
/// WORKFLOW_OWNER and WORKFLOW_NAME authorize `onReport`'s `metadata` against the
/// workflow that is allowed to deliver reports; the KeystoneForwarder is a per-chain
/// singleton shared by every workflow, so leaving WORKFLOW_OWNER unset (address(0))
/// disables that check and must never be used for a pool holding real funds.
/// WORKFLOW_NAME may be left empty to accept any name from WORKFLOW_OWNER.
contract DeployCre is Script {
    function run() external returns (CreRankedShares pool) {
        address workflowOwner = vm.envOr("WORKFLOW_OWNER", address(0));
        string memory workflowNameStr = vm.envOr("WORKFLOW_NAME", string(""));
        bytes10 workflowName = bytes(workflowNameStr).length == 0 ? bytes10(0) : _workflowNameOf(workflowNameStr);

        if (workflowOwner == address(0)) {
            console.log(
                "WARNING: WORKFLOW_OWNER unset; onReport accepts a report from any workflow reaching the forwarder. Do not deploy this pool for real funds."
            );
        }

        vm.startBroadcast();
        pool = new CreRankedShares(
            IERC20(vm.envAddress("TOKEN")),
            vm.envAddress("OWNER"),
            uint64(vm.envUint("VOTING_DEADLINE")),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            vm.envUint("MIN_DIRECT_VOTE"),
            uint64(vm.envUint("ABANDON_GRACE")),
            vm.envAddress("FORWARDER"),
            workflowOwner,
            workflowName
        );
        vm.stopBroadcast();
        console.log("CreRankedShares deployed at", address(pool));
    }

    /// @dev Mirrors `CreRankedShares.workflowNameOf`; computed here (rather than called
    ///      on the deployed pool) to avoid a chicken-and-egg with the constructor.
    function _workflowNameOf(string memory name) internal pure returns (bytes10) {
        bytes32 digest = sha256(bytes(name));
        bytes memory hexAlphabet = "0123456789abcdef";
        bytes memory out = new bytes(10);
        for (uint256 i = 0; i < 5; i++) {
            uint8 b = uint8(digest[i]);
            out[2 * i] = hexAlphabet[b >> 4];
            out[2 * i + 1] = hexAlphabet[b & 0x0f];
        }
        return bytes10(out);
    }
}
