// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Grumpkin: y^2 = x^3 - 17 over the BN254 scalar field.
library Grumpkin {
    uint256 internal constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant B = P - 17;

    function isOnCurve(uint256 x, uint256 y) internal pure returns (bool) {
        if (x >= P || y >= P) return false;
        uint256 lhs = mulmod(y, y, P);
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), B, P);
        return lhs == rhs;
    }
}
