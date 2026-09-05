// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @dev Chainlink CRE report receiver: the KeystoneForwarder calls onReport with the
///      workflow metadata and the report bytes the workflow produced.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
