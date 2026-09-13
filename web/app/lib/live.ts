/** Public commitment per project from public ballots: the direct weight of every
 * voter whose ballot gives the project competition rank 1, ties included. */
export interface LiveEntry {
  weight: bigint;
  ballot: number[];
}

export function commitmentsFromEntries(entries: readonly LiveEntry[], projectCount: number): bigint[] {
  const out = Array.from({ length: projectCount }, () => 0n);
  for (const { weight, ballot } of entries) {
    if (weight === 0n) continue;
    const n = Math.min(projectCount, ballot.length);
    for (let p = 0; p < n; p++) if (ballot[p] === 1) out[p] += weight;
  }
  return out;
}
