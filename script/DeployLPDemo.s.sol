// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {deriveWorkflowName} from "../src/lib/CreMetadata.sol";
import {LPCreRankedShares} from "../src/uniswap/LPCreRankedShares.sol";
import {LPVoting} from "../src/uniswap/LPVoting.sol";
import {PoolKey} from "../src/uniswap/IV4.sol";

/// @notice Second stage, after v4/script/DeployV4.s.sol. All values are public config.
contract DeployLPDemo is Script {
    function run() external returns (LPCreRankedShares pool, LPVoting lp) {
        require(block.chainid == 5042002 || block.chainid == 31337, "Arc testnet or Anvil only");
        address deployer = vm.envAddress("DEPLOYER");
        address usdc = vm.envAddress("USDC");
        address eurc = vm.envAddress("EURC");
        address dao = vm.envAddress("DAO_TOKEN");
        address workflowOwner = vm.envAddress("WORKFLOW_OWNER");
        require(workflowOwner != address(0), "Set the CRE workflow owner's public address");
        bytes10 name = deriveWorkflowName(vm.envOr("WORKFLOW_NAME", string("ranked-shares-lp-demo")));
        uint256 end = vm.envUint("VOTING_DEADLINE");
        require(
            end > block.timestamp + 10 minutes && end <= block.timestamp + 30 days,
            "Use a deadline 10 minutes to 30 days ahead"
        );
        LPCreRankedShares.Config memory cfg = LPCreRankedShares.Config(
            IERC20(usdc),
            deployer,
            uint64(end),
            vm.envBytes("TALLIER_PK"),
            vm.envBytes32("KEY_SALT"),
            1e6,
            1 days,
            vm.envAddress("FORWARDER"),
            workflowOwner,
            name
        );
        vm.startBroadcast(deployer);
        pool = new LPCreRankedShares(cfg);
        lp = new LPVoting(
            address(pool),
            vm.envAddress("POSITION_MANAGER"),
            vm.envAddress("STATE_VIEW"),
            cfg.forwarder,
            workflowOwner,
            name
        );
        pool.setLPVoting(lp);
        pool.addProject(2e6, vm.envAddress("DEMO_LP_A"));
        pool.addProject(3e6, vm.envAddress("DEMO_LP_B"));
        pool.addProject(5e6, deployer);
        pool.enableArkivBallots();
        pool.openVoting();
        IERC20(usdc).approve(address(pool), 10e6);
        pool.sponsorLP(5e6, _key(dao, usdc), usdc, 10_000);
        pool.sponsorLP(5e6, _key(dao, eurc), eurc, 10_000);
        vm.stopBroadcast();
        console.log("VITE_POOL_ADDRESS", address(pool));
        console.log("LP_MODULE", address(lp));
        console.log("Voting deadline", end);
    }

    function _key(address a, address b) internal pure returns (PoolKey memory) {
        return PoolKey(a < b ? a : b, a < b ? b : a, 3000, 60, address(0));
    }
}
