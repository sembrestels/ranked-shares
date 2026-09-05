// prover/test/service.test.ts — the prove service, in-process, against its own anvil
// chain (a different port than e2e.test.ts so both files can run in one `vitest run`).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bytesToHex, createTestClient, createWalletClient, hexToBytes, http, type WalletClient } from "viem";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import * as cm from "@lib/commitments";
import { readPoolSnapshot } from "../src/core/chain";
import { rebuild, rebuildFromFixture } from "../src/core/state";
import { runChain } from "../src/core/submit";
import { Prover } from "../src/core/prove";
import { createServer, type ServiceOptions } from "../src/service";
import { encodeCloseReport } from "@lib/report";
import { startFixtureChain, deployUnclosedPool, deployVoterPool, replayFixturePool, workflowMetadata, FORWARDER, NO_WORKFLOW_CHECK, type FixtureChain } from "./helpers/anvil";
import poolAbi from "../../cre/src/abi/SealedRankedShares.json";

const PORT = 8549;

let chain: FixtureChain;
let server: import("node:http").Server;
let base: string;
const servers: import("node:http").Server[] = [];

/** A second (third, …) service on an ephemeral port, closed by `afterAll`. */
async function startServer(opts: ServiceOptions): Promise<string> {
  const s = createServer(opts);
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, resolve));
  const addr = s.address();
  if (!addr || typeof addr === "string") throw new Error("expected a TCP address");
  return `http://127.0.0.1:${addr.port}`;
}

async function postJSON(path: string, body: unknown, at = base): Promise<{ status: number; body: any }> {
  const r = await fetch(`${at}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function getJSON(path: string, at = base): Promise<{ status: number; body: any }> {
  const r = await fetch(`${at}${path}`);
  return { status: r.status, body: await r.json() };
}

/** Poll a job to a terminal state. */
async function pollJob(id: string, at = base, timeoutMs = 590_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await getJSON(`/jobs/${id}`, at);
    if (body.status === "done" || body.status === "failed") return body;
    if (Date.now() > deadline) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe("the prove service", () => {
  beforeAll(async () => {
    chain = await startFixtureChain({ port: PORT });
    server = createServer({ rpc: chain.rpc, master: hexToBytes(chain.fx.master) });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    for (const s of servers) s.close();
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

  // The KeystoneForwarder is a per-chain singleton shared by every workflow, so a pool
  // that only checked `msg.sender == forwarder` would take a kind-1 report — and its
  // `proofGrace` clock — from any workflow owner registered with it. This is that check
  // seen from the client side, against a real chain rather than forge's cheatcodes.
  test("onReport needs the forwarder metadata to name the pool's workflow owner", async () => {
    const owner = chain.coordinator.address;
    const pool = await deployUnclosedPool(chain.rpc, undefined, { workflowOwner: owner, workflowName: NO_WORKFLOW_CHECK.workflowName });
    expect((await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "workflowOwner" })) as string).toBe(owner);

    // one project, voting open, and the clock past the deadline, so a kind-2 report has
    // somewhere to land: the pool is then in Closing with no voters to walk.
    const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(chain.rpc) });
    const deployerWallet = createWalletClient({ account: chain.deployer, chain: foundry, transport: http(chain.rpc) });
    const send = async (hash: `0x${string}`) => {
      const receipt = await chain.pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
    };
    const asDeployer = { address: pool, abi: poolAbi, account: chain.deployer, chain: foundry } as const;
    await send(await deployerWallet.writeContract({ ...asDeployer, functionName: "addProject", args: [1n, chain.deployer.address] } as any));
    await send(await deployerWallet.writeContract({ ...asDeployer, functionName: "openVoting" } as any));
    const deadline = (await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "votingDeadline" })) as bigint;
    await testClient.setNextBlockTimestamp({ timestamp: deadline });
    await testClient.mine({ blocks: 1 });

    await testClient.impersonateAccount({ address: FORWARDER });
    await testClient.setBalance({ address: FORWARDER, value: 10n ** 18n });
    const report = encodeCloseReport(100);
    const call = (metadata: `0x${string}`) => chain.pub.simulateContract({ address: pool, abi: poolAbi, functionName: "onReport", args: [metadata, report], account: FORWARDER });

    // the MockForwarder's empty metadata is no longer enough
    await expect(call("0x")).rejects.toThrow(/BadMetadata/);
    // nor is well-formed metadata naming somebody else's workflow
    await expect(call(workflowMetadata(chain.deployer.address))).rejects.toThrow(/WrongWorkflow/);

    // the real 62-byte metadata carrying this pool's workflow owner is accepted
    const metadata = workflowMetadata(owner);
    expect((metadata.length - 2) / 2).toBe(62);
    const forwarderWallet = createWalletClient({ account: FORWARDER, chain: foundry, transport: http(chain.rpc) });
    await send(await forwarderWallet.writeContract({ address: pool, abi: poolAbi, functionName: "onReport", args: [metadata, report], account: FORWARDER, chain: foundry } as any));
    expect(await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "closed" })).toBe(true);
  }, 120_000);

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

  test("readPoolSnapshot rejects when no Transcript log falls in the requested range", async () => {
    const after = (await chain.pub.getBlockNumber()) + 1n;
    await expect(readPoolSnapshot(chain.pub, chain.pool, after)).rejects.toThrow(`no Transcript event for ${chain.pool} at or after block ${after}`);
  });

  test(
    "POST /prove, poll to done, proofs match the fixture, submit with the resume hint to Proven, cached on retry",
    async () => {
      const { status, body } = await postJSON("/prove", { pool: chain.pool });
      expect(status).toBe(202);
      const jobId = body.job as string;
      expect(typeof jobId).toBe("string");

      const job = await pollJob(jobId);
      expect(job.status, `job failed: ${job.error}`).toBe("done");
      expect(job.pool.toLowerCase()).toBe(chain.pool.toLowerCase());

      const plan = rebuildFromFixture(chain.fx);
      const ingestProofs = job.proofs.filter((p: any) => p.kind === "ingest").sort((a: any, b: any) => a.index - b.index);
      const tallyProofs = job.proofs.filter((p: any) => p.kind === "tally").sort((a: any, b: any) => a.index - b.index);
      expect(ingestProofs.length).toBe(3);
      expect(tallyProofs.length).toBe(3);
      ingestProofs.forEach((p: any, k: number) => expect(p.publicInputs.map(toBig)).toEqual(plan.expected.ingest[k]));
      tallyProofs.forEach((p: any, g: number) => expect(p.publicInputs.map(toBig)).toEqual(plan.expected.tally[g]));

      // a fresh, un-ingested pool: prove everything, submit from the start, no restart.
      expect(job.resume).toEqual({ ingestFrom: 0, tallyFrom: 0, restart: false });
      expect(tallyProofs.map((p: any) => p.restart)).toEqual([false, false, false]);

      // the service didn't submit (no --submit): do it ourselves, as the coordinator,
      // following the job's resume hint rather than assuming where the chain stands.
      const wallet = createWalletClient({ account: chain.coordinator, chain: foundry, transport: http(chain.rpc) });
      const submitAdvance = async (proof: `0x${string}`, publicInputs: `0x${string}`[], restart: boolean) => {
        const hash = await wallet.writeContract({ address: chain.pool, abi: poolAbi, functionName: "advance", args: [proof, publicInputs, restart], account: chain.coordinator, chain: foundry } as any);
        const receipt = await chain.pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`advance reverted: ${hash}`);
      };
      for (const p of ingestProofs.filter((p: any) => p.index >= job.resume.ingestFrom)) await submitAdvance(p.proof, p.publicInputs, false);
      for (const p of tallyProofs.filter((p: any) => p.index >= job.resume.tallyFrom)) await submitAdvance(p.proof, p.publicInputs, p.restart);
      const finality = Number(await chain.pub.readContract({ address: chain.pool, abi: poolAbi, functionName: "finality" }));
      expect(finality).toBe(1); // Proven

      // a second request for the same pool returns the cached job.
      const again = await postJSON("/prove", { pool: chain.pool });
      expect(again.status).toBe(202);
      expect(again.body.job).toBe(jobId);
    },
    600_000,
  );

  test(
    "with --submit the service signs locally and drives a second pool to Proven",
    async () => {
      const { pool } = await replayFixturePool(chain.rpc, chain.fx);
      // No `chain` option: the account is a local one, so viem must sign it itself,
      // resolving the chain id from the RPC rather than falling back to
      // eth_sendTransaction (which only anvil's unlocked accounts would accept).
      const at = await startServer({ rpc: chain.rpc, master: hexToBytes(chain.fx.master), submit: true, account: chain.coordinator });
      expect((await getJSON("/health", at)).body).toEqual({ ok: true, coordinator: chain.coordinator.address, submits: true });

      const { status, body } = await postJSON("/prove", { pool }, at);
      expect(status).toBe(202);
      const job = await pollJob(body.job as string, at);
      expect(job.status, `job failed: ${job.error}`).toBe("done");
      expect(job.finality).toBe(1); // Proven, submitted by the service itself
      expect(Number(await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(1);
    },
    600_000,
  );

  test("a deterministically failing pool is not re-run within the cooldown", async () => {
    // A service holding the wrong master derives the wrong tallier key: every job for
    // every pool fails in `rebuild`, immediately and identically.
    const at = await startServer({ rpc: chain.rpc, master: new Uint8Array(randomBytes(32)) });
    const first = await postJSON("/prove", { pool: chain.pool }, at);
    expect(first.status).toBe(202);
    const failed = await pollJob(first.body.job as string, at, 60_000);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/tallier key mismatch/);

    const second = await postJSON("/prove", { pool: chain.pool }, at);
    expect(second.body.job).toBe(first.body.job);
    expect(second.status).toBe(409);
    expect((await getJSON(`/jobs/${second.body.job}`, at)).body.status).toBe("failed");
  });

  test("readPoolSnapshot pages a roster larger than one votersFrom page", async () => {
    const n = 51; // one page of 50 plus one
    const { pool, voters } = await deployVoterPool(chain.rpc, n);
    const s = await readPoolSnapshot(chain.pub, pool, 0n);
    expect(s.voters.length).toBe(n);
    expect(s.voters.map((v) => `0x${v.addr.toString(16).padStart(40, "0")}`)).toEqual(voters.map((a) => a.toLowerCase()));
    expect(s.voters.every((v) => v.hasDirect && v.directWeight === 1n && v.ciphertext === null)).toBe(true);
    // the pages reassemble into exactly the roster the pool committed to at `close`
    const root = cm.inputsRoot(cm.publicChain(s.voters), cm.sealedChain(s.voters, s.batch).h, s.sealedCount, cm.costsHash(s.costs), s.totalWeight);
    expect(bytesToHex(root)).toBe(s.inputsRoot.toLowerCase());
  }, 120_000);

  test("a job over its wall-clock budget is failed and the worker moves on", async () => {
    // 1 ms is shorter than the first chain read, so the job cannot get anywhere; the
    // wrong master keeps whatever it started from running long after the timeout.
    const at = await startServer({ rpc: chain.rpc, master: new Uint8Array(randomBytes(32)), jobTimeout: 0.001 });
    const { body } = await postJSON("/prove", { pool: chain.pool }, at);
    const job = await pollJob(body.job as string, at, 60_000);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/timed out/);
    // the worker didn't wedge: the service still answers.
    expect((await getJSON("/health", at)).status).toBe(200);
  });

  test("runChain sends nothing once the pool has been finalized", async () => {
    // A third pool, taken to Attested by anyone after `proofGrace` elapses.
    const { pool } = await replayFixturePool(chain.rpc, chain.fx);
    const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(chain.rpc) });
    const reportedAt = (await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "reportedAt" })) as bigint;
    const proofGrace = (await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "proofGrace" })) as bigint;
    await testClient.setNextBlockTimestamp({ timestamp: reportedAt + proofGrace + 1n });
    await testClient.mine({ blocks: 1 });
    const anyone = createWalletClient({ account: chain.deployer, chain: foundry, transport: http(chain.rpc) });
    const acceptHash = await anyone.writeContract({ address: pool, abi: poolAbi, functionName: "acceptProvisional", args: [], account: chain.deployer, chain: foundry } as any);
    expect((await chain.pub.waitForTransactionReceipt({ hash: acceptHash })).status).toBe("success");
    expect(Number(await chain.pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(2); // Attested

    // runChain against it must not prove or send anything.
    const snapshot = await readPoolSnapshot(chain.pub, pool, 0n);
    const plan = rebuild(snapshot, toBig(chain.fx.sk));
    let writes = 0;
    const counting = {
      ...anyone,
      writeContract: async (args: unknown) => {
        writes++;
        return anyone.writeContract(args as never);
      },
    } as unknown as WalletClient;
    const nonceBefore = await chain.pub.getTransactionCount({ address: chain.coordinator.address });
    const never = { prove: async () => { throw new Error("must not prove a finalized pool"); } } as unknown as Prover;
    const lines: string[] = [];
    await runChain(chain.pub, counting, plan, snapshot, never, (m) => lines.push(m), { account: chain.coordinator, chain: foundry });
    expect(writes).toBe(0);
    expect(await chain.pub.getTransactionCount({ address: chain.coordinator.address })).toBe(nonceBefore);
    expect(lines.join(" ")).toMatch(/already finalized/);
  }, 120_000);
});
