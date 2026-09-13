// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @dev Six-decimal token for browser deployment tests against local Anvil.
contract MockStablecoin is MockERC20 {
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
