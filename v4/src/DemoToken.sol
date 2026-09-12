// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @notice Permissionless faucet token for the demo only. Never a production asset.
contract DemoToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_, 6) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
