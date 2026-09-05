// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ZiskVerifier} from "./ZiskVerifier.sol";

/// @dev Deploys the verifier and verifies one proof inside its own constructor, then
///      returns `1` as its runtime code. `eth_call` of its creation code therefore answers
///      "does this chain's EVM (BN254 precompiles included) accept ZisK proofs?" without
///      a funded account: the result is 32 bytes ending in 0x01, or a revert.
contract VerifierProbe {
    constructor(bytes32 programVK, bytes32 rootC, bytes memory publicValues, bytes memory proofBytes) {
        ZiskVerifier verifier = new ZiskVerifier();
        verifier.verifySnarkProof(programVK, rootC, publicValues, proofBytes);
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}
