// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PBEAR} from "./PBEAR.sol";

/// @title RankedShares
/// @notice A contribution-weighted participatory budgeting pool. Money deposited
///         into the pool is the budget, and every deposited token is one unit of
///         voting weight. Contributors vote with their own deposits; organisations
///         can sponsor seats for a group (an explicit list or the holders of an
///         ERC-721 collection). An address casts one ballot, weighted by
///         everything backing it. Projects are selected with PB-EAR.
contract RankedShares is PBEAR, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors

    error WrongPhase();
    error DeadlinePassed();
    error DeadlineNotReached();
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

    // ---------------------------------------------------------------- events

    event ProjectAdded(uint256 indexed projectId, uint256 cost, address recipient);
    event VotingOpened();
    event Contributed(address indexed contributor, uint256 amount);
    event Sponsored(uint256 indexed sponsorshipId, address indexed sponsor, uint256 amount, uint256 seats, address nft);
    event SeatClaimed(uint256 indexed sponsorshipId, uint256 indexed tokenId, address indexed holder, address previous);
    event Voted(address indexed voter);
    event Claimed(uint256 indexed projectId, address indexed recipient, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    // ----------------------------------------------------------------- types

    enum Phase {
        Setup,
        Open,
        Tally,
        Done
    }

    struct Sponsorship {
        address sponsor;
        uint256 amount;
        uint256 perSeat;
        uint256 seats;
        uint256 claimed;
        address nft; // address(0) for explicit-list sponsorships
    }

    // --------------------------------------------------------------- storage

    IERC20 public immutable token;
    uint64 public immutable votingDeadline;

    bool public votingOpen;
    mapping(uint256 => address) public recipientOf;

    Sponsorship[] internal _sponsorships;
    /// @notice Current holder of the seat keyed by an NFT token id.
    mapping(uint256 => mapping(uint256 => address)) public seatHolder;

    mapping(uint256 => bool) public claimed;
    uint256 public claimedTotal;

    // ----------------------------------------------------------- constructor

    constructor(IERC20 token_, address owner_, uint64 votingDeadline_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        votingDeadline = votingDeadline_;
    }

    // ------------------------------------------------------------- modifiers

    modifier inPhase(Phase expected) {
        if (phase() != expected) revert WrongPhase();
        _;
    }

    modifier beforeDeadline() {
        if (block.timestamp >= votingDeadline) revert DeadlinePassed();
        _;
    }

    // ----------------------------------------------------------------- views

    function phase() public view returns (Phase) {
        if (tallyDone) return Phase.Done;
        if (tallyStarted) return Phase.Tally;
        if (votingOpen) return Phase.Open;
        return Phase.Setup;
    }

    function sponsorships(uint256 id)
        external
        view
        returns (address sponsor, uint256 amount, uint256 perSeat, uint256 seats, uint256 claimed, address nft)
    {
        Sponsorship storage s = _sponsorships[id];
        return (s.sponsor, s.amount, s.perSeat, s.seats, s.claimed, s.nft);
    }

    function sponsorshipCount() external view returns (uint256) {
        return _sponsorships.length;
    }

    // ----------------------------------------------------------------- setup

    function addProject(uint256 cost_, address recipient) external onlyOwner inPhase(Phase.Setup) returns (uint256 id) {
        if (recipient == address(0)) revert ZeroAddress();
        id = _addProject(cost_);
        recipientOf[id] = recipient;
        emit ProjectAdded(id, cost_, recipient);
    }

    function openVoting() external onlyOwner inPhase(Phase.Setup) beforeDeadline {
        if (projectCount() == 0) revert NoProjects();
        votingOpen = true;
        emit VotingOpened();
    }

    // -------------------------------------------------------------- deposits

    /// @notice Deposit `amount` and vote with it yourself.
    function contribute(uint256 amount) external inPhase(Phase.Open) beforeDeadline {
        _deposit(amount);
        _grantWeight(msg.sender, amount);
        emit Contributed(msg.sender, amount);
    }

    /// @notice Deposit `amount` split equally among `members`, one seat per entry.
    function sponsor(uint256 amount, address[] calldata members)
        external
        inPhase(Phase.Open)
        beforeDeadline
        returns (uint256 id)
    {
        if (members.length == 0) revert NoSeats();
        _deposit(amount);
        uint256 perSeat = amount / members.length;
        id = _sponsorships.length;
        _sponsorships.push(
            Sponsorship({
                sponsor: msg.sender,
                amount: amount,
                perSeat: perSeat,
                seats: members.length,
                claimed: members.length,
                nft: address(0)
            })
        );
        for (uint256 i = 0; i < members.length; i++) {
            _grantWeight(members[i], perSeat);
        }
        emit Sponsored(id, msg.sender, amount, members.length, address(0));
    }

    /// @notice Deposit `amount` split equally across `seats` seats claimable by
    ///         holders of `nft`. Pass `seats = 0` to use the collection's
    ///         `totalSupply()`; reverts if the collection does not expose one.
    function sponsorNFT(uint256 amount, IERC721 nft, uint256 seats)
        external
        inPhase(Phase.Open)
        beforeDeadline
        returns (uint256 id)
    {
        if (address(nft) == address(0)) revert ZeroAddress();
        if (seats == 0) seats = _totalSupplyOf(nft);
        _deposit(amount);
        id = _sponsorships.length;
        _sponsorships.push(
            Sponsorship({
                sponsor: msg.sender,
                amount: amount,
                perSeat: amount / seats,
                seats: seats,
                claimed: 0,
                nft: address(nft)
            })
        );
        emit Sponsored(id, msg.sender, amount, seats, address(nft));
    }

    /// @notice Occupy the seat keyed by `tokenId` with the caller, who must own
    ///         the token. Takes the seat over from any previous holder.
    function claimSeat(uint256 sponsorshipId, uint256 tokenId) external inPhase(Phase.Open) beforeDeadline {
        Sponsorship storage s = _sponsorships[sponsorshipId];
        if (s.nft == address(0)) revert NotNFTSponsorship();
        if (IERC721(s.nft).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        address previous = seatHolder[sponsorshipId][tokenId];
        if (previous == msg.sender) revert AlreadyHeld();
        if (previous == address(0)) {
            if (s.claimed >= s.seats) revert NoSeatsLeft();
            s.claimed++;
        } else {
            _revokeWeight(previous, s.perSeat);
        }
        seatHolder[sponsorshipId][tokenId] = msg.sender;
        _grantWeight(msg.sender, s.perSeat);
        emit SeatClaimed(sponsorshipId, tokenId, msg.sender, previous);
    }

    // --------------------------------------------------------------- ballots

    /// @notice Cast or replace the caller's ballot. See `PBEAR` for the encoding.
    function vote(bytes calldata ranks) external inPhase(Phase.Open) beforeDeadline {
        _setBallot(msg.sender, ranks);
        emit Voted(msg.sender);
    }

    // ----------------------------------------------------------------- tally

    /// @notice Close the voting window and start the tally. Anyone may call it
    ///         once the deadline has passed. Tokens sent directly to the pool are
    ///         not part of the budget.
    function startTally() external inPhase(Phase.Open) {
        if (block.timestamp < votingDeadline) revert DeadlineNotReached();
        if (token.balanceOf(address(this)) < totalWeight) revert BalanceBelowTotalWeight();
        _startTally();
    }

    // --------------------------------------------------------------- payouts

    /// @notice Pay a funded project's cost to its recipient. Anyone may trigger it.
    function claim(uint256 projectId) external inPhase(Phase.Done) {
        if (!funded[projectId]) revert NotFunded();
        if (claimed[projectId]) revert AlreadyClaimed();
        claimed[projectId] = true;
        uint256 amount = cost(projectId);
        claimedTotal += amount;
        address recipient = recipientOf[projectId];
        emit Claimed(projectId, recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    /// @notice Withdraw everything the pool holds beyond the funded projects'
    ///         unclaimed costs: unspent budget plus any stray transfers.
    function sweep(address to) external onlyOwner inPhase(Phase.Done) {
        if (to == address(0)) revert ZeroAddress();
        uint256 owed = spent - claimedTotal;
        uint256 amount = token.balanceOf(address(this)) - owed;
        emit Swept(to, amount);
        token.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------- internals

    function _deposit(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _increaseTotalWeight(amount);
    }

    function _totalSupplyOf(IERC721 nft) private view returns (uint256 supply) {
        (bool ok, bytes memory data) = address(nft).staticcall(abi.encodeCall(IERC721Enumerable.totalSupply, ()));
        if (!ok || data.length < 32) revert SeatsUnknown();
        supply = abi.decode(data, (uint256));
        if (supply == 0) revert SeatsUnknown();
    }
}
