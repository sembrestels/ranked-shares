/** Public commitment per project: the direct weight of every voter whose
 * public ballot gives the project competition rank 1 (ties included). This
 * is the number a donor recognises as "what I put behind it"; any-rank sums
 * would exceed the budget. Spec decision 1. */
import { type Hex, hexToBytes } from "viem";

export interface RosterEntry {
  weight: bigint;
  /** One byte per project, competition rank; "0x" when the voter has no public ballot. */
  ballot: Hex;
}

export function commitmentsFrom(entries: readonly RosterEntry[], projectCount: number): bigint[] {
  const out = Array.from({ length: projectCount }, () => 0n);
  for (const { weight, ballot } of entries) {
    if (weight === 0n || ballot === "0x") continue;
    const ranks = hexToBytes(ballot);
    const n = Math.min(projectCount, ranks.length);
    for (let p = 0; p < n; p++) if (ranks[p] === 1) out[p] += weight;
  }
  return out;
}
