// prover/src/core/state.ts — the plan of proofs, as reference/noir/tools/noir_inputs.py computes it
import { toBig } from "@lib/field";
import * as cm from "@lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "@lib/entries";
import { pubkey } from "@lib/grumpkin";
import { pbearTranscript } from "@lib/pbear";
import { pack } from "@lib/sealed";
import type { Snapshot } from "./chain";
import { profileFor } from "./profile";

export { profileFor };

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
  /**
   * Set when the reported transcript (`s.transcript`, read from chain) doesn't replay
   * cleanly against `cm.tallyStep` — a malformed or tampered `Transcript` event, not
   * something a local proving run can hit. Ingest proofs depend only on committed inputs
   * and are still built normally; only `tallyGroups`/`expected.tally` come back empty.
   * The message, never plaintext.
   */
  tallyError?: string;
};

export function rebuild(
  s: ProofPlan["snapshot"] & { nSealedMax: number; mMax: number; batch: number; transcript?: bigint[][] | null },
  sk: bigint,
): ProofPlan {
  const pk = pubkey(sk);
  if (pk.x !== s.pkX || pk.y !== s.pkY) throw new Error("tallier key mismatch");
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
  let transcript: bigint[][] = [];
  const tallyGroups: ProofPlan["tallyGroups"] = [];
  const expectedTally: bigint[][] = [];
  let tallyError: string | undefined;
  try {
    transcript = s.transcript ?? pbearTranscript(s.costs, publicEntries(s.voters, s.m), entries, s.totalWeight).transcript;
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
  } catch (e) {
    // A malformed or tampered reported transcript (TranscriptMismatch or otherwise) must
    // not take the ingest proofs down with it — they depend only on committed inputs,
    // already built above. Discard any partial tally groups from before the failure.
    tallyGroups.length = 0;
    expectedTally.length = 0;
    tallyError = e instanceof Error ? e.message : String(e);
  }
  return { profile, snapshot: s, sk, sealed, ingestBefore, ingestAfter, transcript, tallyGroups, expected: { ingest: expectedIngest, tally: expectedTally }, tallyError };
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
