// prover/test/submit.test.ts — planTally's resume/restart decision, against a fixture
// plan and no chain at all.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { stateCommit } from "@lib/commitments";
import { rebuildFromFixture } from "../src/core/state";
import { planTally } from "../src/core/submit";

const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/fixture_test_main.json", import.meta.url), "utf8"));
const plan = rebuildFromFixture(fx);

const commit = (group: (typeof plan.tallyGroups)[number], which: "stateIn" | "stateOut") => stateCommit(plan.profile, group[which]);

describe("planTally", () => {
  test("fresh chain: on-chain state is the ingested state (group 0's stateIn), no restart", () => {
    const onChain = commit(plan.tallyGroups[0]!, "stateIn");
    expect(planTally(onChain, plan)).toEqual({ g: 0, restart: false });
  });

  test("resuming mid-chain: on-chain state matches a later group's stateIn, no restart", () => {
    const onChain = commit(plan.tallyGroups[1]!, "stateIn");
    expect(planTally(onChain, plan)).toEqual({ g: 1, restart: false });
    const onChainLast = commit(plan.tallyGroups[2]!, "stateIn");
    expect(planTally(onChainLast, plan)).toEqual({ g: 2, restart: false });
  });

  test("already Proven: on-chain state is the last group's stateOut", () => {
    const onChain = commit(plan.tallyGroups[plan.tallyGroups.length - 1]!, "stateOut");
    expect(planTally(onChain, plan)).toBe("proven");
  });

  test("unknown on-chain state auto-restarts from group 0", () => {
    const onChain = 0xdeadbeefn;
    expect(planTally(onChain, plan)).toEqual({ g: 0, restart: true });
  });

  test("opts.restart forces group 0 even when the on-chain state matches a later group (regression: previously sent restart=true with the auto-detected group, which the contract rejects)", () => {
    const onChain = commit(plan.tallyGroups[plan.tallyGroups.length - 1]!, "stateIn");
    expect(planTally(onChain, plan, { restart: true })).toEqual({ g: 0, restart: true });
  });

  test("opts.restart = false with no matching group is a caller error", () => {
    expect(() => planTally(0xdeadbeefn, plan, { restart: false })).toThrow(/restart is required/);
  });

  test("opts.restart = false with a matching group behaves like auto-detection", () => {
    const onChain = commit(plan.tallyGroups[1]!, "stateIn");
    expect(planTally(onChain, plan, { restart: false })).toEqual({ g: 1, restart: false });
  });
});
