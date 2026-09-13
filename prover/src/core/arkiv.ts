// Async EVM / Arkiv reader for browsers and Node. Kept outside CRE's Javy source
// tree, where HTTP is available only through DON capabilities.
import {
  type Address,
  decodeFunctionData,
  type Hex,
  parseAbiItem,
  type PublicClient,
} from "viem";
import {
  ARKIV_RPC,
  ballotAbi,
  type BallotRef,
  checkedPayload,
  MAX_VOTERS,
  payloadQuery,
  payloadReply,
  type ResolvedVoter,
  rosterPage,
} from "../../../cre/src/lib/arkiv";

export async function fetchPayloads(
  keys: readonly Hex[],
  rpc = ARKIV_RPC,
): Promise<Map<string, Hex>> {
  const out = new Map<string, Hex>();
  for (let i = 0; i < keys.length; i += 200) {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadQuery(keys.slice(i, i + 200))),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Arkiv RPC returned HTTP ${response.status}.`);
    }
    for (const [key, value] of payloadReply(await response.json())) {
      out.set(key, value);
    }
  }
  return out;
}

/** Recover accepted bytes from their original vote transaction if Arkiv expires.
 * Contract commitments authenticate the bytes even for smart-account calls; only
 * direct wallet calls can be decoded here. Other callers must supply an archive.
 */
export async function recoverPayload(
  client: PublicClient,
  pool: Address,
  voter: Address,
  isSealed: boolean,
  ref: BallotRef,
): Promise<Hex> {
  const publications = await client.getLogs({
    address: pool,
    event: parseAbiItem("event BallotPublished(address indexed voter,bool indexed isSealed,bytes32 indexed ballotId,uint256 revision,bytes payload)"),
    args: { voter, isSealed, ballotId: ref.entityKey },
    fromBlock: ref.blockNumber, toBlock: ref.blockNumber,
  });
  for (const log of publications) {
    if (log.args.ballotId?.toLowerCase() === ref.entityKey.toLowerCase() && log.args.revision === ref.revision) return checkedPayload(ref, log.args.payload);
  }
  const logs = await client.getLogs({
    address: pool,
    event: parseAbiItem(
      "event BallotStored(address indexed voter,bool indexed isSealed,bytes32 indexed entityKey,bytes32 payloadHash,uint256 revision)",
    ),
    args: { voter, isSealed, entityKey: ref.entityKey },
    fromBlock: ref.blockNumber,
    toBlock: ref.blockNumber,
  });
  for (const log of logs) {
    if (log.args.revision !== ref.revision || !log.transactionHash) continue;
    const tx = await client.getTransaction({ hash: log.transactionHash });
    if (
      tx.to?.toLowerCase() !== pool.toLowerCase() ||
      tx.from.toLowerCase() !== voter.toLowerCase() ||
      tx.blockHash !== log.blockHash
    ) continue;
    const decoded = decodeFunctionData({ abi: ballotAbi, data: tx.input });
    if (decoded.functionName !== (isSealed ? "voteSealedArkiv" : "voteArkiv")) {
      continue;
    }
    const [key, payload, previous] = decoded.args as readonly [
      Hex,
      Hex,
      bigint,
    ];
    if (
      key.toLowerCase() === ref.entityKey.toLowerCase() &&
      previous + 1n === ref.revision
    ) return checkedPayload(ref, payload);
  }
  throw new Error(
    `Unable to recover accepted ballot ${ref.entityKey}. Results cannot be calculated from incomplete ballots.`,
  );
}

export async function readArkivVoters(
  client: PublicClient,
  pool: Address,
  options: {
    blockNumber?: bigint;
    publicOnly?: boolean;
    load?: (keys: readonly Hex[]) => Promise<Map<string, Hex>>;
  } = {},
): Promise<ResolvedVoter[]> {
  const blockNumber = options.blockNumber ??
    await client.getBlockNumber({ cacheTime: 0 });
  const at = { address: pool, abi: ballotAbi, blockNumber } as const;
  const n = Number(
    await client.readContract({ ...at, functionName: "voterCount" }),
  );
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_VOTERS) {
    throw new Error("Voter count exceeds the supported read limit.");
  }
  const out: ResolvedVoter[] = [];
  for (let start = 0; start < n; start += 50) {
    const roster = rosterPage(
      await client.readContract({
        ...at,
        functionName: "voterRefsFrom",
        args: [BigInt(start), 50n],
      }),
      Math.min(50, n - start),
    );
    const refs = roster.flatMap((v) =>
      options.publicOnly ? [v.publicRef] : [v.publicRef, v.sealedRef]
    );
    const keys = [
      ...new Set(
        refs.filter((ref) => ref.revision > 0n).map((ref) => ref.entityKey),
      ),
    ];
    const payloads = await (options.load ?? fetchPayloads)(keys).catch(() =>
      new Map<string, Hex>()
    );
    // Roster ordering is consensus relevant for integer deductions. Never sort by
    // Arkiv time, discard a missing accepted ballot, or count an uncommitted row.
    for (const voter of roster) {
      let recovered = 0;
      const resolve = async (ref: BallotRef, isSealed: boolean) => {
        if (!ref.revision || (isSealed && options.publicOnly)) {
          return "0x" as Hex;
        }
        try {
          return checkedPayload(ref, payloads.get(ref.entityKey.toLowerCase()));
        } catch {
          recovered++;
          return recoverPayload(client, pool, voter.address, isSealed, ref);
        }
      };
      const publicBallot = await resolve(voter.publicRef, false);
      const sealedBallot = await resolve(voter.sealedRef, true);
      out.push({ ...voter, publicBallot, sealedBallot, recovered });
    }
  }
  return out;
}
