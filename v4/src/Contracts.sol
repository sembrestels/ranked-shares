// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Compile official contracts in a separate project: PositionManager requires 0.8.26.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PositionManager} from "v4-periphery/src/PositionManager.sol";
import {PositionDescriptor} from "v4-periphery/src/PositionDescriptor.sol";
import {StateView} from "v4-periphery/src/lens/StateView.sol";
