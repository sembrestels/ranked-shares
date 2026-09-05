// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHonkVerifier} from "../../src/noir/interfaces/IHonkVerifier.sol";

/// @dev Accepts or rejects every proof. `verify` is `view` in the interface, so the mock
///      cannot record calls; tests assert on the pool's state changes instead.
contract MockHonkVerifier is IHonkVerifier {
    bool public accept = true;

    function setAccept(bool value) external {
        accept = value;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return accept;
    }
}
