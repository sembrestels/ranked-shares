import { parseAbi } from "viem";

export const poolKeyStruct =
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }";
export const lpAbi = parseAbi([
  "struct Sponsorship { address sponsor; bytes32 poolId; address stable; uint256 amount; uint256 minimumValue; uint160 price; uint64 updatedAt; uint64 sourceBlock; uint256 totalAccrued; uint256 settleCursor; uint256 allocationCursor; uint256 allocated; bool stable0; bool finalized; }",
  "struct Position { uint256 tokenId; address owner; uint128 liquidity; uint160 lower; uint160 upper; uint64 settledAt; uint256 rate; bool active; }",
  "function pool() view returns (address)",
  "function positionManager() view returns (address)",
  "function stateView() view returns (address)",
  "function deadline() view returns (uint64)",
  "function sponsorshipCount() view returns (uint256)",
  "function sponsorship(uint256 id) view returns (Sponsorship)",
  "function positions(uint256 id) view returns (Position[])",
  "function positionValue(uint256 id,uint256 tokenId) view returns (uint256)",
  "function projection(uint256 id,address who) view returns (uint256 earned,uint256 total,uint256 projectedWeight)",
  "function allocatedWeight(uint256 id,address who) view returns (uint256)",
  "function finalized() view returns (bool)",
  "function registered(address who) view returns (bool)",
  "function finalizeLP(uint256 id,uint256 maxItems)",
  "function onReport(bytes metadata,bytes report)",
  "event ReferencePriceSet(uint256 indexed id,uint160 price,uint64 sourceBlock,uint64 effectiveAt)",
]);
export const lpPoolAbi = parseAbi([
  poolKeyStruct,
  "function lpVoting() view returns (address)",
  "function sponsorLP(uint256 amount,PoolKey key,address stable,uint256 minimumValue) returns (uint256)",
  "function canVoteLP(address who) view returns (bool)",
  "function phase() view returns (uint8)",
  "function token() view returns (address)",
  "function totalWeight() view returns (uint256)",
  "function costs() view returns (uint256[])",
  "function inputsHash() view returns (bytes32)",
  "function keySalt() view returns (bytes32)",
  "function tallierPk() view returns (bytes)",
  "function votersFrom(uint256 start,uint256 count) view returns (address[],uint256[],uint256[],bytes[],bytes[])",
]);
export const positionManagerAbi = parseAbi([
  poolKeyStruct,
  "function getPoolAndPositionInfo(uint256 tokenId) view returns (PoolKey,uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function subscriber(uint256 tokenId) view returns (address)",
  "function subscribe(uint256 tokenId,address subscriber,bytes data) payable",
  "function unsubscribe(uint256 tokenId) payable",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160,int24,uint24,uint24)",
]);
