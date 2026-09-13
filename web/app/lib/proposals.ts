import {
  type Address,
  type Hex,
  isAddress,
  maxUint256,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";

export const proposalAbi = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function votingOpen() view returns (bool)",
  "function votingDeadline() view returns (uint64)",
  "function proposalCount() view returns (uint256)",
  "function proposals(uint256) view returns (address proposer, bytes32 contentRef, uint256 cost, address recipient, uint8 status, uint256 projectId)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function proposalRevision(uint256) view returns (uint256)",
  "function proposalEditor(uint256) view returns (address)",
  "function propose(bytes32 contentRef, uint256 cost, address recipient) returns (uint256)",
  "function editProposal(uint256 id, uint256 expectedRevision, bytes32 contentRef, uint256 cost, address recipient)",
  "function acceptProposal(uint256 id, uint256 expectedRevision) returns (uint256)",
  "function rejectProposal(uint256 id, uint256 expectedRevision)",
  "function addProject(uint256 cost, address recipient) returns (uint256)",
  "function projectCount() view returns (uint256)",
  "event Proposed(uint256 indexed proposalId, address indexed proposer, bytes32 contentRef, uint256 cost, address recipient)",
  "event ProposalAccepted(uint256 indexed proposalId, uint256 indexed projectId)",
  "event ProposalRejected(uint256 indexed proposalId)",
  "event ProposalEdited(uint256 indexed proposalId, address indexed editor, uint256 revision, bytes32 previousContentRef, bytes32 contentRef, uint256 cost, address recipient)",
  "error EmptyContentReference()",
  "error ZeroProposalCost()",
  "error ZeroAddress()",
  "error InvalidProposal()",
  "error ProposalAlreadyReviewed()",
  "error UnauthorizedProposalEditor()",
  "error StaleProposalRevision(uint256 expected, uint256 actual)",
  "error WrongPhase()",
  "error DeadlinePassed()",
  "error CostTooLarge()",
  "error TooManyProjects()",
  "error OwnableUnauthorizedAccount(address account)",
]);

export type Proposal = {
  id: bigint;
  proposer: Address;
  contentRef: Hex;
  cost: bigint;
  recipient: Address;
  status: number;
  projectId: bigint;
  revision: bigint;
  editor: Address;
};

export const statuses = ["Pending review", "Accepted", "Rejected"] as const;

export function proposalTerms(
  amount: string,
  recipient: string,
  decimals: number,
) {
  if (
    !/^\d+(\.\d+)?$/.test(amount) ||
    (amount.split(".")[1]?.length ?? 0) > decimals
  ) {
    throw new Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  }
  const cost = parseUnits(amount, decimals);
  if (cost <= 0n || cost > maxUint256) {
    throw new Error(
      "Enter a positive amount within the token's supported range.",
    );
  }
  if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress) {
    throw new Error("Enter a valid, nonzero recipient wallet address.");
  }
  return { cost, recipient: recipient as Address };
}

export function errorMessage(error: unknown): string {
  // viem nests decoded contract errors under the simulation/transaction error.
  const cause = error && typeof error === "object" && "walk" in error &&
      typeof error.walk === "function"
    ? error.walk((e: { data?: { errorName?: string } }) => !!e.data?.errorName)
    : undefined;
  if (cause?.data?.errorName === "StaleProposalRevision") {
    return "This proposal changed while you were reviewing it. Refresh and read the latest revision before saving or deciding.";
  }
  if (cause?.data?.errorName === "ProposalAlreadyReviewed") {
    return "This proposal has already been accepted or rejected and can no longer be edited.";
  }
  if (error && typeof error === "object" && "shortMessage" in error) {
    return String(error.shortMessage);
  }
  return error instanceof Error ? error.message : String(error);
}
