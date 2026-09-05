// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PBEAR} from "./PBEAR.sol";
import {PoolBase} from "./PoolBase.sol";

/// @title RankedShares
/// @notice A contribution-weighted participatory budgeting pool that tallies PB-EAR
///         on-chain. Deposits, sponsorships, seats, claims and sweep come from PoolBase;
///         ballots and the tally come from PBEAR.
contract RankedShares is PoolBase, PBEAR {
    // Redeclarations of `PoolBase`'s file-scope errors, present only so this compiler
    // resolves `RankedShares.WrongPhase.selector` etc. as members of this contract type;
    // see the comment in `PoolBase.sol`. Same name and arguments means same selector,
    // so these match what `PoolBase`'s own code actually reverts with.
    error WrongPhase();
    error DeadlinePassed();
    error ZeroAmount();
    error ZeroAddress();
    error NoSeats();
    error SeatsUnknown();
    error NoSeatsLeft();
    error NotTokenOwner();
    error AlreadyHeld();
    error NotNFTSponsorship();
    error BalanceBelowTotalWeight();
    error NotFunded();
    error AlreadyClaimed();

    error DeadlineNotReached();

    event Voted(address indexed voter);

    enum Phase {
        Setup,
        Open,
        Tally,
        Done
    }

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_) PoolBase(token_, owner_, votingDeadline_) {}

    modifier inPhase(Phase expected) {
        if (phase() != expected) revert WrongPhase();
        _;
    }

    function phase() public view returns (Phase) {
        if (tallyDone) return Phase.Done;
        if (tallyStarted) return Phase.Tally;
        if (votingOpen) return Phase.Open;
        return Phase.Setup;
    }

    /// @notice Cast or replace the caller's ballot. See `PBEAR` for the encoding.
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        _setBallot(msg.sender, ranks);
        emit Voted(msg.sender);
    }

    /// @notice Close the voting window and start the tally once the deadline has passed.
    function startTally() external inPhase(Phase.Open) {
        if (block.timestamp < votingDeadline) revert DeadlineNotReached();
        _requireBalanceCoversBudget();
        _startTally();
    }

    // ----------------------------------------------------------------- hooks

    function _isSetup() internal view override returns (bool) {
        return phase() == Phase.Setup;
    }

    function _isOpen() internal view override returns (bool) {
        return phase() == Phase.Open;
    }

    function _isDone() internal view override returns (bool) {
        return phase() == Phase.Done;
    }

    function _registerProject(uint256 cost_) internal override returns (uint256) {
        return _addProject(cost_);
    }

    function _beforeOpen() internal view override {
        if (projectCount() == 0) revert NoProjects();
    }

    function _addBudget(uint256 amount) internal override {
        _increaseTotalWeight(amount);
    }

    function _budget() internal view override returns (uint256) {
        return totalWeight;
    }

    function _onContribution(address who, uint256 amount) internal override {
        _grantWeight(who, amount);
    }

    function _onSeatGranted(address who, uint256 perSeat) internal override {
        _grantWeight(who, perSeat);
    }

    function _onSeatRevoked(address who, uint256 perSeat) internal override {
        _revokeWeight(who, perSeat);
    }

    function _isFunded(uint256 projectId) internal view override returns (bool) {
        return funded[projectId];
    }

    function _costOf(uint256 projectId) internal view override returns (uint256) {
        return cost(projectId);
    }

    function _spent() internal view override returns (uint256) {
        return spent;
    }
}
