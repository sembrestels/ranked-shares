// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ABI-only interfaces. The integration suite deploys the pinned official v4 code.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface IV4PositionManager {
    function poolManager() external view returns (address);
    function unsubscribeGasLimit() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function subscriber(uint256 tokenId) external view returns (address);
    function subscribe(uint256 tokenId, address subscriber_, bytes calldata data) external payable;
    function unsubscribe(uint256 tokenId) external payable;
}

interface IV4StateView {
    function poolManager() external view returns (address);
    function getSlot0(bytes32 poolId) external view returns (uint160, int24, uint24, uint24);
}

interface IV4Subscriber {
    function notifySubscribe(uint256 tokenId, bytes calldata data) external;
    function notifyUnsubscribe(uint256 tokenId) external;
    function notifyModifyLiquidity(uint256 tokenId, int256 liquidityChange, int256 feesAccrued) external;
    function notifyBurn(uint256 tokenId, address owner, uint256 info, uint256 liquidity, int256 feesAccrued) external;
}

interface ILPVotingPool {
    function phase() external view returns (uint8);
    function votingDeadline() external view returns (uint64);
    function creditLP(address who, uint256 amount) external;
}
