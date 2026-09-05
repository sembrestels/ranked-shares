import { describe, expect, test } from "bun:test";
import defaultMain from "../../reference/vectors/noir/fixture_default_main.json";
import testMain from "../../reference/vectors/noir/fixture_test_main.json";
import testNosealed from "../../reference/vectors/noir/fixture_test_nosealed.json";
import testSmallm from "../../reference/vectors/noir/fixture_test_smallm.json";
import { toBig } from "../src/lib/field";
import * as cm from "../src/lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "../src/lib/entries";
import { pbearTranscript } from "../src/lib/pbear";
import { pack } from "../src/lib/sealed";

// The CRE SDK types every `node:fs` export as `never` (WASM guardrail), so the
// fixtures come in as JSON imports, like the other vector tests.
const FIXTURES: Record<string, any> = {
  test_main: testMain,
  test_smallm: testSmallm,
  test_nosealed: testNosealed,
  default_main: defaultMain,
};
const load = (name: string) => FIXTURES[name];

function voters(fx: any): Voter[] {
  return fx.voters.map((v: any) => ({
    addr: toBig(v.addr),
    directWeight: toBig(v.directWeight),
    seatWeight: toBig(v.seatWeight),
    hasDirect: v.hasDirect,
    directPacked: toBig(v.directPacked),
    ciphertext: v.hasSealed ? (v.ciphertext.map(toBig) as [bigint, bigint, bigint]) : null,
  }));
}

describe("commitments against the fixtures", () => {
  for (const name of Object.keys(FIXTURES)) {
    test(name, () => {
      const fx = load(name);
      const profile = cm.PROFILES[fx.profile.name as keyof typeof cm.PROFILES];
      const vs = voters(fx);
      const m: number = fx.m;
      const costs = fx.costs.map(toBig);
      const budget = toBig(fx.totalWeight);
      const sk = toBig(fx.sk);

      expect(Buffer.from(cm.publicChain(vs)).toString("hex")).toBe(fx.hPub.slice(2));
      const { h, checkpoints } = cm.sealedChain(vs, profile.batch);
      expect(h).toBe(toBig(fx.hSealed));
      expect(checkpoints).toEqual(fx.checkpoints.map(toBig));
      const ch = cm.costsHash(costs);
      expect(ch).toBe(toBig(fx.costsHash));
      expect(Buffer.from(cm.inputsRoot(cm.publicChain(vs), h, sealedVoters(vs).length, ch, budget)).toString("hex")).toBe(fx.inputsRoot.slice(2));

      const pub = publicEntries(vs, m);
      const sealed = sealedEntries(vs, sk, m);
      const { funded, transcript } = pbearTranscript(costs, pub, sealed, budget);
      expect(funded).toEqual(fx.funded);
      expect(transcript.map((s) => s.map(Number))).toEqual(fx.transcript);
      expect(cm.transcriptHash(transcript)).toBe(toBig(fx.transcriptHash));

      // ingest chain
      const state = cm.emptyState(profile, m, budget);
      const sv = sealedVoters(vs);
      fx.ingestProofs.forEach((proof: any, k: number) => {
        for (let j = 0; j < profile.batch; j++) {
          const i = k * profile.batch + j;
          if (i < sv.length) {
            const ranks = sealed[i].ballot;
            cm.ingest(state, i, sv[i].seatWeight, ranks === null ? null : pack(ranks));
          }
        }
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateOut));
      });
      // tally chain
      let cursor = 0;
      for (const proof of fx.tallyProofs) {
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateIn));
        for (let s = 0; s < profile.k; s++) {
          const step = cursor < transcript.length ? transcript[cursor] : [BigInt(state.level), ...new Array(m).fill(0n), cm.NONE, 0n];
          const before = state.tHash;
          cm.tallyStep(profile, state, costs, step);
          if (state.tHash !== before) cursor++;
        }
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateOut));
        expect(state.done ? 1 : 0).toBe(proof.done);
        expect(cm.fundedOrderPacked(state)).toBe(toBig(proof.fundedOrderPacked));
      }
    });
  }
});
