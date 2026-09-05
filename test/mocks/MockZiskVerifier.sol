// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IZiskVerifier} from "../../src/zisk/IZiskVerifier.sol";

/// @dev Accepts every proof, or rejects every proof by reverting `InvalidProof()` the way
///      the real verifier does. `verifySnarkProof` is `view` in the interface, so the
///      mock cannot record calls; tests assert on the pool's state.
contract MockZiskVerifier is IZiskVerifier {
    error InvalidProof();

    bool public accept = true;

    function setAccept(bool value) external {
        accept = value;
    }

    function verifySnarkProof(bytes32, bytes32, bytes calldata, bytes calldata) external view {
        if (!accept) revert InvalidProof();
    }
}
