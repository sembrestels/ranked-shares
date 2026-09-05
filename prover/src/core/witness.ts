// prover/src/core/witness.ts — InputMaps matching the circuits' `main` signatures
import type { InputMap } from "@noir-lang/noir_js";
import type { ProofPlan } from "./state";
import { skLimbs } from "./key";
import type { State } from "@lib/commitments";

const d = (n: bigint | number) => n.toString();

function stateInput(s: State) {
  return {
    weights: s.weights.map(d),
    ballots: s.ballots.map(d),
    funded: s.funded,
    funded_order: s.fundedOrder.map(d),
    funded_count: d(s.fundedCount),
    level: d(s.level),
    spent: d(s.spent),
    done: s.done,
    m: d(s.m),
    budget: d(s.budget),
    t_hash: d(s.tHash),
  };
}

export function ingestInputs(plan: ProofPlan, k: number): InputMap {
  const pi = plan.expected.ingest[k]!;
  const { lo, hi } = skLimbs(plan.sk);
  const entries = [];
  for (let j = 0; j < plan.profile.batch; j++) {
    const v = plan.sealed[k * plan.profile.batch + j];
    entries.push(v ? { addr: d(v.addr), seat_weight: d(v.seatWeight), rx: d(v.ciphertext![0]), ry: d(v.ciphertext![1]), c: d(v.ciphertext![2]) } : { addr: "0", seat_weight: "0", rx: "0", ry: "0", c: "0" });
  }
  return {
    k: d(pi[0]!),
    n_sealed: d(pi[1]!),
    m: d(pi[2]!),
    budget: d(pi[3]!),
    pk_x: d(pi[4]!),
    pk_y: d(pi[5]!),
    h_in: d(pi[6]!),
    h_out: d(pi[7]!),
    state_in: d(pi[8]!),
    state_out: d(pi[9]!),
    sk_lo: lo,
    sk_hi: hi,
    state: stateInput(plan.ingestBefore[k]!),
    entries,
  } as unknown as InputMap;
}

export function tallyInputs(plan: ProofPlan, g: number): InputMap {
  const pi = plan.expected.tally[g]!;
  const group = plan.tallyGroups[g]!;
  const m = plan.snapshot.m;
  const pad = (arr: bigint[], len: number) => [...arr, ...new Array<bigint>(len - arr.length).fill(0n)].map(d);
  return {
    costs_hash: d(pi[0]!),
    state_in: d(pi[1]!),
    state_out: d(pi[2]!),
    done: d(pi[3]!),
    t_hash_out: d(pi[4]!),
    funded_count: d(pi[5]!),
    funded_order_packed: d(pi[6]!),
    costs: pad(plan.snapshot.costs, plan.profile.mMax),
    state: stateInput(group.stateIn),
    steps: group.steps.map((step) => ({ level: d(step[0]!), pub_support: pad(step.slice(1, m + 1), plan.profile.mMax), best: d(step[m + 1]!), total: d(step[m + 2]!) })),
  } as unknown as InputMap;
}
