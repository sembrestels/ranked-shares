// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script, console} from "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PositionManager} from "v4-periphery/src/PositionManager.sol";
import {PositionDescriptor} from "v4-periphery/src/PositionDescriptor.sol";
import {StateView} from "v4-periphery/src/lens/StateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IWETH9} from "v4-periphery/src/interfaces/external/IWETH9.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DemoToken} from "../src/DemoToken.sol";

/// @notice Run from v4/. Arc uses the canonical ERC-20 interfaces for both stables.
contract DeployV4 is Script {
    function run() external {
        require(block.chainid == 5042002 || block.chainid == 31337, "Arc testnet or local Anvil only");
        address deployer = vm.envAddress("DEPLOYER");
        address lpA = vm.envAddress("DEMO_LP_A");
        address lpB = vm.envAddress("DEMO_LP_B");
        require(lpA != address(0) && lpB != address(0), "LP wallets required");
        uint256 fromBlock = block.number;
        vm.startBroadcast(deployer);
        address usdc;
        address eurc;
        address permitAddress = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        if (block.chainid == 31337) {
            DemoToken usd = new DemoToken("Test USDC", "USDC");
            DemoToken eur = new DemoToken("Test EURC", "EURC");
            usd.mint(deployer, 100e6);
            eur.mint(deployer, 100e6);
            usdc = address(usd);
            eurc = address(eur);
            bytes memory code = vm.getCode(string.concat(vm.projectRoot(), "/out/Permit2.sol/Permit2.json"));
            assembly ("memory-safe") { permitAddress := create(0, add(code, 32), mload(code)) }
        } else {
            usdc = 0x3600000000000000000000000000000000000000;
            eurc = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
            require(permitAddress.code.length != 0, "Canonical Permit2 is missing");
        }
        require(
            IERC20(usdc).balanceOf(deployer) >= 11e6 && IERC20(eurc).balanceOf(deployer) >= 1e6,
            "Fund deployer with 11 USDC and 1 EURC plus gas"
        );
        PoolManager manager = new PoolManager(deployer);
        // These pools only use ERC-20 currencies; native wrapping is unused.
        PositionDescriptor descriptor = new PositionDescriptor(manager, address(0), bytes32("USDC"));
        PositionManager pm =
            new PositionManager(manager, IAllowanceTransfer(permitAddress), 300_000, descriptor, IWETH9(address(0)));
        StateView state = new StateView(manager);
        DemoToken dao = new DemoToken("RankedShares Demo DAO", "DAO");
        dao.mint(deployer, 100e6);
        IERC20(address(dao)).approve(permitAddress, 2e6);
        IERC20(usdc).approve(permitAddress, 1e6);
        IERC20(eurc).approve(permitAddress, 1e6);
        IAllowanceTransfer permit = IAllowanceTransfer(permitAddress);
        permit.approve(address(dao), address(pm), 2e6, uint48(block.timestamp + 1 days));
        permit.approve(usdc, address(pm), 1e6, uint48(block.timestamp + 1 days));
        permit.approve(eurc, address(pm), 1e6, uint48(block.timestamp + 1 days));
        _seed(manager, pm, address(dao), usdc, lpA, lpB);
        _seed(manager, pm, address(dao), eurc, lpA, lpB);
        vm.stopBroadcast();
        console.log("POOL_MANAGER", address(manager));
        console.log("POSITION_MANAGER", address(pm));
        console.log("STATE_VIEW", address(state));
        console.log("DAO_TOKEN", address(dao));
        console.log("USDC", usdc);
        console.log("EURC", eurc);
        console.log("VITE_LP_FROM_BLOCK", fromBlock);
        console.log("LP A owns position IDs 1 (USDC) and 3 (EURC)");
        console.log("LP B owns position IDs 2 (USDC) and 4 (EURC)");
    }

    function _seed(PoolManager manager, PositionManager pm, address dao, address stable, address lpA, address lpB)
        internal
    {
        (address a, address b) = dao < stable ? (dao, stable) : (stable, dao);
        PoolKey memory key = PoolKey(Currency.wrap(a), Currency.wrap(b), 3000, 60, IHooks(address(0)));
        manager.initialize(key, 1 << 96);
        _mint(pm, key, lpA, -600, 600, 1e7);
        _mint(pm, key, lpB, -120, 120, 5e7);
    }

    function _mint(
        PositionManager pm,
        PoolKey memory key,
        address recipient,
        int24 lower,
        int24 upper,
        uint128 liquidity
    ) internal {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, liquidity, uint128(400_000), uint128(400_000), recipient, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(hex"020d", params), block.timestamp + 1 hours);
    }
}
