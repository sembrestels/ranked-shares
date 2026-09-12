# Round pages A: the read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Deno + Hono read API under `web/api/` that serves one consistent snapshot of a RankedShares pool (`GET /api/round`), a project with its Swarm pitch (`GET /api/project/:id`), and a voter's own status (`GET /api/voter/:address`), plus `web/server.ts` that serves it next to the built SPA as one Deno Deploy app.

**Architecture:** `bootstrap.ts` builds the dependencies (config, a viem public client with RPC failover, a snapshot cache, a content resolver) and the Hono app; routes are thin, services do the work. Every read for one snapshot is pinned to one block number. Variants (plain, cre, zisk, noir) are detected by probing and read through per-variant ABIs. Pure functions (`commitmentsFrom`, `stageOf`) carry the logic and are unit-tested; chain reads are tested against a fake pool transport; one Anvil test checks the plain pool end to end.

**Tech Stack:** Deno 2, Hono (jsr), viem 2 (already a dependency of `web/`), `@std/assert`, `@std/http`, Anvil and Foundry artifacts in `out/` for the integration test.

**Spec:** `docs/superpowers/specs/2026-09-12-round-pages-design.md` (sections 2, 3, 5).

## Global Constraints

- All files under `web/`; run every command from `web/` unless stated. Deno tasks, not npm, run the API.
- Public commitment per project = sum of direct weight of voters whose public ballot byte for the project equals 1 (competition rank 1, ties included). Never any-rank sums. Noir pools: `commitmentsAvailable: false` and zero commitments.
- One block number per snapshot; every contract read for that snapshot passes `blockNumber`.
- JSON: bigints as decimal strings, addresses checksummed (`getAddress`), bytes as `0x` hex, times as unix seconds (numbers).
- Errors: `400` malformed input, `404` unknown project, `502 { error: "rpc unavailable" }` when the RPC is down, `500` otherwise; every error body is `{ error: string }`.
- No Deno KV, no cron, no auth, no writes, no private keys. Nothing secret is `VITE_`-prefixed.
- Copy strings, labels, and step keys exactly as in the spec: step keys `proposals, setup, open, closing, proving, proven, paid`; labels `Proposals, Setup, Open, Closing, Proving` (plain: `Counting`), proven label `Proven | Provisional | Abandoned | Counted`, `Paid`.
- Lint: `deno lint` recommended rules with `no-explicit-any` excluded (set in Task 1). Format: `deno fmt` with line width 100 (set in Task 1).
- Commits: one per task, message in the imperative, no attribution lines.

---

### Task 1: API scaffold, config, health route

**Files:**
- Modify: `web/deno.json`
- Modify: `web/tsconfig.json`
- Create: `web/api/config.ts`, `web/api/deps.ts`, `web/api/app.ts`, `web/api/bootstrap.ts`, `web/api/main.ts`, `web/api/routes/health.ts`
- Test: `web/api/tests/config.test.ts`, `web/api/tests/health.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string, string | undefined>): Config`; `Config = { port, rpcUrls, chainId, poolAddress: Address | null, webOrigins, beeUrl: string | null, snapshotTtlMs, rosterPage, contentTimeoutMs }`; `createApp(deps: Deps): Hono`; `HttpError(status, message)`; `Deps = { config, now: () => number, log: (msg: string) => void }` (extended by Tasks 6 and 7).

- [ ] **Step 1: Add the Deno tasks, imports, lint and fmt settings**

Replace `web/deno.json` with:

```json
{
  "nodeModulesDir": "auto",
  "tasks": {
    "dev": "deno run -A npm:@react-router/dev dev",
    "build": "deno run -A npm:@react-router/dev build",
    "preview": "deno run -A npm:vite preview --outDir build/client",
    "typecheck": "deno run -A npm:@react-router/dev typegen && deno run -A npm:typescript/tsc --noEmit",
    "test": "deno run -A npm:vitest run",
    "dev:api": "deno run --env-file=.env -A --watch api/main.ts",
    "start": "deno run --env-file=.env --allow-net --allow-read --allow-env server.ts",
    "test:api": "deno test -A api/",
    "check:api": "deno check api/main.ts",
    "lint": "deno lint",
    "fmt": "deno fmt"
  },
  "imports": {
    "hono": "jsr:@hono/hono@^4.13",
    "@std/assert": "jsr:@std/assert@^1",
    "@std/http": "jsr:@std/http@^1.0.0"
  },
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable", "deno.ns"],
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "lint": {
    "include": ["api/"],
    "rules": { "tags": ["recommended"], "exclude": ["no-explicit-any"] }
  },
  "fmt": { "include": ["api/"], "lineWidth": 100, "indentWidth": 2 }
}
```

Then run `deno install` from `web/` so `deno.lock` records the jsr packages.

- [ ] **Step 2: Keep tsc away from the Deno files**

In `web/tsconfig.json` add, next to `"include"`:

```json
  "exclude": ["api", "server.ts", "node_modules", "build"],
```

and change `"include"` to `["app", "test", ".react-router/types/**/*", "vite.config.ts", "react-router.config.ts"]`.

- [ ] **Step 3: Write the failing config tests**

`web/api/tests/config.test.ts`:

```ts
import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "../config.ts";

Deno.test("loadConfig: defaults", () => {
  const c = loadConfig({});
  assertEquals(c.port, 8000);
  assertEquals(c.rpcUrls, ["http://127.0.0.1:8545"]);
  assertEquals(c.chainId, 31337);
  assertEquals(c.poolAddress, null);
  assertEquals(c.webOrigins, ["http://localhost:5174"]);
  assertEquals(c.beeUrl, null);
  assertEquals(c.snapshotTtlMs, 15_000);
  assertEquals(c.rosterPage, 200);
  assertEquals(c.contentTimeoutMs, 5_000);
});

Deno.test("loadConfig: VITE_ fallbacks, lists, checksummed pool, trailing slash trimmed", () => {
  const c = loadConfig({
    VITE_RPC_URL: "http://a , http://b",
    VITE_CHAIN_ID: "5042002",
    VITE_POOL_ADDRESS: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    BEE_URL: "http://bee:1633/",
    WEB_ORIGIN: "https://ranked.example, http://localhost:5174",
  });
  assertEquals(c.rpcUrls, ["http://a", "http://b"]);
  assertEquals(c.chainId, 5042002);
  assertEquals(c.poolAddress, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
  assertEquals(c.beeUrl, "http://bee:1633");
  assertEquals(c.webOrigins, ["https://ranked.example", "http://localhost:5174"]);
});

Deno.test("loadConfig: API variables win over VITE_ ones", () => {
  const c = loadConfig({ RPC_URL: "http://api", VITE_RPC_URL: "http://vite", CHAIN_ID: "7", VITE_CHAIN_ID: "8" });
  assertEquals(c.rpcUrls, ["http://api"]);
  assertEquals(c.chainId, 7);
});

Deno.test("loadConfig: rejects a malformed pool and a non-numeric port", () => {
  assertThrows(() => loadConfig({ POOL_ADDRESS: "0x12" }), Error, "POOL_ADDRESS");
  assertThrows(() => loadConfig({ PORT: "eighty" }), Error, "PORT");
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `deno test -A api/tests/config.test.ts`
Expected: FAIL, module `../config.ts` not found.

- [ ] **Step 5: Write `web/api/config.ts`**

```ts
/** Environment into a typed config. Pure, so tests build their own. API
 * variables win; the VITE_ ones are read as fallbacks so one .env serves both. */
import { type Address, getAddress, isAddress } from "viem";

export interface Config {
  port: number;
  rpcUrls: string[];
  chainId: number;
  poolAddress: Address | null;
  webOrigins: string[];
  beeUrl: string | null;
  snapshotTtlMs: number;
  rosterPage: number;
  contentTimeoutMs: number;
}

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function positive(name: string, v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got ${v}`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rpcUrls = list(env.RPC_URL || env.VITE_RPC_URL);
  if (rpcUrls.length === 0) rpcUrls.push("http://127.0.0.1:8545");
  const pool = env.POOL_ADDRESS || env.VITE_POOL_ADDRESS || "";
  if (pool && !isAddress(pool)) throw new Error(`POOL_ADDRESS is not an address: ${pool}`);
  const origins = list(env.WEB_ORIGIN);
  const bee = (env.BEE_URL ?? "").trim().replace(/\/+$/, "");
  return {
    port: positive("PORT", env.PORT, 8000),
    rpcUrls,
    chainId: positive("CHAIN_ID", env.CHAIN_ID || env.VITE_CHAIN_ID, 31337),
    poolAddress: pool ? getAddress(pool) : null,
    webOrigins: origins.length ? origins : ["http://localhost:5174"],
    beeUrl: bee || null,
    snapshotTtlMs: positive("SNAPSHOT_TTL_MS", env.SNAPSHOT_TTL_MS, 15_000),
    rosterPage: positive("ROSTER_PAGE", env.ROSTER_PAGE, 200),
    contentTimeoutMs: positive("CONTENT_TIMEOUT_MS", env.CONTENT_TIMEOUT_MS, 5_000),
  };
}
```

- [ ] **Step 6: Write the failing health tests**

`web/api/tests/health.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";

const deps = { config: loadConfig({ CHAIN_ID: "31337" }), now: () => 0, log: () => {} };

Deno.test("GET /healthz reports the chain and pool", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/healthz"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, chainId: 31337, pool: null });
});

Deno.test("unknown routes are JSON 404s", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/api/nothing"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not found" });
});

Deno.test("CORS allows a configured origin on GET", async () => {
  const res = await createApp(deps).fetch(
    new Request("http://x/healthz", { headers: { Origin: "http://localhost:5174" } }),
  );
  assertEquals(res.headers.get("access-control-allow-origin"), "http://localhost:5174");
});
```

- [ ] **Step 7: Run to see them fail**

Run: `deno test -A api/tests/health.test.ts`
Expected: FAIL, `../app.ts` not found.

- [ ] **Step 8: Write `deps.ts`, `app.ts`, `routes/health.ts`, `bootstrap.ts`, `main.ts`**

`web/api/deps.ts`:

```ts
import type { Config } from "./config.ts";

/** Everything a route needs, built once in bootstrap.ts and faked in tests. */
export interface Deps {
  config: Config;
  now: () => number;
  log: (msg: string) => void;
}
```

`web/api/app.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Deps } from "./deps.ts";
import { healthRoutes } from "./routes/health.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    deps.log(`unhandled: ${err.stack ?? err}`);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.use(
    "*",
    cors({ origin: deps.config.webOrigins, allowMethods: ["GET", "OPTIONS"], maxAge: 600 }),
  );
  app.route("/healthz", healthRoutes(deps));
  return app;
}
```

`web/api/routes/health.ts`:

```ts
import { Hono } from "hono";
import type { Deps } from "../deps.ts";

export function healthRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/", (c) =>
    c.json({ ok: true, chainId: deps.config.chainId, pool: deps.config.poolAddress }));
  return r;
}
```

`web/api/bootstrap.ts`:

```ts
/** Builds the API from the environment. Shared by main.ts (API alone) and
 * ../server.ts (API next to the built SPA). */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import type { Deps } from "./deps.ts";

export function createServer(env: Record<string, string | undefined> = Deno.env.toObject()) {
  const config = loadConfig(env);
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
  const now = () => Math.floor(Date.now() / 1000);
  const deps: Deps = { config, now, log };
  return { app: createApp(deps), config, deps };
}
```

`web/api/main.ts`:

```ts
/** The API on its own (dev). Production serves API and SPA from ../server.ts. */
import { createServer } from "./bootstrap.ts";

const { app, config } = createServer();
Deno.serve({ port: config.port }, app.fetch);
```

- [ ] **Step 9: Run all API tests, lint, check**

Run: `deno test -A api/ && deno lint && deno check api/main.ts`
Expected: 7 tests pass, lint clean, check clean.

- [ ] **Step 10: Confirm the SPA toolchain still passes**

Run: `deno task typecheck && deno task test`
Expected: typecheck clean (tsc no longer sees `api/`), 20 vitest tests pass.

- [ ] **Step 11: Commit**

```bash
git add deno.json deno.lock tsconfig.json api
git commit -m "Scaffold the read API: config, Hono app, health route, Deno tasks"
```

---

### Task 2: ABIs, the viem client, variant detection, and the fake pool transport

**Files:**
- Create: `web/api/chain/abi.ts`, `web/api/chain/client.ts`, `web/api/chain/kind.ts`
- Test: `web/api/tests/fake-pool.ts` (helper), `web/api/tests/kind.test.ts`

**Interfaces:**
- Produces: `plainAbi`, `sealedAbi`, `noirAbi`, `erc20Abi` (viem `parseAbi` results); `createClient({ rpcUrls, chainId, transport? }): PublicClient`; `type Kind = "plain" | "cre" | "zisk" | "noir"`; `detectKind(client, pool, blockNumber): Promise<Kind>`; test helper `fakeTransport(contracts: FakeContract[], block?: bigint): { transport, calls: string[] }` with `FakeContract = { address, abi, handlers: Record<string, (args: readonly unknown[]) => unknown> }`.

- [ ] **Step 1: Write `web/api/chain/abi.ts`**

```ts
/** Read ABIs per pool variant. Same-named functions differ between variants
 * (directBallotOf, sealedOf, votersFrom), so each variant has its own ABI and
 * the reader picks one after detectKind(). Signatures from the contract
 * survey of 2026-09-12 (spec section 3.3). */
import { parseAbi } from "viem";

const base = [
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function votingOpen() view returns (bool)",
  "function votingDeadline() view returns (uint64)",
  "function totalWeight() view returns (uint256)",
  "function spent() view returns (uint256)",
  "function claimedTotal() view returns (uint256)",
  "function projectCount() view returns (uint256)",
  "function cost(uint256 projectId) view returns (uint256)",
  "function recipientOf(uint256 projectId) view returns (address)",
  "function contentRefOf(uint256 projectId) view returns (bytes32)",
  "function funded(uint256 projectId) view returns (bool)",
  "function claimed(uint256 projectId) view returns (bool)",
  "function fundedProjects() view returns (uint256[])",
  "function proposalCount() view returns (uint256)",
  "function voterCount() view returns (uint256)",
  "function phase() view returns (uint8)",
] as const;

const sealedCommon = [
  "function finality() view returns (uint8)",
  "function closed() view returns (bool)",
  "function closeCursor() view returns (uint256)",
  "function abandonGrace() view returns (uint64)",
  "function totalSeatWeight() view returns (uint256)",
  "function directWeight(address voter) view returns (uint256)",
  "function seatWeight(address voter) view returns (uint256)",
] as const;

export const plainAbi = parseAbi([
  ...base,
  "function tallyStarted() view returns (bool)",
  "function tallyDone() view returns (bool)",
  "function rankLevel() view returns (uint256)",
  "function voterAt(uint256 index) view returns (address)",
  "function ballotOf(address voter) view returns (bytes)",
  "function weightOf(address voter) view returns (uint256)",
] as const);

export const sealedAbi = parseAbi([
  ...base,
  ...sealedCommon,
  "function kind() pure returns (string)",
  "function directBallotOf(address voter) view returns (bytes)",
  "function sealedOf(address voter) view returns (bytes)",
  "function votersFrom(uint256 start, uint256 count) view returns (address[] who, uint256[] direct, uint256[] seats, bytes[] ballots, bytes[] cts)",
] as const);

export const noirAbi = parseAbi([
  ...base,
  ...sealedCommon,
  "function profileId() view returns (bytes32)",
  "function proofGrace() view returns (uint64)",
  "function reportedAt() view returns (uint64)",
  "function resultReported() view returns (bool)",
  "function ingestCursor() view returns (uint256)",
  "function numBatches() view returns (uint256)",
  "function sealedCount() view returns (uint256)",
  "function hasDirect(address voter) view returns (bool)",
  "function directBallotOf(address voter) view returns (uint256)",
  "function sealedOf(address voter) view returns (uint256 rx, uint256 ry, uint256 c)",
  "function votersFrom(uint256 start, uint256 count) view returns (address[] who, uint256[] direct, uint256[] ballots, uint256[] seats, uint256[3][] cts, bool[] hasDirectFlags)",
] as const);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const);
```

- [ ] **Step 2: Write `web/api/chain/client.ts`**

```ts
/** One viem public client. Several RPC URLs become a fallback transport so a
 * flaky provider does not take the API down. Tests pass a custom transport. */
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type PublicClient,
  type Transport,
} from "viem";

export function createClient(
  opts: { rpcUrls: string[]; chainId: number; transport?: Transport },
): PublicClient {
  const chain = defineChain({
    id: opts.chainId,
    name: `chain-${opts.chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: opts.rpcUrls } },
  });
  const transport = opts.transport ??
    (opts.rpcUrls.length === 1
      ? http(opts.rpcUrls[0], { timeout: 10_000 })
      : fallback(opts.rpcUrls.map((u) => http(u, { timeout: 10_000 }))));
  return createPublicClient({ chain, transport });
}
```

- [ ] **Step 3: Write the fake pool transport helper `web/api/tests/fake-pool.ts`**

```ts
/** A viem transport that answers eth_call from handler functions, so chain
 * reads are tested without a node. Unknown functions revert, like a real
 * contract without that selector, which is what detectKind relies on. */
import {
  type Abi,
  type Address,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  toHex,
} from "viem";

export interface FakeContract {
  address: Address;
  abi: Abi;
  handlers: Record<string, (args: readonly unknown[]) => unknown>;
}

export function fakeTransport(contracts: FakeContract[], block = 100n) {
  const byAddr = new Map(contracts.map((c) => [c.address.toLowerCase(), c]));
  const calls: string[] = [];
  const transport = custom({
    // deno-lint-ignore require-await
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      if (method === "eth_chainId") return toHex(31337);
      if (method === "eth_blockNumber") return toHex(block);
      if (method === "eth_call") {
        const [{ to, data }] = params as [{ to: Address; data: Hex }];
        const c = byAddr.get(to.toLowerCase());
        if (!c) throw new Error(`no contract at ${to}`);
        let functionName: string;
        let args: readonly unknown[];
        try {
          const d = decodeFunctionData({ abi: c.abi, data });
          functionName = d.functionName;
          args = d.args ?? [];
        } catch {
          throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
        }
        const h = c.handlers[functionName];
        if (!h) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
        return encodeFunctionResult({ abi: c.abi, functionName, result: h(args) as never });
      }
      throw new Error(`unexpected rpc method ${method}`);
    },
  });
  return { transport, calls };
}

export const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
export const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
export const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
export const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
```

- [ ] **Step 4: Write the failing kind tests `web/api/tests/kind.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { detectKind } from "../chain/kind.ts";
import { fakeTransport, POOL } from "./fake-pool.ts";

const clientFor = (abi: typeof plainAbi | typeof sealedAbi | typeof noirAbi, handlers: Record<string, () => unknown>) =>
  createClient({
    rpcUrls: ["http://fake"],
    chainId: 31337,
    transport: fakeTransport([{ address: POOL, abi, handlers }]).transport,
  });

Deno.test("detectKind: kind() = zisk", async () => {
  const client = clientFor(sealedAbi, { kind: () => "zisk" });
  assertEquals(await detectKind(client, POOL, 100n), "zisk");
});

Deno.test("detectKind: kind() = cre", async () => {
  const client = clientFor(sealedAbi, { kind: () => "cre" });
  assertEquals(await detectKind(client, POOL, 100n), "cre");
});

Deno.test("detectKind: no kind() but profileId() = noir", async () => {
  const client = clientFor(noirAbi, { profileId: () => "0x" + "ab".repeat(32) });
  assertEquals(await detectKind(client, POOL, 100n), "noir");
});

Deno.test("detectKind: neither = plain", async () => {
  const client = clientFor(plainAbi, { tallyDone: () => false });
  assertEquals(await detectKind(client, POOL, 100n), "plain");
});
```

- [ ] **Step 5: Run to see them fail**

Run: `deno test -A api/tests/kind.test.ts`
Expected: FAIL, `../chain/kind.ts` not found.

- [ ] **Step 6: Write `web/api/chain/kind.ts`**

```ts
/** Which pool is this? SealedPool variants answer kind(); the Noir pool has
 * profileId(); the plain pool has neither. Probed once per snapshot. */
import type { Address, PublicClient } from "viem";
import { noirAbi, sealedAbi } from "./abi.ts";

export type Kind = "plain" | "cre" | "zisk" | "noir";

export async function detectKind(
  client: PublicClient,
  pool: Address,
  blockNumber: bigint,
): Promise<Kind> {
  try {
    const k = await client.readContract({ address: pool, abi: sealedAbi, functionName: "kind", blockNumber });
    if (k === "cre" || k === "zisk") return k;
  } catch {
    // not a SealedPool
  }
  try {
    await client.readContract({ address: pool, abi: noirAbi, functionName: "profileId", blockNumber });
    return "noir";
  } catch {
    // not a Noir pool
  }
  return "plain";
}
```

- [ ] **Step 7: Run the tests, lint, check**

Run: `deno test -A api/tests/kind.test.ts && deno lint && deno check api/chain/kind.ts api/tests/fake-pool.ts`
Expected: 4 pass, clean.

- [ ] **Step 8: Commit**

```bash
git add api/chain api/tests/fake-pool.ts api/tests/kind.test.ts
git commit -m "Add the pool ABIs per variant, the viem client, variant detection, and a fake pool transport"
```

---

### Task 3: Public commitments, a pure function

**Files:**
- Create: `web/api/services/commitments.ts`
- Test: `web/api/tests/commitments.test.ts`

**Interfaces:**
- Produces: `RosterEntry = { weight: bigint; ballot: Hex }` (`"0x"` = no public ballot); `commitmentsFrom(entries: readonly RosterEntry[], projectCount: number): bigint[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from "@std/assert";
import { commitmentsFrom } from "../services/commitments.ts";

Deno.test("commitmentsFrom: first-ranked project gets the voter's direct weight", () => {
  const out = commitmentsFrom([
    { weight: 1000n, ballot: "0x0102" },
    { weight: 300n, ballot: "0x0201" },
  ], 2);
  assertEquals(out, [1000n, 300n]);
});

Deno.test("commitmentsFrom: ties at rank 1 count for every tied project", () => {
  assertEquals(commitmentsFrom([{ weight: 500n, ballot: "0x0101" }], 2), [500n, 500n]);
});

Deno.test("commitmentsFrom: unranked (0) and lower ranks add nothing", () => {
  assertEquals(commitmentsFrom([{ weight: 500n, ballot: "0x000201" }], 3), [0n, 0n, 500n]);
});

Deno.test("commitmentsFrom: no ballot, zero weight, and short ballots are safe", () => {
  assertEquals(
    commitmentsFrom([
      { weight: 900n, ballot: "0x" },
      { weight: 0n, ballot: "0x01" },
      { weight: 7n, ballot: "0x01" },
    ], 3),
    [7n, 0n, 0n],
  );
});

Deno.test("commitmentsFrom: zero projects gives an empty vector", () => {
  assertEquals(commitmentsFrom([{ weight: 1n, ballot: "0x01" }], 0), []);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test -A api/tests/commitments.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/api/services/commitments.ts`**

```ts
/** Public commitment per project: the direct weight of every voter whose
 * public ballot gives the project competition rank 1 (ties included). This
 * is the number a donor recognises as "what I put behind it"; any-rank sums
 * would exceed the budget. Spec decision 1. */
import { type Hex, hexToBytes } from "viem";

export interface RosterEntry {
  weight: bigint;
  /** One byte per project, competition rank; "0x" when the voter has no public ballot. */
  ballot: Hex;
}

export function commitmentsFrom(entries: readonly RosterEntry[], projectCount: number): bigint[] {
  const out = Array.from({ length: projectCount }, () => 0n);
  for (const { weight, ballot } of entries) {
    if (weight === 0n || ballot === "0x") continue;
    const ranks = hexToBytes(ballot);
    const n = Math.min(projectCount, ranks.length);
    for (let p = 0; p < n; p++) if (ranks[p] === 1) out[p] += weight;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `deno test -A api/tests/commitments.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/commitments.ts api/tests/commitments.test.ts
git commit -m "Compute public commitments per project from first-ranked direct weight"
```

---

### Task 4: The stage, a pure function

**Files:**
- Create: `web/api/services/stage.ts`
- Test: `web/api/tests/stage.test.ts`

**Interfaces:**
- Produces: `StepKey`, `Stage = { current: StepKey; steps: { key; state: "done" | "current" | "next"; label: string }[] }`, `StageFacts = { kind: Kind; phase: PhaseName; votingDeadline: number; finality: Finality | null; spent: string; claimedTotal: string }`, `PhaseName = "setup" | "open" | "closing" | "tally" | "done"`, `Finality = "proven" | "attested" | "abandoned" | "counted"`, `stageOf(facts: StageFacts, now: number): Stage`.

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from "@std/assert";
import { type StageFacts, stageOf } from "../services/stage.ts";

const base: StageFacts = {
  kind: "zisk",
  phase: "open",
  votingDeadline: 2_000,
  finality: null,
  spent: "0",
  claimedTotal: "0",
};
const states = (s: ReturnType<typeof stageOf>) => s.steps.map((x) => x.state).join(" ");
const labels = (s: ReturnType<typeof stageOf>) => s.steps.map((x) => x.label).join(" ");

Deno.test("stage: seven steps in order with the spec's labels", () => {
  const s = stageOf(base, 1_000);
  assertEquals(s.steps.map((x) => x.key), ["proposals", "setup", "open", "closing", "proving", "proven", "paid"]);
  assertEquals(labels(s), "Proposals Setup Open Closing Proving Proven Paid");
});

Deno.test("stage: setup marks proposals and setup current", () => {
  const s = stageOf({ ...base, phase: "setup" }, 1_000);
  assertEquals(s.current, "setup");
  assertEquals(states(s), "current current next next next next next");
});

Deno.test("stage: open before the deadline", () => {
  const s = stageOf(base, 1_000);
  assertEquals(s.current, "open");
  assertEquals(states(s), "done done current next next next next");
});

Deno.test("stage: a plain pool past the deadline but not tallying is closing", () => {
  const s = stageOf({ ...base, kind: "plain" }, 2_500);
  assertEquals(s.current, "closing");
});

Deno.test("stage: closing and tally", () => {
  assertEquals(stageOf({ ...base, phase: "closing" }, 2_500).current, "closing");
  const t = stageOf({ ...base, phase: "tally" }, 2_500);
  assertEquals(t.current, "proving");
  assertEquals(states(t), "done done done done current next next");
});

Deno.test("stage: plain pool labels proving as Counting and finality as Counted", () => {
  const s = stageOf({ ...base, kind: "plain", phase: "tally" }, 2_500);
  assertEquals(s.steps[4].label, "Counting");
  assertEquals(s.steps[5].label, "Counted");
});

Deno.test("stage: done with unpaid funded projects stays on proven, labelled by finality", () => {
  const s = stageOf({ ...base, phase: "done", finality: "proven", spent: "100", claimedTotal: "40" }, 3_000);
  assertEquals(s.current, "proven");
  assertEquals(s.steps[5].label, "Proven");
  assertEquals(states(s), "done done done done done current next");
  assertEquals(stageOf({ ...base, phase: "done", finality: "attested", spent: "1", claimedTotal: "0" }, 3_000).steps[5].label, "Provisional");
});

Deno.test("stage: done and fully paid moves to paid", () => {
  const s = stageOf({ ...base, phase: "done", finality: "proven", spent: "100", claimedTotal: "100" }, 3_000);
  assertEquals(s.current, "paid");
  assertEquals(states(s), "done done done done done done current");
});

Deno.test("stage: abandoned ends on proven labelled Abandoned with paid next", () => {
  const s = stageOf({ ...base, phase: "done", finality: "abandoned", spent: "0", claimedTotal: "0" }, 3_000);
  assertEquals(s.current, "proven");
  assertEquals(s.steps[5].label, "Abandoned");
  assertEquals(s.steps[6].state, "next");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test -A api/tests/stage.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/api/services/stage.ts`**

```ts
/** The seven-step stage bar from chain facts. Spec decision 3. */
import type { Kind } from "../chain/kind.ts";

export type PhaseName = "setup" | "open" | "closing" | "tally" | "done";
export type Finality = "proven" | "attested" | "abandoned" | "counted";
export type StepKey = "proposals" | "setup" | "open" | "closing" | "proving" | "proven" | "paid";
export type StepState = "done" | "current" | "next";

export interface StageFacts {
  kind: Kind;
  phase: PhaseName;
  votingDeadline: number;
  finality: Finality | null;
  spent: string;
  claimedTotal: string;
}

export interface Stage {
  current: StepKey;
  steps: { key: StepKey; state: StepState; label: string }[];
}

const ORDER: StepKey[] = ["proposals", "setup", "open", "closing", "proving", "proven", "paid"];

function provenLabel(f: StageFacts): string {
  switch (f.finality) {
    case "proven":
      return "Proven";
    case "attested":
      return "Provisional";
    case "abandoned":
      return "Abandoned";
    case "counted":
      return "Counted";
    default:
      return f.kind === "plain" ? "Counted" : "Proven";
  }
}

export function stageOf(f: StageFacts, now: number): Stage {
  const labels: Record<StepKey, string> = {
    proposals: "Proposals",
    setup: "Setup",
    open: "Open",
    closing: "Closing",
    proving: f.kind === "plain" ? "Counting" : "Proving",
    proven: provenLabel(f),
    paid: "Paid",
  };
  let index: number;
  const alsoCurrent = new Set<StepKey>();
  switch (f.phase) {
    case "setup":
      index = 1;
      alsoCurrent.add("proposals");
      break;
    case "open":
      index = now >= f.votingDeadline ? 3 : 2;
      break;
    case "closing":
      index = 3;
      break;
    case "tally":
      index = 4;
      break;
    case "done":
      index = f.finality === "abandoned" || BigInt(f.claimedTotal) < BigInt(f.spent) ? 5 : 6;
      break;
  }
  const steps = ORDER.map((key, i) => ({
    key,
    label: labels[key],
    state: (i < index ? "done" : i === index || alsoCurrent.has(key) ? "current" : "next") as StepState,
  }));
  return { current: ORDER[index], steps };
}
```

- [ ] **Step 4: Run the tests**

Run: `deno test -A api/tests/stage.test.ts`
Expected: 9 pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/stage.ts api/tests/stage.test.ts
git commit -m "Derive the seven-step stage from pool facts"
```

---

### Task 5: Reading a round from the chain, per variant

**Files:**
- Create: `web/api/chain/read.ts`
- Test: `web/api/tests/read.test.ts`

**Interfaces:**
- Consumes: `detectKind`, the ABIs, `commitmentsFrom`, `StageFacts` types.
- Produces: `ProjectView`, `RoundFacts` (spec 3.2 `RoundSnapshot` without `at` and `stage`), `readRound(client, pool, opts: { rosterPage: number; chainId: number }): Promise<{ facts: RoundFacts; roster: Set<string> }>` (roster = lowercase addresses of every registered voter), and `readRoster` internals reused by Task 8.

- [ ] **Step 1: Write the failing tests `web/api/tests/read.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { erc20Abi, noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { readRound } from "../chain/read.ts";
import { A, B, fakeTransport, POOL, TOKEN } from "./fake-pool.ts";

const ZERO = "0x" + "00".repeat(32);
const tokenContract = {
  address: TOKEN,
  abi: erc20Abi,
  handlers: { symbol: () => "USDC", decimals: () => 6 },
};
const common = {
  token: () => TOKEN,
  owner: () => A,
  votingDeadline: () => 1_700_003_600n,
  totalWeight: () => 1_300n,
  spent: () => 0n,
  claimedTotal: () => 0n,
  projectCount: () => 2n,
  cost: ([id]: readonly unknown[]) => [4_000n, 2_500n][Number(id)],
  recipientOf: () => B,
  contentRefOf: ([id]: readonly unknown[]) => Number(id) === 0 ? "0x" + "ab".repeat(32) : ZERO,
  funded: () => false,
  claimed: () => false,
  fundedProjects: () => [],
  proposalCount: () => 3n,
  voterCount: () => 2n,
};

Deno.test("readRound: plain pool in the open phase", async () => {
  const { transport, calls } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: plainAbi,
      handlers: {
        ...common,
        phase: () => 1,
        votingOpen: () => true,
        tallyStarted: () => false,
        tallyDone: () => false,
        rankLevel: () => 0n,
        voterAt: ([i]) => [A, B][Number(i)],
        ballotOf: ([a]) => (a as string).toLowerCase() === A.toLowerCase() ? "0x0102" : "0x0201",
        weightOf: ([a]) => (a as string).toLowerCase() === A.toLowerCase() ? 1_000n : 300n,
      },
    },
  ], 123n);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts, roster } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "plain");
  assertEquals(facts.block, 123);
  assertEquals(facts.phase, "open");
  assertEquals(facts.votingDeadline, 1_700_003_600);
  assertEquals(facts.token, { address: TOKEN, symbol: "USDC", decimals: 6 });
  assertEquals(facts.projects.map((p) => p.commitment), ["1000", "300"]);
  assertEquals(facts.projects[0].cost, "4000");
  assertEquals(facts.projects[0].contentRef, "0x" + "ab".repeat(32));
  assertEquals(facts.projects[1].contentRef, ZERO);
  assertEquals(facts.sealed, { total: "0", count: 0, commitmentsAvailable: true });
  assertEquals(facts.closing, null);
  assertEquals(facts.proving, null);
  assertEquals(facts.finality, null);
  assertEquals(facts.graces, { abandonFrom: null, provisionalFrom: null });
  assertEquals(facts.voterCount, 2);
  assertEquals(facts.proposalCount, 3);
  assertEquals(roster, new Set([A.toLowerCase(), B.toLowerCase()]));
  assertEquals(calls.filter((m) => m === "eth_blockNumber").length, 1);
});

Deno.test("readRound: zisk pool in the tally phase with sealed ballots", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: sealedAbi,
      handlers: {
        ...common,
        kind: () => "zisk",
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        totalSeatWeight: () => 500n,
        votersFrom: ([start, count]) => {
          if (BigInt(start as bigint) !== 0n || BigInt(count as bigint) !== 2n) throw new Error("bad page");
          return [[A, B], [1_000n, 0n], [0n, 500n], ["0x0102", "0x"], ["0x", "0x" + "cd".repeat(35)]];
        },
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "zisk");
  assertEquals(facts.phase, "tally");
  assertEquals(facts.projects.map((p) => p.commitment), ["1000", "0"]);
  assertEquals(facts.sealed, { total: "500", count: 1, commitmentsAvailable: true });
  assertEquals(facts.closing, { closed: true, cursor: 2 });
  assertEquals(facts.proving, null);
  assertEquals(facts.graces, { abandonFrom: 1_700_003_600 + 604_800, provisionalFrom: null });
});

Deno.test("readRound: zisk pool done and proven", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: sealedAbi,
      handlers: {
        ...common,
        kind: () => "zisk",
        phase: () => 4,
        votingOpen: () => true,
        finality: () => 1,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        totalSeatWeight: () => 500n,
        spent: () => 4_000n,
        claimedTotal: () => 0n,
        funded: ([id]) => Number(id) === 0,
        fundedProjects: () => [0n],
        votersFrom: () => [[A, B], [1_000n, 0n], [0n, 500n], ["0x0102", "0x"], ["0x", "0x" + "cd".repeat(35)]],
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.phase, "done");
  assertEquals(facts.finality, "proven");
  assertEquals(facts.fundedOrder, [0]);
  assertEquals(facts.projects[0].funded, true);
  assertEquals(facts.graces.abandonFrom, null);
});

Deno.test("readRound: noir pool reports sealed count and no commitments", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: noirAbi,
      handlers: {
        ...common,
        profileId: () => "0x" + "ab".repeat(32),
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        proofGrace: () => 86_400n,
        reportedAt: () => 1_700_010_000n,
        resultReported: () => true,
        ingestCursor: () => 1n,
        numBatches: () => 4n,
        sealedCount: () => 1n,
        totalSeatWeight: () => 500n,
        votersFrom: () => [[A, B], [1_000n, 0n], [5n, 0n], [0n, 500n], [[0n, 0n, 0n], [1n, 2n, 3n]], [true, false]],
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts, roster } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "noir");
  assertEquals(facts.sealed, { total: "500", count: 1, commitmentsAvailable: false });
  assertEquals(facts.projects.map((p) => p.commitment), ["0", "0"]);
  assertEquals(facts.proving, { accepted: 1, total: 4 });
  assertEquals(facts.graces, { abandonFrom: 1_700_003_600 + 604_800, provisionalFrom: 1_700_010_000 + 86_400 });
  assertEquals(roster.size, 2);
});

Deno.test("readRound: token symbol falls back to 'tokens'", async () => {
  const { transport } = fakeTransport([
    { address: TOKEN, abi: erc20Abi, handlers: { decimals: () => 18 } },
    {
      address: POOL,
      abi: plainAbi,
      handlers: { ...common, phase: () => 0, votingOpen: () => false, tallyStarted: () => false, tallyDone: () => false, rankLevel: () => 0n, voterCount: () => 0n },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.token.symbol, "tokens");
  assertEquals(facts.phase, "setup");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test -A api/tests/read.test.ts`
Expected: FAIL, `../chain/read.ts` not found.

- [ ] **Step 3: Write `web/api/chain/read.ts`**

```ts
/** One consistent read of a pool: block number first, then every view pinned
 * to it, through the ABI of the detected variant. Spec section 3.3. */
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import { erc20Abi, noirAbi, plainAbi, sealedAbi } from "./abi.ts";
import { detectKind, type Kind } from "./kind.ts";
import { commitmentsFrom, type RosterEntry } from "../services/commitments.ts";
import type { Finality, PhaseName } from "../services/stage.ts";

export interface ProjectView {
  id: number;
  cost: string;
  recipient: Address;
  contentRef: Hex;
  commitment: string;
  funded: boolean;
  claimed: boolean;
}

export interface RoundFacts {
  pool: Address;
  kind: Kind;
  chainId: number;
  block: number;
  token: { address: Address; symbol: string; decimals: number };
  phase: PhaseName;
  votingDeadline: number;
  totalWeight: string;
  spent: string;
  claimedTotal: string;
  projects: ProjectView[];
  fundedOrder: number[];
  proposalCount: number;
  voterCount: number;
  sealed: { total: string; count: number; commitmentsAvailable: boolean };
  closing: { closed: boolean; cursor: number } | null;
  proving: { accepted: number; total: number | null } | null;
  finality: Finality | null;
  graces: { abandonFrom: number | null; provisionalFrom: number | null };
}

export interface ReadOptions {
  rosterPage: number;
  chainId: number;
}

type Abi = typeof plainAbi | typeof sealedAbi | typeof noirAbi;

/** A loosely typed reader: the per-variant ABI is chosen at runtime, so the
 * function names cannot be checked statically. Results are cast at the use. */
export function reader(client: PublicClient, pool: Address, abi: Abi, blockNumber: bigint) {
  return (functionName: string, args: readonly unknown[] = []): Promise<unknown> =>
    client.readContract({ address: pool, abi, functionName, args, blockNumber } as any);
}

export function abiFor(kind: Kind): Abi {
  return kind === "plain" ? plainAbi : kind === "noir" ? noirAbi : sealedAbi;
}

async function chunked<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

const PHASES: Record<Kind, PhaseName[]> = {
  plain: ["setup", "open", "tally", "done"],
  cre: ["setup", "open", "closing", "tally", "done"],
  zisk: ["setup", "open", "closing", "tally", "done"],
  noir: ["setup", "open", "closing", "tally", "done"],
};
const FINALITIES: (Finality | null)[] = [null, "proven", "attested", "abandoned"];

interface Roster {
  entries: RosterEntry[];
  addresses: Set<string>;
  sealedCount: number;
}

export async function readRoster(
  call: ReturnType<typeof reader>,
  kind: Kind,
  voterCount: number,
  page: number,
): Promise<Roster> {
  const entries: RosterEntry[] = [];
  const addresses = new Set<string>();
  let sealedCount = 0;
  if (kind === "plain") {
    const who = await chunked(
      Array.from({ length: voterCount }, (_, i) => i),
      20,
      (i) => call("voterAt", [BigInt(i)]) as Promise<Address>,
    );
    const rows = await chunked(who, 20, async (a) => {
      const [ballot, weight] = await Promise.all([call("ballotOf", [a]), call("weightOf", [a])]);
      return { a, ballot: ballot as Hex, weight: weight as bigint };
    });
    for (const { a, ballot, weight } of rows) {
      addresses.add(a.toLowerCase());
      entries.push({ weight, ballot });
    }
    return { entries, addresses, sealedCount };
  }
  for (let start = 0; start < voterCount; start += page) {
    const count = Math.min(page, voterCount - start);
    const res = await call("votersFrom", [BigInt(start), BigInt(count)]) as unknown[];
    const who = res[0] as Address[];
    const direct = res[1] as bigint[];
    if (kind === "noir") {
      const cts = res[4] as [bigint, bigint, bigint][];
      for (let i = 0; i < who.length; i++) {
        addresses.add(who[i].toLowerCase());
        if (cts[i][0] !== 0n) sealedCount++;
      }
      continue;
    }
    const ballots = res[3] as Hex[];
    const cts = res[4] as Hex[];
    for (let i = 0; i < who.length; i++) {
      addresses.add(who[i].toLowerCase());
      entries.push({ weight: direct[i], ballot: ballots[i] });
      if (cts[i] !== "0x") sealedCount++;
    }
  }
  return { entries, addresses, sealedCount };
}

export async function readRound(
  client: PublicClient,
  pool: Address,
  opts: ReadOptions,
): Promise<{ facts: RoundFacts; roster: Set<string> }> {
  const blockNumber = await client.getBlockNumber();
  const kind = await detectKind(client, pool, blockNumber);
  const call = reader(client, pool, abiFor(kind), blockNumber);

  const [token, votingDeadline, totalWeight, spent, claimedTotal, projectCount, fundedRaw, proposalCount, voterCount, phaseRaw] =
    await Promise.all([
      call("token"),
      call("votingDeadline"),
      call("totalWeight"),
      call("spent"),
      call("claimedTotal"),
      call("projectCount"),
      call("fundedProjects"),
      call("proposalCount"),
      call("voterCount"),
      call("phase"),
    ]) as [Address, bigint, bigint, bigint, bigint, bigint, bigint[], bigint, bigint, number];

  const tokenAddress = getAddress(token);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals", blockNumber }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol", blockNumber })
      .catch(() => "tokens"),
  ]);

  const m = Number(projectCount);
  const n = Number(voterCount);
  const roster = await readRoster(call, kind, n, opts.rosterPage);
  const commitments = kind === "noir"
    ? Array.from({ length: m }, () => 0n)
    : commitmentsFrom(roster.entries, m);

  const projects = await chunked(Array.from({ length: m }, (_, id) => id), 10, async (id) => {
    const [cost, recipient, contentRef, funded, claimed] = await Promise.all([
      call("cost", [BigInt(id)]),
      call("recipientOf", [BigInt(id)]),
      call("contentRefOf", [BigInt(id)]),
      call("funded", [BigInt(id)]),
      call("claimed", [BigInt(id)]),
    ]) as [bigint, Address, Hex, boolean, boolean];
    return {
      id,
      cost: cost.toString(),
      recipient: getAddress(recipient),
      contentRef,
      commitment: commitments[id].toString(),
      funded,
      claimed,
    } satisfies ProjectView;
  });

  const phase = PHASES[kind][Number(phaseRaw)] ?? "setup";
  const deadline = Number(votingDeadline);
  let finality: Finality | null = null;
  let closing: RoundFacts["closing"] = null;
  let proving: RoundFacts["proving"] = null;
  const graces: RoundFacts["graces"] = { abandonFrom: null, provisionalFrom: null };
  let sealedTotal = 0n;
  let sealedCount = roster.sealedCount;

  if (kind === "plain") {
    const [tallyDone, rankLevel] = await Promise.all([call("tallyDone"), call("rankLevel")]) as [boolean, bigint];
    finality = tallyDone ? "counted" : null;
    if (phase === "tally") proving = { accepted: Number(rankLevel), total: null };
  } else {
    const [finalityRaw, closed, closeCursor, abandonGrace, totalSeatWeight] = await Promise.all([
      call("finality"),
      call("closed"),
      call("closeCursor"),
      call("abandonGrace"),
      call("totalSeatWeight"),
    ]) as [number, boolean, bigint, bigint, bigint];
    finality = FINALITIES[finalityRaw] ?? null;
    closing = { closed, cursor: Number(closeCursor) };
    sealedTotal = totalSeatWeight;
    if (phase === "closing" || phase === "tally") graces.abandonFrom = deadline + Number(abandonGrace);
    if (kind === "noir") {
      const [count, reported, reportedAt, proofGrace, ingestCursor, numBatches] = await Promise.all([
        call("sealedCount"),
        call("resultReported"),
        call("reportedAt"),
        call("proofGrace"),
        call("ingestCursor"),
        call("numBatches"),
      ]) as [bigint, boolean, bigint, bigint, bigint, bigint];
      sealedCount = Number(count);
      if (phase === "tally") proving = { accepted: Number(ingestCursor), total: Number(numBatches) };
      if (reported && phase !== "done") graces.provisionalFrom = Number(reportedAt) + Number(proofGrace);
    }
  }

  const facts: RoundFacts = {
    pool: getAddress(pool),
    kind,
    chainId: opts.chainId,
    block: Number(blockNumber),
    token: { address: tokenAddress, symbol: symbol as string, decimals: Number(decimals) },
    phase,
    votingDeadline: deadline,
    totalWeight: totalWeight.toString(),
    spent: spent.toString(),
    claimedTotal: claimedTotal.toString(),
    projects,
    fundedOrder: fundedRaw.map((x) => Number(x)),
    proposalCount: Number(proposalCount),
    voterCount: n,
    sealed: { total: sealedTotal.toString(), count: sealedCount, commitmentsAvailable: kind !== "noir" },
    closing,
    proving,
    finality,
    graces,
  };
  return { facts, roster: roster.addresses };
}
```

- [ ] **Step 4: Run the tests, lint, check**

Run: `deno test -A api/tests/read.test.ts && deno lint && deno check api/chain/read.ts`
Expected: 5 pass, clean. If `deno check` rejects the `as any` in `reader`, keep it and confirm `no-explicit-any` is excluded in `deno.json` (Task 1).

- [ ] **Step 5: Commit**

```bash
git add api/chain/read.ts api/tests/read.test.ts
git commit -m "Read a pool's round facts per variant, pinned to one block"
```

---

### Task 6: The snapshot cache and `GET /api/round`

**Files:**
- Create: `web/api/services/snapshot.ts`, `web/api/routes/round.ts`, `web/api/tests/fixtures.ts`
- Modify: `web/api/deps.ts`, `web/api/app.ts`, `web/api/bootstrap.ts`
- Test: `web/api/tests/snapshot.test.ts`, `web/api/tests/round.test.ts`

**Interfaces:**
- Consumes: `readRound`, `stageOf`, `RoundFacts`.
- Produces: `RoundSnapshot = RoundFacts & { at: number; stage: Stage }`; `Snapshots = { get(pool: Address, minBlock?: number): Promise<{ snapshot: RoundSnapshot; roster: Set<string> }> }`; `createSnapshots({ read, ttlMs, now })`; `poolFrom(param, config): Address`; `isRpcDown(err): boolean`; `Deps` gains `client: PublicClient` and `snapshots: Snapshots`; fixture `openSnapshot: RoundSnapshot`.

- [ ] **Step 1: Write the fixture `web/api/tests/fixtures.ts`**

```ts
import type { RoundSnapshot } from "../services/snapshot.ts";
import { A, B, POOL, TOKEN } from "./fake-pool.ts";

export const openSnapshot: RoundSnapshot = {
  pool: POOL,
  kind: "zisk",
  chainId: 31337,
  block: 123,
  at: 1_700_000_000,
  token: { address: TOKEN, symbol: "USDC", decimals: 6 },
  phase: "open",
  votingDeadline: 1_700_003_600,
  totalWeight: "1300",
  spent: "0",
  claimedTotal: "0",
  projects: [
    { id: 0, cost: "4000", recipient: B, contentRef: "0x" + "ab".repeat(32) as `0x${string}`, commitment: "1000", funded: false, claimed: false },
    { id: 1, cost: "2500", recipient: A, contentRef: ("0x" + "00".repeat(32)) as `0x${string}`, commitment: "300", funded: false, claimed: false },
  ],
  fundedOrder: [],
  proposalCount: 3,
  voterCount: 2,
  sealed: { total: "500", count: 1, commitmentsAvailable: true },
  closing: { closed: false, cursor: 0 },
  proving: null,
  finality: null,
  graces: { abandonFrom: null, provisionalFrom: null },
  stage: {
    current: "open",
    steps: [
      { key: "proposals", state: "done", label: "Proposals" },
      { key: "setup", state: "done", label: "Setup" },
      { key: "open", state: "current", label: "Open" },
      { key: "closing", state: "next", label: "Closing" },
      { key: "proving", state: "next", label: "Proving" },
      { key: "proven", state: "next", label: "Proven" },
      { key: "paid", state: "next", label: "Paid" },
    ],
  },
};
```

- [ ] **Step 2: Write the failing snapshot cache tests `web/api/tests/snapshot.test.ts`**

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { createSnapshots } from "../services/snapshot.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

const facts = (block: number) => {
  const { at: _at, stage: _stage, ...rest } = openSnapshot;
  return { facts: { ...rest, block }, roster: new Set<string>() };
};

Deno.test("snapshots: reads once within the TTL and stamps at and stage", async () => {
  let reads = 0;
  let t = 1_000;
  const s = createSnapshots({ read: async () => { reads++; return facts(10); }, ttlMs: 15_000, now: () => t });
  const first = await s.get(POOL);
  assertEquals(first.snapshot.at, 1_000);
  assertEquals(first.snapshot.stage.current, "open");
  t = 1_010;
  await s.get(POOL);
  assertEquals(reads, 1);
  t = 1_016;
  await s.get(POOL);
  assertEquals(reads, 2);
});

Deno.test("snapshots: concurrent callers share one read", async () => {
  let reads = 0;
  const s = createSnapshots({
    read: async () => { reads++; await new Promise((r) => setTimeout(r, 5)); return facts(10); },
    ttlMs: 15_000,
    now: () => 1_000,
  });
  await Promise.all([s.get(POOL), s.get(POOL), s.get(POOL)]);
  assertEquals(reads, 1);
});

Deno.test("snapshots: minBlock forces a re-read when the cache is older, at most twice", async () => {
  const blocks = [10, 10, 12];
  let reads = 0;
  const s = createSnapshots({ read: async () => facts(blocks[reads++]), ttlMs: 15_000, now: () => 1_000 });
  await s.get(POOL);
  const r = await s.get(POOL, 12);
  assertEquals(r.snapshot.block, 12);
  assertEquals(reads, 3);
});

Deno.test("snapshots: a failed read rejects and keeps the last good value for the next call", async () => {
  let fail = false;
  let t = 1_000;
  const s = createSnapshots({ read: async () => { if (fail) throw new Error("rpc"); return facts(10); }, ttlMs: 15_000, now: () => t });
  await s.get(POOL);
  fail = true;
  t = 1_020;
  await assertRejects(() => s.get(POOL), Error, "rpc");
  fail = false;
  const again = await s.get(POOL);
  assertEquals(again.snapshot.block, 10);
});
```

- [ ] **Step 3: Run to see them fail**

Run: `deno test -A api/tests/snapshot.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `web/api/services/snapshot.ts`**

```ts
/** Per-pool cache of the round snapshot: TTL, single-flight, and a minimum
 * block for the refetch after a user's own transaction. Spec decisions 6, 7. */
import type { Address } from "viem";
import type { RoundFacts } from "../chain/read.ts";
import { type Stage, stageOf } from "./stage.ts";

export type RoundSnapshot = RoundFacts & { at: number; stage: Stage };
export interface Snapshot {
  snapshot: RoundSnapshot;
  roster: Set<string>;
}
export interface Snapshots {
  get(pool: Address, minBlock?: number): Promise<Snapshot>;
}

interface Entry {
  at: number;
  value: Snapshot | null;
  pending: Promise<Snapshot> | null;
}

export function createSnapshots(opts: {
  read: (pool: Address) => Promise<{ facts: RoundFacts; roster: Set<string> }>;
  ttlMs: number;
  now: () => number;
}): Snapshots {
  const entries = new Map<string, Entry>();

  function fresh(e: Entry | undefined, minBlock?: number): Snapshot | null {
    if (!e?.value) return null;
    if ((opts.now() - e.at) * 1000 >= opts.ttlMs) return null;
    if (minBlock !== undefined && e.value.snapshot.block < minBlock) return null;
    return e.value;
  }

  function start(key: string, pool: Address): Promise<Snapshot> {
    const e = entries.get(key) ?? { at: 0, value: null, pending: null };
    const pending = opts.read(pool).then(({ facts, roster }) => {
      const at = opts.now();
      const value = { snapshot: { ...facts, at, stage: stageOf(facts, at) }, roster };
      entries.set(key, { at, value, pending: null });
      return value;
    }, (err) => {
      entries.set(key, { at: e.at, value: e.value, pending: null });
      throw err;
    });
    entries.set(key, { ...e, pending });
    return pending;
  }

  return {
    async get(pool, minBlock) {
      const key = pool.toLowerCase();
      const cached = fresh(entries.get(key), minBlock);
      if (cached) return cached;
      const e = entries.get(key);
      let value = await (e?.pending ?? start(key, pool));
      if (minBlock !== undefined && value.snapshot.block < minBlock) {
        value = await (entries.get(key)?.pending ?? start(key, pool));
      }
      return value;
    },
  };
}
```

- [ ] **Step 5: Run the cache tests**

Run: `deno test -A api/tests/snapshot.test.ts`
Expected: 4 pass.

- [ ] **Step 6: Write the failing route tests `web/api/tests/round.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { HttpRequestError } from "viem";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

function depsWith(overrides: Partial<Deps> = {}, env: Record<string, string> = { POOL_ADDRESS: POOL }): Deps {
  return {
    config: loadConfig(env),
    client: {} as Deps["client"],
    snapshots: { get: async () => ({ snapshot: openSnapshot, roster: new Set() }) },
    now: () => 0,
    log: () => {},
    ...overrides,
  };
}

Deno.test("GET /api/round returns the configured pool's snapshot", async () => {
  const res = await createApp(depsWith()).fetch(new Request("http://x/api/round"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), openSnapshot);
});

Deno.test("GET /api/round?pool= overrides and ?after= is passed as the minimum block", async () => {
  const seen: unknown[] = [];
  const deps = depsWith({
    snapshots: { get: async (pool, minBlock) => { seen.push([pool, minBlock]); return { snapshot: openSnapshot, roster: new Set() }; } },
  }, {});
  const res = await createApp(deps).fetch(new Request(`http://x/api/round?pool=${POOL.toLowerCase()}&after=130`));
  assertEquals(res.status, 200);
  assertEquals(seen, [[POOL, 130]]);
});

Deno.test("GET /api/round rejects a bad pool, a bad after, and no pool at all", async () => {
  const app = createApp(depsWith({}, {}));
  assertEquals((await app.fetch(new Request("http://x/api/round?pool=0x12"))).status, 400);
  assertEquals((await app.fetch(new Request("http://x/api/round"))).status, 400);
  const bad = await createApp(depsWith()).fetch(new Request("http://x/api/round?after=soon"));
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "after must be a block number" });
});

Deno.test("GET /api/round answers 502 when the RPC is down", async () => {
  const deps = depsWith({
    snapshots: { get: async () => { throw new HttpRequestError({ url: "http://rpc", details: "connection refused" }); } },
  });
  const res = await createApp(deps).fetch(new Request("http://x/api/round"));
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "rpc unavailable" });
});
```

- [ ] **Step 7: Run to see them fail**

Run: `deno test -A api/tests/round.test.ts`
Expected: FAIL (type errors on `Deps`, missing route).

- [ ] **Step 8: Extend `deps.ts`, add `routes/round.ts`, wire `app.ts` and `bootstrap.ts`**

`web/api/deps.ts`:

```ts
import type { PublicClient } from "viem";
import type { Config } from "./config.ts";
import type { Snapshots } from "./services/snapshot.ts";

/** Everything a route needs, built once in bootstrap.ts and faked in tests. */
export interface Deps {
  config: Config;
  client: PublicClient;
  snapshots: Snapshots;
  now: () => number;
  log: (msg: string) => void;
}
```

`web/api/routes/round.ts`:

```ts
import { Hono } from "hono";
import { type Address, getAddress, isAddress } from "viem";
import { HttpError } from "../app.ts";
import type { Config } from "../config.ts";
import type { Deps } from "../deps.ts";

/** ?pool= overrides the configured pool so the SPA's round picker keeps working. */
export function poolFrom(param: string | undefined, config: Config): Address {
  if (param !== undefined) {
    if (!isAddress(param)) throw new HttpError(400, "pool must be an address");
    return getAddress(param);
  }
  if (!config.poolAddress) throw new HttpError(400, "no pool configured; pass ?pool=");
  return config.poolAddress;
}

export function minBlockFrom(param: string | undefined): number | undefined {
  if (param === undefined) return undefined;
  const n = Number(param);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, "after must be a block number");
  return n;
}

export function roundRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/", async (c) => {
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot } = await deps.snapshots.get(pool, minBlockFrom(c.req.query("after")));
    return c.json(snapshot);
  });
  return r;
}
```

In `web/api/app.ts` add the import and the RPC-down mapping. Replace the file with:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HttpRequestError, TimeoutError } from "viem";
import type { Deps } from "./deps.ts";
import { healthRoutes } from "./routes/health.ts";
import { roundRoutes } from "./routes/round.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** viem wraps transport failures in ContractFunctionExecutionError; walk the causes. */
export function isRpcDown(err: unknown): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e instanceof HttpRequestError || e instanceof TimeoutError) return true;
  }
  return false;
}

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (isRpcDown(err)) {
      deps.log(`rpc unavailable: ${err.message}`);
      return c.json({ error: "rpc unavailable" }, 502);
    }
    deps.log(`unhandled: ${err.stack ?? err}`);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.use(
    "*",
    cors({ origin: deps.config.webOrigins, allowMethods: ["GET", "OPTIONS"], maxAge: 600 }),
  );
  app.route("/healthz", healthRoutes(deps));
  app.route("/api/round", roundRoutes(deps));
  return app;
}
```

`web/api/bootstrap.ts`:

```ts
/** Builds the API from the environment. Shared by main.ts (API alone) and
 * ../server.ts (API next to the built SPA). */
import { createApp } from "./app.ts";
import { createClient } from "./chain/client.ts";
import { readRound } from "./chain/read.ts";
import { loadConfig } from "./config.ts";
import type { Deps } from "./deps.ts";
import { createSnapshots } from "./services/snapshot.ts";

export function createServer(env: Record<string, string | undefined> = Deno.env.toObject()) {
  const config = loadConfig(env);
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
  const now = () => Math.floor(Date.now() / 1000);
  const client = createClient({ rpcUrls: config.rpcUrls, chainId: config.chainId });
  const snapshots = createSnapshots({
    read: (pool) => readRound(client, pool, { rosterPage: config.rosterPage, chainId: config.chainId }),
    ttlMs: config.snapshotTtlMs,
    now,
  });
  const deps: Deps = { config, client, snapshots, now, log };
  return { app: createApp(deps), config, deps };
}
```

Update `web/api/tests/health.test.ts` so its `deps` object has the two new fields: `client: {} as Deps["client"]`, `snapshots: { get: async () => { throw new Error("unused"); } }` (import `Deps` from `../deps.ts`).

- [ ] **Step 9: Run all API tests, lint, check**

Run: `deno test -A api/ && deno lint && deno check api/main.ts`
Expected: all pass (7 + 4 + 5 + 9 + 5 + 4 + 4 = 38), clean.

- [ ] **Step 10: Commit**

```bash
git add api
git commit -m "Serve GET /api/round from a per-pool snapshot cache with single-flight and minimum block"
```

---

### Task 7: Proposal content from Swarm and `GET /api/project/:id`

**Files:**
- Create: `web/api/services/content.ts`, `web/api/routes/project.ts`
- Modify: `web/api/deps.ts`, `web/api/app.ts`, `web/api/bootstrap.ts`, `web/api/tests/health.test.ts`, `web/api/tests/round.test.ts` (add `content` to the fake deps)
- Test: `web/api/tests/content.test.ts`, `web/api/tests/project.test.ts`

**Interfaces:**
- Consumes: `parseContent(data: Uint8Array): ProposalContent` and `ProposalContent` from `web/app/lib/swarm.ts`. If `deno check` cannot import that module (it pulls the Swarm ID SDK at runtime), move `parseContent`, `ProposalContent`, `Attachment`, `publicReference`, and `PREVIEW_BYTES` into a new `web/app/lib/proposal-content.ts` with no SDK import, re-export them from `swarm.ts`, and import from the new file; the vitest suite must still pass.
- Produces: `Content = { get(ref: Hex): Promise<Resolved> }`, `Resolved = { status: "ok" | "none" | "unavailable"; content: ProposalContent | null; reason: string | null }`; `createContent({ beeUrl, fetch, timeoutMs })`; `Deps` gains `content: Content`; response shape of spec 3.2 `ProjectResponse`.

- [ ] **Step 1: Write the failing content tests `web/api/tests/content.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { createContent } from "../services/content.ts";

const REF = ("0x" + "ab".repeat(32)) as `0x${string}`;
const ZERO = ("0x" + "00".repeat(32)) as `0x${string}`;
const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, title: "Audit", body: "Hello", attachments: [] }));

const fetchWith = (handler: (url: string) => Response | Promise<Response>) => {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { f, urls };
};

Deno.test("content: zero reference is none", async () => {
  const c = createContent({ beeUrl: "http://bee", fetch: fetchWith(() => new Response("x")).f, timeoutMs: 100 });
  assertEquals(await c.get(ZERO), { status: "none", content: null, reason: null });
});

Deno.test("content: no gateway configured is unavailable with a reason", async () => {
  const c = createContent({ beeUrl: null, fetch: fetchWith(() => new Response("x")).f, timeoutMs: 100 });
  assertEquals(await c.get(REF), { status: "unavailable", content: null, reason: "no gateway configured" });
});

Deno.test("content: fetches /bytes/<ref>, parses the manifest, and caches by reference", async () => {
  const { f, urls } = fetchWith(() => new Response(manifest));
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100 });
  const first = await c.get(REF);
  assertEquals(first.status, "ok");
  assertEquals(first.content?.title, "Audit");
  await c.get(REF);
  assertEquals(urls, [`http://bee/bytes/${"ab".repeat(32)}`]);
});

Deno.test("content: a 404, a timeout, and unparseable bytes are unavailable and not cached", async () => {
  const { f, urls } = fetchWith((url) => {
    if (url.endsWith("cc".repeat(32))) return new Response("nope", { status: 404 });
    if (url.endsWith("dd".repeat(32))) return Promise.reject(new DOMException("timed out", "TimeoutError"));
    return new Response(new TextEncoder().encode("not json"));
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100 });
  const gone = await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(gone.status, "unavailable");
  assertEquals(gone.reason, "gateway answered 404");
  const slow = await c.get(("0x" + "dd".repeat(32)) as `0x${string}`);
  assertEquals(slow.status, "unavailable");
  const junk = await c.get(("0x" + "ee".repeat(32)) as `0x${string}`);
  assertEquals(junk.status, "unavailable");
  await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(urls.length, 4);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test -A api/tests/content.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/api/services/content.ts`**

```ts
/** Proposal content by Swarm reference: fetched from a Bee node's /bytes
 * endpoint, parsed with the browser's parser, cached forever because a
 * reference is the content's hash. Spec decision 8. */
import type { Hex } from "viem";
import { parseContent, type ProposalContent } from "../../app/lib/swarm.ts";

export interface Resolved {
  status: "ok" | "none" | "unavailable";
  content: ProposalContent | null;
  reason: string | null;
}
export interface Content {
  get(ref: Hex): Promise<Resolved>;
}

const ZERO = "0x" + "00".repeat(32);

export function createContent(
  opts: { beeUrl: string | null; fetch: typeof fetch; timeoutMs: number },
): Content {
  const cache = new Map<string, ProposalContent>();
  const unavailable = (reason: string): Resolved => ({ status: "unavailable", content: null, reason });
  return {
    async get(ref) {
      if (ref.toLowerCase() === ZERO) return { status: "none", content: null, reason: null };
      if (!opts.beeUrl) return unavailable("no gateway configured");
      const key = ref.toLowerCase();
      const hit = cache.get(key);
      if (hit) return { status: "ok", content: hit, reason: null };
      let res: Response;
      try {
        res = await opts.fetch(`${opts.beeUrl}/bytes/${key.slice(2)}`, {
          headers: { Accept: "application/octet-stream" },
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (e) {
        return unavailable(`gateway unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) return unavailable(`gateway answered ${res.status}`);
      try {
        const content = parseContent(new Uint8Array(await res.arrayBuffer()));
        cache.set(key, content);
        return { status: "ok", content, reason: null };
      } catch (e) {
        return unavailable(`content unreadable: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run the content tests and check the import**

Run: `deno test -A api/tests/content.test.ts && deno check api/services/content.ts`
Expected: 4 pass. If `deno check` fails inside `app/lib/swarm.ts`, do the extraction described under Interfaces, run `deno task test` (vitest) to confirm 20 pass, and re-run this step.

- [ ] **Step 5: Write the failing project route tests `web/api/tests/project.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

const deps: Deps = {
  config: loadConfig({ POOL_ADDRESS: POOL }),
  client: {} as Deps["client"],
  snapshots: { get: async () => ({ snapshot: openSnapshot, roster: new Set() }) },
  content: {
    get: async (ref) =>
      ref.startsWith("0xabab")
        ? { status: "ok", content: { version: 1, title: "Audit", body: "Hello", attachments: [] } as any, reason: null }
        : { status: "none", content: null, reason: null },
  },
  now: () => 0,
  log: () => {},
};

Deno.test("GET /api/project/0 returns the project, its round slice, and the pitch", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/api/project/0"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.project, openSnapshot.projects[0]);
  assertEquals(body.round, {
    pool: openSnapshot.pool, kind: "zisk", block: 123, at: 1_700_000_000,
    token: openSnapshot.token, phase: "open", finality: null, stage: openSnapshot.stage,
  });
  assertEquals(body.contentStatus, "ok");
  assertEquals(body.content.title, "Audit");
  assertEquals(body.reason, null);
});

Deno.test("GET /api/project/1 with a zero reference has no pitch", async () => {
  const body = await (await createApp(deps).fetch(new Request("http://x/api/project/1"))).json();
  assertEquals(body.contentStatus, "none");
  assertEquals(body.content, null);
});

Deno.test("GET /api/project rejects bad ids and unknown projects", async () => {
  const app = createApp(deps);
  assertEquals((await app.fetch(new Request("http://x/api/project/x"))).status, 400);
  assertEquals((await app.fetch(new Request("http://x/api/project/-1"))).status, 400);
  const missing = await app.fetch(new Request("http://x/api/project/7"));
  assertEquals(missing.status, 404);
  assertEquals(await missing.json(), { error: "unknown project" });
});
```

- [ ] **Step 6: Run to see them fail**

Run: `deno test -A api/tests/project.test.ts`
Expected: FAIL (`content` not in `Deps`, route missing).

- [ ] **Step 7: Add `content` to `Deps`, write the route, wire app and bootstrap, update the other fake deps**

`web/api/deps.ts`: add `import type { Content } from "./services/content.ts";` and the field `content: Content;` after `snapshots`.

`web/api/routes/project.ts`:

```ts
import { Hono } from "hono";
import { HttpError } from "../app.ts";
import type { Deps } from "../deps.ts";
import { poolFrom } from "./round.ts";

export function projectRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/:id", async (c) => {
    const raw = c.req.param("id");
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id)) throw new HttpError(400, "id must be a non-negative integer");
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot } = await deps.snapshots.get(pool);
    const project = snapshot.projects[id];
    if (!project) throw new HttpError(404, "unknown project");
    const resolved = await deps.content.get(project.contentRef);
    const { pool: p, kind, block, at, token, phase, finality, stage } = snapshot;
    return c.json({
      project,
      round: { pool: p, kind, block, at, token, phase, finality, stage },
      contentStatus: resolved.status,
      content: resolved.content,
      reason: resolved.reason,
    });
  });
  return r;
}
```

In `web/api/app.ts` add `import { projectRoutes } from "./routes/project.ts";` and, after the round route, `app.route("/api/project", projectRoutes(deps));`.

In `web/api/bootstrap.ts` add `import { createContent } from "./services/content.ts";`, build
`const content = createContent({ beeUrl: config.beeUrl, fetch, timeoutMs: config.contentTimeoutMs });`
and include `content` in `deps`.

In `web/api/tests/health.test.ts` and `web/api/tests/round.test.ts`, add to the fake deps:
`content: { get: async () => ({ status: "none", content: null, reason: null }) }`.

- [ ] **Step 8: Run everything**

Run: `deno test -A api/ && deno lint && deno check api/main.ts`
Expected: 45 pass, clean.

- [ ] **Step 9: Commit**

```bash
git add api app/lib
git commit -m "Serve GET /api/project/:id with the pitch resolved from Swarm by reference"
```

---

### Task 8: `GET /api/voter/:address`

**Files:**
- Create: `web/api/routes/voter.ts`
- Modify: `web/api/chain/read.ts` (add `readVoter`), `web/api/app.ts`
- Test: `web/api/tests/voter.test.ts`

**Interfaces:**
- Consumes: `reader`, `abiFor`, the ABIs, `Snapshots`.
- Produces: `VoterFacts = { weight: { direct: string; seats: string; total: string }; ballot: { public: { ranks: number[] } | null; sealed: boolean } }`; `readVoter(client, pool, kind, address, blockNumber): Promise<VoterFacts>`; response of spec 3.2 `VoterResponse`.

- [ ] **Step 1: Write the failing tests `web/api/tests/voter.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { readVoter } from "../chain/read.ts";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { A, B, fakeTransport, POOL } from "./fake-pool.ts";
import { openSnapshot } from "./fixtures.ts";

const same = (x: unknown, y: string) => (x as string).toLowerCase() === y.toLowerCase();

Deno.test("readVoter: plain pool", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: plainAbi,
    handlers: {
      weightOf: ([a]) => same(a, A) ? 1_000n : 0n,
      ballotOf: ([a]) => same(a, A) ? "0x0102" : "0x",
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "plain", A, 100n), {
    weight: { direct: "1000", seats: "0", total: "1000" },
    ballot: { public: { ranks: [1, 2] }, sealed: false },
  });
  assertEquals(await readVoter(client, POOL, "plain", B, 100n), {
    weight: { direct: "0", seats: "0", total: "0" },
    ballot: { public: null, sealed: false },
  });
});

Deno.test("readVoter: zisk pool with a sealed ballot", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: sealedAbi,
    handlers: {
      directWeight: () => 0n,
      seatWeight: () => 500n,
      directBallotOf: () => "0x",
      sealedOf: () => "0x" + "cd".repeat(35),
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "zisk", B, 100n), {
    weight: { direct: "0", seats: "500", total: "500" },
    ballot: { public: null, sealed: true },
  });
});

Deno.test("readVoter: noir pool reports presence without decoding the packed ballot", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: noirAbi,
    handlers: {
      directWeight: () => 7n,
      seatWeight: () => 0n,
      hasDirect: () => true,
      directBallotOf: () => 5n,
      sealedOf: () => [0n, 0n, 0n],
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "noir", A, 100n), {
    weight: { direct: "7", seats: "0", total: "7" },
    ballot: { public: { ranks: [] }, sealed: false },
  });
});

Deno.test("GET /api/voter/:address joins the snapshot's roster and validates the address", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: sealedAbi,
    handlers: { directWeight: () => 1_000n, seatWeight: () => 0n, directBallotOf: () => "0x0102", sealedOf: () => "0x" },
  }]);
  const deps: Deps = {
    config: loadConfig({ POOL_ADDRESS: POOL }),
    client: createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport }),
    snapshots: { get: async () => ({ snapshot: openSnapshot, roster: new Set([A.toLowerCase()]) }) },
    content: { get: async () => ({ status: "none", content: null, reason: null }) },
    now: () => 0,
    log: () => {},
  };
  const app = createApp(deps);
  const res = await app.fetch(new Request(`http://x/api/voter/${A.toLowerCase()}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    address: A,
    block: 123,
    weight: { direct: "1000", seats: "0", total: "1000" },
    ballot: { public: { ranks: [1, 2] }, sealed: false },
    inRoster: true,
  });
  const other = await (await app.fetch(new Request(`http://x/api/voter/${B}`))).json();
  assertEquals(other.inRoster, false);
  assertEquals((await app.fetch(new Request("http://x/api/voter/0x12"))).status, 400);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test -A api/tests/voter.test.ts`
Expected: FAIL, `readVoter` not exported, route missing.

- [ ] **Step 3: Add `readVoter` to `web/api/chain/read.ts`**

Append:

```ts
export interface VoterFacts {
  weight: { direct: string; seats: string; total: string };
  ballot: { public: { ranks: number[] } | null; sealed: boolean };
}

export async function readVoter(
  client: PublicClient,
  pool: Address,
  kind: Kind,
  address: Address,
  blockNumber: bigint,
): Promise<VoterFacts> {
  const call = reader(client, pool, abiFor(kind), blockNumber);
  if (kind === "plain") {
    const [weight, ballot] = await Promise.all([call("weightOf", [address]), call("ballotOf", [address])]) as [bigint, Hex];
    return {
      weight: { direct: weight.toString(), seats: "0", total: weight.toString() },
      ballot: { public: ballot === "0x" ? null : { ranks: Array.from(hexToBytes(ballot)) }, sealed: false },
    };
  }
  const [direct, seats] = await Promise.all([call("directWeight", [address]), call("seatWeight", [address])]) as [bigint, bigint];
  const weight = { direct: direct.toString(), seats: seats.toString(), total: (direct + seats).toString() };
  if (kind === "noir") {
    const [hasDirect, sealed] = await Promise.all([call("hasDirect", [address]), call("sealedOf", [address])]) as [boolean, [bigint, bigint, bigint]];
    return { weight, ballot: { public: hasDirect ? { ranks: [] } : null, sealed: sealed[0] !== 0n } };
  }
  const [ballot, ct] = await Promise.all([call("directBallotOf", [address]), call("sealedOf", [address])]) as [Hex, Hex];
  return {
    weight,
    ballot: { public: ballot === "0x" ? null : { ranks: Array.from(hexToBytes(ballot)) }, sealed: ct !== "0x" },
  };
}
```

and add `hexToBytes` to the viem import at the top of the file.

- [ ] **Step 4: Write `web/api/routes/voter.ts` and wire it**

```ts
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { HttpError } from "../app.ts";
import { readVoter } from "../chain/read.ts";
import type { Deps } from "../deps.ts";
import { poolFrom } from "./round.ts";

export function voterRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/:address", async (c) => {
    const raw = c.req.param("address");
    if (!isAddress(raw)) throw new HttpError(400, "address is not an address");
    const address = getAddress(raw);
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot, roster } = await deps.snapshots.get(pool);
    const facts = await readVoter(deps.client, pool, snapshot.kind, address, BigInt(snapshot.block));
    return c.json({ address, block: snapshot.block, ...facts, inRoster: roster.has(address.toLowerCase()) });
  });
  return r;
}
```

In `web/api/app.ts` add `import { voterRoutes } from "./routes/voter.ts";` and `app.route("/api/voter", voterRoutes(deps));` after the project route.

- [ ] **Step 5: Run everything**

Run: `deno test -A api/ && deno lint && deno check api/main.ts`
Expected: 49 pass, clean.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "Serve GET /api/voter/:address with weight, ballot presence, and roster membership"
```

---

### Task 9: The site server, environment, docs, and the Anvil integration test

**Files:**
- Create: `web/api/static.ts`, `web/server.ts`, `web/api/tests/static.test.ts`, `web/api/tests/anvil.test.ts`
- Modify: `web/.env.example`, `web/README.md`, `web/deno.json` (check task), `README.md` (root)

**Interfaces:**
- Consumes: `createServer()` from `bootstrap.ts`, `serveDir` from `@std/http/file-server`, Foundry artifacts `out/MockERC20.sol/MockERC20.json` and `out/RankedShares.sol/RankedShares.json` (run `forge build` at the repository root first; the existing `web/test/workflow.test.tsx` uses the same files).
- Produces: `serveStatic(req, root): Promise<Response>`, `isApi(pathname): boolean`; a running server on `PORT`.

- [ ] **Step 1: Write the failing static test `web/api/tests/static.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { isApi, serveStatic } from "../static.ts";

Deno.test("isApi: only /api, /api/* and /healthz", () => {
  assertEquals(isApi("/api"), true);
  assertEquals(isApi("/api/round"), true);
  assertEquals(isApi("/healthz"), true);
  assertEquals(isApi("/apix"), false);
  assertEquals(isApi("/"), false);
});

Deno.test("serveStatic: files, immutable assets, and the SPA fallback", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/assets`);
  await Deno.writeTextFile(`${root}/index.html`, "<!doctype html><title>shell</title>");
  await Deno.writeTextFile(`${root}/assets/app-abc.js`, "1");
  const asset = await serveStatic(new Request("http://x/assets/app-abc.js"), root);
  assertEquals(asset.status, 200);
  assertEquals(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
  await asset.body?.cancel();
  const shell = await serveStatic(new Request("http://x/"), root);
  assertEquals(shell.headers.get("cache-control"), "no-cache");
  await shell.body?.cancel();
  const deep = await serveStatic(new Request("http://x/project/3"), root);
  assertEquals(deep.status, 200);
  assertEquals(await deep.text(), "<!doctype html><title>shell</title>");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `deno test -A api/tests/static.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/api/static.ts` and `web/server.ts`**

`web/api/static.ts`:

```ts
/** The built SPA from build/client with the SPA fallback, and the split
 * between API paths and page paths. Same shape as thedao-rfps/web/server.ts. */
import { serveDir } from "@std/http/file-server";

export const isApi = (pathname: string): boolean =>
  pathname === "/healthz" || pathname === "/api" || pathname.startsWith("/api/");

/** Vite names assets by content hash, so they cache for good; the HTML shell
 * must revalidate on every load or a browser keeps the previous deploy. */
function withCaching(res: Response, pathname: string): Response {
  if (res.status !== 200) return res;
  const html = res.headers.get("Content-Type")?.includes("text/html");
  const value = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : html
    ? "no-cache"
    : "public, max-age=300";
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function serveStatic(req: Request, root: string): Promise<Response> {
  const { pathname } = new URL(req.url);
  const res = await serveDir(req, { fsRoot: root, quiet: true });
  if (res.status !== 404) return withCaching(res, pathname);
  await res.body?.cancel();
  const fallback = await serveDir(new Request(new URL("/index.html", req.url), req), {
    fsRoot: root,
    quiet: true,
  });
  return withCaching(fallback, pathname);
}
```

`web/server.ts`:

```ts
/// <reference lib="deno.ns" />
/** Site server (Deno Deploy entrypoint): the API under /api and /healthz, the
 * built SPA from build/client for everything else, with the prerendered
 * shell as fallback for client-side routes such as /project/3. */
import { createServer } from "./api/bootstrap.ts";
import { isApi, serveStatic } from "./api/static.ts";

const { app, config } = createServer();
const ROOT = new URL("./build/client", import.meta.url).pathname;

Deno.serve({ port: config.port }, (req) => {
  return isApi(new URL(req.url).pathname) ? app.fetch(req) : serveStatic(req, ROOT);
});
```

In `web/deno.json` change `"check:api"` to `"deno check api/main.ts server.ts"` and add `"server.ts"` to both the `lint.include` and `fmt.include` arrays.

- [ ] **Step 4: Run the static test and check**

Run: `deno test -A api/tests/static.test.ts && deno check api/main.ts server.ts`
Expected: 2 pass, clean.

- [ ] **Step 5: Write the Anvil integration test `web/api/tests/anvil.test.ts`**

```ts
/** End to end against a real plain pool on Anvil: deploy, contribute, vote,
 * then read /api/round and /api/voter through the app. Skipped when anvil is
 * not installed or the Foundry artifacts are missing (run `forge build`). */
import { assertEquals } from "@std/assert";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "../bootstrap.ts";

const PORT = 8574;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const donor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const writeAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function addProject(uint256 cost, address recipient) returns (uint256)",
  "function openVoting()",
  "function contribute(uint256 amount)",
  "function vote(bytes ranks)",
]);

function artifact(name: string) {
  const path = new URL(`../../../out/${name}.sol/${name}.json`, import.meta.url);
  return JSON.parse(Deno.readTextFileSync(path)) as { abi: unknown[]; bytecode: { object: Hex } };
}

function available(): boolean {
  try {
    artifact("RankedShares");
    return new Deno.Command("anvil", { args: ["--version"], stdout: "null", stderr: "null" }).outputSync().success;
  } catch {
    return false;
  }
}

Deno.test({
  name: "anvil: /api/round and /api/voter reflect a real plain pool",
  ignore: !available(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const anvil = new Deno.Command("anvil", { args: ["--port", String(PORT), "--silent"], stdout: "null", stderr: "null" }).spawn();
    try {
      const pub = createPublicClient({ chain, transport: http(RPC) });
      for (let i = 0; i < 50; i++) {
        try {
          await pub.getBlockNumber();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const wallet = (account: typeof owner) => createWalletClient({ account, chain, transport: http(RPC) });
      const deploy = async (name: string, args: unknown[] = []) => {
        const a = artifact(name);
        const hash = await wallet(owner).deployContract({ abi: a.abi as any, bytecode: a.bytecode.object, args: args as any });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return receipt.contractAddress as Address;
      };
      const send = async (account: typeof owner, address: Address, functionName: string, args: unknown[]) => {
        const hash = await wallet(account).writeContract({ address, abi: writeAbi, functionName: functionName as any, args: args as any } as any);
        return pub.waitForTransactionReceipt({ hash });
      };
      const block = await pub.getBlock();
      const token = await deploy("MockERC20");
      const pool = await deploy("RankedShares", [token, owner.address, block.timestamp + 3600n]);
      const unit = 10n ** 18n;
      await send(owner, pool, "addProject", [4000n * unit, donor.address]);
      await send(owner, pool, "addProject", [2500n * unit, owner.address]);
      await send(owner, pool, "openVoting", []);
      for (const [who, amount] of [[owner, 1000n * unit], [donor, 300n * unit]] as const) {
        await send(who, token, "mint", [who.address, amount]);
        await send(who, token, "approve", [pool, amount]);
        await send(who, pool, "contribute", [amount]);
      }
      await send(owner, pool, "vote", ["0x0102"]);
      const last = await send(donor, pool, "vote", ["0x0201"]);

      const { app } = createServer({ RPC_URL: RPC, CHAIN_ID: "31337", POOL_ADDRESS: pool });
      const round = await (await app.fetch(new Request(`http://x/api/round?after=${last.blockNumber}`))).json();
      assertEquals(round.kind, "plain");
      assertEquals(round.phase, "open");
      assertEquals(round.stage.current, "open");
      assertEquals(round.token.symbol, "MCK");
      assertEquals(round.projects.map((p: { commitment: string }) => p.commitment), [(1000n * unit).toString(), (300n * unit).toString()]);
      assertEquals(round.projects[0].cost, (4000n * unit).toString());
      assertEquals(round.voterCount, 2);
      assertEquals(round.totalWeight, (1300n * unit).toString());

      const voter = await (await app.fetch(new Request(`http://x/api/voter/${owner.address}`))).json();
      assertEquals(voter.weight.total, (1000n * unit).toString());
      assertEquals(voter.ballot, { public: { ranks: [1, 2] }, sealed: false });
      assertEquals(voter.inRoster, true);

      const project = await (await app.fetch(new Request("http://x/api/project/1"))).json();
      assertEquals(project.project.commitment, (300n * unit).toString());
      assertEquals(project.contentStatus, "none");
    } finally {
      anvil.kill("SIGTERM");
      await anvil.status;
    }
  },
});
```

- [ ] **Step 6: Build the artifacts and run the integration test**

Run, from the repository root: `forge build`, then from `web/`: `deno test -A api/tests/anvil.test.ts`
Expected: 1 pass (not skipped: the output must not say "ignored"). If `MockERC20` is not at `out/MockERC20.sol/MockERC20.json`, find it with `ls ../out | grep -i mock` and fix the path in `artifact()`.

- [ ] **Step 7: Environment and docs**

Append to `web/.env.example`:

```
# ------------------------------------------------------------------ api
# The read API (deno task dev:api on its own, deno task start with the SPA).
# API variables win; the VITE_ ones above are used as fallbacks.
PORT=8000
RPC_URL=http://127.0.0.1:8545          # comma-separated for failover
CHAIN_ID=31337
POOL_ADDRESS=
WEB_ORIGIN=http://localhost:5174
# A Bee node or gateway for proposal content by reference (optional).
BEE_URL=
SNAPSHOT_TTL_MS=15000
ROSTER_PAGE=200
```

In `web/README.md`, after the "Run" section's command list, add:

```
    deno task dev:api           # the read API on http://localhost:8000
    deno task test:api          # deno test: fake pool transport, plus Anvil when installed
    deno task check:api         # type-check the API and the site server
    deno task start             # the deployed server: API under /api plus build/client
```

and a new section before "Storage and deployment":

```
## The read API

`api/` is a Deno + Hono API that reads one consistent snapshot of a pool (every
view pinned to one block) and serves it as JSON: `GET /api/round` (projects with
their public commitment, the sealed total and count, the stage bar's steps, the
outcome), `GET /api/project/:id` (a project with its pitch resolved from Swarm by
reference through `BEE_URL`), `GET /api/voter/:address` (weight, ballot presence,
roster membership), and `GET /healthz`. `?pool=0x…` overrides `POOL_ADDRESS`;
`?after=<block>` on `/api/round` forces a re-read after the caller's own transaction.
A public commitment is the direct weight of voters whose public ballot ranks the
project first; Noir pools report `commitmentsAvailable: false`. `server.ts` serves the
API and `build/client` from one port for Deno Deploy (root `web`, build `deno task
build`, entrypoint `server.ts`). Design: `docs/superpowers/specs/2026-09-12-round-pages-design.md`.
```

In the root `README.md`, in the "Proposals and Swarm ID" section's first paragraph, after the sentence ending "described in the frontend decision records.", add: "The same package holds the read API (`web/api/`, `deno task dev:api`) that the round and project pages read from; see `web/README.md`."

- [ ] **Step 8: Run the whole web verification**

Run, from `web/`: `deno test -A api/ && deno lint && deno task check:api && deno task typecheck && deno task test && deno task build`
Expected: all API tests pass including the Anvil test, lint clean, both checks clean, 20 vitest tests pass, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add api server.ts deno.json .env.example README.md ../README.md
git commit -m "Serve the API next to the built SPA, document it, and test it end to end on Anvil"
```
