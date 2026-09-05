// prover/src/core/chain.ts — reads the pool's on-chain state into a Snapshot
import { type Address, type PublicClient, parseAbiItem } from "viem";
import abi from "../../../cre/src/abi/SealedRankedShares.json";
import type { Voter } from "@lib/entries";

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

export async function read<T>(client: PublicClient, pool: Address, functionName: string, args: unknown[] = []): Promise<T> {
  return (await client.readContract({ address: pool, abi, functionName, args } as any)) as T;
}

export async function readPoolSnapshot(client: PublicClient, pool: Address, fromBlock = 0n): Promise<Snapshot> {
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
    read<number>(client, pool, "phase"),
    read<bigint[]>(client, pool, "costs"),
    read<bigint>(client, pool, "totalWeight"),
    read<`0x${string}`>(client, pool, "keySalt"),
    read<bigint>(client, pool, "batch"),
    read<bigint>(client, pool, "nSealedMax"),
    read<bigint>(client, pool, "mMax"),
    read<bigint>(client, pool, "tallierPkX"),
    read<bigint>(client, pool, "tallierPkY"),
    read<Address>(client, pool, "coordinator"),
    read<bigint>(client, pool, "sealedCount"),
    read<bigint>(client, pool, "numBatches"),
    read<bigint>(client, pool, "costsHash"),
    read<`0x${string}`>(client, pool, "inputsRoot"),
    read<boolean>(client, pool, "resultReported"),
    read<bigint>(client, pool, "transcriptHash"),
    read<bigint>(client, pool, "ingestCursor"),
    read<bigint>(client, pool, "stateCommit"),
    read<bigint>(client, pool, "ingestedState"),
    read<bigint[]>(client, pool, "provisionalResult"),
    read<bigint>(client, pool, "voterCount"),
  ]);
  const checkpoints: bigint[] = [];
  for (let k = 0; k <= Number(numBatches); k++) checkpoints.push(await read<bigint>(client, pool, "checkpoint", [BigInt(k)]));
  const voters: Voter[] = [];
  for (let start = 0; start < Number(n); start += 50) {
    const [who, direct, ballots, seats, cts, flags] = await read<[Address[], bigint[], bigint[], bigint[], [bigint, bigint, bigint][], boolean[]]>(client, pool, "votersFrom", [BigInt(start), 50n]);
    who.forEach((a, i) =>
      voters.push({
        addr: BigInt(a),
        directWeight: direct[i]!,
        seatWeight: seats[i]!,
        hasDirect: flags[i]!,
        directPacked: ballots[i]!,
        ciphertext: cts[i]![0] === 0n ? null : [cts[i]![0], cts[i]![1], cts[i]![2]],
      }),
    );
  }
  let transcript: bigint[][] | null = null;
  if (resultReported) {
    const logs = await client.getLogs({ address: pool, event: parseAbiItem("event Transcript(uint256[] transcript)"), fromBlock, toBlock: "latest" });
    const flat = (logs[logs.length - 1]!.args as any).transcript as bigint[];
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
