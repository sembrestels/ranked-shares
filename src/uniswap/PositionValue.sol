// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Principal value at a reference price; fees are excluded until reinvested.
library PositionValue {
    uint256 internal constant Q96 = 1 << 96;
    error InvalidPrice();

    // Supports raw token price ratios from 2^-64 through 2^64. This bounds every
    // value for uint128 liquidity below 2^162, even at the full v4 tick range.
    function checkPrice(uint160 price) internal pure {
        if (price < 1 << 64 || price >= 1 << 128) revert InvalidPrice();
    }

    function value(uint128 liquidity, uint160 lower, uint160 upper, uint160 price, bool stable0)
        internal
        pure
        returns (uint256)
    {
        uint256 p = price;
        uint256 a = lower;
        uint256 b = upper;
        uint256 bounded = p < a ? a : p > b ? b : p;
        uint256 amount0 = Math.mulDiv(uint256(liquidity) << 96, b - bounded, b) / bounded;
        uint256 amount1 = Math.mulDiv(liquidity, bounded - a, Q96);
        uint256 ratio = p * p; // checkPrice bounds this to uint256, nonzero.
        return
            stable0 ? amount0 + Math.mulDiv(amount1, 1 << 192, ratio) : amount1 + Math.mulDiv(amount0, ratio, 1 << 192);
    }
}
