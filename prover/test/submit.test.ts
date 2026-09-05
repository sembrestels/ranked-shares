// prover/test/submit.test.ts — planTally's resume/restart decision and runChain's
// signing, against a fixture plan and a stubbed chain (no anvil).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Account, Hex, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stateCommit } from "@lib/commitments";
import { rebuildFromFixture } from "../src/core/state";
import type { Snapshot } from "../src/core/chain";
import type { Prover } from "../src/core/prove";
import { planTally, resumeHint, runChain } from "../src/core/submit";

const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/noir/fixture_test_main.json", import.meta.url), "utf8"));
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

const snapshotWith = (over: Partial<Snapshot>): Snapshot => ({ pool: "0x00000000000000000000000000000000000000aa", ingestCursor: 0, ...over }) as Snapshot;

describe("resumeHint (proofs-only runs)", () => {
  const groups = plan.tallyGroups;
  const numBatches = plan.expected.ingest.length;

  test("ingest still pending: tally starts at 0 with no restart, whatever the chain says now", () => {
    expect(resumeHint(0xdeadbeefn, plan, snapshotWith({ ingestCursor: 0 }))).toEqual({ ingestFrom: 0, tallyFrom: 0, restart: false });
    expect(resumeHint(0xdeadbeefn, plan, snapshotWith({ ingestCursor: numBatches - 1 }))).toEqual({ ingestFrom: numBatches - 1, tallyFrom: 0, restart: false });
  });

  test("ingest complete, chain at group 0: submit from 0, no restart", () => {
    const onChain = commit(groups[0]!, "stateIn");
    expect(resumeHint(onChain, plan, snapshotWith({ ingestCursor: numBatches }))).toEqual({ ingestFrom: numBatches, tallyFrom: 0, restart: false });
  });

  test("ingest complete, chain mid-chain: submit from that group, no restart", () => {
    const onChain = commit(groups[1]!, "stateIn");
    expect(resumeHint(onChain, plan, snapshotWith({ ingestCursor: numBatches }))).toEqual({ ingestFrom: numBatches, tallyFrom: 1, restart: false });
  });

  test("ingest complete, already Proven: nothing left to submit", () => {
    const onChain = commit(groups[groups.length - 1]!, "stateOut");
    expect(resumeHint(onChain, plan, snapshotWith({ ingestCursor: numBatches }))).toEqual({ ingestFrom: numBatches, tallyFrom: groups.length, restart: false });
  });

  test("ingest complete, chain in an unknown state: restart from group 0", () => {
    expect(resumeHint(0xdeadbeefn, plan, snapshotWith({ ingestCursor: numBatches }))).toEqual({ ingestFrom: numBatches, tallyFrom: 0, restart: true });
  });
});

describe("runChain submission", () => {
  const KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
  const numBatches = plan.expected.ingest.length;

  /** A chain that is reported, sitting at tally group 0, and never finalized. */
  function stubs(reads: Record<string, unknown> = {}) {
    const writes: any[] = [];
    const values: Record<string, unknown> = { finality: 0n, resultReported: true, stateCommit: commit(plan.tallyGroups[0]!, "stateIn"), ...reads };
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => values[functionName],
      waitForTransactionReceipt: async () => ({ status: "success", gasUsed: 1n }),
    } as unknown as PublicClient;
    const wallet = {
      writeContract: async (args: any) => {
        writes.push(args);
        return "0x" + "11".repeat(32);
      },
    } as unknown as WalletClient;
    const prover = { prove: async () => ({ proof: Uint8Array.from([1, 2, 3]), publicInputs: [] as `0x${string}`[] }) } as unknown as Prover;
    return { client, wallet, prover, writes, values };
  }

  test("a local account reaches writeContract as an Account object, so viem signs locally", async () => {
    const account: Account = privateKeyToAccount(KEY);
    const { client, wallet, prover, writes } = stubs();
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: numBatches }), prover, () => {}, { account, chain: null });
    expect(writes.length).toBe(plan.tallyGroups.length);
    for (const w of writes) {
      expect(typeof w.account).toBe("object");
      expect(w.account.type).toBe("local");
      expect(w.account.address).toBe(account.address);
    }
    expect(writes[0].functionName).toBe("advance");
  });

  test("a finalized pool is left alone: nothing is proved and nothing is sent", async () => {
    const { client, wallet, writes } = stubs({ finality: 2n });
    let proved = 0;
    const counting = { prove: async () => (proved++, { proof: Uint8Array.from([1]), publicInputs: [] as `0x${string}`[] }) } as unknown as Prover;
    const lines: string[] = [];
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: 0 }), counting, (m) => lines.push(m), { account: privateKeyToAccount(KEY), chain: null });
    expect(writes.length).toBe(0);
    expect(proved).toBe(0);
    expect(lines.join(" ")).toMatch(/already finalized/);
  });

  test("a plan with tallyError still submits pending ingest, but sends no tally advance", async () => {
    // As `rebuild` would return it for a malformed reported transcript: ingest untouched,
    // the tally side empty.
    const withTallyError = { ...plan, tallyGroups: [], expected: { ...plan.expected, tally: [] }, tallyError: "best" };
    const { client, wallet, prover, writes } = stubs();
    const lines: string[] = [];
    await runChain(client, wallet, withTallyError, snapshotWith({ ingestCursor: 0 }), prover, (m) => lines.push(m), { account: privateKeyToAccount(KEY), chain: null });
    expect(writes.length).toBe(numBatches);
    expect(writes.every((w) => w.functionName === "advance")).toBe(true);
    expect(lines.join(" ")).toMatch(/tally plan unavailable: best/);
  });

  test("batch: the whole run leaves as one advanceMany, arrays in chain order, no restart on a fresh chain", async () => {
    const { client, wallet, prover, writes } = stubs();
    const lines: string[] = [];
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: 0 }), prover, (m) => lines.push(m), {
      account: privateKeyToAccount(KEY),
      chain: null,
      batch: true,
    });
    expect(writes.length).toBe(1);
    const [proofs, publicInputs, restart] = writes[0].args;
    expect(writes[0].functionName).toBe("advanceMany");
    expect(proofs.length).toBe(numBatches + plan.tallyGroups.length);
    expect(publicInputs.length).toBe(proofs.length);
    expect(proofs.every((p: string) => p === "0x010203")).toBe(true);
    expect(restart).toBe(false);
    expect(lines).toContain("proved ingest 0");
    expect(lines).toContain(`proved tally ${plan.tallyGroups.length - 1}`);
    expect(lines.join(" ")).toMatch(/advanceMany accepted, \d+ proofs, gas/);
  });

  test("batch: an on-chain state matching no group, with ingest complete, sends restart: true", async () => {
    const { client, wallet, prover, writes } = stubs({ stateCommit: 0xdeadbeefn });
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: numBatches }), prover, () => {}, {
      account: privateKeyToAccount(KEY),
      chain: null,
      batch: true,
    });
    expect(writes.length).toBe(1);
    const [proofs, , restart] = writes[0].args;
    expect(writes[0].functionName).toBe("advanceMany");
    expect(proofs.length).toBe(plan.tallyGroups.length); // ingest already on chain
    expect(restart).toBe(true);
  });

  test("batch: a finalized pool is left alone, and nothing is batched up either", async () => {
    const { client, wallet, prover, writes } = stubs({ finality: 2n });
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: 0 }), prover, () => {}, {
      account: privateKeyToAccount(KEY),
      chain: null,
      batch: true,
    });
    expect(writes.length).toBe(0);
  });

  test("batch: with no tally to prove, the pending ingest still leaves as one advanceMany", async () => {
    const { client, wallet, prover, writes } = stubs({ resultReported: false });
    await runChain(client, wallet, plan, snapshotWith({ ingestCursor: 0 }), prover, () => {}, {
      account: privateKeyToAccount(KEY),
      chain: null,
      batch: true,
    });
    expect(writes.length).toBe(1);
    expect(writes[0].functionName).toBe("advanceMany");
    expect(writes[0].args[0].length).toBe(numBatches);
  });

  test("batch is ignored without submit: nothing is sent", async () => {
    const { client, wallet, prover, writes } = stubs();
    const resume = await runChain(client, wallet, plan, snapshotWith({ ingestCursor: 0 }), prover, () => {}, {
      account: privateKeyToAccount(KEY),
      chain: null,
      submit: false,
      batch: true,
    });
    expect(writes.length).toBe(0);
    expect(resume).toEqual({ ingestFrom: 0, tallyFrom: 0, restart: false });
  });

  test("submit: false with a tallyError plan proves the pending ingest and stops, sending nothing", async () => {
    const withTallyError = { ...plan, tallyGroups: [], expected: { ...plan.expected, tally: [] }, tallyError: "best" };
    const { client, wallet, prover, writes } = stubs();
    let tallyProved = 0;
    const counting = {
      prove: async (kind: string, ...rest: unknown[]) => {
        if (kind === "tally") tallyProved++;
        return prover.prove(kind as any, ...(rest as [never]));
      },
    } as unknown as Prover;
    const resume = await runChain(client, wallet, withTallyError, snapshotWith({ ingestCursor: 0 }), counting, () => {}, {
      account: privateKeyToAccount(KEY),
      chain: null,
      submit: false,
    });
    expect(writes.length).toBe(0); // submit: false never calls advance
    expect(tallyProved).toBe(0);
    expect(resume).toEqual({ ingestFrom: 0, tallyFrom: 0, restart: false });
  });
});
