// cre/src/lib/commitments.ts — port of reference/noir/commitments.py
import { NONE } from "./field";
import { addressBytes, concatBytes, keccak, wordBE } from "./hash";
import { cumulativeDeductions } from "./pbear";
import { sponge } from "./poseidon2";
import { effectiveRanks, unpack } from "./sealed";
import type { Voter } from "./entries";

export { NONE };

export type Profile = { name: string; nSealedMax: number; mMax: number; batch: number; k: number };
export const PROFILES: Record<string, Profile> = {
  default: { name: "default", nSealedMax: 256, mMax: 16, batch: 32, k: 8 },
  test: { name: "test", nSealedMax: 8, mMax: 4, batch: 2, k: 2 },
};

export class TranscriptMismatch extends Error {}

export function publicChain(voters: Voter[]): Uint8Array {
  let h: Uint8Array = new Uint8Array(32);
  for (const v of voters) {
    if (!v.hasDirect) continue;
    h = keccak(concatBytes(h, addressBytes(v.addr), wordBE(v.directWeight), wordBE(v.directPacked)));
  }
  return h;
}

export function sealedChain(voters: Voter[], batch: number): { h: bigint; checkpoints: bigint[] } {
  const sealed = voters.filter((v) => v.ciphertext !== null);
  let h = 0n;
  const checkpoints = [0n];
  sealed.forEach((v, j) => {
    const [rx, ry, c] = v.ciphertext!;
    h = sponge([h, v.addr, v.seatWeight, rx, ry, c]);
    if ((j + 1) % batch === 0 || j + 1 === sealed.length) checkpoints.push(h);
  });
  if (sealed.length === 0) checkpoints.push(0n);
  return { h, checkpoints };
}

export function costsHash(costs: bigint[]): bigint {
  return sponge(costs);
}

export function inputsRoot(hPub: Uint8Array, hSealed: bigint, sealedCount: number, costsHashValue: bigint, totalWeight: bigint): Uint8Array {
  return keccak(concatBytes(hPub, wordBE(hSealed), wordBE(BigInt(sealedCount)), wordBE(costsHashValue), wordBE(totalWeight)));
}

export function transcriptHashAfter(t: bigint, step: bigint[]): bigint {
  return sponge([t, ...step]);
}

export function transcriptHash(transcript: bigint[][]): bigint {
  return transcript.reduce((t, step) => transcriptHashAfter(t, step), 0n);
}

export type State = {
  weights: bigint[];
  ballots: bigint[];
  funded: boolean[];
  fundedOrder: number[];
  fundedCount: number;
  level: number;
  spent: bigint;
  done: boolean;
  m: number;
  budget: bigint;
  tHash: bigint;
};

export function emptyState(p: Profile, m: number, budget: bigint): State {
  return {
    weights: new Array<bigint>(p.nSealedMax).fill(0n),
    ballots: new Array<bigint>(p.nSealedMax).fill(0n),
    funded: new Array<boolean>(p.mMax).fill(false),
    fundedOrder: new Array<number>(p.mMax).fill(0),
    fundedCount: 0,
    level: 1,
    spent: 0n,
    done: false,
    m,
    budget,
    tHash: 0n,
  };
}

export function cloneState(s: State): State {
  return { ...s, weights: [...s.weights], ballots: [...s.ballots], funded: [...s.funded], fundedOrder: [...s.fundedOrder] };
}

export function fundedBits(s: State): bigint {
  return s.funded.reduce((bits, f, c) => (f ? bits | (1n << BigInt(c)) : bits), 0n);
}

export function fundedOrderPacked(s: State): bigint {
  let packed = 0n;
  for (let j = 0; j < s.fundedCount; j++) packed += BigInt(s.fundedOrder[j]) << BigInt(8 * j);
  return packed;
}

export function stateCommit(p: Profile, s: State): bigint {
  if (s.weights.length !== p.nSealedMax || s.funded.length !== p.mMax) throw new Error("state does not match profile");
  return sponge([...s.weights, ...s.ballots, fundedBits(s), fundedOrderPacked(s), BigInt(s.fundedCount), BigInt(s.level), s.spent, s.done ? 1n : 0n, BigInt(s.m), s.budget, s.tHash]);
}

export function ingest(s: State, index: number, seatWeight: bigint, packed: bigint | null): void {
  if (packed === null) {
    s.weights[index] = 0n;
    s.ballots[index] = 0n;
  } else {
    s.weights[index] = seatWeight;
    s.ballots[index] = packed;
  }
}

function exhausted(s: State, costs: bigint[]): boolean {
  for (let c = 0; c < s.m; c++) if (!s.funded[c] && s.spent + costs[c] <= s.budget) return false;
  return true;
}

export function tallyStep(p: Profile, s: State, costs: bigint[], step: bigint[]): void {
  const m = s.m;
  if (s.done) return;
  if (exhausted(s, costs)) {
    s.done = true;
    return;
  }
  if (step.length !== m + 3) throw new TranscriptMismatch("step length");
  const level = Number(step[0]);
  const pub = step.slice(1, m + 1);
  const best = step[m + 1];
  const total = step[m + 2];
  if (level !== s.level) throw new TranscriptMismatch("level");
  s.tHash = transcriptHashAfter(s.tHash, step);
  const ranks = s.weights.map((w, e) => {
    if (w === 0n) return null;
    const r = unpack(s.ballots[e], m);
    return r === null ? null : effectiveRanks(r, m);
  });
  const sealed = new Array<bigint>(m).fill(0n);
  ranks.forEach((r, e) => {
    if (r === null) return;
    for (let c = 0; c < m; c++) if (!s.funded[c] && r[c] <= level) sealed[c] += s.weights[e];
  });
  const sum = pub.map((x, c) => x + sealed[c]);
  let arg: number | null = null;
  for (let c = 0; c < m; c++) {
    if (s.funded[c] || sum[c] < costs[c]) continue;
    if (arg === null || sum[c] > sum[arg] || (sum[c] === sum[arg] && costs[c] < costs[arg])) arg = c;
  }
  if (best !== (arg === null ? NONE : BigInt(arg))) throw new TranscriptMismatch("best");
  if (best === NONE) {
    if (total !== 0n) throw new TranscriptMismatch("total");
    if (level >= m) s.done = true;
    else s.level += 1;
    return;
  }
  const b = Number(best);
  if (total !== sum[b]) throw new TranscriptMismatch("total");
  const thr = costs[b];
  const sup = ranks.map((r, e) => (r !== null && r[b] <= level ? e : -1)).filter((e) => e >= 0);
  const ded = cumulativeDeductions(sup.map((e) => s.weights[e]), thr, total, pub[b]);
  sup.forEach((e, j) => (s.weights[e] -= ded[j]));
  s.funded[b] = true;
  s.fundedOrder[s.fundedCount] = b;
  s.fundedCount += 1;
  s.spent += thr;
  if (exhausted(s, costs)) s.done = true;
}
