// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {PoolKey, IV4Subscriber} from "../../src/uniswap/IV4.sol";
import {LPVoting} from "../../src/uniswap/LPVoting.sol";
import {LPCreRankedShares} from "../../src/uniswap/LPCreRankedShares.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {PositionValue} from "../../src/uniswap/PositionValue.sol";
import {TickMath} from "../../src/uniswap/TickMath.sol";
import {ArkivBallots} from "../../src/ArkivBallots.sol";

contract MockV4 {
    address public constant poolManager = address(123);
    uint256 public constant unsubscribeGasLimit = 300_000;
    uint160 public price = 1 << 96;
    PoolKey public key;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public subscriber;
    mapping(uint256 => uint128) public getPositionLiquidity;
    mapping(uint256 => uint256) public info;

    function setKey(PoolKey memory k) external {
        key = k;
    }

    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24) {
        return (price, 0, 0, 3000);
    }

    function getPoolAndPositionInfo(uint256 id) external view returns (PoolKey memory, uint256) {
        return (key, info[id]);
    }

    function mint(uint256 id, address who, uint128 liquidity, int24 lower, int24 upper) external {
        ownerOf[id] = who;
        getPositionLiquidity[id] = liquidity;
        info[id] = (uint256(uint24(lower)) << 8) | (uint256(uint24(upper)) << 32);
    }

    function subscribe(uint256 id, address target, bytes calldata data) external {
        require(msg.sender == ownerOf[id] && subscriber[id] == address(0));
        subscriber[id] = target;
        IV4Subscriber(target).notifySubscribe(id, data);
    }

    function resize(uint256 id, uint128 liquidity) external {
        int256 delta = int256(uint256(liquidity)) - int256(uint256(getPositionLiquidity[id]));
        getPositionLiquidity[id] = liquidity;
        if (subscriber[id] != address(0)) IV4Subscriber(subscriber[id]).notifyModifyLiquidity(id, delta, 0);
    }

    function unsubscribe(uint256 id) public returns (bool ok) {
        address target = subscriber[id];
        delete subscriber[id];
        (ok,) = target.call{gas: unsubscribeGasLimit}(abi.encodeCall(IV4Subscriber.notifyUnsubscribe, (id)));
    }

    function transfer(uint256 id, address to) external returns (bool) {
        ownerOf[id] = to;
        return unsubscribe(id);
    }

    function burn(uint256 id) external {
        address target = subscriber[id];
        delete subscriber[id];
        IV4Subscriber(target).notifyBurn(id, ownerOf[id], info[id], getPositionLiquidity[id], 0);
        delete ownerOf[id];
    }
}

contract LPVotingTest is Test {
    MockERC20 token;
    MockV4 pm;
    LPVoting lp;
    LPCreRankedShares pool;
    PoolKey key;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address workflowOwner = address(0xC0DE);
    bytes10 workflowName = bytes10("lp-demo");
    uint64 end = 10_001;

    function setUp() public {
        vm.warp(1);
        token = new MockERC20();
        pm = new MockV4();
        key = PoolKey(address(1), address(2), 3000, 60, address(0));
        pm.setKey(key);
        pool = new LPCreRankedShares(
            LPCreRankedShares.Config(
                token,
                address(this),
                end,
                abi.encodePacked(bytes1(0x02), bytes32(uint256(1))),
                bytes32(0),
                0,
                1 days,
                address(this),
                workflowOwner,
                workflowName
            )
        );
        lp = new LPVoting(address(pool), address(pm), address(pm), address(this), workflowOwner, workflowName);
        pool.setLPVoting(lp);
        pool.addProject(100, alice);
        pool.openVoting();
        token.mint(address(this), 1_000_000);
        token.approve(address(pool), type(uint256).max);
        pool.sponsorLP(90_000, key, key.currency1, 1);
    }

    function claim(uint256 id, address who, uint128 liquidity) internal {
        pm.mint(id, who, liquidity, -600, 600);
        vm.prank(who);
        pm.subscribe(id, address(lp), abi.encode(uint256(0)));
    }

    function finish(uint256 chunk) internal {
        vm.warp(end);
        while (!lp.finalized()) lp.finalizeLP(0, chunk);
    }

    function price(uint160 next, uint64 blockNumber) internal {
        lp.onReport(
            abi.encodePacked(bytes32(0), workflowName, workflowOwner),
            abi.encode(uint8(4), abi.encode(uint256(0), next, blockNumber, uint64(block.timestamp)))
        );
    }

    function testTimeWeightedAllocationAndEarlyBallot() public {
        claim(1, alice, 1e12);
        vm.prank(alice);
        pool.voteSealed(new bytes(34));
        assertEq(pool.seatWeight(alice), 0);
        vm.warp(5_001);
        claim(2, bob, 1e12);
        vm.warp(end);
        vm.expectRevert(LPCreRankedShares.LPNotFinalized.selector);
        pool.close(25);
        finish(1);
        assertEq(pool.seatWeight(alice), 60_000);
        assertEq(pool.seatWeight(bob), 30_000);
        pool.close(25);
        assertTrue(pool.closed());
    }

    function testTransferRetainsOriginalOwnersEarnedWeight() public {
        claim(1, alice, 1e12);
        vm.warp(5_001);
        assertTrue(pm.transfer(1, bob));
        vm.prank(bob);
        pm.subscribe(1, address(lp), abi.encode(uint256(0)));
        finish(5);
        assertEq(pool.seatWeight(alice), 45_000);
        assertEq(pool.seatWeight(bob), 45_000);
    }

    function testZeroLiquidityCanResumeAndBurnStopsAccrual() public {
        claim(1, alice, 1e12);
        claim(2, bob, 1e12);
        vm.warp(2_501);
        pm.resize(1, 0);
        vm.warp(5_001);
        pm.resize(1, 1e12);
        vm.warp(7_501);
        pm.burn(1);
        finish(3);
        assertEq(pool.seatWeight(alice), 30_000);
        assertEq(pool.seatWeight(bob), 60_000);
    }

    function testWithdrawAfterDeadlineCannotChangeFinalWeight() public {
        claim(1, alice, 1e12);
        claim(2, bob, 1e12);
        vm.warp(end + 100);
        pm.resize(1, 0);
        assertTrue(pm.unsubscribe(1));
        lp.finalizeLP(0, 10);
        assertEq(pool.seatWeight(alice), 45_000);
    }

    function testPriceUpdatesOnlyChangeFutureAccrual() public {
        claim(1, alice, 1e12);
        uint256 oldRate = lp.positions(0)[0].rate;
        vm.warp(5_001);
        price(uint160(2 << 96), 10);
        assertEq(lp.accrued(0, alice), oldRate * 5_000);
        uint256 newRate = lp.positions(0)[0].rate;
        finish(10);
        assertEq(lp.accrued(0, alice), oldRate * 5_000 + newRate * 5_000);
    }

    function testUnsubscribeGasWithFullCampaign() public {
        for (uint256 i; i < 64; i++) {
            claim(i + 1, address(uint160(1000 + i)), 1e12);
        }
        vm.warp(100);
        price(uint160(2 << 96), 2);
        vm.warp(200);
        uint256 before = gasleft();
        assertTrue(pm.unsubscribe(1));
        uint256 used = before - gasleft();
        assertLt(used, 200_000);
        uint256 earned = lp.accrued(0, address(1000));
        vm.warp(300);
        price(uint160(1 << 96), 3);
        assertEq(lp.accrued(0, address(1000)), earned);
    }

    function testRejectsUnauthorizedAndReplayedPrices() public {
        vm.warp(100);
        vm.prank(alice);
        vm.expectRevert(LPVoting.Unauthorized.selector);
        lp.onReport("", "");
        price(uint160(1 << 96), 2);
        vm.warp(200);
        vm.expectRevert(LPVoting.StalePrice.selector);
        price(uint160(1 << 96), 2);
    }

    function testEmptyCampaignClosesAndFundsAbstain() public {
        finish(5);
        assertEq(pool.lpGranted(), 0);
        assertEq(pool.totalWeight(), 90_000);
        pool.close(5);
        assertTrue(pool.closed());
    }

    function testAggregatesBeforeRoundingAndProjectionMatchesClose() public {
        claim(1, alice, 1e12);
        claim(2, alice, 1e12);
        claim(3, bob, 1e12);
        vm.warp(9_000);
        (,, uint256 projected) = lp.projection(0, alice);
        finish(2);
        assertEq(pool.seatWeight(alice), projected);
        assertEq(projected, 60_000);
    }

    function testCallbackCallerCannotForgeWeight() public {
        vm.expectRevert(LPVoting.Unauthorized.selector);
        lp.notifySubscribe(1, abi.encode(uint256(0)));
        vm.expectRevert(LPCreRankedShares.InvalidLPModule.selector);
        pool.creditLP(alice, 90_000);
    }

    function testArkivBallotCanPrecedeLPWeightAndClosesAfterAllocation() public {
        pool = new LPCreRankedShares(
            LPCreRankedShares.Config(
                token,
                address(this),
                end,
                abi.encodePacked(bytes1(0x02), bytes32(uint256(1))),
                bytes32(0),
                0,
                1 days,
                address(this),
                workflowOwner,
                workflowName
            )
        );
        lp = new LPVoting(address(pool), address(pm), address(pm), address(this), workflowOwner, workflowName);
        pool.setLPVoting(lp);
        pool.addProject(100, alice);
        pool.enableArkivBallots();
        pool.openVoting();
        token.approve(address(pool), 90_000);
        pool.sponsorLP(90_000, key, key.currency1, 1);
        claim(1, alice, 1e12);
        bytes memory payload = new bytes(34);
        vm.prank(alice);
        pool.voteSealedArkiv(bytes32(uint256(1)), payload, 0);
        assertEq(pool.seatWeight(alice), 0);
        ArkivBallots.BallotData[] memory ballots = new ArkivBallots.BallotData[](1);
        ballots[0] = ArkivBallots.BallotData("", payload);
        vm.warp(end);
        vm.expectRevert(LPCreRankedShares.LPNotFinalized.selector);
        pool.closeArkiv(0, ballots);
        finish(10);
        pool.closeArkiv(0, ballots);
        assertTrue(pool.closed());
        assertEq(pool.seatWeight(alice), 90_000);
    }

    function testFuzzSettleOrderDoesNotChangeIntegral(uint128 raw, uint64 secondsHeld) public {
        uint128 liquidity = uint128(bound(raw, 1e6, 1e25));
        uint64 t = uint64(bound(secondsHeld, 1, 9_998));
        claim(1, alice, liquidity);
        uint256 rate = lp.positions(0)[0].rate;
        vm.warp(1 + t);
        pm.resize(1, liquidity);
        finish(1);
        assertEq(lp.accrued(0, alice), rate * 10_000);
    }

    function testFuzzValueBounds(uint128 liquidity, int24 lo, int24 hi, uint128 priceRaw, bool stable0) public pure {
        lo = int24(bound(int256(lo), -887272, 887271));
        hi = int24(bound(int256(hi), int256(lo) + 1, 887272));
        uint160 p = uint160(bound(uint256(priceRaw), 1 << 64, type(uint128).max));
        uint256 v = PositionValue.value(
            liquidity, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), p, stable0
        );
        assertLt(v, 1 << 162);
    }
}
