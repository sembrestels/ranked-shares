// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedRankedShares} from "../src/SealedRankedShares.sol";
import {IPoseidon2} from "../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../src/lib/Poseidon2.sol";
import {MockHonkVerifier} from "../test/mocks/MockHonkVerifier.sol";

/// @notice Deploys a SealedRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> FORWARDER=0x… COORDINATOR=0x… \
///   TALLIER_PK_X=<uint> TALLIER_PK_Y=<uint> KEY_SALT=0x<32 bytes> \
///   N_SEALED_MAX=256 M_MAX=16 BATCH=32 MIN_DIRECT_VOTE=10000000 \
///   PROOF_GRACE=86400 ABANDON_GRACE=604800 \
///   [POSEIDON=0x…] [INGEST_VERIFIER=0x…] [TALLY_VERIFIER=0x…] \
///   forge script script/DeploySealed.s.sol --rpc-url $RPC_URL --broadcast
///
/// Unset POSEIDON deploys a fresh Poseidon2. Unset verifiers deploy MockHonkVerifiers
/// that accept every proof: fine for a demo of the DON path, never for a pool whose
/// `Proven` finality is meant to mean anything.
contract DeploySealed is Script {
    function run() external returns (SealedRankedShares pool) {
        SealedRankedShares.Config memory cfg;
        cfg.forwarder = vm.envAddress("FORWARDER");
        cfg.coordinator = vm.envAddress("COORDINATOR");
        cfg.tallierPkX = vm.envUint("TALLIER_PK_X");
        cfg.tallierPkY = vm.envUint("TALLIER_PK_Y");
        cfg.keySalt = vm.envBytes32("KEY_SALT");
        cfg.nSealedMax = vm.envUint("N_SEALED_MAX");
        cfg.mMax = vm.envUint("M_MAX");
        cfg.batch = vm.envUint("BATCH");
        cfg.minDirectVote = vm.envUint("MIN_DIRECT_VOTE");
        cfg.proofGrace = uint64(vm.envUint("PROOF_GRACE"));
        cfg.abandonGrace = uint64(vm.envUint("ABANDON_GRACE"));

        vm.startBroadcast();
        address poseidon = vm.envOr("POSEIDON", address(0));
        if (poseidon == address(0)) {
            poseidon = address(new Poseidon2());
            console.log("Poseidon2 deployed at", poseidon);
        }
        cfg.poseidon = IPoseidon2(poseidon);
        address ingest = vm.envOr("INGEST_VERIFIER", address(0));
        address tally = vm.envOr("TALLY_VERIFIER", address(0));
        if (ingest == address(0) || tally == address(0)) {
            console.log("WARNING: deploying MockHonkVerifier; Proven finality is meaningless on this pool");
            if (ingest == address(0)) ingest = address(new MockHonkVerifier());
            if (tally == address(0)) tally = address(new MockHonkVerifier());
        }
        cfg.ingestVerifier = IHonkVerifier(ingest);
        cfg.tallyVerifier = IHonkVerifier(tally);
        pool = new SealedRankedShares(
            IERC20(vm.envAddress("TOKEN")), vm.envAddress("OWNER"), uint64(vm.envUint("VOTING_DEADLINE")), cfg
        );
        vm.stopBroadcast();

        console.log("SealedRankedShares deployed at", address(pool));
    }
}
