// prover/src/core/profile.ts — resolving a pool's circuit profile from its on-chain
// parameters. Lives on its own so both `chain.ts` (which bounds its reads by the profile)
// and `state.ts` (which plans the proofs) can use it without importing each other.
import * as cm from "@lib/commitments";

export function profileFor(nSealedMax: number, mMax: number, batch: number): cm.Profile {
  const p = Object.values(cm.PROFILES).find((x) => x.nSealedMax === nSealedMax && x.mMax === mMax && x.batch === batch);
  if (!p) throw new Error(`no circuit profile for E=${nSealedMax} M=${mMax} B=${batch}`);
  return p;
}
