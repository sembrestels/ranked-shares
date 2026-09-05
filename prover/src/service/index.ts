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
import { runChain, type Resume } from "../core/submit";
import { deriveSk } from "../core/key";

const POOL_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ROOT_RE = /^0x0+$/;
const MAX_BODY_BYTES = 4096; // {"pool":"0x…"} needs a fraction of this
const MAX_JOBS = 200; // finished jobs beyond this are evicted oldest-first
const MAX_LOG_LINES = 500; // per job
const DEFAULT_JOB_TIMEOUT_SEC = 1800;
const FAILURE_COOLDOWN_MS = 60_000; // don't re-run a pool that just failed deterministically

type ProofRecord = { kind: "ingest" | "tally"; index: number; proof: `0x${string}`; publicInputs: `0x${string}`[]; restart: boolean };
type Status = "queued" | "running" | "done" | "failed";
type Job = {
  id: string;
  pool: Address;
  inputsRoot: `0x${string}`;
  status: Status;
  log: string[];
  proofs: ProofRecord[];
  /** Where to start submitting these proofs (proofs-only runs); see `runChain`. */
  resume?: Resume;
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
  /** Wall-clock budget for one job, in seconds. Default 1800. */
  jobTimeout?: number;
};

export function createServer(opts: ServiceOptions): http.Server {
  const submit = opts.submit ?? false;
  const threads = opts.threads ?? Math.max(1, os.availableParallelism() - 1);
  const jobTimeoutMs = (opts.jobTimeout ?? DEFAULT_JOB_TIMEOUT_SEC) * 1000;
  const client: PublicClient = createPublicClient({ transport: httpTransport(opts.rpc) });
  const wallet: WalletClient = createWalletClient({ account: opts.account, chain: opts.chain ?? undefined, transport: httpTransport(opts.rpc) }) as unknown as WalletClient;

  const jobs = new Map<string, Job>();
  // A pool with a job currently queued or running, keyed by lower-cased address: guards
  // against two requests racing to read `inputsRoot` and both missing each other's job.
  const jobsByPool = new Map<string, string>();
  // Finished jobs, keyed by `${pool}|${inputsRoot}` so a pool already proven for a given
  // (immutable, post-close) inputsRoot is never re-proven.
  const doneJobsByKey = new Map<string, string>();
  // The last failed job per pool, so a deterministically failing pool (a key mismatch, a
  // pool this service can't read) isn't re-proven on every POST for a while.
  const failedByPool = new Map<string, { id: string; at: number }>();
  const provers = new Map<string, Promise<Prover>>();
  const queue: string[] = [];
  let working = false;

  function proverFor(profile: "test" | "default"): Promise<Prover> {
    let p = provers.get(profile);
    if (!p) {
      // Memoize the promise, but not a rejected one: a failed `Prover.create` (a bad
      // artifact read, a transient OOM) must not poison every later job.
      p = Prover.create(profile, threads).catch((e) => {
        provers.delete(profile);
        throw e;
      });
      provers.set(profile, p);
    }
    return p;
  }

  function pushLog(job: Job, line: string): void {
    if (job.log.length < MAX_LOG_LINES) job.log.push(line);
    else job.log[MAX_LOG_LINES - 1] = `… log truncated at ${MAX_LOG_LINES} lines`;
  }

  /** Keep the job map bounded: drop finished jobs, oldest first, and their cache entries. */
  function evictOldJobs(): void {
    for (const [id, job] of jobs) {
      if (jobs.size <= MAX_JOBS) return;
      if (job.status !== "done" && job.status !== "failed") continue;
      jobs.delete(id);
      const poolKey = job.pool.toLowerCase();
      if (doneJobsByKey.get(`${poolKey}|${job.inputsRoot}`) === id) doneJobsByKey.delete(`${poolKey}|${job.inputsRoot}`);
      if (failedByPool.get(poolKey)?.id === id) failedByPool.delete(poolKey);
    }
  }

  /**
   * A pool whose reported transcript doesn't replay (`plan.tallyError`, see
   * `state.ts`/`submit.ts`) is not a failure of this job: `runChain` proves/submits the
   * ingest batches (which don't depend on the transcript) and logs `tally plan
   * unavailable: …` instead of throwing, so the job below still lands as `done` — with
   * that message in `job.log` and no tally proofs in `job.proofs` — rather than `failed`,
   * because ingest genuinely landed and a caller polling only `status` shouldn't read this
   * as "retry me"; the transcript problem is on chain, not something a retry fixes.
   */
  async function runJob(job: Job): Promise<void> {
    job.status = "running";
    const snapshot = await readPoolSnapshot(client, job.pool, 0n);
    const sk = deriveSk(opts.master, hexToBytes(snapshot.keySalt));
    const plan = rebuild(snapshot, sk);
    const prover = await proverFor(plan.profile.name as "test" | "default");
    const resume = await runChain(client, wallet, plan, snapshot, prover, (m) => pushLog(job, m), {
      submit,
      // The `Account` itself, not its address: viem signs locally with an account object
      // and would fall back to `eth_sendTransaction` (anvil only) with a bare address.
      account: opts.account,
      chain: opts.chain,
      onProof: (p) => {
        job.proofs.push({ kind: p.kind, index: p.index, proof: toHex(p.proof), publicInputs: p.publicInputs, restart: p.restart });
      },
    });
    if (resume) job.resume = resume;
    if (submit) job.finality = Number(await read<bigint>(client, job.pool, "finality"));
  }

  /**
   * `runJob` with a wall-clock budget. A job that overruns is failed and the worker moves
   * on; the underlying promise may still settle later and its result is ignored.
   */
  async function runJobWithTimeout(job: Job): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running = runJob(job);
    running.catch(() => {}); // a rejection after the timeout won't crash the process
    try {
      await Promise.race([
        running,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`job timed out after ${jobTimeoutMs / 1000}s`)), jobTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
          await runJobWithTimeout(job);
          job.status = "done";
          doneJobsByKey.set(`${poolKey}|${job.inputsRoot}`, id);
        } catch (e) {
          job.status = "failed";
          job.error = e instanceof Error ? e.message : String(e);
          // Not cached like a success — a later POST retries — but held for a cooldown so
          // a pool that fails every time isn't re-proven once per request.
          failedByPool.set(poolKey, { id, at: Date.now() });
        } finally {
          if (jobsByPool.get(poolKey) === id) jobsByPool.delete(poolKey);
          evictOldJobs();
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
      const failed = failedByPool.get(poolKey);
      if (failed && Date.now() - failed.at < FAILURE_COOLDOWN_MS && jobs.has(failed.id)) {
        // Proving is deterministic: a pool that just failed will fail again. Hand back the
        // failed job (with its error) instead of burning the box on it once per request.
        send(res, 409, { job: failed.id, error: jobs.get(failed.id)!.error, retryAfterMs: FAILURE_COOLDOWN_MS - (Date.now() - failed.at) });
        return;
      }
      const id = randomUUID();
      const job: Job = { id, pool: addr, inputsRoot, status: "queued", log: [], proofs: [] };
      jobs.set(id, job);
      evictOldJobs();
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
      send(res, 200, { status: job.status, pool: job.pool, log: job.log, proofs: job.proofs, resume: job.resume, finality: job.finality, error: job.error });
      return;
    }

    send(res, 404, { error: "not found" });
  }

  return server;
}
