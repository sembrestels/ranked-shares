import { readArkivVoters } from "../../../prover/src/core/arkiv";
import { lpPoolAbi } from "../../../cre/src/lib/lp-abi";
import {
  type Address,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbi,
  type PublicClient,
  stringToHex,
  toHex,
  type WalletClient,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { encrypt } from "../../../cre/src/lib/sealed";
import { Q } from "../../../cre/src/lib/field";
import { validate } from "../../../shared/ranks";
import { pbearTranscript } from "../../../shared/pbear";
import { ballotAbi } from "../../../cre/src/lib/arkiv";
import { loadPayloads, type PublishedBallot, savePending, verifyPublished } from "./arkiv";
import { assertWallet } from "./transactions";
import { privacyAbi, proposalAbi } from "./proposals";

export const votingAbi = parseAbi([
  "function phase() view returns (uint8)",
  "function owner() view returns (address)",
  "function projectCount() view returns (uint256)",
  "function cost(uint256) view returns (uint256)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function totalWeight() view returns (uint256)",
  "function votingDeadline() view returns (uint64)",
  "function abandonGrace() view returns (uint64)",
  "function proofGrace() view returns (uint64)",
  "function directWeight(address) view returns (uint256)",
  "function seatWeight(address) view returns (uint256)",
  "function weightOf(address) view returns (uint256)",
  "function minDirectVote() view returns (uint256)",
  "function minSealedVote() view returns (uint256)",
  "function tallierPk() view returns (bytes)",
  "function tallierPkX() view returns (uint256)",
  "function tallierPkY() view returns (uint256)",
  "function fundedProjects() view returns (uint256[])",
]);
export type PoolKind = PublishedBallot["kind"];
function randomScalar(order: bigint): bigint {
  for (;;) {
    const n = BigInt(toHex(crypto.getRandomValues(new Uint8Array(32))));
    if (n > 0n && n < order) return n;
  }
}
/** Same SEC1/ECDH/keccak encoding as reference/zisk/sealed.py, used by CRE too. */
export function encryptSecp(
  pk: Hex,
  voter: Address,
  ranks: number[],
  scalar = randomScalar(secp256k1.Point.Fn.ORDER),
): Hex {
  const ephemeral = secp256k1.getPublicKey(
    hexToBytes(toHex(scalar, { size: 32 })),
    true,
  );
  const shared = secp256k1.getSharedSecret(
    hexToBytes(toHex(scalar, { size: 32 })),
    hexToBytes(pk),
    true,
  ).slice(1);
  const key = keccak256(
    concat([
      stringToHex("RankedShares/sealed/secp256k1"),
      toHex(shared),
      voter,
    ]),
  );
  const pad: number[] = [];
  for (let block = 0; pad.length < ranks.length; block++) {
    pad.push(
      ...hexToBytes(keccak256(concat([key, toHex(block, { size: 1 })]))),
    );
  }
  return toHex(
    new Uint8Array([...ephemeral, ...ranks.map((rank, i) => rank ^ pad[i])]),
  );
}
export async function ballotPayload(
  client: PublicClient,
  pool: Address,
  account: Address,
  kind: PoolKind,
  sealed: boolean,
  ranks: number[],
): Promise<Hex> {
  if (!validate(ranks, ranks.length)) {
    throw new Error(
      "Use competition ranks: 1, 2, 3; ties use the same rank and skip the following places (1, 1, 3). Zero leaves a project last.",
    );
  }
  if (!sealed) return toHex(new Uint8Array(ranks));
  if (kind === "public") {
    throw new Error("This pool supports public ballots only.");
  }
  if (kind === "noir") {
    const [x, y] = await Promise.all([
      client.readContract({
        address: pool,
        abi: votingAbi,
        functionName: "tallierPkX",
      }),
      client.readContract({
        address: pool,
        abi: votingAbi,
        functionName: "tallierPkY",
      }),
    ]);
    return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, {
      type: "uint256",
    }], encrypt({ x, y }, BigInt(account), ranks, randomScalar(Q)));
  }
  const pk = await client.readContract({
    address: pool,
    abi: votingAbi,
    functionName: "tallierPk",
  });
  return encryptSecp(pk, account, ranks);
}

export async function readVoting(
  client: PublicClient,
  pool: Address,
  account?: Address,
) {
  const block = await client.getBlock();
  const at = {
    address: pool,
    abi: votingAbi,
    blockNumber: block.number,
  } as const;
  const refs = { ...at, abi: ballotAbi } as const;
  const [kindValue, enabled, phase, owner, m, deadline, totalWeight] =
    await Promise.all([
      client.readContract({ ...refs, functionName: "kind" }),
      client.readContract({ ...refs, functionName: "arkivBallots" }),
      client.readContract({ ...at, functionName: "phase" }),
      client.readContract({ ...at, functionName: "owner" }),
      client.readContract({ ...at, functionName: "projectCount" }),
      client.readContract({ ...at, functionName: "votingDeadline" }),
      client.readContract({ ...at, functionName: "totalWeight" }),
    ]);
  if (!["public", "noir", "cre", "zisk"].includes(kindValue)) {
    throw new Error("Unsupported pool implementation.");
  }
  const kind = kindValue as PoolKind;
  const privacy = await client.readContract({
    ...at,
    abi: proposalAbi,
    functionName: "proposalPrivacy",
  }).catch(() => undefined);
  if (m > 255n) throw new Error("Invalid project count.");
  const projects = await Promise.all(
    Array.from({ length: Number(m) }, async (_, id) => ({
      id,
      publishedKey: privacy
        ? await client.readContract({
          address: privacy,
          abi: privacyAbi,
          functionName: "projectKey",
          args: [BigInt(id)],
          blockNumber: block.number,
        })
        : undefined,
      cost: await client.readContract({
        ...at,
        functionName: "cost",
        args: [BigInt(id)],
      }),
      contentRef: await client.readContract({
        ...at,
        functionName: "contentRefOf",
        args: [BigInt(id)],
      }),
    })),
  );
  const grace = kind === "public"
    ? 0n
    : await client.readContract({ ...at, functionName: "abandonGrace" });
  const direct = !account ? 0n : await client.readContract({
    ...at,
    functionName: kind === "public" ? "weightOf" : "directWeight",
    args: [account],
  });
  const seats = !account || kind === "public" ? 0n : await client.readContract({
    ...at,
    functionName: "seatWeight",
    args: [account],
  });
  const lpEligible = !account || kind !== "cre" ? false : await client.readContract({
    ...at, abi: lpPoolAbi, functionName: "canVoteLP", args: [account],
  }).catch(() => false); // Older CRE rounds do not expose the LP extension.
  const publicRef = account
    ? await client.readContract({
      ...refs,
      functionName: "ballotRefOf",
      args: [account, false],
    })
    : undefined;
  const sealedRef = account
    ? await client.readContract({
      ...refs,
      functionName: "ballotRefOf",
      args: [account, true],
    })
    : undefined;
  const minimum = kind === "public"
    ? 0n
    : await client.readContract({ ...at, functionName: "minDirectVote" });
  const minimumSealed = kind !== "noir"
    ? 0n
    : await client.readContract({ ...at, functionName: "minSealedVote" });
  return {
    kind,
    enabled,
    phase,
    owner,
    projects,
    deadline,
    totalWeight,
    grace,
    direct,
    seats,
    lpEligible,
    publicRef,
    sealedRef,
    minimum,
    minimumSealed,
    block: block.number,
    timestamp: block.timestamp,
  };
}
export type VotingRound = Awaited<ReturnType<typeof readVoting>>;

export function votingBlockReason(round: VotingRound, account: Address | undefined, sealed: boolean): string | undefined {
  if (!account) return "Connect your wallet to vote.";
  if (!round.enabled) return "The organizer must enable Arkiv ballot storage before voting opens.";
  if (round.phase !== 1 || round.timestamp >= round.deadline) return "This round is not open for voting.";
  if (sealed) {
    if (round.kind === "public") return "This round only accepts public ballots.";
    if (!((round.seats > 0n && round.seats >= round.minimumSealed) || round.lpEligible)) {
      return "Encrypted voting requires an eligible sponsored seat or liquidity position.";
    }
  } else {
    if (round.kind !== "public" && round.publicRef?.revision !== 0n) {
      return "This wallet's public ballot is already final. It cannot cast another public ballot in this round.";
    }
    if (round.direct <= 0n || round.direct < round.minimum) {
      return "Public voting requires a direct contribution to this round. Enter a contribution with your vote.";
    }
  }
}

export async function publicResults(
  client: PublicClient,
  pool: Address,
  round: VotingRound,
) {
  if (
    round.kind === "public" && round.phase >= 2 ||
    round.kind !== "public" && round.phase === 4
  ) {
    const funded = await client.readContract({
      address: pool,
      abi: votingAbi,
      functionName: "fundedProjects",
      blockNumber: round.block,
    });
    return {
      funded: funded.map(Number),
      ballots: null,
      recovered: 0,
      final: round.phase === (round.kind === "public" ? 3 : 4),
    };
  }
  const voters = await readArkivVoters(client, pool, {
    blockNumber: round.block,
    publicOnly: true,
    load: loadPayloads,
  });
  const pub = voters.filter((v) => v.publicRef.revision > 0n).map((v) => ({
    weight: v.directWeight,
    ballot: [...hexToBytes(v.publicBallot)],
  }));
  const { funded } = pbearTranscript(
    round.projects.map((p) => p.cost),
    pub,
    [],
    round.totalWeight,
  );
  return {
    funded,
    ballots: pub.length,
    recovered: voters.reduce((sum, v) => sum + v.recovered, 0),
    final: false,
  };
}

export async function commitBallot(
  client: PublicClient,
  wallet: WalletClient,
  ballot: PublishedBallot,
) {
  await assertWallet(client, wallet, ballot.account);
  if (await client.getChainId() !== ballot.chainId) {
    throw new Error("This ballot belongs to a different pool network.");
  }
  if (ballot.voteTx) {
    const receipt = await client.waitForTransactionReceipt({
      hash: ballot.voteTx,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      delete ballot.voteTx;
      savePending(ballot);
      throw new Error(
        "The vote transaction reverted. Retry after checking your eligibility and the voting deadline.",
      );
    }
  } else {
    await verifyPublished(ballot);
    const { request } = await client.simulateContract({
      address: ballot.pool,
      abi: ballotAbi,
      functionName: ballot.isSealed ? "voteSealedArkiv" : "voteArkiv",
      args: [ballot.entityKey!, ballot.payload, BigInt(ballot.revision) - 1n],
      account: ballot.account,
    });
    await assertWallet(client, wallet, ballot.account);
    ballot.voteTx = await wallet.writeContract({
      ...request,
      chain: wallet.chain,
    });
    savePending(ballot);
    const receipt = await client.waitForTransactionReceipt({
      hash: ballot.voteTx,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      delete ballot.voteTx;
      savePending(ballot);
      throw new Error(
        "The vote transaction reverted. The stored ballot is ready to retry.",
      );
    }
  }
  const accepted = await client.readContract({
    address: ballot.pool,
    abi: ballotAbi,
    functionName: "ballotRefOf",
    args: [ballot.account, ballot.isSealed],
  });
  if (
    accepted.revision !== BigInt(ballot.revision) ||
    accepted.entityKey.toLowerCase() !== ballot.entityKey?.toLowerCase() ||
    accepted.payloadHash !== keccak256(ballot.payload)
  ) {
    throw new Error(
      "This draft is no longer the pool's current ballot. Refresh the round before preparing another vote.",
    );
  }
  savePending();
}
