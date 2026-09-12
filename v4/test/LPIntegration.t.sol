// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PositionManager} from "v4-periphery/src/PositionManager.sol";
import {PositionDescriptor} from "v4-periphery/src/PositionDescriptor.sol";
import {StateView} from "v4-periphery/src/lens/StateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IWETH9} from "v4-periphery/src/interfaces/external/IWETH9.sol";
import {DemoToken} from "../src/DemoToken.sol";

interface IRound {
    struct Config {
        address token;
        address owner;
        uint64 deadline;
        bytes tallierPk;
        bytes32 keySalt;
        uint256 minDirectVote;
        uint64 abandonGrace;
        address forwarder;
        address workflowOwner;
        bytes10 workflowName;
    }
    function setLPVoting(address module) external;
    function addProject(uint256 cost, address recipient) external returns (uint256);
    function openVoting() external;
    function sponsorLP(uint256 amount, PoolKey calldata key, address stable, uint256 minimumValue)
        external
        returns (uint256);
    function voteSealed(bytes calldata ct) external;
    function seatWeight(address who) external view returns (uint256);
    function close(uint256 chunk) external;
    function inputsHash() external view returns (bytes32);
    function onReport(bytes calldata metadata, bytes calldata report) external;
    function phase() external view returns (uint8);
    function claim(uint256 id) external;
}

interface ILP {
    function finalizeLP(uint256 id, uint256 chunk) external;
    function accrued(uint256 id, address who) external view returns (uint256);
    function onReport(bytes calldata metadata, bytes calldata report) external;
    function finalized() external view returns (bool);
}

contract LPIntegrationTest is Test {
    PoolManager manager;
    PositionManager pm;
    StateView state;
    IAllowanceTransfer permit;
    DemoToken a;
    DemoToken b;
    PoolKey key;
    IRound round;
    ILP lp;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 deadline = 10_001;

    function deploy(bytes memory code, bytes memory args) internal returns (address at) {
        bytes memory init = bytes.concat(code, args);
        assembly ("memory-safe") { at := create(0, add(init, 32), mload(init)) }
        require(at != address(0), "deployment failed");
    }

    function setUp() public {
        vm.warp(1);
        manager = new PoolManager(address(this));
        permit = IAllowanceTransfer(
            deploy(vm.getCode(string.concat(vm.projectRoot(), "/out/Permit2.sol/Permit2.json")), "")
        );
        PositionDescriptor descriptor = new PositionDescriptor(manager, address(0), bytes32("USDC"));
        pm = new PositionManager(manager, permit, 300_000, descriptor, IWETH9(address(0)));
        state = new StateView(manager);
        a = new DemoToken("Demo DAO", "DAO");
        b = new DemoToken("Test USDC", "USDC");
        (address c0, address c1) = address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        key = PoolKey(Currency.wrap(c0), Currency.wrap(c1), 3000, 60, IHooks(address(0)));
        manager.initialize(key, 1 << 96);
        a.mint(address(this), 1e15);
        b.mint(address(this), 1e15);
        a.approve(address(permit), type(uint256).max);
        b.approve(address(permit), type(uint256).max);
        permit.approve(address(a), address(pm), type(uint160).max, type(uint48).max);
        permit.approve(address(b), address(pm), type(uint160).max, type(uint48).max);
        round = IRound(
            deploy(
                vm.getCode(string.concat(vm.projectRoot(), "/../out/LPCreRankedShares.sol/LPCreRankedShares.json")),
                abi.encode(
                    IRound.Config(
                        address(b),
                        address(this),
                        deadline,
                        abi.encodePacked(bytes1(0x02), bytes32(uint256(1))),
                        bytes32(0),
                        0,
                        1 days,
                        address(this),
                        address(0),
                        bytes10(0)
                    )
                )
            )
        );
        lp = ILP(
            deploy(
                vm.getCode(string.concat(vm.projectRoot(), "/../out/LPVoting.sol/LPVoting.json")),
                abi.encode(address(round), address(pm), address(state), address(this), address(0), bytes10(0))
            )
        );
        round.setLPVoting(address(lp));
        round.addProject(60_000, alice);
        round.openVoting();
        b.approve(address(round), 90_000);
        round.sponsorLP(90_000, key, address(b), 1);
    }

    function mint(address to, uint128 liquidity) internal returns (uint256 id) {
        id = pm.nextTokenId();
        bytes[] memory params = new bytes[](2);
        params[0] =
            abi.encode(key, int24(-600), int24(600), liquidity, type(uint128).max, type(uint128).max, to, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(hex"020d", params), block.timestamp + 100);
        vm.prank(to);
        pm.subscribe(id, address(lp), abi.encode(uint256(0)));
    }

    function decrease(uint256 id, address owner, uint128 amount) internal {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(id, amount, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, owner);
        vm.prank(owner);
        pm.modifyLiquidities(abi.encode(hex"0111", params), block.timestamp + 100);
    }

    function testRealV4MintResizeTransferCloseAndClaim() public {
        uint256 id = mint(alice, 1e12);
        vm.prank(alice);
        round.voteSealed(new bytes(34));
        vm.warp(5_001);
        decrease(id, alice, 5e11);
        vm.prank(alice);
        pm.transferFrom(alice, bob, id);
        assertEq(address(pm.subscriber(id)), address(0));
        vm.prank(bob);
        pm.subscribe(id, address(lp), abi.encode(uint256(0)));
        vm.prank(bob);
        round.voteSealed(new bytes(34));
        vm.warp(deadline);
        decrease(id, bob, 5e11); // after deadline must not erase already-earned weight
        while (!lp.finalized()) lp.finalizeLP(0, 1);
        assertApproxEqAbs(round.seatWeight(alice), 60_000, 1);
        assertApproxEqAbs(round.seatWeight(bob), 30_000, 1);
        round.close(25);
        uint256[] memory funded = new uint256[](1);
        round.onReport("", abi.encode(uint8(1), abi.encode(round.inputsHash(), funded)));
        assertEq(round.phase(), 4);
        round.claim(0);
        assertGe(b.balanceOf(alice), 60_000);
    }

    function testRealV4BurnNotifiesAndUnsubscribeGasIsSufficient() public {
        uint256 id = mint(alice, 1e12);
        vm.warp(100);
        lp.onReport("", abi.encode(uint8(4), abi.encode(uint256(0), uint160(2 << 96), uint64(2), uint64(100))));
        vm.warp(200);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(id, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, alice);
        vm.prank(alice);
        pm.modifyLiquidities(abi.encode(hex"0311", params), block.timestamp + 100);
        uint256 earned = lp.accrued(0, alice);
        assertGt(earned, 0);
        vm.warp(deadline);
        lp.finalizeLP(0, 10);
        assertEq(lp.accrued(0, alice), earned);
    }
}
