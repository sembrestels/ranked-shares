// prover/src/core/state.ts — the plan of proofs, as reference/tools/noir_inputs.py computes it
import { toBig } from "@lib/field";
import * as cm from "@lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "@lib/entries";
import { pbearTranscript } from "@lib/pbear";
import { pack } from "@lib/sealed";
import type { Snapshot } from "./chain";

export type ProofPlan = {
  profile: cm.Profile;
  snapshot: Pick<Snapshot, "m" | "costs" | "totalWeight" | "pkX" | "pkY" | "checkpoints" | "costsHash" | "voters" | "sealedCount" | "numBatches">;
  sk: bigint;
  sealed: Voter[];
  ingestBefore: cm.State[]; // state before batch k
  ingestAfter: cm.State[]; // state after batch k
  transcript: bigint[][];
  tallyGroups: { stateIn: cm.State; steps: bigint[][]; stateOut: cm.State }[];
  expected: { ingest: bigint[][]; tally: bigint[][] };
};

export function profileFor(nSealedMax: number, mMax: number, batch: number): cm.Profile {
  const p = Object.values(cm.PROFILES).find((x) => x.nSealedMax === nSealedMax && x.mMax === mMax && x.batch === batch);
  if (!p) throw new Error(`no circuit profile for E=${nSealedMax} M=${mMax} B=${batch}`);
  return p;
}

export function rebuild(
  s: ProofPlan["snapshot"] & { nSealedMax: number; mMax: number; batch: number; transcript?: bigint[][] | null },
  sk: bigint,
): ProofPlan {
  const profile = profileFor(s.nSealedMax, s.mMax, s.batch);
  const sealed = sealedVoters(s.voters);
  const entries = sealedEntries(s.voters, sk, s.m);
  const state = cm.emptyState(profile, s.m, s.totalWeight);
  const ingestBefore: cm.State[] = [];
  const ingestAfter: cm.State[] = [];
  const expectedIngest: bigint[][] = [];
  const numBatches = Math.max(1, Math.ceil(sealed.length / profile.batch));
  for (let k = 0; k < numBatches; k++) {
    ingestBefore.push(cm.cloneState(state));
    for (let j = 0; j < profile.batch; j++) {
      const i = k * profile.batch + j;
      if (i < sealed.length) cm.ingest(state, i, sealed[i]!.seatWeight, entries[i]!.ballot === null ? null : pack(entries[i]!.ballot!));
    }
    ingestAfter.push(cm.cloneState(state));
    expectedIngest.push([
      BigInt(k),
      BigInt(sealed.length),
      BigInt(s.m),
      s.totalWeight,
      s.pkX,
      s.pkY,
      s.checkpoints[k]!,
      s.checkpoints[k + 1]!,
      k === 0 ? 0n : cm.stateCommit(profile, ingestBefore[k]!),
      cm.stateCommit(profile, state),
    ]);
  }
  const transcript = s.transcript ?? pbearTranscript(s.costs, publicEntries(s.voters, s.m), entries, s.totalWeight).transcript;
  const tallyGroups: ProofPlan["tallyGroups"] = [];
  const expectedTally: bigint[][] = [];
  let cursor = 0;
  while (!state.done) {
    const stateIn = cm.cloneState(state);
    const steps: bigint[][] = [];
    for (let i = 0; i < profile.k; i++) {
      const step = cursor < transcript.length ? transcript[cursor]! : [BigInt(state.level), ...new Array<bigint>(s.m).fill(0n), cm.NONE, 0n];
      steps.push(step);
      const before = state.tHash;
      cm.tallyStep(profile, state, s.costs, step);
      if (state.tHash !== before) cursor++;
    }
    const stateOut = cm.cloneState(state);
    tallyGroups.push({ stateIn, steps, stateOut });
    expectedTally.push([s.costsHash, cm.stateCommit(profile, stateIn), cm.stateCommit(profile, stateOut), state.done ? 1n : 0n, state.tHash, BigInt(state.fundedCount), cm.fundedOrderPacked(state)]);
  }
  return { profile, snapshot: s, sk, sealed, ingestBefore, ingestAfter, transcript, tallyGroups, expected: { ingest: expectedIngest, tally: expectedTally } };
}

export function rebuildFromFixture(fx: any): ProofPlan {
  const voters: Voter[] = fx.voters.map((v: any) => ({
    addr: toBig(v.addr),
    directWeight: toBig(v.directWeight),
    seatWeight: toBig(v.seatWeight),
    hasDirect: v.hasDirect,
    directPacked: toBig(v.directPacked),
    ciphertext: v.hasSealed ? (v.ciphertext.map(toBig) as [bigint, bigint, bigint]) : null,
  }));
  return rebuild(
    {
      m: fx.m,
      costs: fx.costs.map(toBig),
      totalWeight: toBig(fx.totalWeight),
      pkX: toBig(fx.pk[0]),
      pkY: toBig(fx.pk[1]),
      checkpoints: fx.checkpoints.map(toBig),
      costsHash: toBig(fx.costsHash),
      voters,
      sealedCount: fx.sealedCount,
      numBatches: fx.numBatches,
      nSealedMax: fx.profile.nSealedMax,
      mMax: fx.profile.mMax,
      batch: fx.profile.batch,
      transcript: null,
    },
    toBig(fx.sk),
  );
}
