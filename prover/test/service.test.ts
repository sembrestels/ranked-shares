// prover/test/service.test.ts — the prove service, in-process, against its own anvil
// chain (a different port than e2e.test.ts so both files can run in one `vitest run`).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createWalletClient, hexToBytes, http, type Address } from "viem";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { rebuildFromFixture } from "../src/core/state";
import { createServer } from "../src/service";
import { startFixtureChain, deployUnclosedPool, type FixtureChain } from "./helpers/anvil";
import poolAbi from "../../cre/src/abi/SealedRankedShares.json";

const PORT = 8549;

let chain: FixtureChain;
let server: import("node:http").Server;
let base: string;

async function postJSON(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function getJSON(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json() };
}

describe("the prove service", () => {
  beforeAll(async () => {
    chain = await startFixtureChain({ port: PORT });
    server = createServer({ rpc: chain.rpc, master: hexToBytes(chain.fx.master) });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await chain?.stop();
  });

  test("GET /health", async () => {
    const { status, body } = await getJSON("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, coordinator: null, submits: false });
  });

  test("400 on a malformed pool address", async () => {
    const { status, body } = await postJSON("/prove", { pool: "not-an-address" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/pool/i);
  });

  test("404 on an unknown job", async () => {
    const { status } = await getJSON("/jobs/does-not-exist");
    expect(status).toBe(404);
  });

  test("409 on a pool that hasn't closed yet", async () => {
    const unclosedPool = await deployUnclosedPool(chain.rpc);
    const { status, body } = await postJSON("/prove", { pool: unclosedPool });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not closed/i);
  });

  test("413 (or a closed connection) on an oversized request body", async () => {
    const big = JSON.stringify({ pool: chain.pool, junk: "x".repeat(8192) });
    let status: number | undefined;
    let closed = false;
    try {
      const r = await fetch(`${base}/prove`, { method: "POST", headers: { "content-type": "application/json" }, body: big });
      status = r.status;
    } catch {
      closed = true;
    }
    expect(closed || status === 413, `expected 413 or a closed connection, got status ${status}`).toBe(true);

    // the connection didn't wedge the server: it still answers normal requests.
    const { status: healthStatus } = await getJSON("/health");
    expect(healthStatus).toBe(200);
  });

  test(
    "POST /prove, poll to done, proofs match the fixture, submit to Proven, cached on retry",
    async () => {
      const { status, body } = await postJSON("/prove", { pool: chain.pool });
      expect(status).toBe(202);
      const jobId = body.job as string;
      expect(typeof jobId).toBe("string");

      let job: any;
      const deadline = Date.now() + 590_000;
      for (;;) {
        ({ body: job } = await getJSON(`/jobs/${jobId}`));
        if (job.status === "done" || job.status === "failed") break;
        if (Date.now() > deadline) throw new Error("job did not finish in time");
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(job.status, `job failed: ${job.error}`).toBe("done");
      expect(job.pool.toLowerCase()).toBe(chain.pool.toLowerCase());

      const plan = rebuildFromFixture(chain.fx);
      const ingestProofs = job.proofs.filter((p: any) => p.kind === "ingest").sort((a: any, b: any) => a.index - b.index);
      const tallyProofs = job.proofs.filter((p: any) => p.kind === "tally").sort((a: any, b: any) => a.index - b.index);
      expect(ingestProofs.length).toBe(3);
      expect(tallyProofs.length).toBe(3);
      ingestProofs.forEach((p: any, k: number) => expect(p.publicInputs.map(toBig)).toEqual(plan.expected.ingest[k]));
      tallyProofs.forEach((p: any, g: number) => expect(p.publicInputs.map(toBig)).toEqual(plan.expected.tally[g]));

      // the service didn't submit (no --submit): do it ourselves, as the coordinator.
      const wallet = createWalletClient({ account: chain.coordinator, chain: foundry, transport: http(chain.rpc) });
      const submitAdvance = async (proof: `0x${string}`, publicInputs: `0x${string}`[], restart: boolean) => {
        const hash = await wallet.writeContract({ address: chain.pool, abi: poolAbi, functionName: "advance", args: [proof, publicInputs, restart], account: chain.coordinator, chain: foundry } as any);
        const receipt = await chain.pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`advance reverted: ${hash}`);
      };
      for (const p of ingestProofs) await submitAdvance(p.proof, p.publicInputs, false);
      // fresh pool: the on-chain tally state already matches tallyGroups[0].stateIn.
      let restart = false;
      for (const p of tallyProofs) {
        await submitAdvance(p.proof, p.publicInputs, restart);
        restart = false;
      }
      const finality = Number(await chain.pub.readContract({ address: chain.pool, abi: poolAbi, functionName: "finality" }));
      expect(finality).toBe(1); // Proven

      // a second request for the same pool returns the cached job.
      const again = await postJSON("/prove", { pool: chain.pool });
      expect(again.status).toBe(202);
      expect(again.body.job).toBe(jobId);
    },
    600_000,
  );
});
