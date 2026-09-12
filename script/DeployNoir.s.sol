// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NoirRankedShares} from "../src/noir/NoirRankedShares.sol";
import {deriveWorkflowName} from "../src/lib/CreMetadata.sol";
import {IPoseidon2} from "../src/noir/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../src/noir/interfaces/IHonkVerifier.sol";
import {MockHonkVerifier} from "../test/mocks/MockHonkVerifier.sol";

/// @notice Deploys a NoirRankedShares pool.
///
///   TOKEN=0x… OWNER=0x… VOTING_DEADLINE=<unix> FORWARDER=0x… COORDINATOR=0x… \
///   WORKFLOW_OWNER=0x… WORKFLOW_NAME=ranked-shares-sealed-staging \
///   TALLIER_PK_X=<uint> TALLIER_PK_Y=<uint> KEY_SALT=0x<32 bytes> \
///   PROFILE=test|default MIN_DIRECT_VOTE=10000000 MIN_SEALED_VOTE=10000000 \
///   PROOF_GRACE=86400 ABANDON_GRACE=604800 \
///   [POSEIDON=0x…] [INGEST_VERIFIER=0x…] [TALLY_VERIFIER=0x…] \
///   forge script script/DeployNoir.s.sol --rpc-url $RPC_URL --broadcast
///
/// WORKFLOW_OWNER and WORKFLOW_NAME authorize `onReport`'s `metadata` against the
/// workflow that is allowed to deliver reports; the KeystoneForwarder is a per-chain
/// singleton shared by every workflow, so leaving WORKFLOW_OWNER unset (address(0))
/// disables that check and must never be used for a pool holding real funds. Doing so
/// requires explicitly opting in with ALLOW_ANY_WORKFLOW=1 (see `WorkflowOwnerRequired`).
/// WORKFLOW_NAME is the `workflow-name` from `cre/workflows/sealed/workflow.yaml` for the
/// target being deployed, and may be left empty to accept any name from WORKFLOW_OWNER.
///
/// `PROFILE` fixes `nSealedMax`, `mMax` and `batch` together — `test` is 8 / 4 / 2 and
/// `default` 256 / 16 / 32 — because the verifiers are compiled for one profile and the
/// three are never chosen independently. The script logs the profile and the pool's
/// `profileId()`, which is what a client checks its proving keys against.
///
/// Unset POSEIDON deploys a fresh Poseidon2. Unset verifiers deploy MockHonkVerifiers
/// that accept every proof: fine for a demo of the DON path, never for a pool whose
/// `Proven` finality is meant to mean anything. The real ones are the generated
/// `default`-profile Honk verifiers: deploy them once per chain with
/// `script/DeployNoirVerifiers.s.sol` and pass its two addresses as `INGEST_VERIFIER` and
/// `TALLY_VERIFIER`.
contract DeployNoir is Script {
    error UnknownProfile();
    /// @notice WORKFLOW_OWNER is unset or zero, which disables `onReport`'s workflow
    ///         check and lets any workflow reaching the forwarder report to this pool.
    ///         To deploy such a pool anyway (simulation only; it must never hold real
    ///         funds), set ALLOW_ANY_WORKFLOW=1.
    error WorkflowOwnerRequired();

    uint256 constant TEST_N_SEALED_MAX = 8;
    uint256 constant TEST_M_MAX = 4;
    uint256 constant TEST_BATCH = 2;

    uint256 constant DEFAULT_N_SEALED_MAX = 256;
    uint256 constant DEFAULT_M_MAX = 16;
    uint256 constant DEFAULT_BATCH = 32;

    function run() external returns (NoirRankedShares pool) {
        NoirRankedShares.Config memory cfg;
        cfg.forwarder = vm.envAddress("FORWARDER");
        cfg.coordinator = vm.envAddress("COORDINATOR");
        cfg.workflowOwner = vm.envOr("WORKFLOW_OWNER", address(0));
        string memory workflowNameStr = vm.envOr("WORKFLOW_NAME", string(""));
        cfg.workflowName = bytes(workflowNameStr).length == 0 ? bytes10(0) : deriveWorkflowName(workflowNameStr);
        if (cfg.workflowOwner == address(0)) {
            if (!vm.envOr("ALLOW_ANY_WORKFLOW", false)) {
                revert WorkflowOwnerRequired();
            }
            console.log(
                "WARNING: WORKFLOW_OWNER unset; onReport accepts a report from any workflow reaching the forwarder. Do not deploy this pool for real funds."
            );
        }
        console.log("workflowOwner", cfg.workflowOwner);
        console.log("workflowName:", workflowNameStr);
        console.logBytes10(cfg.workflowName);
        cfg.tallierPkX = vm.envUint("TALLIER_PK_X");
        cfg.tallierPkY = vm.envUint("TALLIER_PK_Y");
        cfg.keySalt = vm.envBytes32("KEY_SALT");
        cfg.minDirectVote = vm.envUint("MIN_DIRECT_VOTE");
        cfg.minSealedVote = vm.envUint("MIN_SEALED_VOTE");
        cfg.proofGrace = uint64(vm.envUint("PROOF_GRACE"));
        cfg.abandonGrace = uint64(vm.envUint("ABANDON_GRACE"));

        string memory profile = vm.envString("PROFILE");
        bytes32 which = keccak256(bytes(profile));
        if (which == keccak256("test")) {
            cfg.nSealedMax = TEST_N_SEALED_MAX;
            cfg.mMax = TEST_M_MAX;
            cfg.batch = TEST_BATCH;
        } else if (which == keccak256("default")) {
            cfg.nSealedMax = DEFAULT_N_SEALED_MAX;
            cfg.mMax = DEFAULT_M_MAX;
            cfg.batch = DEFAULT_BATCH;
        } else {
            revert UnknownProfile();
        }
        console.log("Profile:", profile);
        console.log("  nSealedMax / mMax / batch:", cfg.nSealedMax, cfg.mMax, cfg.batch);

        vm.startBroadcast();
        address poseidon = vm.envOr("POSEIDON", address(0));
        if (poseidon == address(0)) {
            // Keep the generated Poseidon assembly on its legacy pipeline. The
            // pool uses IR, whose Poseidon output would exceed EIP-170.
            bytes memory code = vm.getCode("Poseidon2.sol:Poseidon2");
            assembly ("memory-safe") {
                poseidon := create(0, add(code, 32), mload(code))
            }
            require(poseidon != address(0), "Poseidon deployment failed");
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
        pool = new NoirRankedShares(
            IERC20(vm.envAddress("TOKEN")), vm.envAddress("OWNER"), uint64(vm.envUint("VOTING_DEADLINE")), cfg
        );
        vm.stopBroadcast();

        console.log("NoirRankedShares deployed at", address(pool));
        console.log("profileId:");
        console.logBytes32(pool.profileId());
    }
}
