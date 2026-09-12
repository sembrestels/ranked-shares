// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";
import {checkWorkflow} from "../lib/CreMetadata.sol";
import {PoolKey, IV4PositionManager, IV4StateView, IV4Subscriber, ILPVotingPool} from "./IV4.sol";
import {TickMath} from "./TickMath.sol";
import {PositionValue} from "./PositionValue.sol";

/// @notice Bounded Arc demo: sponsor money is allocated by integrated LP value.
/// @dev Price updates settle at most 64 positions. Unsubscribe is constant work,
/// with no external calls, valuation maths, or price-history loop.
contract LPVoting is IV4Subscriber, IReceiver {
    error Unauthorized();
    error InvalidTerms();
    error Closed();
    error WrongPool();
    error AlreadyActive();
    error LimitReached();
    error BelowMinimum();
    error StalePrice();
    error BadChunk();

    uint256 public constant MAX_SPONSORSHIPS = 8;
    uint256 public constant MAX_POSITIONS = 64;
    uint256 public constant MAX_ACCOUNTS = 128;
    uint256 public constant MAX_PRICE_AGE = 5 minutes;
    uint256 public constant PRICE_INTERVAL = 60;

    struct Sponsorship {
        address sponsor;
        bytes32 poolId;
        address stable;
        uint256 amount;
        uint256 minimumValue;
        uint160 price;
        uint64 updatedAt;
        uint64 sourceBlock;
        uint256 totalAccrued;
        uint256 settleCursor;
        uint256 allocationCursor;
        uint256 allocated;
        bool stable0;
        bool finalized;
    }

    struct Position {
        uint256 tokenId;
        address owner;
        uint128 liquidity;
        uint160 lower;
        uint160 upper;
        uint64 settledAt;
        uint256 rate;
        bool active;
    }

    ILPVotingPool public immutable pool;
    IV4PositionManager public immutable positionManager;
    IV4StateView public immutable stateView;
    address public immutable forwarder;
    address public immutable workflowOwner;
    bytes10 public immutable workflowName;
    uint64 public immutable deadline;
    Sponsorship[] internal _sponsorships;
    mapping(uint256 => Position[]) internal _positions;
    mapping(uint256 => address[]) internal _accounts;
    mapping(uint256 => mapping(address => bool)) internal _accountSeen;
    mapping(uint256 => mapping(uint256 => uint256)) internal _positionIndex;
    mapping(uint256 => uint256) internal _activeCampaign; // tokenId -> id + 1
    mapping(bytes32 => bool) public sponsoredPool;
    mapping(uint256 => mapping(address => uint256)) public accrued;
    mapping(uint256 => mapping(address => uint256)) public allocatedWeight;
    mapping(address => bool) public registered;
    uint256 public finalizedCount;

    event SponsoredLP(uint256 indexed id, address indexed sponsor, bytes32 indexed poolId, uint256 amount);
    event PositionSubscribed(uint256 indexed id, uint256 indexed tokenId, address indexed owner);
    event PositionStopped(uint256 indexed id, uint256 indexed tokenId);
    event ReferencePriceSet(uint256 indexed id, uint160 price, uint64 sourceBlock, uint64 effectiveAt);
    event LPFinalized(uint256 indexed id, uint256 allocated);

    constructor(
        address pool_,
        address manager_,
        address stateView_,
        address forwarder_,
        address workflowOwner_,
        bytes10 workflowName_
    ) {
        if (
            pool_.code.length == 0 || manager_.code.length == 0 || stateView_.code.length == 0
                || forwarder_ == address(0)
        ) revert InvalidTerms();
        pool = ILPVotingPool(pool_);
        positionManager = IV4PositionManager(manager_);
        stateView = IV4StateView(stateView_);
        if (positionManager.unsubscribeGasLimit() < 200_000 || positionManager.poolManager() != stateView.poolManager())
        {
            revert InvalidTerms();
        }
        deadline = pool.votingDeadline();
        forwarder = forwarder_;
        workflowOwner = workflowOwner_;
        workflowName = workflowName_;
    }

    function sponsorshipCount() external view returns (uint256) {
        return _sponsorships.length;
    }

    function sponsorship(uint256 id) external view returns (Sponsorship memory) {
        return _sponsorships[id];
    }

    function positions(uint256 id) external view returns (Position[] memory) {
        return _positions[id];
    }

    function accounts(uint256 id) external view returns (address[] memory) {
        return _accounts[id];
    }

    function finalized() external view returns (bool) {
        return finalizedCount == _sponsorships.length;
    }

    function positionValue(uint256 id, uint256 tokenId) external view returns (uint256) {
        Sponsorship storage s = _sponsorships[id];
        (PoolKey memory key, uint256 info) = positionManager.getPoolAndPositionInfo(tokenId);
        if (keccak256(abi.encode(key)) != s.poolId) revert WrongPool();
        return PositionValue.value(
            positionManager.getPositionLiquidity(tokenId),
            TickMath.getSqrtPriceAtTick(int24(uint24(info >> 8))),
            TickMath.getSqrtPriceAtTick(int24(uint24(info >> 32))),
            s.price,
            s.stable0
        );
    }

    function sponsor(address who, uint256 amount, PoolKey calldata key, address stable, uint256 minimumValue)
        external
        returns (uint256 id)
    {
        if (msg.sender != address(pool)) revert Unauthorized();
        if (pool.phase() != 1 || block.timestamp >= deadline) revert Closed();
        bytes32 poolId = keccak256(abi.encode(key));
        if (
            key.currency0 >= key.currency1 || (stable != key.currency0 && stable != key.currency1) || minimumValue == 0
                || amount == 0 || sponsoredPool[poolId]
        ) revert InvalidTerms();
        if (_sponsorships.length == MAX_SPONSORSHIPS) revert LimitReached();
        (uint160 price,,,) = stateView.getSlot0(poolId);
        PositionValue.checkPrice(price);
        sponsoredPool[poolId] = true;
        id = _sponsorships.length;
        _sponsorships.push();
        Sponsorship storage s = _sponsorships[id];
        s.sponsor = who;
        s.poolId = poolId;
        s.stable = stable;
        s.amount = amount;
        s.minimumValue = minimumValue;
        s.price = price;
        s.updatedAt = uint64(block.timestamp);
        s.stable0 = stable == key.currency0;
        emit SponsoredLP(id, who, poolId, amount);
        emit ReferencePriceSet(id, price, 0, uint64(block.timestamp));
    }

    function notifySubscribe(uint256 tokenId, bytes calldata data) external {
        if (msg.sender != address(positionManager)) revert Unauthorized();
        if (block.timestamp >= deadline || pool.phase() != 1) revert Closed();
        uint256 id = abi.decode(data, (uint256));
        Sponsorship storage s = _sponsorships[id];
        if (_activeCampaign[tokenId] != 0) revert AlreadyActive();
        (PoolKey memory key, uint256 info) = positionManager.getPoolAndPositionInfo(tokenId);
        if (keccak256(abi.encode(key)) != s.poolId) revert WrongPool();
        uint160 lower = TickMath.getSqrtPriceAtTick(int24(uint24(info >> 8)));
        uint160 upper = TickMath.getSqrtPriceAtTick(int24(uint24(info >> 32)));
        if (lower >= upper) revert InvalidTerms();
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);
        uint256 rate = PositionValue.value(liquidity, lower, upper, s.price, s.stable0);
        if (rate < s.minimumValue) revert BelowMinimum();
        address owner = positionManager.ownerOf(tokenId);
        if (!_accountSeen[id][owner]) {
            if (_accounts[id].length == MAX_ACCOUNTS) revert LimitReached();
            _accountSeen[id][owner] = true;
            _accounts[id].push(owner);
        }
        uint256 index = _positionIndex[id][tokenId];
        if (index == 0) {
            if (_positions[id].length == MAX_POSITIONS) revert LimitReached();
            _positions[id].push();
            index = _positions[id].length;
            _positionIndex[id][tokenId] = index;
        }
        _positions[id][index - 1] =
            Position(tokenId, owner, liquidity, lower, upper, uint64(block.timestamp), rate, true);
        _activeCampaign[tokenId] = id + 1;
        registered[owner] = true;
        emit PositionSubscribed(id, tokenId, owner);
    }

    function notifyModifyLiquidity(uint256 tokenId, int256, int256) external {
        if (msg.sender != address(positionManager) || block.timestamp >= deadline) return;
        uint256 active = _activeCampaign[tokenId];
        if (active == 0) return;
        uint256 id = active - 1;
        Position storage p = _positions[id][_positionIndex[id][tokenId] - 1];
        _settle(id, p);
        p.liquidity = positionManager.getPositionLiquidity(tokenId);
        Sponsorship storage s = _sponsorships[id];
        p.rate = PositionValue.value(p.liquidity, p.lower, p.upper, s.price, s.stable0);
    }

    function notifyUnsubscribe(uint256 tokenId) external {
        _stop(tokenId);
    }

    function notifyBurn(uint256 tokenId, address, uint256, uint256, int256) external {
        _stop(tokenId);
    }

    function _stop(uint256 tokenId) internal {
        if (msg.sender != address(positionManager)) return;
        uint256 active = _activeCampaign[tokenId];
        if (active == 0) return;
        uint256 id = active - 1;
        Position storage p = _positions[id][_positionIndex[id][tokenId] - 1];
        _settle(id, p);
        p.active = false;
        p.rate = 0;
        p.liquidity = 0;
        delete _activeCampaign[tokenId];
        emit PositionStopped(id, tokenId);
    }

    function _settle(uint256 id, Position storage p) internal {
        uint64 until = uint64(block.timestamp < deadline ? block.timestamp : deadline);
        uint256 earned = p.rate * (until - p.settledAt);
        if (earned != 0) {
            accrued[id][p.owner] += earned;
            _sponsorships[id].totalAccrued += earned;
        }
        p.settledAt = until;
    }

    /// @notice Current and projected shares, assuming unchanged liquidity and prices.
    function projection(uint256 id, address who)
        external
        view
        returns (uint256 earned, uint256 total, uint256 projectedWeight)
    {
        Sponsorship storage s = _sponsorships[id];
        earned = accrued[id][who];
        total = s.totalAccrued;
        uint256 projectedOwn = earned;
        uint256 projectedTotal = total;
        uint256 until = block.timestamp < deadline ? block.timestamp : deadline;
        Position[] storage list = _positions[id];
        for (uint256 i; i < list.length; i++) {
            Position storage p = list[i];
            uint256 nowValue = p.rate * (until - p.settledAt);
            uint256 endValue = p.rate * (deadline - p.settledAt);
            total += nowValue;
            projectedTotal += endValue;
            if (p.owner == who) {
                earned += nowValue;
                projectedOwn += endValue;
            }
        }
        if (projectedTotal != 0) projectedWeight = Math.mulDiv(s.amount, projectedOwn, projectedTotal);
    }

    /// @notice Anyone may settle then allocate; each call processes at most maxItems.
    function finalizeLP(uint256 id, uint256 maxItems) public {
        if (block.timestamp < deadline || pool.phase() != 2) revert Closed();
        if (maxItems == 0 || maxItems > MAX_ACCOUNTS) revert BadChunk();
        Sponsorship storage s = _sponsorships[id];
        if (s.finalized) return;
        Position[] storage list = _positions[id];
        uint256 work;
        while (s.settleCursor < list.length && work < maxItems) {
            _settle(id, list[s.settleCursor++]);
            work++;
        }
        if (s.settleCursor != list.length) return;
        address[] storage owners = _accounts[id];
        while (s.allocationCursor < owners.length && work < maxItems) {
            address who = owners[s.allocationCursor++];
            uint256 weight = s.totalAccrued == 0 ? 0 : Math.mulDiv(s.amount, accrued[id][who], s.totalAccrued);
            allocatedWeight[id][who] = weight;
            s.allocated += weight;
            if (weight != 0) pool.creditLP(who, weight);
            work++;
        }
        if (s.allocationCursor == owners.length) {
            s.finalized = true;
            finalizedCount++;
            emit LPFinalized(id, s.allocated);
        }
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert Unauthorized();
        checkWorkflow(metadata, workflowOwner, workflowName);
        (uint8 kind, bytes memory payload) = abi.decode(report, (uint8, bytes));
        if (kind == 5) {
            (uint256 id, uint256 maxItems) = abi.decode(payload, (uint256, uint256));
            finalizeLP(id, maxItems);
        } else if (kind == 4) {
            (uint256 id, uint160 price, uint64 sourceBlock, uint64 observedAt) =
                abi.decode(payload, (uint256, uint160, uint64, uint64));
            _setPrice(id, price, sourceBlock, observedAt);
        } else {
            revert InvalidTerms();
        }
    }

    function _setPrice(uint256 id, uint160 price, uint64 sourceBlock, uint64 observedAt) internal {
        if (block.timestamp >= deadline || pool.phase() != 1) revert Closed();
        Sponsorship storage s = _sponsorships[id];
        if (
            sourceBlock <= s.sourceBlock || observedAt > block.timestamp || block.timestamp - observedAt > MAX_PRICE_AGE
                || block.timestamp < s.updatedAt + PRICE_INTERVAL
        ) revert StalePrice();
        PositionValue.checkPrice(price);
        Position[] storage list = _positions[id];
        for (uint256 i; i < list.length; i++) {
            Position storage p = list[i];
            _settle(id, p);
            if (p.active) p.rate = PositionValue.value(p.liquidity, p.lower, p.upper, price, s.stable0);
        }
        s.price = price;
        s.sourceBlock = sourceBlock;
        s.updatedAt = uint64(block.timestamp);
        emit ReferencePriceSet(id, price, sourceBlock, uint64(block.timestamp));
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == type(IReceiver).interfaceId || id == type(IV4Subscriber).interfaceId
                || id == type(IERC165).interfaceId;
    }
}
