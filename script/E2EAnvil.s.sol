// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZiskRankedShares} from "../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../src/zisk/IZiskVerifier.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockERC721} from "../test/mocks/MockERC721.sol";

/// @notice Local end-to-end setup: on a fresh anvil, from account 0, deploys the mock
///         token (nonce 0), the mock NFT (1), the verifier (2) and the pool (3), so the
///         pool lands at the fixture's address and the committed proof verifies against it.
///
///   VOTING_DEADLINE=<unix> forge script script/E2EAnvil.s.sol --rpc-url http://127.0.0.1:8545 \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
contract E2EAnvil is Script {
    using stdJson for string;

    error PoolAddressMismatch(address got, address want);

    string internal fx;
    string internal cd;

    function run() external {
        fx = vm.readFile("reference/vectors/zisk/fixture_main.json");
        cd = vm.readFile("zisk/fixtures/main-calldata.json");
        address want = fx.readAddress(".pool");

        vm.startBroadcast();
        MockERC20 token = new MockERC20();
        MockERC721 nft = new MockERC721();
        ZiskVerifier verifier = new ZiskVerifier();
        ZiskRankedShares pool = _deployPool(token, verifier);
        if (address(pool) != want) revert PoolAddressMismatch(address(pool), want);
        bytes32[] memory costs = fx.readBytes32Array(".costs");
        for (uint256 c = 0; c < costs.length; c++) {
            pool.addProject(uint256(costs[c]), msg.sender);
        }
        pool.openVoting();
        vm.stopBroadcast();

        console.log("TOKEN", address(token));
        console.log("NFT", address(nft));
        console.log("VERIFIER", address(verifier));
        console.log("POOL", address(pool));
    }

    /// @dev Split out of `run` so the constructor's ten arguments fit the stack.
    function _deployPool(MockERC20 token, ZiskVerifier verifier) internal returns (ZiskRankedShares) {
        return new ZiskRankedShares(
            IERC20(address(token)),
            msg.sender,
            uint64(vm.envUint("VOTING_DEADLINE")),
            fx.readBytes(".pk"),
            fx.readBytes32(".keySalt"),
            uint256(fx.readBytes32(".minDirectVote")),
            7 days,
            IZiskVerifier(address(verifier)),
            cd.readBytes32(".programVK"),
            verifier.getRootCVadcopFinal()
        );
    }
}
