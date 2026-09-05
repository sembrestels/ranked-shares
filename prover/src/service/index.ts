// prover/src/service/index.ts — a long-running "prove this pool" HTTP API for the
// operator's home box. Holds the tallier master secret, derives each pool's key from
// its `keySalt`, and runs `runChain` per job; with `submit: false` it only proves and
// hands the proofs back to whoever asked (advance is permissionless except restarts).
import * as http from "node:http";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, hexToBytes, http as httpTransport, toHex, type Account, type Address, type Chain, type PublicClient, type WalletClient } from "viem";
import { readPoolSnapshot, read } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { deriveSk } from "../core/key";

const POOL_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ROOT_RE = /^0x0+$/;
const MAX_BODY_BYTES = 4096; // {"pool":"0x…"} needs a fraction of this

type ProofRecord = { kind: "ingest" | "tally"; index: number; proof: `0x${string}`; publicInputs: `0x${string}`[] };
type Status = "queued" | "running" | "done" | "failed";
type Job = {
  id: string;
  pool: Address;
  inputsRoot: `0x${string}`;
  status: Status;
  log: string[];
  proofs: ProofRecord[];
  finality?: number;
  error?: string;
};

export type ServiceOptions = {
  rpc: string;
  /** The tallier master secret. Never logged or returned; kept only in closure. */
  master: Uint8Array;
  /** Submit `advance` ourselves (needs `account` to be the pool's coordinator for restarts). Default false: prove and hand the proofs back. */
  submit?: boolean;
  account?: Account;
  chain?: Chain | null;
  threads?: number;
};

export function createServer(opts: ServiceOptions): http.Server {
  const submit = opts.submit ?? false;
  const threads = opts.threads ?? Math.max(1, os.availableParallelism() - 1);
  const client: PublicClient = createPublicClient({ transport: httpTransport(opts.rpc) });
  const wallet: WalletClient = createWalletClient({ account: opts.account, chain: opts.chain ?? undefined, transport: httpTransport(opts.rpc) }) as unknown as WalletClient;

  const jobs = new Map<string, Job>();
  // A pool with a job currently queued or running, keyed by lower-cased address: guards
  // against two requests racing to read `inputsRoot` and both missing each other's job.
  const jobsByPool = new Map<string, string>();
  // Finished jobs, keyed by `${pool}|${inputsRoot}` so a pool already proven for a given
  // (immutable, post-close) inputsRoot is never re-proven.
  const doneJobsByKey = new Map<string, string>();
  const provers = new Map<string, Promise<Prover>>();
  const queue: string[] = [];
  let working = false;

  function proverFor(profile: "test" | "default"): Promise<Prover> {
    let p = provers.get(profile);
    if (!p) {
      p = Prover.create(profile, threads);
      provers.set(profile, p);
    }
    return p;
  }

  async function runJob(job: Job): Promise<void> {
    job.status = "running";
    const snapshot = await readPoolSnapshot(client, job.pool, 0n);
    const sk = deriveSk(opts.master, hexToBytes(snapshot.keySalt));
    const plan = rebuild(snapshot, sk);
    const prover = await proverFor(plan.profile.name as "test" | "default");
    await runChain(client, wallet, plan, snapshot, prover, (m) => job.log.push(m), {
      submit,
      account: opts.account?.address,
      chain: opts.chain,
      onProof: (p) => {
        job.proofs.push({ kind: p.kind, index: p.index, proof: toHex(p.proof), publicInputs: p.publicInputs });
      },
    });
    if (submit) job.finality = Number(await read<bigint>(client, job.pool, "finality"));
  }

  async function worker(): Promise<void> {
    if (working) return;
    working = true;
    try {
      let id: string | undefined;
      while ((id = queue.shift()) !== undefined) {
        const job = jobs.get(id)!;
        const poolKey = job.pool.toLowerCase();
        try {
          await runJob(job);
          job.status = "done";
          doneJobsByKey.set(`${poolKey}|${job.inputsRoot}`, id);
        } catch (e) {
          job.status = "failed";
          job.error = e instanceof Error ? e.message : String(e);
          // don't cache a failure: let a later POST /prove retry it.
        } finally {
          if (jobsByPool.get(poolKey) === id) jobsByPool.delete(poolKey);
        }
      }
    } finally {
      working = false;
    }
  }

  function send(res: http.ServerResponse, status: number, body: unknown): void {
    const s = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(s);
  }

  // Resolves the request body as a string, or `undefined` if it exceeded `maxBytes` — in
  // which case a 413 has already been written to `res` and the caller must not respond
  // again. Counts actual bytes received rather than trusting Content-Length.
  function readBody(req: http.IncomingMessage, res: http.ServerResponse, maxBytes = MAX_BODY_BYTES): Promise<string | undefined> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let tooLarge = false;
      req.on("data", (c: Buffer) => {
        if (tooLarge) return;
        bytes += c.length;
        if (bytes > maxBytes) {
          tooLarge = true;
          const body = JSON.stringify({ error: "request body too large" });
          res.writeHead(413, { "content-type": "application/json" });
          res.end(body, () => req.destroy());
          resolve(undefined);
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", () => {
        if (!tooLarge) resolve("");
      });
    });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, coordinator: opts.account?.address ?? null, submits: submit });
      return;
    }

    if (req.method === "POST" && url.pathname === "/prove") {
      const raw = await readBody(req, res);
      if (raw === undefined) return; // 413 already sent
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        send(res, 400, { error: "invalid JSON body" });
        return;
      }
      const pool = body?.pool;
      if (typeof pool !== "string" || !POOL_RE.test(pool)) {
        send(res, 400, { error: "pool must be a 0x-prefixed 20-byte hex address" });
        return;
      }
      const addr = pool as Address;
      const poolKey = addr.toLowerCase();
      let inputsRoot: `0x${string}`;
      try {
        inputsRoot = await read<`0x${string}`>(client, addr, "inputsRoot");
      } catch (e) {
        send(res, 400, { error: `could not read pool: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      if (ZERO_ROOT_RE.test(inputsRoot)) {
        // Ingest needs the checkpoints `close()` writes, so an un-closed pool can't be
        // proven yet — and every un-closed pool shares this same zero inputsRoot, so
        // caching on it here would let two different pools collide.
        send(res, 409, { error: "pool not closed yet" });
        return;
      }
      const doneKey = `${poolKey}|${inputsRoot}`;
      const done = doneJobsByKey.get(doneKey);
      if (done) {
        send(res, 202, { job: done });
        return;
      }
      const inFlight = jobsByPool.get(poolKey);
      if (inFlight) {
        send(res, 202, { job: inFlight });
        return;
      }
      const id = randomUUID();
      const job: Job = { id, pool: addr, inputsRoot, status: "queued", log: [], proofs: [] };
      jobs.set(id, job);
      jobsByPool.set(poolKey, id);
      queue.push(id);
      void worker();
      send(res, 202, { job: id });
      return;
    }

    const jobMatch = /^\/jobs\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]!);
      if (!job) {
        send(res, 404, { error: "unknown job" });
        return;
      }
      send(res, 200, { status: job.status, pool: job.pool, log: job.log, proofs: job.proofs, finality: job.finality, error: job.error });
      return;
    }

    send(res, 404, { error: "not found" });
  }

  return server;
}
