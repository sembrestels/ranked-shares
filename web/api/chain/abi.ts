/** Read ABIs per pool variant. Same-named functions differ between variants
 * (directBallotOf, sealedOf, votersFrom), so each variant has its own ABI and
 * the reader picks one after detectKind(). Signatures from the contract
 * survey of 2026-09-12 (spec section 3.3). */
import { parseAbi } from "viem";

const base = [
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function votingOpen() view returns (bool)",
  "function votingDeadline() view returns (uint64)",
  "function totalWeight() view returns (uint256)",
  "function spent() view returns (uint256)",
  "function claimedTotal() view returns (uint256)",
  "function projectCount() view returns (uint256)",
  "function cost(uint256 projectId) view returns (uint256)",
  "function recipientOf(uint256 projectId) view returns (address)",
  "function contentRefOf(uint256 projectId) view returns (bytes32)",
  "function funded(uint256 projectId) view returns (bool)",
  "function claimed(uint256 projectId) view returns (bool)",
  "function fundedProjects() view returns (uint256[])",
  "function proposalCount() view returns (uint256)",
  "function voterCount() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function kind() pure returns (string)",
  "function arkivBallots() view returns (bool)",
  "struct BallotRef { bytes32 entityKey; bytes32 payloadHash; uint256 revision; uint256 blockNumber; }",
  "function ballotRefOf(address voter, bool isSealed) view returns (BallotRef)",
  "function voterRefsFrom(uint256 start, uint256 count) view returns (address[] who, uint256[] direct, uint256[] seats, BallotRef[] publicRefs, BallotRef[] sealedRefs)",
] as const;

const sealedCommon = [
  "function finality() view returns (uint8)",
  "function closed() view returns (bool)",
  "function closeCursor() view returns (uint256)",
  "function abandonGrace() view returns (uint64)",
  "function totalSeatWeight() view returns (uint256)",
  "function directWeight(address voter) view returns (uint256)",
  "function seatWeight(address voter) view returns (uint256)",
] as const;

export const plainAbi = parseAbi(
  [
    ...base,
    "function tallyStarted() view returns (bool)",
    "function tallyDone() view returns (bool)",
    "function rankLevel() view returns (uint256)",
    "function voterAt(uint256 index) view returns (address)",
    "function ballotOf(address voter) view returns (bytes)",
    "function weightOf(address voter) view returns (uint256)",
  ] as const,
);

export const sealedAbi = parseAbi(
  [
    ...base,
    ...sealedCommon,
    "function directBallotOf(address voter) view returns (bytes)",
    "function sealedOf(address voter) view returns (bytes)",
    "function votersFrom(uint256 start, uint256 count) view returns (address[] who, uint256[] direct, uint256[] seats, bytes[] ballots, bytes[] cts)",
  ] as const,
);

export const noirAbi = parseAbi(
  [
    ...base,
    ...sealedCommon,
    "function profileId() view returns (bytes32)",
    "function proofGrace() view returns (uint64)",
    "function reportedAt() view returns (uint64)",
    "function resultReported() view returns (bool)",
    "function ingestCursor() view returns (uint256)",
    "function numBatches() view returns (uint256)",
    "function sealedCount() view returns (uint256)",
    "function hasDirect(address voter) view returns (bool)",
    "function directBallotOf(address voter) view returns (uint256)",
    "function sealedOf(address voter) view returns (uint256 rx, uint256 ry, uint256 c)",
    "function votersFrom(uint256 start, uint256 count) view returns (address[] who, uint256[] direct, uint256[] ballots, uint256[] seats, uint256[3][] cts, bool[] hasDirectFlags)",
  ] as const,
);

export const erc20Abi = parseAbi(
  [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ] as const,
);
