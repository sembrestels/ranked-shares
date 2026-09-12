// Canonical ballot reads shared by the frontend and the Noir prover. Arkiv is
// discovery/availability; only the pool's current reference authorizes a ballot.
import {
  type Address,
  decodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbi,
} from "viem";
import { pack, validate } from "../../../shared/ranks";
import type { Voter } from "./entries";

export const ARKIV_RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
export const ARKIV_CHAIN_ID = 7738577;
export const BALLOT_SCHEMA = "ranked-shares.ballot.v1";
export const MAX_VOTERS = 100_000;
export const ballotAbi = parseAbi([
  "struct BallotRef { bytes32 entityKey; bytes32 payloadHash; uint256 revision; uint256 blockNumber; }",
  "struct BallotData { bytes publicBallot; bytes sealedBallot; }",
  "function arkivBallots() view returns (bool)",
  "function enableArkivBallots()",
  "function kind() view returns (string)",
  "function voterCount() view returns (uint256)",
  "function ballotRefOf(address voter, bool isSealed) view returns (BallotRef)",
  "function voterRefsFrom(uint256 start,uint256 count) view returns (address[] who,uint256[] direct,uint256[] seats,BallotRef[] publicRefs,BallotRef[] sealedRefs)",
  "function voteArkiv(bytes32 entityKey,bytes payload,uint256 expectedRevision)",
  "function voteSealedArkiv(bytes32 entityKey,bytes payload,uint256 expectedRevision)",
  "function closeArkiv(uint256 expectedCursor,BallotData[] ballots)",
  "function closeCursor() view returns (uint256)",
  "function startTally()",
  "function runArkiv(uint256 maxSteps,bytes[] ballots)",
  "event BallotStored(address indexed voter,bool indexed isSealed,bytes32 indexed entityKey,bytes32 payloadHash,uint256 revision)",
]);
export type BallotRef = {
  entityKey: Hex;
  payloadHash: Hex;
  revision: bigint;
  blockNumber: bigint;
};
export type BallotData = { publicBallot: Hex; sealedBallot: Hex };
export type RosterEntry = {
  address: Address;
  directWeight: bigint;
  seatWeight: bigint;
  publicRef: BallotRef;
  sealedRef: BallotRef;
};
export type ResolvedVoter = RosterEntry & BallotData & { recovered: number };
export type RefPage = readonly [
  readonly Address[],
  readonly bigint[],
  readonly bigint[],
  readonly BallotRef[],
  readonly BallotRef[],
];

export function rosterPage(page: RefPage, expected: number): RosterEntry[] {
  if (page.some((part) => part.length !== expected)) {
    throw new Error("Incomplete voter roster from the pool RPC.");
  }
  return page[0].map((address, i) => ({
    address,
    directWeight: page[1][i],
    seatWeight: page[2][i],
    publicRef: page[3][i],
    sealedRef: page[4][i],
  }));
}

export function checkedPayload(ref: BallotRef, payload: Hex | undefined): Hex {
  if (ref.revision === 0n) return "0x";
  if (
    payload === undefined || !/^0x(?:[a-fA-F0-9]{2})*$/.test(payload) ||
    keccak256(payload) !== ref.payloadHash.toLowerCase()
  ) {
    throw new Error(
      `Ballot ${ref.entityKey} is missing or does not match its on-chain hash.`,
    );
  }
  return payload;
}

// Small raw-RPC seam also usable by the synchronous CRE HTTP capability. Keys are
// validated before interpolation; user-supplied strings never enter query syntax.
export function payloadQuery(keys: readonly Hex[]) {
  if (
    !keys.length || keys.length > 200 ||
    keys.some((k) => !/^0x[0-9a-fA-F]{64}$/.test(k))
  ) throw new Error("Invalid Arkiv entity keys.");
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "arkiv_query",
    params: [keys.map((k) => `$key = key(${k})`).join(" OR "), {
      select: { key: true, payload: true },
      limit: "0xc8",
    }],
  };
}
export function payloadReply(reply: unknown): Map<string, Hex> {
  const body = reply as {
    error?: unknown;
    result?: { data?: { key?: string; payload?: string }[]; cursor?: string };
  };
  if (body?.error || !Array.isArray(body?.result?.data) || body.result.cursor) {
    throw new Error("Arkiv did not return a complete ballot response.");
  }
  const out = new Map<string, Hex>();
  for (const row of body.result.data) {
    if (
      !/^0x[0-9a-fA-F]{64}$/.test(row.key ?? "") ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(row.payload ?? "")
    ) throw new Error("Malformed Arkiv payload.");
    out.set(row.key!.toLowerCase(), row.payload as Hex);
  }
  return out;
}
export function toNoirVoter(voter: ResolvedVoter, m: number): Voter {
  const ranks = [...hexToBytes(voter.publicBallot)];
  if (voter.publicRef.revision && !validate(ranks, m)) {
    throw new Error("Invalid accepted public ballot.");
  }
  let ciphertext: [bigint, bigint, bigint] | null = null;
  if (voter.sealedRef.revision) {
    if (voter.sealedBallot.length !== 194) {
      throw new Error("Invalid accepted Noir ciphertext length.");
    }
    ciphertext = [
      ...decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, {
        type: "uint256",
      }], voter.sealedBallot),
    ];
  }
  return {
    addr: BigInt(voter.address),
    directWeight: voter.directWeight,
    seatWeight: voter.seatWeight,
    hasDirect: voter.publicRef.revision > 0n,
    directPacked: pack(ranks),
    ciphertext,
  };
}
