/** One consistent read of a pool: block number first, then every view pinned
 * to it, through the ABI of the detected variant. Spec section 3.3. */
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import { erc20Abi, noirAbi, plainAbi, sealedAbi } from "./abi.ts";
import { detectKind, type Kind } from "./kind.ts";
import { commitmentsFrom, type RosterEntry } from "../services/commitments.ts";
import type { Finality, PhaseName } from "../services/stage.ts";

export interface ProjectView {
  id: number;
  cost: string;
  recipient: Address;
  contentRef: Hex;
  commitment: string;
  funded: boolean;
  claimed: boolean;
}

export interface RoundFacts {
  pool: Address;
  kind: Kind;
  chainId: number;
  block: number;
  token: { address: Address; symbol: string; decimals: number };
  phase: PhaseName;
  votingDeadline: number;
  totalWeight: string;
  spent: string;
  claimedTotal: string;
  projects: ProjectView[];
  fundedOrder: number[];
  proposalCount: number;
  voterCount: number;
  sealed: { total: string; count: number; commitmentsAvailable: boolean };
  closing: { closed: boolean; cursor: number } | null;
  proving: { accepted: number; total: number | null } | null;
  finality: Finality | null;
  graces: { abandonFrom: number | null; provisionalFrom: number | null };
}

export interface ReadOptions {
  rosterPage: number;
  chainId: number;
}

type Abi = typeof plainAbi | typeof sealedAbi | typeof noirAbi;

/** A loosely typed reader: the per-variant ABI is chosen at runtime, so the
 * function names cannot be checked statically. Results are cast at the use. */
export function reader(client: PublicClient, pool: Address, abi: Abi, blockNumber: bigint) {
  return (functionName: string, args: readonly unknown[] = []): Promise<unknown> =>
    client.readContract({ address: pool, abi, functionName, args, blockNumber } as any);
}

export function abiFor(kind: Kind): Abi {
  return kind === "plain" ? plainAbi : kind === "noir" ? noirAbi : sealedAbi;
}

async function chunked<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

const PHASES: Record<Kind, PhaseName[]> = {
  plain: ["setup", "open", "tally", "done"],
  cre: ["setup", "open", "closing", "tally", "done"],
  zisk: ["setup", "open", "closing", "tally", "done"],
  noir: ["setup", "open", "closing", "tally", "done"],
};
const FINALITIES: (Finality | null)[] = [null, "proven", "attested", "abandoned"];

interface Roster {
  entries: RosterEntry[];
  addresses: Set<string>;
  sealedCount: number;
}

export async function readRoster(
  call: ReturnType<typeof reader>,
  kind: Kind,
  voterCount: number,
  page: number,
): Promise<Roster> {
  const entries: RosterEntry[] = [];
  const addresses = new Set<string>();
  let sealedCount = 0;
  if (kind === "plain") {
    const who = await chunked(
      Array.from({ length: voterCount }, (_, i) => i),
      20,
      (i) => call("voterAt", [BigInt(i)]) as Promise<Address>,
    );
    const rows = await chunked(who, 20, async (a) => {
      const [ballot, weight] = await Promise.all([call("ballotOf", [a]), call("weightOf", [a])]);
      return { a, ballot: ballot as Hex, weight: weight as bigint };
    });
    for (const { a, ballot, weight } of rows) {
      addresses.add(a.toLowerCase());
      entries.push({ weight, ballot });
    }
    return { entries, addresses, sealedCount };
  }
  for (let start = 0; start < voterCount; start += page) {
    const count = Math.min(page, voterCount - start);
    const res = await call("votersFrom", [BigInt(start), BigInt(count)]) as unknown[];
    const who = res[0] as Address[];
    const direct = res[1] as bigint[];
    if (kind === "noir") {
      const cts = res[4] as [bigint, bigint, bigint][];
      for (let i = 0; i < who.length; i++) {
        addresses.add(who[i].toLowerCase());
        if (cts[i][0] !== 0n) sealedCount++;
      }
      continue;
    }
    const ballots = res[3] as Hex[];
    const cts = res[4] as Hex[];
    for (let i = 0; i < who.length; i++) {
      addresses.add(who[i].toLowerCase());
      entries.push({ weight: direct[i], ballot: ballots[i] });
      if (cts[i] !== "0x") sealedCount++;
    }
  }
  return { entries, addresses, sealedCount };
}

export async function readRound(
  client: PublicClient,
  pool: Address,
  opts: ReadOptions,
): Promise<{ facts: RoundFacts; roster: Set<string> }> {
  const blockNumber = await client.getBlockNumber();
  const kind = await detectKind(client, pool, blockNumber);
  const call = reader(client, pool, abiFor(kind), blockNumber);

  const [
    token,
    votingDeadline,
    totalWeight,
    spent,
    claimedTotal,
    projectCount,
    fundedRaw,
    proposalCount,
    voterCount,
    phaseRaw,
  ] = await Promise.all([
    call("token"),
    call("votingDeadline"),
    call("totalWeight"),
    call("spent"),
    call("claimedTotal"),
    call("projectCount"),
    call("fundedProjects"),
    call("proposalCount"),
    call("voterCount"),
    call("phase"),
  ]) as [Address, bigint, bigint, bigint, bigint, bigint, bigint[], bigint, bigint, number];

  const tokenAddress = getAddress(token);
  const [decimals, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    })
      .catch(() => "tokens"),
  ]);

  const m = Number(projectCount);
  const n = Number(voterCount);
  const roster = await readRoster(call, kind, n, opts.rosterPage);
  const commitments = kind === "noir"
    ? Array.from({ length: m }, () => 0n)
    : commitmentsFrom(roster.entries, m);

  const projects = await chunked(Array.from({ length: m }, (_, id) => id), 10, async (id) => {
    const [cost, recipient, contentRef, funded, claimed] = await Promise.all([
      call("cost", [BigInt(id)]),
      call("recipientOf", [BigInt(id)]),
      call("contentRefOf", [BigInt(id)]),
      call("funded", [BigInt(id)]),
      call("claimed", [BigInt(id)]),
    ]) as [bigint, Address, Hex, boolean, boolean];
    return {
      id,
      cost: cost.toString(),
      recipient: getAddress(recipient),
      contentRef,
      commitment: commitments[id].toString(),
      funded,
      claimed,
    } satisfies ProjectView;
  });

  const phase = PHASES[kind][Number(phaseRaw)] ?? "setup";
  const deadline = Number(votingDeadline);
  let finality: Finality | null = null;
  let closing: RoundFacts["closing"] = null;
  let proving: RoundFacts["proving"] = null;
  const graces: RoundFacts["graces"] = { abandonFrom: null, provisionalFrom: null };
  let sealedTotal = 0n;
  let sealedCount = roster.sealedCount;

  if (kind === "plain") {
    const [tallyDone, rankLevel] = await Promise.all([call("tallyDone"), call("rankLevel")]) as [
      boolean,
      bigint,
    ];
    finality = tallyDone ? "counted" : null;
    if (phase === "tally") proving = { accepted: Number(rankLevel), total: null };
  } else {
    const [finalityRaw, closed, closeCursor, abandonGrace, totalSeatWeight] = await Promise.all([
      call("finality"),
      call("closed"),
      call("closeCursor"),
      call("abandonGrace"),
      call("totalSeatWeight"),
    ]) as [number, boolean, bigint, bigint, bigint];
    finality = FINALITIES[finalityRaw] ?? null;
    closing = { closed, cursor: Number(closeCursor) };
    sealedTotal = totalSeatWeight;
    if (phase === "closing" || phase === "tally") {
      graces.abandonFrom = deadline + Number(abandonGrace);
    }
    if (kind === "noir") {
      const [count, reported, reportedAt, proofGrace, ingestCursor, numBatches] = await Promise.all(
        [
          call("sealedCount"),
          call("resultReported"),
          call("reportedAt"),
          call("proofGrace"),
          call("ingestCursor"),
          call("numBatches"),
        ],
      ) as [bigint, boolean, bigint, bigint, bigint, bigint];
      sealedCount = Number(count);
      if (phase === "tally") {
        proving = { accepted: Number(ingestCursor), total: Number(numBatches) };
      }
      if (reported && phase !== "done") {
        graces.provisionalFrom = Number(reportedAt) + Number(proofGrace);
      }
    }
  }

  const facts: RoundFacts = {
    pool: getAddress(pool),
    kind,
    chainId: opts.chainId,
    block: Number(blockNumber),
    token: { address: tokenAddress, symbol: symbol as string, decimals: Number(decimals) },
    phase,
    votingDeadline: deadline,
    totalWeight: totalWeight.toString(),
    spent: spent.toString(),
    claimedTotal: claimedTotal.toString(),
    projects,
    fundedOrder: fundedRaw.map((x) => Number(x)),
    proposalCount: Number(proposalCount),
    voterCount: n,
    sealed: {
      total: sealedTotal.toString(),
      count: sealedCount,
      commitmentsAvailable: kind !== "noir",
    },
    closing,
    proving,
    finality,
    graces,
  };
  return { facts, roster: roster.addresses };
}
