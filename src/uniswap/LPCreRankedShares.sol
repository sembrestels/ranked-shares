// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreRankedShares} from "../cre/CreRankedShares.sol";
import {PoolKey} from "./IV4.sol";
import {LPVoting} from "./LPVoting.sol";

/// @notice CRE demo pool. The LP ledger is installed once, before voting opens.
contract LPCreRankedShares is CreRankedShares {
    error LPNotFinalized();
    error InvalidLPModule();
    LPVoting public lpVoting;
    uint256 public lpBudget;
    uint256 public lpGranted;

    struct Config {
        IERC20 token;
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

    constructor(Config memory cfg)
        CreRankedShares(
            cfg.token,
            cfg.owner,
            cfg.deadline,
            cfg.tallierPk,
            cfg.keySalt,
            cfg.minDirectVote,
            cfg.abandonGrace,
            cfg.forwarder,
            cfg.workflowOwner,
            cfg.workflowName
        )
    {}

    function setLPVoting(LPVoting module) external onlyOwner {
        if (!_isSetup() || address(lpVoting) != address(0) || address(module.pool()) != address(this)) {
            revert InvalidLPModule();
        }
        lpVoting = module;
    }

    function sponsorLP(uint256 amount, PoolKey calldata key, address stable, uint256 minimumValue)
        external
        onlyOpen
        beforeDeadline
        returns (uint256)
    {
        if (address(lpVoting) == address(0)) revert InvalidLPModule();
        _deposit(amount);
        lpBudget += amount;
        return lpVoting.sponsor(msg.sender, amount, key, stable, minimumValue);
    }

    function creditLP(address who, uint256 amount) external {
        if (msg.sender != address(lpVoting) || phase() != Phase.Closing || amount > lpBudget - lpGranted) {
            revert InvalidLPModule();
        }
        lpGranted += amount;
        _onSeatGranted(who, amount);
    }

    function canVoteLP(address who) external view returns (bool) {
        return address(lpVoting) != address(0) && lpVoting.registered(who);
    }

    function _canVoteSealed(address who) internal view override returns (bool) {
        return super._canVoteSealed(who) || (address(lpVoting) != address(0) && lpVoting.registered(who));
    }

    function _beforeClose() internal view override {
        if (address(lpVoting) != address(0) && !lpVoting.finalized()) revert LPNotFinalized();
    }
}
