import { readArkivVoters } from "./arkiv";
// prover/src/core/chain.ts — reads the pool's on-chain state into a Snapshot
import { type Address, type PublicClient, parseAbiItem } from "viem";
import abi from "../../../cre/src/abi/NoirRankedShares.json";
import { isSealed, type Voter } from "@lib/entries";
import { profileFor } from "./profile";
import { ballotAbi, toNoirVoter } from "@lib/arkiv";

/**
 * The most voters a snapshot will page through. A pool's roster is bounded only by
 * `minDirectVote` on chain, so a bad or hostile RPC answer (or a genuinely enormous
 * pool) must not turn `readPoolSnapshot` into an unbounded read loop.
 */
export const MAX_VOTERS = 100_000;
const VOTER_PAGE = 50;
/** `getLogs` window, small enough for RPC providers that cap the range. */
const LOG_CHUNK = 10_000n;

export type Snapshot = {
  pool: Address;
  phase: number;
  m: number;
  costs: bigint[];
  totalWeight: bigint;
  keySalt: `0x${string}`;
  batch: number;
  nSealedMax: number;
  mMax: number;
  pkX: bigint;
  pkY: bigint;
  coordinator: Address;
  /** The workflow owner `onReport` authorizes, or the zero address when the check is off. */
  workflowOwner: Address;
  /** The workflow name `onReport` authorizes, or ten zero bytes to accept any name. */
  workflowName: `0x${string}`;
  sealedCount: number;
  numBatches: number;
  checkpoints: bigint[];
  costsHash: bigint;
  inputsRoot: `0x${string}`;
  resultReported: boolean;
  transcriptHash: bigint;
  ingestCursor: number;
  stateCommit: bigint;
  ingestedState: bigint;
  transcript: bigint[][] | null;
  provisional: number[];
  voters: Voter[];
};

export async function read<T>(client: PublicClient, pool: Address, functionName: string, args: unknown[] = [], blockNumber?: bigint): Promise<T> {
  return (await client.readContract({ address: pool, abi, functionName, args, blockNumber } as any)) as T;
}

/**
 * Every `Transcript` log from `fromBlock` to the latest block, fetched in windows of at
 * most `LOG_CHUNK` blocks so providers that cap `eth_getLogs` ranges still answer.
 */
async function transcriptLogs(client: PublicClient, pool: Address, fromBlock: bigint): Promise<{ args: { transcript?: readonly bigint[] } }[]> {
  const event = parseAbiItem("event Transcript(uint256[] transcript)");
  // `cacheTime: 0`: viem caches `getBlockNumber` for `pollingInterval` (4s by default) per
  // client, and a caller that reuses one client across reads would otherwise stop the
  // window short of a block mined moments ago — losing a `Transcript` reported just now.
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const out: { args: { transcript?: readonly bigint[] } }[] = [];
  for (let from = fromBlock; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
    out.push(...(await client.getLogs({ address: pool, event, fromBlock: from, toBlock: to })));
  }
  return out;
}

export async function readPoolSnapshot(client: PublicClient, pool: Address, fromBlock = 0n): Promise<Snapshot> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const at = <T>(functionName: string, args: unknown[] = []) => read<T>(client, pool, functionName, args, blockNumber);
  const [
    phase,
    costs,
    totalWeight,
    keySalt,
    batch,
    nSealedMax,
    mMax,
    pkX,
    pkY,
    coordinator,
    workflowOwner,
    workflowName,
    sealedCount,
    numBatches,
    costsHash,
    inputsRoot,
    resultReported,
    transcriptHash,
    ingestCursor,
    stateCommit,
    ingestedState,
    provisional,
    n,
  ] = await Promise.all([
    at<number>("phase"),
    at<bigint[]>("costs"),
    at<bigint>("totalWeight"),
    at<`0x${string}`>("keySalt"),
    at<bigint>("batch"),
    at<bigint>("nSealedMax"),
    at<bigint>("mMax"),
    at<bigint>("tallierPkX"),
    at<bigint>("tallierPkY"),
    at<Address>("coordinator"),
    at<Address>("workflowOwner"),
    at<`0x${string}`>("workflowName"),
    at<bigint>("sealedCount"),
    at<bigint>("numBatches"),
    at<bigint>("costsHash"),
    at<`0x${string}`>("inputsRoot"),
    at<boolean>("resultReported"),
    at<bigint>("transcriptHash"),
    at<bigint>("ingestCursor"),
    at<bigint>("stateCommit"),
    at<bigint>("ingestedState"),
    at<bigint[]>("provisionalResult"),
    at<bigint>("voterCount"),
  ]);
  // Bound both loops below before running them: the profile fixes how many ingest
  // batches can exist, and MAX_VOTERS caps the roster paging.
  const profile = profileFor(Number(nSealedMax), Number(mMax), Number(batch));
  const maxBatches = Math.ceil(profile.nSealedMax / profile.batch);
  if (Number(numBatches) > maxBatches) {
    throw new Error(`pool ${pool} reports numBatches=${numBatches}, above the ${profile.name} profile's maximum of ${maxBatches}`);
  }
  const voterCount = Number(n);
  if (voterCount > MAX_VOTERS) {
    throw new Error(`pool ${pool} reports voterCount=${n}, above MAX_VOTERS=${MAX_VOTERS}`);
  }
  const checkpoints: bigint[] = [];
  for (let k = 0; k <= Number(numBatches); k++) checkpoints.push(await at<bigint>("checkpoint", [BigInt(k)]));
  const voters: Voter[] = [];
  // Old deployed contracts have no arkivBallots selector. A failed probe is only
  // a compatibility fallback; new Arkiv pools must never use the empty legacy maps.
  const arkiv = await client.readContract({ address: pool, abi: ballotAbi, functionName: "arkivBallots", blockNumber }).catch(() => false);
  if (arkiv) {
    voters.push(...(await readArkivVoters(client, pool, { blockNumber })).map((v) => toNoirVoter(v, costs.length)));
  }
  for (let start = 0; !arkiv && start < voterCount; start += VOTER_PAGE) {
    const [who, direct, ballots, seats, cts, flags] = await at<[Address[], bigint[], bigint[], bigint[], [bigint, bigint, bigint][], boolean[]]>("votersFrom", [
      BigInt(start),
      BigInt(VOTER_PAGE),
    ]);
    who.forEach((a, i) =>
      voters.push({
        addr: BigInt(a),
        directWeight: direct[i]!,
        seatWeight: seats[i]!,
        hasDirect: flags[i]!,
        directPacked: ballots[i]!,
        ciphertext: isSealed(cts[i]!) ? [cts[i]![0], cts[i]![1], cts[i]![2]] : null,
      }),
    );
  }
  let transcript: bigint[][] | null = null;
  if (resultReported) {
    const logs = await transcriptLogs(client, pool, fromBlock);
    if (logs.length === 0) throw new Error(`no Transcript event for ${pool} at or after block ${fromBlock}`);
    const flat = [...(logs[logs.length - 1]!.args.transcript ?? [])];
    const width = costs.length + 3;
    transcript = [];
    for (let i = 0; i < flat.length; i += width) transcript.push(flat.slice(i, i + width));
  }
  return {
    pool,
    phase: Number(phase),
    m: costs.length,
    costs,
    totalWeight,
    keySalt,
    batch: Number(batch),
    nSealedMax: Number(nSealedMax),
    mMax: Number(mMax),
    pkX,
    pkY,
    coordinator,
    workflowOwner,
    workflowName,
    sealedCount: Number(sealedCount),
    numBatches: Number(numBatches),
    checkpoints,
    costsHash,
    inputsRoot,
    resultReported,
    transcriptHash,
    ingestCursor: Number(ingestCursor),
    stateCommit,
    ingestedState,
    transcript,
    provisional: provisional.map(Number),
    voters,
  };
}
