// prover/src/core/audit.ts — replays the on-chain public block against the reported transcript
import type { Address, PublicClient } from "viem";
import { NONE } from "@lib/field";
import { publicEntries } from "@lib/entries";
import { replayPublic } from "@lib/pbear";
import { readPoolSnapshot } from "./chain";

export async function audit(client: PublicClient, pool: Address, fromBlock = 0n): Promise<{ ok: boolean; firstProblem?: string }> {
  const s = await readPoolSnapshot(client, pool, fromBlock);
  if (!s.resultReported || !s.transcript) return { ok: false, firstProblem: "no transcript reported yet" };
  const ok = replayPublic(s.costs, publicEntries(s.voters, s.m), s.transcript, s.totalWeight);
  if (!ok) return { ok, firstProblem: "the public block does not reproduce the reported transcript" };
  const funded = s.transcript
    .map((st) => st[s.m + 1]!)
    .filter((b) => b !== NONE)
    .map(Number);
  if (funded.join(",") !== s.provisional.join(",")) return { ok: false, firstProblem: "funded set differs from the transcript" };
  return { ok: true };
}
