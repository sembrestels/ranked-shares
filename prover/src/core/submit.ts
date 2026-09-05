// prover/src/core/submit.ts — resumes the proof chain and drives `advance` on the pool
import { toHex, type Account, type Address, type Chain, type PublicClient, type WalletClient } from "viem";
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

/**
 * Where someone else — the caller of a `submit: false` run — should start submitting the
 * proofs this run produced, read off the pool's current state.
 */
export type Resume = { ingestFrom: number; tallyFrom: number; restart: boolean };

/**
 * The resume hint for a run that proves everything rather than submitting it. `restart`
 * is true only when ingest is already complete on chain yet the on-chain `stateCommit`
 * belongs to no group of this transcript (and is not the final `stateOut`) — the one case
 * where the chain has to be reset to `ingestedState` before the tally proofs apply.
 * Pure and chain-free, like `planTally`.
 */
export function resumeHint(onChain: bigint, plan: ProofPlan, snapshot: Pick<Snapshot, "ingestCursor">): Resume {
  const ingestFrom = snapshot.ingestCursor;
  const groups = plan.tallyGroups;
  // Ingest still pending: submitting it lands the chain on group 0's stateIn by
  // construction, so the tally starts at 0 with no restart whatever it reads now.
  if (ingestFrom < plan.expected.ingest.length || groups.length === 0) return { ingestFrom, tallyFrom: 0, restart: false };
  if (onChain === stateCommit(plan.profile, groups[groups.length - 1]!.stateOut)) return { ingestFrom, tallyFrom: groups.length, restart: false };
  const found = groups.findIndex((grp) => stateCommit(plan.profile, grp.stateIn) === onChain);
  return { ingestFrom, tallyFrom: found < 0 ? 0 : found, restart: found < 0 };
}

export type OnProof = (p: { kind: "ingest" | "tally"; index: number; proof: Uint8Array; publicInputs: `0x${string}`[]; restart: boolean }) => void | Promise<void>;

/**
 * Proves — and, with `submit` (the default), submits — everything the pool still needs.
 *
 * With `submit: false` nothing is sent, so nothing the chain would have to accept first
 * can be assumed: every ingest batch from `ingestCursor` and every tally group from 0 is
 * proved, and the returned `Resume` says where whoever submits them should start.
 * With `submit: true` the run resumes the tally chain itself via `planTally` and returns
 * null.
 *
 * With `batch` (and `submit`), the proofs are not sent one `advance` at a time: everything
 * this run proves is collected and sent as a single `advanceMany`, which is one wallet
 * confirmation and one transaction fee instead of one per proof. The proofs, their order
 * and the `restart` decision are exactly the same either way — `advanceMany` applies to
 * each element the rules `advance` applies to it — so the only difference a caller sees is
 * that nothing lands until the last proof is ready, and that a single rejected proof
 * reverts the whole batch.
 */
export async function runChain(
  client: PublicClient,
  wallet: WalletClient,
  plan: ProofPlan,
  snapshot: Snapshot,
  prover: Prover,
  log: (s: string) => void,
  opts?: { restart?: boolean; account?: Account | Address; chain?: Chain | null; submit?: boolean; batch?: boolean; onProof?: OnProof },
): Promise<Resume | null> {
  const pool = snapshot.pool as Address;
  const submit = opts?.submit ?? true;
  const account = opts?.account ?? wallet.account!;
  const chain = opts?.chain ?? wallet.chain;
  /** Collect the proofs and send them as one `advanceMany`. Only meaningful with `submit`. */
  const batched = submit && (opts?.batch ?? false);
  /** True once the pool is Proven or Attested: `advance` is closed and nothing may be sent. */
  const isDone = async () => Number(await read<bigint>(client, pool, "finality")) !== 0;
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

  type Proved = { proof: Uint8Array; publicInputs: `0x${string}`[] };
  /** What a batched run has proved and not yet sent, in chain order. */
  const pending: Proved[] = [];
  /** The `restart` the batch carries; the pool applies it to the batch's first tally proof. */
  let batchRestart = false;
  /**
   * Send the pending proofs as one `advanceMany`. Returns false when the pool was finalized
   * while this run was proving — the same guard the unbatched path applies before each
   * `advance`, moved to the one place a batched run actually sends.
   */
  const flush = async (): Promise<boolean> => {
    if (pending.length === 0) return true;
    if (await isDone()) {
      log("pool finalized while proving; nothing submitted");
      return false;
    }
    const hash = await wallet.writeContract({
      address: pool,
      abi,
      functionName: "advanceMany",
      args: [pending.map((p) => toHex(p.proof)), pending.map((p) => p.publicInputs), batchRestart],
      account,
      chain,
    } as any);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`advanceMany reverted: ${hash}`);
    log(`advanceMany accepted, ${pending.length} proofs, gas ${receipt.gasUsed}`);
    pending.length = 0;
    return true;
  };
  // Notify a caller that wants the raw proof (e.g. the prove service handing it back to
  // whoever asked) whether or not this run also submits it itself.
  const emit = async (kind: "ingest" | "tally", index: number, out: { proof: Uint8Array; publicInputs: `0x${string}`[] }, restart = false) => {
    if (opts?.onProof) await opts.onProof({ kind, index, proof: out.proof, publicInputs: out.publicInputs, restart });
  };

  // The pool may have been finalized (Attested after `proofGrace`, or Proven by someone
  // else) between the snapshot and now; `advance` would revert, so don't send anything.
  if (await isDone()) {
    log("pool already finalized; nothing to advance");
    return submit ? null : { ingestFrom: snapshot.ingestCursor, tallyFrom: 0, restart: false };
  }

  const numBatches = plan.expected.ingest.length;
  if (snapshot.ingestCursor >= numBatches) {
    log("all ingest batches already on chain");
  } else {
    for (let k = snapshot.ingestCursor; k < numBatches; k++) {
      log(`proving ingest batch ${k}`);
      const out = await prover.prove("ingest", ingestInputs(plan, k));
      await emit("ingest", k, out);
      if (batched) {
        pending.push(out);
        log(`proved ingest ${k}`);
      } else if (submit) {
        const r = await advance(out.proof, out.publicInputs, false);
        log(`ingest ${k} accepted, gas ${r.gasUsed}`);
      } else {
        log(`ingest ${k} proved`);
      }
    }
  }

  /** Stop before the tally, sending whatever a batched run has proved so far. */
  const noTally = async (): Promise<Resume | null> => {
    if (batched) await flush();
    return submit ? null : { ingestFrom: snapshot.ingestCursor, tallyFrom: 0, restart: false };
  };

  if (plan.tallyError) {
    // The reported transcript didn't replay (see `rebuild`); the ingest batches above are
    // still valid and, if `submit`, already landed, so surface this without failing the run.
    log(`tally plan unavailable: ${plan.tallyError}`);
    return await noTally();
  }

  const resultReported = await read<boolean>(client, pool, "resultReported");
  if (!resultReported) {
    log("transcript not reported yet; stopping after ingest");
    return await noTally();
  }

  if (plan.tallyGroups.length === 0) {
    log("no tally groups to prove");
    return await noTally();
  }

  const onChain = await read<bigint>(client, pool, "stateCommit");
  let g = 0;
  let restart = false;
  let resume: Resume | null = null;
  if (submit) {
    const decision = planTally(onChain, plan, opts);
    if (decision === "proven") {
      log("already Proven");
      return null;
    }
    ({ g, restart } = decision);
    batchRestart = restart;
    if (restart) log("restarting the tally chain from group 0");
  } else {
    resume = resumeHint(onChain, plan, snapshot);
    log(`resume hint: ingest from ${resume.ingestFrom}, tally from ${resume.tallyFrom}, restart ${resume.restart}`);
  }
  for (; g < plan.tallyGroups.length; g++) {
    log(`proving tally group ${g}`);
    const out = await prover.prove("tally", tallyInputs(plan, g));
    await emit("tally", g, out, resume ? g === resume.tallyFrom && resume.restart : restart);
    if (batched) {
      pending.push(out);
      log(`proved tally ${g}`);
    } else if (submit) {
      // Between proving and sending, someone may have accepted the provisional result or
      // proven the pool themselves; either way `advance` is closed.
      if (await isDone()) {
        log("pool finalized while proving; nothing submitted");
        return null;
      }
      const r = await advance(out.proof, out.publicInputs, restart);
      log(`tally ${g} accepted, gas ${r.gasUsed}`);
    } else {
      log(`tally ${g} proved`);
    }
    restart = false;
  }
  if (submit) {
    if (batched && !(await flush())) return null;
    const finality = Number(await read<bigint>(client, pool, "finality"));
    log(finality === 1 ? "Proven" : `finality ${finality}`);
  } else {
    log("all tally groups proved");
  }
  return resume;
}
