// prover/test/witness.test.ts — the witness maps reproduce the fixture's public inputs
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { toBig } from "@lib/field";
import { rebuild, rebuildFromFixture } from "../src/core/state";

const load = (n: string) => JSON.parse(readFileSync(new URL(`../../reference/vectors/fixture_${n}.json`, import.meta.url), "utf8"));

/** The same snapshot `rebuildFromFixture` builds, but with a caller-supplied transcript
 * (rather than `null`, which makes `rebuild` compute a fresh one). */
function rebuildWithTranscript(fx: any, transcript: bigint[][]) {
  const voters = fx.voters.map((v: any) => ({
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
      transcript,
    },
    toBig(fx.sk),
  );
}

describe("state rebuild", () => {
  for (const name of ["test_main", "test_smallm", "test_nosealed", "default_main"]) {
    test(name, () => {
      const fx = load(name);
      const plan = rebuildFromFixture(fx);
      expect(plan.expected.ingest.length).toBe(fx.ingestProofs.length);
      plan.expected.ingest.forEach((pi, k) => {
        const p = fx.ingestProofs[k];
        expect(pi).toEqual([BigInt(p.k), BigInt(p.nSealed), BigInt(p.m), toBig(p.budget), toBig(p.pkX), toBig(p.pkY), toBig(p.hIn), toBig(p.hOut), toBig(p.stateIn), toBig(p.stateOut)]);
      });
      expect(plan.expected.tally.length).toBe(fx.tallyProofs.length);
      plan.expected.tally.forEach((pi, g) => {
        const p = fx.tallyProofs[g];
        expect(pi).toEqual([toBig(p.costsHash), toBig(p.stateIn), toBig(p.stateOut), BigInt(p.done), toBig(p.tHashOut), BigInt(p.fundedCount), toBig(p.fundedOrderPacked)]);
      });
    });
  }
});

describe("rebuild against a malformed reported transcript", () => {
  test("ingest is unaffected; tallyGroups/expected.tally come back empty with tallyError set", () => {
    const fx = load("test_main");
    const untampered = rebuildFromFixture(fx);

    const tampered: bigint[][] = fx.transcript.map((row: (number | string)[]) => row.map((x) => BigInt(x)));
    // Perturb one pubSupport value (index 1, the first of the m entries after `level`) on
    // the first step: `cm.tallyStep` recomputes `sum` from it and will disagree with the
    // reported `best`/`total`, throwing TranscriptMismatch.
    tampered[0]![1] = tampered[0]![1]! + 1n;

    const plan = rebuildWithTranscript(fx, tampered);

    expect(plan.expected.ingest).toEqual(untampered.expected.ingest);
    expect(plan.tallyGroups.length).toBe(0);
    expect(plan.expected.tally.length).toBe(0);
    // `TranscriptMismatch`'s message is just the short reason ("best"); the point is that
    // it's captured (and no plaintext ballot data) rather than left to throw uncaught.
    expect(typeof plan.tallyError).toBe("string");
    expect(plan.tallyError).toBe("best");
  });
});
