// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// ---------------------------------------------------------------- errors
//
// Declared at file scope, not inside `PoolBase`, because this compiler does not resolve
// an error declared in a base contract (directly, or via an interface it implements) as
// a member of a derived contract's type: `RankedShares.WrongPhase.selector` needs
// `WrongPhase` declared literally inside `RankedShares` itself. A pool built on
// `PoolBase` therefore redeclares the errors it wants reachable that way; since a custom
// error's selector is determined only by its name and argument types, that redeclaration
// and `PoolBase`'s own use of the same free error below share one selector.

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

/// @title PoolBase
/// @notice What every RankedShares pool does around the tally: token custody, projects,
///         deposits, sponsorships, NFT seats, claims and sweep. How weight is accounted,
///         when each phase holds and what got funded are left to the concrete pool
///         through the hooks at the bottom.
abstract contract PoolBase is Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- events

    event ProjectAdded(uint256 indexed projectId, uint256 cost, address recipient);
    event VotingOpened();
    event Contributed(address indexed contributor, uint256 amount);
    event Sponsored(uint256 indexed sponsorshipId, address indexed sponsor, uint256 amount, uint256 seats, address nft);
    event SeatClaimed(uint256 indexed sponsorshipId, uint256 indexed tokenId, address indexed holder, address previous);
    event Claimed(uint256 indexed projectId, address indexed recipient, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    // ----------------------------------------------------------------- types

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

    modifier onlySetup() {
        if (!_isSetup()) revert WrongPhase();
        _;
    }

    modifier onlyOpen() {
        if (!_isOpen()) revert WrongPhase();
        _;
    }

    modifier onlyDone() {
        if (!_isDone()) revert WrongPhase();
        _;
    }

    modifier beforeDeadline() {
        if (block.timestamp >= votingDeadline) revert DeadlinePassed();
        _;
    }

    // ----------------------------------------------------------------- views

    function sponsorships(uint256 id)
        external
        view
        returns (address sponsor, uint256 amount, uint256 perSeat, uint256 seats, uint256 claimedSeats, address nft)
    {
        Sponsorship storage s = _sponsorships[id];
        return (s.sponsor, s.amount, s.perSeat, s.seats, s.claimed, s.nft);
    }

    function sponsorshipCount() external view returns (uint256) {
        return _sponsorships.length;
    }

    // ----------------------------------------------------------------- setup

    function addProject(uint256 cost_, address recipient) external onlyOwner onlySetup returns (uint256 id) {
        if (recipient == address(0)) revert ZeroAddress();
        id = _registerProject(cost_);
        recipientOf[id] = recipient;
        emit ProjectAdded(id, cost_, recipient);
    }

    function openVoting() external onlyOwner onlySetup beforeDeadline {
        _beforeOpen();
        votingOpen = true;
        emit VotingOpened();
    }

    // -------------------------------------------------------------- deposits

    /// @notice Deposit `amount` and vote with it yourself.
    function contribute(uint256 amount) external onlyOpen beforeDeadline {
        _deposit(amount);
        _onContribution(msg.sender, amount);
        emit Contributed(msg.sender, amount);
    }

    /// @notice Deposit `amount` split equally among `members`, one seat per entry.
    function sponsor(uint256 amount, address[] calldata members) external onlyOpen beforeDeadline returns (uint256 id) {
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
            _onSeatGranted(members[i], perSeat);
        }
        emit Sponsored(id, msg.sender, amount, members.length, address(0));
    }

    /// @notice Deposit `amount` split equally across `seats` seats claimable by holders of
    ///         `nft`. Pass `seats = 0` to use the collection's `totalSupply()`.
    function sponsorNFT(uint256 amount, IERC721 nft, uint256 seats)
        external
        onlyOpen
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

    /// @notice Occupy the seat keyed by `tokenId` with the caller, who must own the token.
    function claimSeat(uint256 sponsorshipId, uint256 tokenId) external onlyOpen beforeDeadline {
        Sponsorship storage s = _sponsorships[sponsorshipId];
        if (s.nft == address(0)) revert NotNFTSponsorship();
        if (IERC721(s.nft).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        address previous = seatHolder[sponsorshipId][tokenId];
        if (previous == msg.sender) revert AlreadyHeld();
        if (previous == address(0)) {
            if (s.claimed >= s.seats) revert NoSeatsLeft();
            s.claimed++;
        } else {
            _onSeatRevoked(previous, s.perSeat);
        }
        seatHolder[sponsorshipId][tokenId] = msg.sender;
        _onSeatGranted(msg.sender, s.perSeat);
        emit SeatClaimed(sponsorshipId, tokenId, msg.sender, previous);
    }

    // --------------------------------------------------------------- payouts

    /// @notice Pay a funded project's cost to its recipient. Anyone may trigger it.
    function claim(uint256 projectId) external onlyDone {
        if (!_isFunded(projectId)) revert NotFunded();
        if (claimed[projectId]) revert AlreadyClaimed();
        claimed[projectId] = true;
        uint256 amount = _costOf(projectId);
        claimedTotal += amount;
        address recipient = recipientOf[projectId];
        emit Claimed(projectId, recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    /// @notice Withdraw everything beyond the funded projects' unclaimed costs.
    function sweep(address to) external onlyOwner onlyDone {
        if (to == address(0)) revert ZeroAddress();
        uint256 owed = _spent() - claimedTotal;
        uint256 amount = token.balanceOf(address(this)) - owed;
        emit Swept(to, amount);
        token.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------- internals

    function _deposit(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _addBudget(amount);
    }

    function _requireBalanceCoversBudget() internal view {
        if (token.balanceOf(address(this)) < _budget()) revert BalanceBelowTotalWeight();
    }

    function _totalSupplyOf(IERC721 nft) private view returns (uint256 supply) {
        (bool ok, bytes memory data) = address(nft).staticcall(abi.encodeCall(IERC721Enumerable.totalSupply, ()));
        if (!ok || data.length < 32) revert SeatsUnknown();
        supply = abi.decode(data, (uint256));
        if (supply == 0) revert SeatsUnknown();
    }

    // ----------------------------------------------------------------- hooks

    function _isSetup() internal view virtual returns (bool);
    function _isOpen() internal view virtual returns (bool);
    function _isDone() internal view virtual returns (bool);
    function _registerProject(uint256 cost_) internal virtual returns (uint256 id);
    function _beforeOpen() internal view virtual;
    function _addBudget(uint256 amount) internal virtual;
    function _budget() internal view virtual returns (uint256);
    function _onContribution(address who, uint256 amount) internal virtual;
    function _onSeatGranted(address who, uint256 perSeat) internal virtual;
    function _onSeatRevoked(address who, uint256 perSeat) internal virtual;
    function _isFunded(uint256 projectId) internal view virtual returns (bool);
    function _costOf(uint256 projectId) internal view virtual returns (uint256);
    function _spent() internal view virtual returns (uint256);
}
