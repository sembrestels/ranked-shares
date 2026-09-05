// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoseidon2 {
    function hash(uint256[] calldata inputs) external pure returns (uint256);
    function permutation(uint256[4] calldata state) external pure returns (uint256[4] memory);
}
