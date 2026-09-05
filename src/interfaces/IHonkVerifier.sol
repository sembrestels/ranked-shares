// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev The interface of the verifiers `bb write_solidity_verifier` emits.
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
