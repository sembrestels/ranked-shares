// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHonkVerifier} from "../../src/noir/interfaces/IHonkVerifier.sol";

/// @dev A verifier that rejects by reverting instead of returning false, which is what
///      the bb-generated Honk verifiers do on a malformed proof. `advance` must still
///      surface `InvalidProof`.
contract MockRevertingVerifier is IHonkVerifier {
    error ProofLengthWrong();

    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        revert ProofLengthWrong();
    }
}
