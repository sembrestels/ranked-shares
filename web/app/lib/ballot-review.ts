import { bytes32, key } from "@arkiv-network/sdk/attr";
import { eq, or } from "@arkiv-network/sdk/query";
import { type Address, type Hex, type PublicClient, toHex } from "viem";
import {
  ballotAbi, ballotAlias, checkedPayload, MAX_VOTERS, rosterPage, type BallotRef,
} from "../../../cre/src/lib/arkiv";
import { arkiv } from "./arkiv";

export type ReviewRow = {
  voter: Address;
  isSealed: boolean;
  entityKey: Hex;
  revision: bigint;
  expiresAt?: bigint;
  status: "available" | "expiry-passed" | "unavailable" | "invalid";
  payload?: Hex;
};
export type BallotReviewData = {
  rows: ReviewRow[];
  poolBlock: bigint;
  arkivBlock: bigint | null;
};

/** Read only current Arkiv payloads for inspection. Unlike tally witnesses, this
 * view never recovers calldata, invents abstentions, or retains expired payloads.
 * Previous rows supply expiry metadata only; absence is not proof of expiration
 * when this client has never observed the entity (it could have been deleted).
 */
export async function readBallotReview(
  client: PublicClient,
  pool: Address,
  previous: readonly ReviewRow[] = [],
): Promise<BallotReviewData> {
  const poolBlock = await client.getBlockNumber({ cacheTime: 0 });
  const at = { address: pool, abi: ballotAbi, blockNumber: poolBlock } as const;
  const count = Number(await client.readContract({ ...at, functionName: "voterCount" }));
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_VOTERS) {
    throw new Error("Voter count exceeds the supported review limit.");
  }
  const accepted: { voter: Address; isSealed: boolean; ref: BallotRef }[] = [];
  for (let start = 0; start < count; start += 50) {
    const roster = rosterPage(await client.readContract({
      ...at, functionName: "voterRefsFrom", args: [BigInt(start), 50n],
    }), Math.min(50, count - start));
    for (const voter of roster) {
      for (const isSealed of [false, true]) {
        const ref = isSealed ? voter.sealedRef : voter.publicRef;
        if (ref.revision) accepted.push({ voter: voter.address, isSealed, ref });
      }
    }
  }
  if (!accepted.length) return { rows: [], poolBlock, arkivBlock: null };
  const [chainId, arkivBlock] = await Promise.all([
    arkiv.getChainId(), arkiv.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (chainId !== arkiv.chain.id) throw new Error("The Arkiv RPC is on the wrong network.");
  const knownExpiry = new Map(previous.map((r) => [r.entityKey.toLowerCase(), r.expiresAt]));
  const keys = [...new Set(accepted.map(({ ref }) => ref.entityKey.toLowerCase() as Hex))];
  const entities = new Map<string, { payload: Uint8Array; expiresAt: bigint }>();
  for (let start = 0; start < keys.length; start += 100) {
    let page = await arkiv.select({ key: true, payload: true, expiresAt: true, attributes: true })
      .where(or(...keys.slice(start, start + 100).flatMap((k) => [eq("$key", key(k)), eq("ballot_id", bytes32(k))])))
      .atBlock(arkivBlock).limit(200).fetch();
    for (;;) {
      if (page.blockNumber !== arkivBlock) {
        throw new Error("Arkiv returned a different snapshot. Refresh the ballot review.");
      }
      for (const entity of page.entities) {
        entities.set(entity.key.toLowerCase(), entity);
        const alias = ballotAlias(entity.attributes, toHex(entity.payload));
        if (alias) entities.set(alias, entity);
      }
      if (!page.hasNextPage()) break;
      page = await page.next();
    }
  }
  const rows = accepted.map(({ voter, isSealed, ref }): ReviewRow => {
    const entity = entities.get(ref.entityKey.toLowerCase());
    const expiresAt = entity?.expiresAt ?? knownExpiry.get(ref.entityKey.toLowerCase());
    const row = { voter, isSealed, entityKey: ref.entityKey, revision: ref.revision, expiresAt };
    // Always respect the latest observed expiry; an owner may have extended it.
    if (expiresAt !== undefined && expiresAt <= arkivBlock) {
      return { ...row, status: "expiry-passed" };
    }
    if (!entity) return { ...row, status: "unavailable" };
    try {
      return { ...row, status: "available", payload: checkedPayload(ref, toHex(entity.payload)) };
    } catch {
      return { ...row, status: "invalid" };
    }
  });
  return { rows, poolBlock, arkivBlock };
}
