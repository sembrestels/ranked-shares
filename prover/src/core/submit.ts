// prover/src/core/submit.ts — resumes the proof chain and drives `advance` on the pool
import { toHex, type Address, type PublicClient, type WalletClient } from "viem";
import abi from "../../../cre/src/abi/SealedRankedShares.json";
import { stateCommit } from "@lib/commitments";
import type { Snapshot } from "./chain";
import type { ProofPlan } from "./state";
import { ingestInputs, tallyInputs } from "./witness";
import type { Prover } from "./prove";

export async function runChain(
  client: PublicClient,
  wallet: WalletClient,
  plan: ProofPlan,
  snapshot: Snapshot,
  prover: Prover,
  log: (s: string) => void,
  opts?: { restart?: boolean },
): Promise<void> {
  const pool = snapshot.pool as Address;
  const read = async <T,>(fn: string, args: unknown[] = []) => (await client.readContract({ address: pool, abi, functionName: fn, args } as any)) as T;
  const advance = async (proof: Uint8Array, pi: `0x${string}`[], restart: boolean) => {
    const hash = await wallet.writeContract({
      address: pool,
      abi,
      functionName: "advance",
      args: [toHex(proof), pi, restart],
      account: wallet.account!,
      chain: wallet.chain,
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

  const resultReported = await read<boolean>("resultReported");
  if (!resultReported) {
    log("transcript not reported yet; stopping after ingest");
    return;
  }

  const lastGroup = plan.tallyGroups[plan.tallyGroups.length - 1]!;
  const onChain = await read<bigint>("stateCommit");
  if (onChain === stateCommit(plan.profile, lastGroup.stateOut)) {
    log("already Proven");
    return;
  }

  let g = plan.tallyGroups.findIndex((grp) => stateCommit(plan.profile, grp.stateIn) === onChain);
  let restart = opts?.restart ?? g < 0;
  if (g < 0) {
    log("on-chain tally state does not match this transcript; restarting from the ingested state");
    g = 0;
  }
  for (; g < plan.tallyGroups.length; g++) {
    log(`proving tally group ${g}`);
    const out = await prover.prove("tally", tallyInputs(plan, g));
    const r = await advance(out.proof, out.publicInputs, restart);
    restart = false;
    log(`tally ${g} accepted, gas ${r.gasUsed}`);
  }
  const finality = Number(await read<bigint>("finality"));
  log(finality === 1 ? "Proven" : `finality ${finality}`);
}
