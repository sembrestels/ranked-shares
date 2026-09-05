// prover/test/prove.test.ts — real proofs with bb.js for the test profile, checked against bb's own verifier
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { toBig } from "@lib/field";
import { rebuildFromFixture } from "../src/core/state";
import { ingestInputs, tallyInputs } from "../src/core/witness";
import { Prover } from "../src/core/prove";

const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/fixture_test_main.json", import.meta.url), "utf8"));

describe("proving the test fixture", () => {
  let prover: Prover;
  beforeAll(async () => {
    prover = await Prover.create("test", 4);
  }, 300_000);
  afterAll(async () => {
    await prover.destroy();
  });

  test(
    "ingest batch 0",
    async () => {
      const plan = rebuildFromFixture(fx);
      const inputs = ingestInputs(plan, 0);
      const { proof, publicInputs } = await prover.prove("ingest", inputs);
      expect(publicInputs.map(toBig)).toEqual(plan.expected.ingest[0]);
      expect(proof.length).toBeGreaterThan(1000);
      expect(await prover.verify("ingest", { proof, publicInputs })).toBe(true);
    },
    300_000,
  );

  test(
    "tally group 0",
    async () => {
      const plan = rebuildFromFixture(fx);
      const inputs = tallyInputs(plan, 0);
      const { proof, publicInputs } = await prover.prove("tally", inputs);
      expect(publicInputs.map(toBig)).toEqual(plan.expected.tally[0]);
      expect(await prover.verify("tally", { proof, publicInputs })).toBe(true);
    },
    300_000,
  );
});
