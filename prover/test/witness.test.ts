// prover/test/witness.test.ts — the witness maps reproduce the fixture's public inputs
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { toBig } from "@lib/field";
import { rebuildFromFixture } from "../src/core/state";

const load = (n: string) => JSON.parse(readFileSync(new URL(`../../reference/vectors/fixture_${n}.json`, import.meta.url), "utf8"));

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
