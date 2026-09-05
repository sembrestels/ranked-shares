// prover/src/core/submit.ts — resumes the proof chain and drives `advance` on the pool
import { toHex, type Address, type Chain, type PublicClient, type WalletClient } from "viem";
import abi from "../../../cre/src/abi/SealedRankedShares.json";
import { stateCommit } from "@lib/commitments";
import { read, type Snapshot } from "./chain";
import type { ProofPlan } from "./state";
import { ingestInputs, tallyInputs } from "./witness";
import type { Prover } from "./prove";

export type TallyPlan = { g: number; restart: boolean } | "proven";

/**
 * Where to resume the tally chain, given the on-chain `stateCommit` and this plan's
 * tally groups. Pure and chain-free so it can be unit tested against a fixture plan.
 * Assumes `plan.tallyGroups` is non-empty; the caller guards that case.
 *
 * `advance(..., restart=true)` resets the on-chain `stateCommit` to `ingestedState`
 * before checking `stateIn` (`_advanceTally`, src/SealedRankedShares.sol), so any
 * restart — whether forced via `opts.restart` or auto-detected because the on-chain
 * state matches none of this transcript's tally groups — must resume at group 0,
 * never at whatever index `findIndex` happened to land on.
 */
export function planTally(onChain: bigint, plan: ProofPlan, opts?: { restart?: boolean }): TallyPlan {
  const lastGroup = plan.tallyGroups[plan.tallyGroups.length - 1]!;
  if (onChain === stateCommit(plan.profile, lastGroup.stateOut)) return "proven";
  const found = plan.tallyGroups.findIndex((grp) => stateCommit(plan.profile, grp.stateIn) === onChain);
  const restart = opts?.restart ?? found < 0;
  if (!restart && found < 0) throw new Error("on-chain tally state matches no known group; a restart is required");
  return { g: restart ? 0 : found, restart };
}

export async function runChain(
  client: PublicClient,
  wallet: WalletClient,
  plan: ProofPlan,
  snapshot: Snapshot,
  prover: Prover,
  log: (s: string) => void,
  opts?: { restart?: boolean; account?: Address; chain?: Chain | null },
): Promise<void> {
  const pool = snapshot.pool as Address;
  const account = opts?.account ?? wallet.account!;
  const chain = opts?.chain ?? wallet.chain;
  const advance = async (proof: Uint8Array, pi: `0x${string}`[], restart: boolean) => {
    const hash = await wallet.writeContract({
      address: pool,
      abi,
      functionName: "advance",
      args: [toHex(proof), pi, restart],
      account,
      chain,
    } as any);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`advance reverted: ${hash}`);
    return receipt;
  };

  const numBatches = plan.expected.ingest.length;
  if (snapshot.ingestCursor >= numBatches) {
    log("all ingest batches already on chain");
  } else {
    for (let k = snapshot.ingestCursor; k < numBatches; k++) {
      log(`proving ingest batch ${k}`);
      const out = await prover.prove("ingest", ingestInputs(plan, k));
      const r = await advance(out.proof, out.publicInputs, false);
      log(`ingest ${k} accepted, gas ${r.gasUsed}`);
    }
  }

  const resultReported = await read<boolean>(client, pool, "resultReported");
  if (!resultReported) {
    log("transcript not reported yet; stopping after ingest");
    return;
  }

  if (plan.tallyGroups.length === 0) {
    log("no tally groups to prove");
    return;
  }

  const onChain = await read<bigint>(client, pool, "stateCommit");
  const decision = planTally(onChain, plan, opts);
  if (decision === "proven") {
    log("already Proven");
    return;
  }
  let { g, restart } = decision;
  if (restart) log("restarting the tally chain from group 0");
  for (; g < plan.tallyGroups.length; g++) {
    log(`proving tally group ${g}`);
    const out = await prover.prove("tally", tallyInputs(plan, g));
    const r = await advance(out.proof, out.publicInputs, restart);
    restart = false;
    log(`tally ${g} accepted, gas ${r.gasUsed}`);
  }
  const finality = Number(await read<bigint>(client, pool, "finality"));
  log(finality === 1 ? "Proven" : `finality ${finality}`);
}
