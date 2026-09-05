# Sealed ballots, plan 4 of 4: TypeScript (CRE workflow, prover, audit)

> **Historical.** The Noir variant's paths and its contract name were moved and renamed
> on 2026-09-05: `SealedRankedShares` is now `NoirRankedShares`, its Solidity lives under
> `src/noir/` and `test/noir/`, its Python under `reference/noir/` and its vectors under
> `reference/vectors/noir/`. Paths below are as they were when the plan was written; see
> the README's Layout section for the current ones.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The off-chain half of the sealed-ballot design in TypeScript: one shared crypto and tally library that runs both under CRE's QuickJS and in a browser, the CRE confidential workflow that closes pools and reports the result and transcript, the coordinator's prover (CLI for CI and headless use, web page for the browser), and the `audit` command anyone can run.

**Architecture:** `cre/src/lib/` holds pure-JavaScript ports of `reference/` (Poseidon2 through `@zkpassport/poseidon2`, Grumpkin through `noble-curves`, keccak through `noble-hashes`, PB-EAR transcript mode, commitments and the circuit state) tested against the same vectors and fixtures the Python, Solidity and Noir sides use. `cre/src/main.ts` is the workflow: a cron trigger, a TEE handler that reads chain state through the DON, decrypts with the Vault secret, tallies, and writes the kind-1 report; kind-2 `close` reports from the DON. `prover/` reuses the library to rebuild the sealed state, generate witnesses with `noir_js`, prove with `bb.js` (`verifierTarget: 'evm'`) and submit `advance`; the same core drives a Node CLI, a long-running "prove this pool" HTTP service for the operator's home machine (the deployment the user chose), and a Vite page for proving from a browser session; `audit` replays the public block against the on-chain transcript. An end-to-end test runs the whole thing against `anvil` with the plan-3 verifiers.

**Tech Stack:** Node 24 for `prover/` (vitest 5, Vite 8, viem 2.56, `@aztec/bb.js` 5.0.0, `@noir-lang/noir_js` 1.0.0-beta.26); bun for `cre/` (the CRE SDK compiles workflows with `bun x cre-compile`; `@chainlink/cre-sdk` 1.19.1, `@chainlink/cre-sdk/test`); `@zkpassport/poseidon2` 0.6.2, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0; Foundry's `anvil` and the forge artifacts of plans 2–3; Python only in tests (differential fuzz through `reference/pbear.py --transcript`).

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (B4, B6.2, B6.3, B6.5, B8, B9, B10, B12.1, B12.4, B12.5, B12.7). Contracts: `src/SealedRankedShares.sol` (plan 2). Circuits and artifacts: `noir/` (plan 3): `noir/artifacts/<profile>/{ingest,tally}.json` (ACIR), `.vk`; `reference/tools/noir_inputs.py` is the executable definition of the witness maps.

**Facts verified before writing (2026-09-05, this machine):**
- `@zkpassport/poseidon2`'s `poseidon2Hash(bigint[])` reproduces `reference/poseidon2.py` on `[1,2,3]` and `[1..6]` (so it is Barretenberg's sponge, including exact multiples of 3).
- `weierstrass({ p, n, h: 1n, a: 0n, b: p - 17n, Gx: 1n, Gy })` from `@noble/curves/abstract/weierstrass.js` is Grumpkin: `BASE.multiply(sk)` reproduces the `pk` of `reference/vectors/sealed.json`.
- CRE SDK 1.19.1: `cre.handlerInTee(trigger, fn, { tee: "nitro" })` runs `fn(runtime: TeeRuntime, payload)` in the enclave; `runtime.getSecret({ id }).result().value` reads a Vault secret; `runtime.usingTheDons()` returns the DON `Runtime` for `EVMClient.callContract` / `writeReport`; `runtime.reportFromDon(prepareReportRequest(hex))` produces a signed report from inside the enclave; `new cre.capabilities.EVMClient(selector).writeReport(donRuntime, { receiver, report, gasConfig })`; Arc testnet is `getNetwork({ chainFamily: "evm", chainSelectorName: "arc-testnet", isTestnet: true })`. Workflows run in QuickJS: no `node:*`, no `fetch`, no WASM threads.
- bb.js 5.0.0: `new UltraHonkBackend(acirBase64, api)` with `api = await Barretenberg.new({ threads })`; `generateProof(witness, { verifierTarget: 'evm' })` returns `{ proof: Uint8Array, publicInputs: string[] }` whose `publicInputs` are the circuit's public inputs in declaration order (pairing points travel inside `proof`); `verifyProof`, `getVerificationKey`. noir_js: `new Noir(circuit).execute(inputMap)` returns `{ witness }`.
- CRE CLI installs with `curl -sSL https://app.chain.link/cre/install.sh | bash`; whether `cre workflow simulate` needs a login is not documented; treat simulation as a manual step.

## Global Constraints

- Shared library files under `cre/src/lib/` are pure JavaScript/TypeScript with no Node, browser or WASM dependency, so they run under QuickJS, Node and the browser alike. `bb.js` and `noir_js` are used only in `prover/`.
- Pins: `@aztec/bb.js` **5.0.0** (matches the `bb` that built the verifiers; recorded in `noir/VERSIONS`), `@noir-lang/noir_js` **1.0.0-beta.26**, `@chainlink/cre-sdk` **1.19.1**, `viem` 2.56.x, `@zkpassport/poseidon2` 0.6.2, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0.
- The Python reference and the fixtures are the oracle; TS tests compare against `reference/vectors/*.json` byte for byte. `FIELD`, `Q`, `G`, `DOMAIN`, `NONE`, the packing, the mask, the chains, the transcript layout and the state commitment are exactly those of plans 1–3.
- Entry order: public block (addresses with `hasDirect`, registration order) then sealed block (addresses with a ciphertext, registration order). Weights are `bigint` and stay below `2^64`.
- Nothing derived from plaintext leaves the enclave except `(inputsRoot, fundedOrder, transcript)`; no `runtime.log` of secrets, keys, ballots or intermediate tallies.
- Report encodings (must equal `SealedRankedShares.onReport`): `abi.encode(uint8 kind, bytes payload)`; kind 1 payload `abi.encode(bytes32 inputsRoot, uint256[] fundedOrder, uint256[] transcript)`; kind 2 payload `abi.encode(uint256 maxVoters)`.
- `advance(bytes proof, bytes32[] publicInputs, bool restart)`: ingest public inputs `[k, nSealed, m, budget, pkX, pkY, hIn, hOut, stateIn, stateOut]`, tally `[costsHash, stateIn, stateOut, done, tHashOut, fundedCount, fundedOrderPacked]`; `restart` only from the pool's `coordinator`.
- Master secret: `keccak256(personal_sign("RankedShares tallier master secret v1"))` by the operator EOA; `sk = keccak256(master ‖ keySalt) mod Q`.
- Tests: `cd cre && bun test`, `cd prover && npm test`, plus `python3 -W error -m unittest discover reference` and `forge test -q` unchanged. No attribution lines in commits. Run the relevant package tests before every commit.

## File structure

```
cre/package.json, tsconfig.json, bunfig.toml         bun project (cre init layout if the CLI is available)
cre/project.yaml, cre/workflows/sealed/workflow.yaml, config.staging.json, secrets.yaml
cre/src/lib/field.ts        constants
cre/src/lib/poseidon2.ts    sponge(bigint[]) and spongeVar
cre/src/lib/grumpkin.ts     curve, mul, generator
cre/src/lib/sealed.ts       pack/unpack/validate, deriveSk, pubkey, mask, encrypt, decrypt
cre/src/lib/pbear.ts        pbearTranscript, replayPublic, cumulativeDeductions
cre/src/lib/commitments.ts  publicChain, sealedChain, costsHash, inputsRoot, transcriptHash, State, ingest, tallyStep, stateCommit
cre/src/lib/entries.ts      entry order from a voter list
cre/src/lib/report.ts       encode kind-1 / kind-2 payloads (viem)
cre/src/abi/SealedRankedShares.json   synced from out/ by cre/scripts/sync-abi.sh
cre/src/main.ts             the workflow
cre/test/*.test.ts          vectors, fixtures, differential fuzz, workflow with EvmMock
prover/package.json, tsconfig.json, vite.config.ts
prover/src/core/chain.ts    viem reads (votersFrom pages, config, checkpoints, transcript event)
prover/src/core/state.ts    rebuild sealed state and expected public inputs from chain data + key
prover/src/core/witness.ts  InputMaps for ingest/tally (mirrors reference/tools/noir_inputs.py)
prover/src/core/prove.ts    noir_js + bb.js
prover/src/core/submit.ts   advance() via viem
prover/src/core/audit.ts    replayPublic against the on-chain transcript
prover/src/core/key.ts      master secret from a signature, sk derivation
prover/src/cli/index.ts     audit | prove | status
prover/src/web/index.html, main.ts   coordinator page
prover/test/*.test.ts       witness/proof against fixtures, e2e on anvil
prover/scripts/e2e-anvil.sh
README.md                   CRE and prover sections
```

---

### Task 0: Toolchain and scaffolding

**Files:**
- Create: `cre/package.json`, `cre/tsconfig.json`, `cre/bunfig.toml`, `cre/scripts/sync-abi.sh`, `cre/src/abi/SealedRankedShares.json`, `prover/package.json`, `prover/tsconfig.json`, `prover/vite.config.ts`, `prover/vitest.config.ts`
- Modify: `.gitignore` (`cre/node_modules/`, `prover/node_modules/`, `prover/dist/`, `cre/dist/`)

**Interfaces:**
- Produces two independent packages. `cre/` scripts: `test` (`bun test`), `compile` (`bun x cre-compile src/main.ts dist/workflow.wasm`), `sync-abi`. `prover/` scripts: `test` (`vitest run`), `dev`/`build` (Vite), `cli` (`node --import tsx src/cli/index.ts` or a `tsx` bin).

- [ ] **Step 1: CRE CLI (optional but attempted)**

Run `curl -sSL https://app.chain.link/cre/install.sh | bash` and `cre version`. If the install succeeds, run `cre init` in a scratch directory choosing TypeScript to see the canonical layout (`project.yaml`, `workflows/<name>/workflow.yaml`, `config.*.json`, `secrets.yaml`) and copy that layout into `cre/`. If the CLI is unavailable or needs a login, use this layout instead and say so in the report:

```
cre/project.yaml
cre/workflows/sealed/workflow.yaml
cre/workflows/sealed/config.staging.json
cre/workflows/sealed/secrets.yaml
```

with `workflow.yaml` naming `../../src/main.ts` as the entry, `config.staging.json`:

```json
{
  "schedule": "0 */2 * * * *",
  "chainSelectorName": "arc-testnet",
  "pools": ["0x0000000000000000000000000000000000000000"],
  "closeChunk": 25,
  "gasLimit": "12000000"
}
```

and `secrets.yaml`:

```yaml
secretsNames:
  RANKED_SHARES_MASTER:
    - RANKED_SHARES_MASTER
```

- [ ] **Step 2: `cre/` package**

```json
{
  "name": "ranked-shares-cre",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "compile": "bun x cre-compile src/main.ts dist/workflow.wasm",
    "sync-abi": "bash scripts/sync-abi.sh"
  },
  "dependencies": {
    "@chainlink/cre-sdk": "1.19.1",
    "@noble/curves": "2.4.0",
    "@noble/hashes": "2.4.0",
    "@zkpassport/poseidon2": "0.6.2",
    "viem": "2.56.3"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.json`: `"target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "types": ["bun-types"]`, `"include": ["src", "test"]`.

```bash
#!/usr/bin/env bash
# cre/scripts/sync-abi.sh — copy the pool ABI from the forge build output.
set -euo pipefail
cd "$(dirname "$0")/../.."
forge build -q
jq '.abi' out/SealedRankedShares.sol/SealedRankedShares.json > cre/src/abi/SealedRankedShares.json
echo "cre/src/abi/SealedRankedShares.json updated"
```

Run: `cd cre && bun install && bun run sync-abi`.

- [ ] **Step 3: `prover/` package**

```json
{
  "name": "ranked-shares-prover",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "vite",
    "build": "vite build",
    "cli": "tsx src/cli/index.ts"
  },
  "dependencies": {
    "@aztec/bb.js": "5.0.0",
    "@noir-lang/noir_js": "1.0.0-beta.26",
    "@noble/curves": "2.4.0",
    "@noble/hashes": "2.4.0",
    "@zkpassport/poseidon2": "0.6.2",
    "viem": "2.56.3"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^8.0.0",
    "vitest": "^5.0.0"
  }
}
```

`vite.config.ts` must serve the page with the headers bb.js needs for threads:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  preview: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  build: { outDir: "../../dist", target: "esnext" },
  optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js"] },
  resolve: { alias: { "@lib": new URL("../cre/src/lib", import.meta.url).pathname } },
});
```

`vitest.config.ts`: `test: { testTimeout: 600_000, hookTimeout: 600_000 }` and the same `@lib` alias. `tsconfig.json` with `"paths": { "@lib/*": ["../cre/src/lib/*"] }`.

Run: `cd prover && npm install`.

- [ ] **Step 4: Commit**

```bash
git add cre prover .gitignore
git commit -m "Scaffold the CRE workflow and prover packages"
```

---

### Task 1: Shared primitives: field, Poseidon2, Grumpkin, keccak

**Files:**
- Create: `cre/src/lib/field.ts`, `cre/src/lib/poseidon2.ts`, `cre/src/lib/grumpkin.ts`, `cre/src/lib/hash.ts`
- Test: `cre/test/primitives.test.ts`

**Interfaces:**
- `field.ts`: `FIELD`, `Q`, `TWO_POW_64`, `NONE = 2n ** 64n - 1n`, `DOMAIN`, `hex(n: bigint, bytes = 32): 0x-string`, `toBig(hexOrNumber): bigint`.
- `poseidon2.ts`: `sponge(inputs: bigint[]): bigint` (the FieldSponge), `spongeVar(inputs, len)` = `sponge(inputs.slice(0, len))`.
- `grumpkin.ts`: `Grumpkin` (noble curve), `G`, `mul(k, point) -> {x, y}`, `isOnCurve(x, y)`, `pubkey(sk) -> {x, y}`.
- `hash.ts`: `keccak(bytes: Uint8Array): Uint8Array`, `concatBytes`, `wordBE(n: bigint, size = 32): Uint8Array`, `addressBytes(addr: bigint)`.

- [ ] **Step 1: Tests**

```ts
// cre/test/primitives.test.ts
import { describe, expect, test } from "bun:test";
import vectors from "../../reference/vectors/poseidon2.json";
import sealedVectors from "../../reference/vectors/sealed.json";
import { sponge, spongeVar } from "../src/lib/poseidon2";
import { G, isOnCurve, mul, pubkey } from "../src/lib/grumpkin";
import { keccak, wordBE } from "../src/lib/hash";
import { FIELD, Q, toBig } from "../src/lib/field";

describe("poseidon2", () => {
  test("hash vectors from bb.js", () => {
    for (const c of vectors.hash) {
      expect(sponge(c.input.map(toBig))).toBe(toBig(c.output));
    }
  });
  test("variable length equals fixed length", () => {
    expect(spongeVar([1n, 2n, 3n, 0n, 0n], 3)).toBe(sponge([1n, 2n, 3n]));
  });
});

describe("grumpkin", () => {
  test("generator and order", () => {
    expect(isOnCurve(G.x, G.y)).toBe(true);
    expect(mul(2n, G)).toEqual(mul(1n, mul(2n, G)));
    const pk = pubkey(toBig(sealedVectors.sk));
    expect(pk.x).toBe(toBig(sealedVectors.pk[0]));
    expect(pk.y).toBe(toBig(sealedVectors.pk[1]));
  });
  test("rejects off-curve and out-of-field", () => {
    expect(isOnCurve(1n, 1n)).toBe(false);
    expect(isOnCurve(FIELD, G.y)).toBe(false);
    expect(Q).toBe(21888242871839275222246405745257275088696311157297823662689037894645226208583n);
  });
});

describe("keccak", () => {
  test("known digests", () => {
    expect(Buffer.from(keccak(new Uint8Array())).toString("hex")).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(Buffer.from(keccak(new TextEncoder().encode("abc"))).toString("hex")).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    expect(wordBE(5n).length).toBe(32);
  });
});
```

Run: `cd cre && bun test test/primitives.test.ts` — expected: fails, modules missing.

- [ ] **Step 2: Implement**

```ts
// cre/src/lib/field.ts
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const TWO_POW_64 = 1n << 64n;
export const NONE = TWO_POW_64 - 1n;
export const DOMAIN = 0x52616e6b65645368617265732f7365616c65642f7632n; // "RankedShares/sealed/v2"

export function hex(n: bigint, bytes = 32): `0x${string}` {
  return `0x${n.toString(16).padStart(bytes * 2, "0")}`;
}

export function toBig(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(v);
}

export function mod(a: bigint, m = FIELD): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}
```

```ts
// cre/src/lib/poseidon2.ts
import { poseidon2Hash } from "@zkpassport/poseidon2";

/** Barretenberg's Poseidon2 FieldSponge over BN254 (t = 4, rate 3), as reference/poseidon2.py. */
export function sponge(inputs: bigint[]): bigint {
  return poseidon2Hash(inputs);
}

export function spongeVar(inputs: bigint[], len: number): bigint {
  return sponge(inputs.slice(0, len));
}
```

```ts
// cre/src/lib/grumpkin.ts
import { weierstrass } from "@noble/curves/abstract/weierstrass.js";
import { FIELD, Q } from "./field";

export const Grumpkin = weierstrass({
  p: FIELD,
  n: Q,
  h: 1n,
  a: 0n,
  b: FIELD - 17n,
  Gx: 1n,
  Gy: 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272cn,
});

export type Point = { x: bigint; y: bigint };
export const G: Point = { x: 1n, y: 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272cn };

export function isOnCurve(x: bigint, y: bigint): boolean {
  if (x < 0n || y < 0n || x >= FIELD || y >= FIELD) return false;
  return (y * y - (x * x * x + FIELD - 17n)) % FIELD === 0n;
}

export function mul(k: bigint, p: Point): Point {
  const a = Grumpkin.fromAffine({ x: p.x, y: p.y }).multiply(((k % Q) + Q) % Q).toAffine();
  return { x: a.x, y: a.y };
}

export function pubkey(sk: bigint): Point {
  return mul(sk, G);
}
```

```ts
// cre/src/lib/hash.ts
import { keccak_256 } from "@noble/hashes/sha3.js";

export function keccak(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function wordBE(n: bigint, size = 32): Uint8Array {
  const out = new Uint8Array(size);
  let v = n;
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function addressBytes(addr: bigint): Uint8Array {
  return wordBE(addr, 20);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesToBig(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}
```

If the noble import paths differ in 2.4 (`@noble/curves/abstract/weierstrass.js` and `@noble/hashes/sha3.js` were verified), adjust and record it. `mul` of the point at infinity is never needed: `sk` is in `[1, Q)` and `R` is on-curve and not the identity.

Run: `bun test test/primitives.test.ts` — expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add cre/src/lib/field.ts cre/src/lib/poseidon2.ts cre/src/lib/grumpkin.ts cre/src/lib/hash.ts cre/test/primitives.test.ts
git commit -m "Add the shared TypeScript primitives: field, Poseidon2, Grumpkin, keccak"
```

---

### Task 2: Sealed ballots in TypeScript

**Files:**
- Create: `cre/src/lib/sealed.ts`
- Test: `cre/test/sealed.test.ts`

**Interfaces:**
- `pack(ranks: number[]): bigint`, `unpack(packed: bigint, m: number): number[] | null` (validation as `PBEAR._setBallot`), `validate(ranks, m): boolean`, `effectiveRanks(ranks, m)`.
- `deriveSk(master: Uint8Array, keySalt: Uint8Array): bigint` = `keccak(master ‖ salt) mod Q`; `masterFromSignature(sig: Uint8Array): Uint8Array` = `keccak(sig)`; `MASTER_MESSAGE = "RankedShares tallier master secret v1"`.
- `mask(shared: Point, voter: bigint): bigint`; `encrypt(pk: Point, voter: bigint, ranks: number[], k: bigint): [bigint, bigint, bigint]`; `decrypt(sk: bigint, voter: bigint, ct: [bigint, bigint, bigint], m: number): number[] | null`; `randomScalar(): bigint` (uses `crypto.getRandomValues`; in QuickJS the workflow never encrypts, so it is only used by the browser).

- [ ] **Step 1: Tests**

```ts
// cre/test/sealed.test.ts
import { describe, expect, test } from "bun:test";
import v from "../../reference/vectors/sealed.json";
import { decrypt, deriveSk, encrypt, pack, unpack, validate, effectiveRanks } from "../src/lib/sealed";
import { pubkey } from "../src/lib/grumpkin";
import { toBig } from "../src/lib/field";

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

describe("packing", () => {
  test("round trip and validation", () => {
    expect(pack([2, 1, 0, 3])).toBe(0x03000102n);
    expect(unpack(0x03000102n, 4)).toEqual([2, 1, 0, 3]);
    expect(unpack(0n, 3)).toEqual([0, 0, 0]);
    expect(unpack(1n << 32n, 4)).toBeNull();
    expect(unpack(pack([5, 0, 0, 0]), 4)).toBeNull();
    expect(unpack(pack([1, 3, 3, 0]), 4)).toBeNull();
    expect(validate([1, 2, 2, 4], 4)).toBe(true);
    expect(effectiveRanks([2, 1, 0, 3], 4)).toEqual([2, 1, 4, 3]);
  });
});

describe("sealed vectors", () => {
  const sk = deriveSk(hexBytes(v.master), hexBytes(v.keySalt));
  test("key derivation", () => {
    expect(sk).toBe(toBig(v.sk));
    const pk = pubkey(sk);
    expect(pk.x).toBe(toBig(v.pk[0]));
  });
  for (const c of v.cases) {
    test(`case voter ${c.voter} m ${c.m}${c.note ? ` (${c.note})` : ""}`, () => {
      const ct = c.ciphertext.map(toBig) as [bigint, bigint, bigint];
      if (!c.note) {
        expect(encrypt(pubkey(sk), toBig(c.voter), c.ranks, toBig(c.k))).toEqual(ct);
      }
      expect(decrypt(sk, toBig(c.voter), ct, c.m)).toEqual(c.plaintext);
    });
  }
});
```

- [ ] **Step 2: Implement**

```ts
// cre/src/lib/sealed.ts
import { DOMAIN, FIELD, Q, mod } from "./field";
import { G, isOnCurve, mul, type Point } from "./grumpkin";
import { bytesToBig, concatBytes, keccak } from "./hash";
import { sponge } from "./poseidon2";

export const MASTER_MESSAGE = "RankedShares tallier master secret v1";

export function pack(ranks: number[]): bigint {
  return ranks.reduce((acc, r, c) => acc + (BigInt(r) << BigInt(8 * c)), 0n);
}

/** Competition-ranking check, identical to PBEAR._setBallot. */
export function validate(ranks: number[], m: number): boolean {
  if (ranks.length !== m || ranks.some((r) => r < 0 || r > m)) return false;
  const counts = new Array<number>(m + 1).fill(0);
  for (const r of ranks) counts[r]++;
  let seen = 0;
  for (let r = 1; r <= m; r++) {
    if (counts[r] !== 0 && r !== seen + 1) return false;
    seen += counts[r];
  }
  return true;
}

export function unpack(packed: bigint, m: number): number[] | null {
  if (packed < 0n || packed >= 1n << BigInt(8 * m)) return null;
  const ranks: number[] = [];
  for (let c = 0; c < m; c++) ranks.push(Number((packed >> BigInt(8 * c)) & 0xffn));
  return validate(ranks, m) ? ranks : null;
}

export function effectiveRanks(ranks: number[], m: number): number[] {
  const def = 1 + ranks.slice(0, m).filter((r) => r !== 0).length;
  return ranks.map((r) => (r === 0 ? def : r));
}

export function masterFromSignature(sig: Uint8Array): Uint8Array {
  return keccak(sig);
}

export function deriveSk(master: Uint8Array, keySalt: Uint8Array): bigint {
  return bytesToBig(keccak(concatBytes(master, keySalt))) % Q;
}

export function mask(shared: Point, voter: bigint): bigint {
  return sponge([DOMAIN, shared.x, shared.y, voter]);
}

export function encrypt(pk: Point, voter: bigint, ranks: number[], k: bigint): [bigint, bigint, bigint] {
  const r = mul(k, G);
  const s = mul(k, pk);
  return [r.x, r.y, mod(pack(ranks) + mask(s, voter))];
}

export function decrypt(sk: bigint, voter: bigint, ct: [bigint, bigint, bigint], m: number): number[] | null {
  const [rx, ry, c] = ct;
  if (rx === 0n || !isOnCurve(rx, ry)) return null;
  const s = mul(sk, { x: rx, y: ry });
  return unpack(mod(c - mask(s, voter)), m);
}

export function randomScalar(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return (bytesToBig(b) % (Q - 1n)) + 1n;
}
```

Run: `bun test test/sealed.test.ts` — expected: all cases pass, including the replayed and zero-`rx` cases.

- [ ] **Step 3: Commit**

```bash
git add cre/src/lib/sealed.ts cre/test/sealed.test.ts
git commit -m "Port sealed-ballot packing, key derivation and encryption to TypeScript"
```

---

### Task 3: PB-EAR transcript mode, commitments and the circuit state

**Files:**
- Create: `cre/src/lib/pbear.ts`, `cre/src/lib/commitments.ts`, `cre/src/lib/entries.ts`
- Test: `cre/test/pbear.test.ts`, `cre/test/commitments.test.ts`

**Interfaces:**
- `pbear.ts`: `type Entry = { weight: bigint; ballot: number[] | null }`; `cumulativeDeductions(weights: bigint[], thr: bigint, total?: bigint, start = 0n): bigint[]`; `pbearTranscript(costs: bigint[], pub: Entry[], sealed: Entry[], budget: bigint): { funded: number[]; transcript: bigint[][] }`; `replayPublic(costs, pub, transcript, budget): boolean`.
- `entries.ts`: `type Voter = { addr: bigint; directWeight: bigint; seatWeight: bigint; hasDirect: boolean; directPacked: bigint; ciphertext: [bigint, bigint, bigint] | null }`; `publicEntries(voters, m): Entry[]`; `sealedVoters(voters): Voter[]`; `sealedEntries(voters, sk, m): Entry[]` (decrypts).
- `commitments.ts`: `publicChain(voters): Uint8Array (32)`, `sealedChain(voters, batch): { h: bigint; checkpoints: bigint[] }`, `costsHash(costs)`, `inputsRoot(hPub, hSealed, sealedCount, costsHash, totalWeight): Uint8Array`, `transcriptHashAfter(t, step)`, `transcriptHash(transcript)`, `type Profile = { nSealedMax: number; mMax: number; batch: number; k: number }`, `PROFILES`, `type State`, `emptyState(profile, m, budget)`, `cloneState`, `fundedBits`, `fundedOrderPacked`, `stateCommit(profile, state)`, `ingest(state, index, seatWeight, packed | null)`, `tallyStep(profile, state, costs, step)` (throws `TranscriptMismatch`).

All of these mirror `reference/pbear.py` and `reference/commitments.py` function by function; read those files first and keep names aligned.

- [ ] **Step 1: Tests**

```ts
// cre/test/pbear.test.ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { NONE } from "../src/lib/field";
import { cumulativeDeductions, pbearTranscript, replayPublic } from "../src/lib/pbear";

describe("pbear transcript", () => {
  test("the [30, 70] example", () => {
    const { funded, transcript } = pbearTranscript([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], [{ weight: 60n, ballot: [2, 1] }], 100n);
    expect(funded).toEqual([0, 1]);
    expect(transcript).toEqual([[1n, 40n, 0n, 0n, 40n], [1n, 0n, 0n, NONE, 0n], [2n, 0n, 10n, 1n, 70n]]);
    expect(replayPublic([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], transcript, 100n)).toBe(true);
  });
  test("deductions sum to the threshold", () => {
    const d = cumulativeDeductions([7n, 5n, 9n], 10n);
    expect(d.reduce((a, b) => a + b, 0n)).toBe(10n);
  });
  test("matches reference/pbear.py --transcript on random instances", () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 60; i++) {
      const m = 1 + rnd(4);
      const costs = Array.from({ length: m }, () => BigInt(1 + rnd(10)));
      const entry = () => {
        const weight = BigInt(rnd(11));
        if (rnd(5) === 0) return { weight, ballot: null };
        const order = Array.from({ length: m }, (_, c) => c).sort(() => rnd(3) - 1);
        const kept = rnd(m + 1);
        const ranks = new Array<number>(m).fill(0);
        let rank = 1;
        for (let p = 0; p < kept; p++) {
          if (p === 0 || rnd(10) < 6) rank = p + 1;
          ranks[order[p]] = rank;
        }
        return { weight, ballot: ranks };
      };
      const pub = Array.from({ length: rnd(4) }, entry);
      const sealed = Array.from({ length: rnd(4) }, entry);
      const budget = [...pub, ...sealed].reduce((a, e) => a + e.weight, 0n) + BigInt(rnd(10));
      const payload = JSON.stringify({ costs: costs.map(Number), public: pub.map((e) => [Number(e.weight), e.ballot]), sealed: sealed.map((e) => [Number(e.weight), e.ballot]), budget: Number(budget) });
      const out = spawnSync(["python3", "../reference/pbear.py", "--transcript", payload]);
      const ref = JSON.parse(out.stdout.toString());
      const got = pbearTranscript(costs, pub, sealed, budget);
      expect(got.funded).toEqual(ref.funded);
      expect(got.transcript.map((s) => s.map(Number))).toEqual(ref.transcript);
    }
  });
});
```

```ts
// cre/test/commitments.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toBig } from "../src/lib/field";
import * as cm from "../src/lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "../src/lib/entries";
import { pbearTranscript } from "../src/lib/pbear";
import { pack } from "../src/lib/sealed";

const FIXTURES = ["test_main", "test_smallm", "test_nosealed", "default_main"];
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../reference/vectors/fixture_${name}.json`, import.meta.url), "utf8"));

function voters(fx: any): Voter[] {
  return fx.voters.map((v: any) => ({
    addr: toBig(v.addr),
    directWeight: toBig(v.directWeight),
    seatWeight: toBig(v.seatWeight),
    hasDirect: v.hasDirect,
    directPacked: toBig(v.directPacked),
    ciphertext: v.hasSealed ? (v.ciphertext.map(toBig) as [bigint, bigint, bigint]) : null,
  }));
}

describe("commitments against the fixtures", () => {
  for (const name of FIXTURES) {
    test(name, () => {
      const fx = load(name);
      const profile = cm.PROFILES[fx.profile.name as keyof typeof cm.PROFILES];
      const vs = voters(fx);
      const m: number = fx.m;
      const costs = fx.costs.map(toBig);
      const budget = toBig(fx.totalWeight);
      const sk = toBig(fx.sk);

      expect(Buffer.from(cm.publicChain(vs)).toString("hex")).toBe(fx.hPub.slice(2));
      const { h, checkpoints } = cm.sealedChain(vs, profile.batch);
      expect(h).toBe(toBig(fx.hSealed));
      expect(checkpoints).toEqual(fx.checkpoints.map(toBig));
      const ch = cm.costsHash(costs);
      expect(ch).toBe(toBig(fx.costsHash));
      expect(Buffer.from(cm.inputsRoot(cm.publicChain(vs), h, sealedVoters(vs).length, ch, budget)).toString("hex")).toBe(fx.inputsRoot.slice(2));

      const pub = publicEntries(vs, m);
      const sealed = sealedEntries(vs, sk, m);
      const { funded, transcript } = pbearTranscript(costs, pub, sealed, budget);
      expect(funded).toEqual(fx.funded);
      expect(transcript.map((s) => s.map(Number))).toEqual(fx.transcript);
      expect(cm.transcriptHash(transcript)).toBe(toBig(fx.transcriptHash));

      // ingest chain
      const state = cm.emptyState(profile, m, budget);
      const sv = sealedVoters(vs);
      fx.ingestProofs.forEach((proof: any, k: number) => {
        for (let j = 0; j < profile.batch; j++) {
          const i = k * profile.batch + j;
          if (i < sv.length) {
            const ranks = sealed[i].ballot;
            cm.ingest(state, i, sv[i].seatWeight, ranks === null ? null : pack(ranks));
          }
        }
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateOut));
      });
      // tally chain
      let cursor = 0;
      for (const proof of fx.tallyProofs) {
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateIn));
        for (let s = 0; s < profile.k; s++) {
          const step = cursor < transcript.length ? transcript[cursor] : [BigInt(state.level), ...new Array(m).fill(0n), cm.NONE, 0n];
          const before = state.tHash;
          cm.tallyStep(profile, state, costs, step);
          if (state.tHash !== before) cursor++;
        }
        expect(cm.stateCommit(profile, state)).toBe(toBig(proof.stateOut));
        expect(state.done ? 1 : 0).toBe(proof.done);
        expect(cm.fundedOrderPacked(state)).toBe(toBig(proof.fundedOrderPacked));
      }
    });
  }
});
```

Run both: `bun test test/pbear.test.ts test/commitments.test.ts` — expected: fail on missing modules.

- [ ] **Step 2: Implement `pbear.ts`**

```ts
// cre/src/lib/pbear.ts — port of reference/pbear.py (transcript mode and public replay)
import { NONE } from "./field";
import { effectiveRanks, validate } from "./sealed";

export type Entry = { weight: bigint; ballot: number[] | null };

export function cumulativeDeductions(weights: bigint[], thr: bigint, total?: bigint, start = 0n): bigint[] {
  const t = total ?? weights.reduce((a, b) => a + b, 0n);
  const out: bigint[] = [];
  let cum = start;
  for (const w of weights) {
    const next = cum + w;
    out.push((next * thr) / t - (cum * thr) / t);
    cum = next;
  }
  return out;
}

function ranksOf(entries: Entry[], m: number): (number[] | null)[] {
  return entries.map((e) => {
    if (e.ballot === null) return null;
    if (!validate(e.ballot, m)) throw new Error("invalid ballot");
    return effectiveRanks(e.ballot, m);
  });
}

function support(weights: bigint[], ranks: (number[] | null)[], indices: number[], funded: boolean[], level: number, m: number): bigint[] {
  const s = new Array<bigint>(m).fill(0n);
  for (const i of indices) {
    const r = ranks[i];
    if (r === null || weights[i] === 0n) continue;
    for (let c = 0; c < m; c++) if (!funded[c] && r[c] <= level) s[c] += weights[i];
  }
  return s;
}

function argmax(costs: bigint[], sum: bigint[], funded: boolean[]): number | null {
  let best: number | null = null;
  for (let c = 0; c < costs.length; c++) {
    if (funded[c] || sum[c] < costs[c]) continue;
    if (best === null || sum[c] > sum[best] || (sum[c] === sum[best] && costs[c] < costs[best])) best = c;
  }
  return best;
}

export function pbearTranscript(costs: bigint[], pub: Entry[], sealed: Entry[], budget: bigint): { funded: number[]; transcript: bigint[][] } {
  const m = costs.length;
  const entries = [...pub, ...sealed];
  const weights = entries.map((e) => e.weight);
  if (weights.reduce((a, b) => a + b, 0n) > budget) throw new Error("entry weights exceed the budget");
  const ranks = ranksOf(entries, m);
  const pubIdx = pub.map((_, i) => i);
  const sealedIdx = sealed.map((_, i) => pub.length + i);
  const funded: number[] = [];
  const isFunded = new Array<boolean>(m).fill(false);
  let spent = 0n;
  let level = 1;
  const transcript: bigint[][] = [];
  const exhausted = () => costs.every((c, i) => isFunded[i] || spent + c > budget);
  while (!exhausted()) {
    const ps = support(weights, ranks, pubIdx, isFunded, level, m);
    const ss = support(weights, ranks, sealedIdx, isFunded, level, m);
    const sum = ps.map((p, c) => p + ss[c]);
    const best = argmax(costs, sum, isFunded);
    if (best === null) {
      transcript.push([BigInt(level), ...ps, NONE, 0n]);
      if (level >= m) break;
      level++;
      continue;
    }
    transcript.push([BigInt(level), ...ps, BigInt(best), sum[best]]);
    const supporters = entries.map((_, i) => i).filter((i) => ranks[i] !== null && weights[i] !== 0n && ranks[i]![best] <= level);
    const ded = cumulativeDeductions(supporters.map((i) => weights[i]), costs[best]);
    supporters.forEach((i, j) => (weights[i] -= ded[j]));
    isFunded[best] = true;
    funded.push(best);
    spent += costs[best];
  }
  if (transcript.length > 2 * m) throw new Error("transcript longer than 2m steps");
  return { funded, transcript };
}

/** The audit of spec B6.3: replay the public block against a transcript from public data. */
export function replayPublic(costs: bigint[], pub: Entry[], transcript: bigint[][], budget: bigint): boolean {
  const m = costs.length;
  const weights = pub.map((e) => e.weight);
  let ranks: (number[] | null)[];
  try {
    ranks = ranksOf(pub, m);
  } catch {
    return false;
  }
  const isFunded = new Array<boolean>(m).fill(false);
  let spent = 0n;
  let level: number | null = 1;
  const exhausted = () => costs.every((c, i) => isFunded[i] || spent + c > budget);
  const all = pub.map((_, i) => i);
  for (const step of transcript) {
    if (step.length !== m + 3 || level === null || exhausted()) return false;
    const [lv, ...rest] = step;
    const ps = rest.slice(0, m);
    const best = rest[m];
    const total = rest[m + 1];
    if (Number(lv) !== level) return false;
    const expected = support(weights, ranks, all, isFunded, level, m);
    if (ps.some((p, c) => p !== expected[c])) return false;
    if (best === NONE) {
      if (total !== 0n || ps.some((p, c) => !isFunded[c] && p >= costs[c])) return false;
      if (level >= m) level = null;
      else level++;
      continue;
    }
    const b = Number(best);
    if (b < 0 || b >= m || isFunded[b]) return false;
    if (total < costs[b] || total < ps[b] || spent + costs[b] > budget) return false;
    const sup = all.filter((i) => ranks[i] !== null && weights[i] !== 0n && ranks[i]![b] <= level!);
    const ded = cumulativeDeductions(sup.map((i) => weights[i]), costs[b], total);
    sup.forEach((i, j) => (weights[i] -= ded[j]));
    isFunded[b] = true;
    spent += costs[b];
  }
  return level === null ? true : exhausted();
}
```

- [ ] **Step 3: Implement `entries.ts` and `commitments.ts`**

```ts
// cre/src/lib/entries.ts
import { decrypt, unpack } from "./sealed";
import type { Entry } from "./pbear";

export type Voter = {
  addr: bigint;
  directWeight: bigint;
  seatWeight: bigint;
  hasDirect: boolean;
  directPacked: bigint;
  ciphertext: [bigint, bigint, bigint] | null;
};

export function publicEntries(voters: Voter[], m: number): Entry[] {
  return voters.filter((v) => v.hasDirect).map((v) => ({ weight: v.directWeight, ballot: unpack(v.directPacked, m) }));
}

export function sealedVoters(voters: Voter[]): Voter[] {
  return voters.filter((v) => v.ciphertext !== null);
}

export function sealedEntries(voters: Voter[], sk: bigint, m: number): Entry[] {
  return sealedVoters(voters).map((v) => ({ weight: v.seatWeight, ballot: decrypt(sk, v.addr, v.ciphertext!, m) }));
}
```

```ts
// cre/src/lib/commitments.ts — port of reference/commitments.py
import { NONE } from "./field";
import { addressBytes, concatBytes, keccak, wordBE } from "./hash";
import { cumulativeDeductions } from "./pbear";
import { sponge } from "./poseidon2";
import { effectiveRanks, unpack } from "./sealed";
import type { Voter } from "./entries";

export { NONE };

export type Profile = { name: string; nSealedMax: number; mMax: number; batch: number; k: number };
export const PROFILES: Record<string, Profile> = {
  default: { name: "default", nSealedMax: 256, mMax: 16, batch: 32, k: 8 },
  test: { name: "test", nSealedMax: 8, mMax: 4, batch: 2, k: 2 },
};

export class TranscriptMismatch extends Error {}

export function publicChain(voters: Voter[]): Uint8Array {
  let h = new Uint8Array(32);
  for (const v of voters) {
    if (!v.hasDirect) continue;
    h = keccak(concatBytes(h, addressBytes(v.addr), wordBE(v.directWeight), wordBE(v.directPacked)));
  }
  return h;
}

export function sealedChain(voters: Voter[], batch: number): { h: bigint; checkpoints: bigint[] } {
  const sealed = voters.filter((v) => v.ciphertext !== null);
  let h = 0n;
  const checkpoints = [0n];
  sealed.forEach((v, j) => {
    const [rx, ry, c] = v.ciphertext!;
    h = sponge([h, v.addr, v.seatWeight, rx, ry, c]);
    if ((j + 1) % batch === 0 || j + 1 === sealed.length) checkpoints.push(h);
  });
  if (sealed.length === 0) checkpoints.push(0n);
  return { h, checkpoints };
}

export function costsHash(costs: bigint[]): bigint {
  return sponge(costs);
}

export function inputsRoot(hPub: Uint8Array, hSealed: bigint, sealedCount: number, costsHashValue: bigint, totalWeight: bigint): Uint8Array {
  return keccak(concatBytes(hPub, wordBE(hSealed), wordBE(BigInt(sealedCount)), wordBE(costsHashValue), wordBE(totalWeight)));
}

export function transcriptHashAfter(t: bigint, step: bigint[]): bigint {
  return sponge([t, ...step]);
}

export function transcriptHash(transcript: bigint[][]): bigint {
  return transcript.reduce((t, step) => transcriptHashAfter(t, step), 0n);
}

export type State = {
  weights: bigint[];
  ballots: bigint[];
  funded: boolean[];
  fundedOrder: number[];
  fundedCount: number;
  level: number;
  spent: bigint;
  done: boolean;
  m: number;
  budget: bigint;
  tHash: bigint;
};

export function emptyState(p: Profile, m: number, budget: bigint): State {
  return {
    weights: new Array<bigint>(p.nSealedMax).fill(0n),
    ballots: new Array<bigint>(p.nSealedMax).fill(0n),
    funded: new Array<boolean>(p.mMax).fill(false),
    fundedOrder: new Array<number>(p.mMax).fill(0),
    fundedCount: 0,
    level: 1,
    spent: 0n,
    done: false,
    m,
    budget,
    tHash: 0n,
  };
}

export function cloneState(s: State): State {
  return { ...s, weights: [...s.weights], ballots: [...s.ballots], funded: [...s.funded], fundedOrder: [...s.fundedOrder] };
}

export function fundedBits(s: State): bigint {
  return s.funded.reduce((bits, f, c) => (f ? bits | (1n << BigInt(c)) : bits), 0n);
}

export function fundedOrderPacked(s: State): bigint {
  let packed = 0n;
  for (let j = 0; j < s.fundedCount; j++) packed += BigInt(s.fundedOrder[j]) << BigInt(8 * j);
  return packed;
}

export function stateCommit(p: Profile, s: State): bigint {
  if (s.weights.length !== p.nSealedMax || s.funded.length !== p.mMax) throw new Error("state does not match profile");
  return sponge([...s.weights, ...s.ballots, fundedBits(s), fundedOrderPacked(s), BigInt(s.fundedCount), BigInt(s.level), s.spent, s.done ? 1n : 0n, BigInt(s.m), s.budget, s.tHash]);
}

export function ingest(s: State, index: number, seatWeight: bigint, packed: bigint | null): void {
  if (packed === null) {
    s.weights[index] = 0n;
    s.ballots[index] = 0n;
  } else {
    s.weights[index] = seatWeight;
    s.ballots[index] = packed;
  }
}

function exhausted(s: State, costs: bigint[]): boolean {
  for (let c = 0; c < s.m; c++) if (!s.funded[c] && s.spent + costs[c] <= s.budget) return false;
  return true;
}

export function tallyStep(p: Profile, s: State, costs: bigint[], step: bigint[]): void {
  const m = s.m;
  if (s.done) return;
  if (exhausted(s, costs)) {
    s.done = true;
    return;
  }
  if (step.length !== m + 3) throw new TranscriptMismatch("step length");
  const level = Number(step[0]);
  const pub = step.slice(1, m + 1);
  const best = step[m + 1];
  const total = step[m + 2];
  if (level !== s.level) throw new TranscriptMismatch("level");
  s.tHash = transcriptHashAfter(s.tHash, step);
  const ranks = s.weights.map((w, e) => {
    if (w === 0n) return null;
    const r = unpack(s.ballots[e], m);
    return r === null ? null : effectiveRanks(r, m);
  });
  const sealed = new Array<bigint>(m).fill(0n);
  ranks.forEach((r, e) => {
    if (r === null) return;
    for (let c = 0; c < m; c++) if (!s.funded[c] && r[c] <= level) sealed[c] += s.weights[e];
  });
  const sum = pub.map((x, c) => x + sealed[c]);
  let arg: number | null = null;
  for (let c = 0; c < m; c++) {
    if (s.funded[c] || sum[c] < costs[c]) continue;
    if (arg === null || sum[c] > sum[arg] || (sum[c] === sum[arg] && costs[c] < costs[arg])) arg = c;
  }
  if (best !== (arg === null ? NONE : BigInt(arg))) throw new TranscriptMismatch("best");
  if (best === NONE) {
    if (total !== 0n) throw new TranscriptMismatch("total");
    if (level >= m) s.done = true;
    else s.level += 1;
    return;
  }
  const b = Number(best);
  if (total !== sum[b]) throw new TranscriptMismatch("total");
  const thr = costs[b];
  const sup = ranks.map((r, e) => (r !== null && r[b] <= level ? e : -1)).filter((e) => e >= 0);
  const ded = cumulativeDeductions(sup.map((e) => s.weights[e]), thr, total, pub[b]);
  sup.forEach((e, j) => (s.weights[e] -= ded[j]));
  s.funded[b] = true;
  s.fundedOrder[s.fundedCount] = b;
  s.fundedCount += 1;
  s.spent += thr;
  if (exhausted(s, costs)) s.done = true;
}
```

Run: `bun test` — expected: everything green including the four fixtures and the 60-instance differential test (needs `python3` on PATH).

- [ ] **Step 4: Commit**

```bash
git add cre/src/lib/pbear.ts cre/src/lib/entries.ts cre/src/lib/commitments.ts cre/test/pbear.test.ts cre/test/commitments.test.ts
git commit -m "Port PB-EAR transcript mode, commitments and the circuit state to TypeScript"
```

---

### Task 4: The CRE workflow

**Files:**
- Create: `cre/src/lib/report.ts`, `cre/src/main.ts`
- Test: `cre/test/report.test.ts`, `cre/test/workflow.test.ts`

**Interfaces:**
- `report.ts`: `encodeResultReport(inputsRoot: 0x-hex, funded: number[], transcript: bigint[][]): 0x-hex` and `encodeCloseReport(maxVoters: number): 0x-hex` (both are the `report` bytes `onReport` decodes, i.e. `abi.encode(uint8, bytes)`); `decodeResultReport(bytes)` for tests.
- `main.ts`: `Config = { schedule: string; chainSelectorName: string; pools: string[]; closeChunk: number; gasLimit: string }`; exports `initWorkflow(config)` and `main()`; a pure function `processPool(reads: PoolReads, master: Uint8Array): { kind: 1; payload... } | { kind: 2; maxVoters } | null` so the tally logic is unit-testable without the runtime; the TEE handler wires reads (through `runtime.usingTheDons()`) and the secret to `processPool`, then `reportFromDon` + `writeReport`.

- [ ] **Step 1: Tests**

```ts
// cre/test/report.test.ts
import { describe, expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import { encodeCloseReport, encodeResultReport } from "../src/lib/report";

describe("report encoding", () => {
  test("kind 1 decodes as the contract does", () => {
    const bytes = encodeResultReport("0x" + "11".repeat(32), [0, 1], [[1n, 40n, 0n, 0n, 40n]]);
    const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], bytes);
    expect(kind).toBe(1);
    const [root, order, transcript] = decodeAbiParameters([{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }], payload as `0x${string}`);
    expect(root).toBe("0x" + "11".repeat(32));
    expect(order).toEqual([0n, 1n]);
    expect(transcript).toEqual([1n, 40n, 0n, 0n, 40n]);
  });
  test("kind 2", () => {
    const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], encodeCloseReport(25));
    expect(kind).toBe(2);
    expect(decodeAbiParameters([{ type: "uint256" }], payload as `0x${string}`)[0]).toBe(25n);
  });
});
```

```ts
// cre/test/workflow.test.ts — processPool against a fixture, no runtime needed
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeAbiParameters } from "viem";
import { processPool, type PoolReads } from "../src/main";
import { toBig } from "../src/lib/field";

const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/fixture_test_main.json", import.meta.url), "utf8"));
const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

function reads(phase: number): PoolReads {
  return {
    phase,
    resultReported: false,
    m: fx.m,
    costs: fx.costs.map(toBig),
    totalWeight: toBig(fx.totalWeight),
    keySalt: hexBytes(fx.keySalt),
    inputsRoot: fx.inputsRoot,
    batch: fx.profile.batch,
    voters: fx.voters.map((v: any) => ({
      addr: toBig(v.addr),
      directWeight: toBig(v.directWeight),
      seatWeight: toBig(v.seatWeight),
      hasDirect: v.hasDirect,
      directPacked: toBig(v.directPacked),
      ciphertext: v.hasSealed ? v.ciphertext.map(toBig) : null,
    })),
  };
}

describe("processPool", () => {
  test("Closing yields a kind-2 close report", () => {
    const out = processPool({ ...reads(2), closeChunk: 25 } as any, hexBytes(fx.master));
    expect(out?.kind).toBe(2);
  });
  test("Tally without a report yields the fixture result and transcript", () => {
    const out = processPool({ ...reads(3), closeChunk: 25 } as any, hexBytes(fx.master));
    expect(out?.kind).toBe(1);
    const [, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], out!.report);
    const [root, order, transcript] = decodeAbiParameters([{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }], payload as `0x${string}`);
    expect(root).toBe(fx.inputsRoot);
    expect(order.map(Number)).toEqual(fx.funded);
    expect(transcript.map(Number)).toEqual(fx.transcript.flat());
  });
  test("a wrong inputsRoot aborts without a report", () => {
    const r = reads(3);
    r.inputsRoot = "0x" + "00".repeat(32);
    expect(() => processPool({ ...r, closeChunk: 25 } as any, hexBytes(fx.master))).toThrow(/inputsRoot/);
  });
  test("Tally with a report already there does nothing", () => {
    const r = reads(3);
    r.resultReported = true;
    expect(processPool({ ...r, closeChunk: 25 } as any, hexBytes(fx.master))).toBeNull();
  });
});
```

Phases: `Setup 0, Open 1, Closing 2, Tally 3, Done 4`.

- [ ] **Step 2: Implement `report.ts` and `main.ts`**

```ts
// cre/src/lib/report.ts
import { encodeAbiParameters } from "viem";

export function encodeResultReport(inputsRoot: `0x${string}`, funded: number[], transcript: bigint[][]): `0x${string}` {
  const payload = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }],
    [inputsRoot, funded.map(BigInt), transcript.flat()],
  );
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, payload]);
}

export function encodeCloseReport(maxVoters: number): `0x${string}` {
  const payload = encodeAbiParameters([{ type: "uint256" }], [BigInt(maxVoters)]);
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [2, payload]);
}
```

```ts
// cre/src/main.ts
import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  Runner,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, hexToBytes, zeroAddress } from "viem";
import abi from "./abi/SealedRankedShares.json";
import * as cm from "./lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "./lib/entries";
import { pbearTranscript } from "./lib/pbear";
import { encodeCloseReport, encodeResultReport } from "./lib/report";
import { deriveSk } from "./lib/sealed";

export type Config = { schedule: string; chainSelectorName: string; pools: string[]; closeChunk: number; gasLimit: string };

export type PoolReads = {
  phase: number;
  resultReported: boolean;
  m: number;
  costs: bigint[];
  totalWeight: bigint;
  keySalt: Uint8Array;
  inputsRoot: `0x${string}`;
  batch: number;
  voters: Voter[];
  closeChunk: number;
};

export type PoolAction = { kind: 2; report: `0x${string}` } | { kind: 1; report: `0x${string}` } | null;

const PHASE_CLOSING = 2;
const PHASE_TALLY = 3;

/**
 * The tally itself, free of any runtime so it can be unit-tested. Everything that
 * touches plaintext happens here and only (inputsRoot, fundedOrder, transcript) leaves.
 */
export function processPool(r: PoolReads, master: Uint8Array): PoolAction {
  if (r.phase === PHASE_CLOSING) return { kind: 2, report: encodeCloseReport(r.closeChunk) };
  if (r.phase !== PHASE_TALLY || r.resultReported) return null;
  const sk = deriveSk(master, r.keySalt);
  const hPub = cm.publicChain(r.voters);
  const { h } = cm.sealedChain(r.voters, r.batch);
  const root = cm.inputsRoot(hPub, h, sealedVoters(r.voters).length, cm.costsHash(r.costs), r.totalWeight);
  if (bytesToHex(root) !== r.inputsRoot.toLowerCase()) throw new Error("inputsRoot mismatch: chain reads disagree with the commitment");
  const { funded, transcript } = pbearTranscript(r.costs, publicEntries(r.voters, r.m), sealedEntries(r.voters, sk, r.m), r.totalWeight);
  return { kind: 1, report: encodeResultReport(r.inputsRoot, funded, transcript) };
}

// ---- chain reads through the DON ----

function call<T>(runtime: Runtime<Config>, evm: InstanceType<typeof cre.capabilities.EVMClient>, pool: Address, functionName: string, args: unknown[] = []): T {
  const data = encodeFunctionData({ abi, functionName, args } as any);
  const reply = evm.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: pool, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER }).result();
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) } as any) as T;
}

export function readPool(runtime: Runtime<Config>, evm: InstanceType<typeof cre.capabilities.EVMClient>, pool: Address, closeChunk: number): PoolReads {
  const phase = Number(call<bigint | number>(runtime, evm, pool, "phase"));
  const base = { phase, closeChunk } as PoolReads;
  if (phase !== PHASE_TALLY) return base;
  const resultReported = call<boolean>(runtime, evm, pool, "resultReported");
  const costs = call<bigint[]>(runtime, evm, pool, "costs");
  const totalWeight = call<bigint>(runtime, evm, pool, "totalWeight");
  const keySalt = hexToBytes(call<`0x${string}`>(runtime, evm, pool, "keySalt"));
  const inputsRoot = call<`0x${string}`>(runtime, evm, pool, "inputsRoot");
  const batch = Number(call<bigint>(runtime, evm, pool, "batch"));
  const n = Number(call<bigint>(runtime, evm, pool, "voterCount"));
  const voters: Voter[] = [];
  const page = 50;
  for (let start = 0; start < n; start += page) {
    const [who, direct, ballots, seats, cts, hasDirectFlags] = call<[Address[], bigint[], bigint[], bigint[], [bigint, bigint, bigint][], boolean[]]>(runtime, evm, pool, "votersFrom", [BigInt(start), BigInt(page)]);
    who.forEach((a, i) => {
      voters.push({
        addr: BigInt(a),
        directWeight: direct[i],
        seatWeight: seats[i],
        hasDirect: hasDirectFlags[i],
        directPacked: ballots[i],
        ciphertext: cts[i][0] === 0n ? null : [cts[i][0], cts[i][1], cts[i][2]],
      });
    });
  }
  return { phase, resultReported, m: costs.length, costs, totalWeight, keySalt, inputsRoot, batch, voters, closeChunk };
}

// ---- the handler ----

const onCronInTee = (runtime: TeeRuntime<Config>) => {
  const don = runtime.usingTheDons();
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error("network not found");
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const master = hexToBytes(runtime.getSecret({ id: "RANKED_SHARES_MASTER" }).result().value as `0x${string}`);
  const summary: string[] = [];
  for (const pool of runtime.config.pools as Address[]) {
    const reads = readPool(don, evm, pool, runtime.config.closeChunk);
    const action = processPool(reads, master);
    if (!action) {
      summary.push(`${pool}: nothing to do (phase ${reads.phase})`);
      continue;
    }
    const report = runtime.reportFromDon(prepareReportRequest(action.report)).result();
    const reply = evm.writeReport(don, { receiver: pool, report, gasConfig: { gasLimit: runtime.config.gasLimit } }).result();
    summary.push(`${pool}: kind ${action.kind} report written, tx status ${reply.txStatus}`);
  }
  runtime.log(summary.join("; "));
  return summary.join("; ");
};

export const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handlerInTee(cron.trigger({ schedule: config.schedule }), onCronInTee, { tee: "nitro" })];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
```

The only `runtime.log` is the summary, which contains pool addresses, phases and tx statuses, never plaintext. If the SDK's `writeReport` reply type or `getSecret().result().value` shape differ at 1.19.1, adjust to the `.d.ts` (`node_modules/@chainlink/cre-sdk/dist/sdk/runtime.d.ts`, `generated-sdk/.../client_sdk_gen.d.ts`) and record the difference. `main()` at module scope is what `cre-compile` expects; guard it with `if (import.meta.main)` only if bun's test runner otherwise executes it on import (bun sets `import.meta.main` false for imported modules).

- [ ] **Step 3: Compile check and tests**

Run: `cd cre && bun test && bun run compile` (the compile step needs the Javy plugin: `bun x cre-setup` first; if `cre-compile` is unavailable without the CLI, report it and keep `bun test` as the gate; `bunx tsc --noEmit` must pass either way).

- [ ] **Step 4: Commit**

```bash
git add cre/src/lib/report.ts cre/src/main.ts cre/test/report.test.ts cre/test/workflow.test.ts
git commit -m "Add the CRE confidential workflow: close reports and the result with its transcript"
```

---

### Task 5: Prover core: chain reads, state rebuild, witnesses, proofs

**Files:**
- Create: `prover/src/core/chain.ts`, `prover/src/core/key.ts`, `prover/src/core/state.ts`, `prover/src/core/witness.ts`, `prover/src/core/prove.ts`, `prover/src/core/artifacts.ts`
- Test: `prover/test/witness.test.ts`, `prover/test/prove.test.ts`

**Interfaces:**
- `key.ts`: `masterFromSignature(sig)`, `deriveSk` re-exports; `skLimbs(sk): { lo: string; hi: string }` (decimal strings for noir_js).
- `chain.ts`: `readPoolSnapshot(client: PublicClient, pool: Address): Snapshot` where `Snapshot = { phase, m, costs, totalWeight, keySalt, batch, nSealedMax, mMax, pkX, pkY, coordinator, sealedCount, numBatches, checkpoints: bigint[], costsHash, inputsRoot, resultReported, transcriptHash, ingestCursor, stateCommit, ingestedState, transcript: bigint[][] | null, provisional: number[], voters: Voter[] }` — `transcript` from the `Transcript(uint256[])` event log.
- `state.ts`: `rebuild(snapshot, sk): { states: { afterIngest: State[] (one per batch), tallyGroups: { stateIn: State; steps: bigint[][] }[] }, expected: { ingest: bigint[][]; tally: bigint[][] } }` — the full plan of proofs and their public inputs, computed exactly as `reference/tools/noir_inputs.py` and the fixture generator do.
- `witness.ts`: `ingestInputs(profile, snapshot, sk, k, stateBefore, expectedPI): InputMap` and `tallyInputs(profile, snapshot, stateIn, steps, expectedPI): InputMap`, with the field names of the circuits' `main` (`k, n_sealed, m, budget, pk_x, pk_y, h_in, h_out, state_in, state_out, sk_lo, sk_hi, state{…}, entries[{addr, seat_weight, rx, ry, c}]` and `costs_hash, state_in, state_out, done, t_hash_out, funded_count, funded_order_packed, costs, state, steps[{level, pub_support, best, total}]`), every value a decimal string (noir_js accepts strings for `Field`/integers; booleans as booleans).
- `prove.ts`: `class Prover { static async create(profile: "test" | "default", threads?): Prover; async prove(kind: "ingest" | "tally", inputs: InputMap): Promise<{ proof: Uint8Array; publicInputs: `0x${string}`[] }>; async verify(kind, proofData): Promise<boolean>; destroy() }` using `Noir` + `UltraHonkBackend` with `verifierTarget: 'evm'`.
- `artifacts.ts`: loads `noir/artifacts/<profile>/{ingest,tally}.json` (Node: `fs`; browser: `import ... with { type: "json" }` via Vite) and exposes `circuit(kind, profile): CompiledCircuit`.

- [ ] **Step 1: Tests**

```ts
// prover/test/witness.test.ts — the witness maps reproduce the fixture's public inputs
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { toBig } from "@lib/field";
import { PROFILES } from "@lib/commitments";
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
```

```ts
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
  });
  afterAll(async () => {
    await prover.destroy();
  });

  test("ingest batch 0", async () => {
    const plan = rebuildFromFixture(fx);
    const inputs = ingestInputs(plan, 0);
    const { proof, publicInputs } = await prover.prove("ingest", inputs);
    expect(publicInputs.map(toBig)).toEqual(plan.expected.ingest[0]);
    expect(proof.length).toBeGreaterThan(1000);
    expect(await prover.verify("ingest", { proof, publicInputs })).toBe(true);
  });

  test("tally group 0", async () => {
    const plan = rebuildFromFixture(fx);
    const inputs = tallyInputs(plan, 0);
    const { proof, publicInputs } = await prover.prove("tally", inputs);
    expect(publicInputs.map(toBig)).toEqual(plan.expected.tally[0]);
    expect(await prover.verify("tally", { proof, publicInputs })).toBe(true);
  });
});
```

`rebuildFromFixture(fx)` is a convenience wrapper that turns a fixture into a `Snapshot` (using `fx.sk`) and calls `rebuild`, so the same code path serves tests and the chain.

- [ ] **Step 2: Implement**

```ts
// prover/src/core/key.ts
import { hexToBytes, type Hex } from "viem";
import { deriveSk, masterFromSignature, MASTER_MESSAGE } from "@lib/sealed";

export { deriveSk, masterFromSignature, MASTER_MESSAGE };

export function masterFromSignatureHex(sig: Hex): Uint8Array {
  return masterFromSignature(hexToBytes(sig));
}

export function skLimbs(sk: bigint): { lo: string; hi: string } {
  return { lo: (sk & ((1n << 128n) - 1n)).toString(), hi: (sk >> 128n).toString() };
}
```

```ts
// prover/src/core/chain.ts
import { type Address, type PublicClient, parseAbiItem } from "viem";
import abi from "../../../cre/src/abi/SealedRankedShares.json";
import type { Voter } from "@lib/entries";

export type Snapshot = {
  pool: Address;
  phase: number;
  m: number;
  costs: bigint[];
  totalWeight: bigint;
  keySalt: `0x${string}`;
  batch: number;
  nSealedMax: number;
  mMax: number;
  pkX: bigint;
  pkY: bigint;
  coordinator: Address;
  sealedCount: number;
  numBatches: number;
  checkpoints: bigint[];
  costsHash: bigint;
  inputsRoot: `0x${string}`;
  resultReported: boolean;
  transcriptHash: bigint;
  ingestCursor: number;
  stateCommit: bigint;
  ingestedState: bigint;
  transcript: bigint[][] | null;
  provisional: number[];
  voters: Voter[];
};

async function read<T>(client: PublicClient, pool: Address, functionName: string, args: unknown[] = []): Promise<T> {
  return (await client.readContract({ address: pool, abi, functionName, args } as any)) as T;
}

export async function readPoolSnapshot(client: PublicClient, pool: Address, fromBlock = 0n): Promise<Snapshot> {
  const [phase, costs, totalWeight, keySalt, batch, nSealedMax, mMax, pkX, pkY, coordinator, sealedCount, numBatches, costsHash, inputsRoot, resultReported, transcriptHash, ingestCursor, stateCommit, ingestedState, provisional, n] = await Promise.all([
    read<number>(client, pool, "phase"), read<bigint[]>(client, pool, "costs"), read<bigint>(client, pool, "totalWeight"), read<`0x${string}`>(client, pool, "keySalt"),
    read<bigint>(client, pool, "batch"), read<bigint>(client, pool, "nSealedMax"), read<bigint>(client, pool, "mMax"), read<bigint>(client, pool, "tallierPkX"), read<bigint>(client, pool, "tallierPkY"),
    read<Address>(client, pool, "coordinator"), read<bigint>(client, pool, "sealedCount"), read<bigint>(client, pool, "numBatches"), read<bigint>(client, pool, "costsHash"), read<`0x${string}`>(client, pool, "inputsRoot"),
    read<boolean>(client, pool, "resultReported"), read<bigint>(client, pool, "transcriptHash"), read<bigint>(client, pool, "ingestCursor"), read<bigint>(client, pool, "stateCommit"), read<bigint>(client, pool, "ingestedState"),
    read<bigint[]>(client, pool, "provisionalResult"), read<bigint>(client, pool, "voterCount"),
  ]);
  const checkpoints: bigint[] = [];
  for (let k = 0; k <= Number(numBatches); k++) checkpoints.push(await read<bigint>(client, pool, "checkpoint", [BigInt(k)]));
  const voters: Voter[] = [];
  for (let start = 0; start < Number(n); start += 50) {
    const [who, direct, ballots, seats, cts, flags] = await read<[Address[], bigint[], bigint[], bigint[], [bigint, bigint, bigint][], boolean[]]>(client, pool, "votersFrom", [BigInt(start), 50n]);
    who.forEach((a, i) => voters.push({ addr: BigInt(a), directWeight: direct[i], seatWeight: seats[i], hasDirect: flags[i], directPacked: ballots[i], ciphertext: cts[i][0] === 0n ? null : [cts[i][0], cts[i][1], cts[i][2]] }));
  }
  let transcript: bigint[][] | null = null;
  if (resultReported) {
    const logs = await client.getLogs({ address: pool, event: parseAbiItem("event Transcript(uint256[] transcript)"), fromBlock, toBlock: "latest" });
    const flat = (logs[logs.length - 1]!.args as any).transcript as bigint[];
    const width = costs.length + 3;
    transcript = [];
    for (let i = 0; i < flat.length; i += width) transcript.push(flat.slice(i, i + width));
  }
  return {
    pool, phase: Number(phase), m: costs.length, costs, totalWeight, keySalt, batch: Number(batch), nSealedMax: Number(nSealedMax), mMax: Number(mMax), pkX, pkY, coordinator,
    sealedCount: Number(sealedCount), numBatches: Number(numBatches), checkpoints, costsHash, inputsRoot, resultReported, transcriptHash, ingestCursor: Number(ingestCursor), stateCommit, ingestedState,
    transcript, provisional: provisional.map(Number), voters,
  };
}
```

```ts
// prover/src/core/state.ts — the plan of proofs, as reference/tools/noir_inputs.py computes it
import { toBig } from "@lib/field";
import * as cm from "@lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "@lib/entries";
import { pbearTranscript } from "@lib/pbear";
import { pack } from "@lib/sealed";
import type { Snapshot } from "./chain";

export type ProofPlan = {
  profile: cm.Profile;
  snapshot: Pick<Snapshot, "m" | "costs" | "totalWeight" | "pkX" | "pkY" | "checkpoints" | "costsHash" | "voters" | "sealedCount" | "numBatches">;
  sk: bigint;
  sealed: Voter[];
  ingestBefore: cm.State[];        // state before batch k
  ingestAfter: cm.State[];         // state after batch k
  transcript: bigint[][];
  tallyGroups: { stateIn: cm.State; steps: bigint[][]; stateOut: cm.State }[];
  expected: { ingest: bigint[][]; tally: bigint[][] };
};

export function profileFor(nSealedMax: number, mMax: number, batch: number): cm.Profile {
  const p = Object.values(cm.PROFILES).find((x) => x.nSealedMax === nSealedMax && x.mMax === mMax && x.batch === batch);
  if (!p) throw new Error(`no circuit profile for E=${nSealedMax} M=${mMax} B=${batch}`);
  return p;
}

export function rebuild(s: ProofPlan["snapshot"] & { nSealedMax: number; mMax: number; batch: number; transcript?: bigint[][] | null }, sk: bigint): ProofPlan {
  const profile = profileFor(s.nSealedMax, s.mMax, s.batch);
  const sealed = sealedVoters(s.voters);
  const entries = sealedEntries(s.voters, sk, s.m);
  const state = cm.emptyState(profile, s.m, s.totalWeight);
  const ingestBefore: cm.State[] = [];
  const ingestAfter: cm.State[] = [];
  const expectedIngest: bigint[][] = [];
  const numBatches = Math.max(1, Math.ceil(sealed.length / profile.batch));
  for (let k = 0; k < numBatches; k++) {
    ingestBefore.push(cm.cloneState(state));
    for (let j = 0; j < profile.batch; j++) {
      const i = k * profile.batch + j;
      if (i < sealed.length) cm.ingest(state, i, sealed[i].seatWeight, entries[i].ballot === null ? null : pack(entries[i].ballot!));
    }
    ingestAfter.push(cm.cloneState(state));
    expectedIngest.push([BigInt(k), BigInt(sealed.length), BigInt(s.m), s.totalWeight, s.pkX, s.pkY, s.checkpoints[k], s.checkpoints[k + 1], k === 0 ? 0n : cm.stateCommit(profile, ingestBefore[k]), cm.stateCommit(profile, state)]);
  }
  const transcript = s.transcript ?? pbearTranscript(s.costs, publicEntries(s.voters, s.m), entries, s.totalWeight).transcript;
  const tallyGroups: ProofPlan["tallyGroups"] = [];
  const expectedTally: bigint[][] = [];
  let cursor = 0;
  while (!state.done) {
    const stateIn = cm.cloneState(state);
    const steps: bigint[][] = [];
    for (let i = 0; i < profile.k; i++) {
      const step = cursor < transcript.length ? transcript[cursor] : [BigInt(state.level), ...new Array<bigint>(s.m).fill(0n), cm.NONE, 0n];
      steps.push(step);
      const before = state.tHash;
      cm.tallyStep(profile, state, s.costs, step);
      if (state.tHash !== before) cursor++;
    }
    const stateOut = cm.cloneState(state);
    tallyGroups.push({ stateIn, steps, stateOut });
    expectedTally.push([s.costsHash, cm.stateCommit(profile, stateIn), cm.stateCommit(profile, stateOut), state.done ? 1n : 0n, state.tHash, BigInt(state.fundedCount), cm.fundedOrderPacked(state)]);
  }
  return { profile, snapshot: s, sk, sealed, ingestBefore, ingestAfter, transcript, tallyGroups, expected: { ingest: expectedIngest, tally: expectedTally } };
}

export function rebuildFromFixture(fx: any): ProofPlan {
  const voters: Voter[] = fx.voters.map((v: any) => ({ addr: toBig(v.addr), directWeight: toBig(v.directWeight), seatWeight: toBig(v.seatWeight), hasDirect: v.hasDirect, directPacked: toBig(v.directPacked), ciphertext: v.hasSealed ? (v.ciphertext.map(toBig) as [bigint, bigint, bigint]) : null }));
  return rebuild({
    m: fx.m, costs: fx.costs.map(toBig), totalWeight: toBig(fx.totalWeight), pkX: toBig(fx.pk[0]), pkY: toBig(fx.pk[1]), checkpoints: fx.checkpoints.map(toBig), costsHash: toBig(fx.costsHash),
    voters, sealedCount: fx.sealedCount, numBatches: fx.numBatches, nSealedMax: fx.profile.nSealedMax, mMax: fx.profile.mMax, batch: fx.profile.batch, transcript: null,
  }, toBig(fx.sk));
}
```

When the chain has a transcript (`resultReported`), `rebuild` uses it; before the report it computes its own so that ingest proofs can start early and the coordinator can compare the two (B8 step 3).

```ts
// prover/src/core/witness.ts — InputMaps matching the circuits' `main` signatures
import type { InputMap } from "@noir-lang/noir_js";
import type { ProofPlan } from "./state";
import { skLimbs } from "./key";
import type { State } from "@lib/commitments";

const d = (n: bigint | number) => n.toString();

function stateInput(s: State) {
  return {
    weights: s.weights.map(d),
    ballots: s.ballots.map(d),
    funded: s.funded,
    funded_order: s.fundedOrder.map(d),
    funded_count: d(s.fundedCount),
    level: d(s.level),
    spent: d(s.spent),
    done: s.done,
    m: d(s.m),
    budget: d(s.budget),
    t_hash: d(s.tHash),
  };
}

export function ingestInputs(plan: ProofPlan, k: number): InputMap {
  const pi = plan.expected.ingest[k];
  const { lo, hi } = skLimbs(plan.sk);
  const entries = [];
  for (let j = 0; j < plan.profile.batch; j++) {
    const v = plan.sealed[k * plan.profile.batch + j];
    entries.push(v ? { addr: d(v.addr), seat_weight: d(v.seatWeight), rx: d(v.ciphertext![0]), ry: d(v.ciphertext![1]), c: d(v.ciphertext![2]) } : { addr: "0", seat_weight: "0", rx: "0", ry: "0", c: "0" });
  }
  return {
    k: d(pi[0]), n_sealed: d(pi[1]), m: d(pi[2]), budget: d(pi[3]), pk_x: d(pi[4]), pk_y: d(pi[5]), h_in: d(pi[6]), h_out: d(pi[7]), state_in: d(pi[8]), state_out: d(pi[9]),
    sk_lo: lo, sk_hi: hi, state: stateInput(plan.ingestBefore[k]), entries,
  } as unknown as InputMap;
}

export function tallyInputs(plan: ProofPlan, g: number): InputMap {
  const pi = plan.expected.tally[g];
  const group = plan.tallyGroups[g];
  const m = plan.snapshot.m;
  const pad = (arr: bigint[], len: number) => [...arr, ...new Array<bigint>(len - arr.length).fill(0n)].map(d);
  return {
    costs_hash: d(pi[0]), state_in: d(pi[1]), state_out: d(pi[2]), done: d(pi[3]), t_hash_out: d(pi[4]), funded_count: d(pi[5]), funded_order_packed: d(pi[6]),
    costs: pad(plan.snapshot.costs, plan.profile.mMax),
    state: stateInput(group.stateIn),
    steps: group.steps.map((step) => ({ level: d(step[0]), pub_support: pad(step.slice(1, m + 1), plan.profile.mMax), best: d(step[m + 1]), total: d(step[m + 2]) })),
  } as unknown as InputMap;
}
```

```ts
// prover/src/core/prove.ts
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { circuit } from "./artifacts";

export type Kind = "ingest" | "tally";
export type ProofOut = { proof: Uint8Array; publicInputs: `0x${string}`[] };

export class Prover {
  private constructor(private api: Barretenberg, private noirs: Record<Kind, Noir>, private backends: Record<Kind, UltraHonkBackend>) {}

  static async create(profile: "test" | "default", threads = 1): Promise<Prover> {
    const api = await Barretenberg.new({ threads });
    const circuits: Record<Kind, CompiledCircuit> = { ingest: circuit("ingest", profile), tally: circuit("tally", profile) };
    const noirs = { ingest: new Noir(circuits.ingest), tally: new Noir(circuits.tally) };
    const backends = { ingest: new UltraHonkBackend(circuits.ingest.bytecode, api), tally: new UltraHonkBackend(circuits.tally.bytecode, api) };
    return new Prover(api, noirs, backends);
  }

  async prove(kind: Kind, inputs: InputMap): Promise<ProofOut> {
    const { witness } = await this.noirs[kind].execute(inputs);
    const { proof, publicInputs } = await this.backends[kind].generateProof(witness, { verifierTarget: "evm" });
    return { proof, publicInputs: publicInputs.map((p) => (p.startsWith("0x") ? p : `0x${p}`) as `0x${string}`) };
  }

  async verify(kind: Kind, out: ProofOut): Promise<boolean> {
    return this.backends[kind].verifyProof({ proof: out.proof, publicInputs: out.publicInputs }, { verifierTarget: "evm" });
  }

  async destroy() {
    await this.api.destroy();
  }
}
```

```ts
// prover/src/core/artifacts.ts
import type { CompiledCircuit } from "@noir-lang/noir_js";
import ingestTest from "../../../noir/artifacts/test/ingest.json";
import tallyTest from "../../../noir/artifacts/test/tally.json";
import ingestDefault from "../../../noir/artifacts/default/ingest.json";
import tallyDefault from "../../../noir/artifacts/default/tally.json";

const table = { test: { ingest: ingestTest, tally: tallyTest }, default: { ingest: ingestDefault, tally: tallyDefault } } as const;

export function circuit(kind: "ingest" | "tally", profile: "test" | "default"): CompiledCircuit {
  return table[profile][kind] as unknown as CompiledCircuit;
}
```

`tsconfig.json` needs `"resolveJsonModule": true`; Vite handles JSON imports in the browser. `noir_js` `execute` fails with a descriptive error when an `assert` in the circuit is violated: that is how a wrong witness shows up in tests.

Run: `cd prover && npm test -- witness` then `npm test -- prove` — expected: all four fixtures rebuild to the exact public inputs; the two real proofs verify. Proving the `test` profile takes seconds; record the wall time.

- [ ] **Step 3: Commit**

```bash
git add prover/src/core prover/test/witness.test.ts prover/test/prove.test.ts prover/tsconfig.json
git commit -m "Add the prover core: chain snapshot, state rebuild, witnesses and bb.js proofs"
```

---

### Task 6: Submit, audit, CLI, and the anvil end-to-end test

**Files:**
- Create: `prover/src/core/submit.ts`, `prover/src/core/audit.ts`, `prover/src/cli/index.ts`, `prover/scripts/e2e-anvil.sh`, `prover/test/e2e.test.ts`
- Modify: `README.md`

**Interfaces:**
- `submit.ts`: `async function runChain(client: PublicClient, wallet: WalletClient, plan: ProofPlan, snapshot: Snapshot, prover: Prover, log: (s: string) => void, opts?: { restart?: boolean })`: resumes from `snapshot.ingestCursor` / `stateCommit`; for each remaining ingest batch and tally group, proves and sends `advance(proof, publicInputs, restart)`; waits for the receipt; re-reads `stateCommit` after each; stops when `finality` is `Proven`. `restart` is passed only on the first tally group when the on-chain `stateCommit` is neither `ingestedState` nor any expected `stateOut` (the chain was left mid-way by a different transcript).
- `audit.ts`: `async function audit(client, pool, fromBlock): Promise<{ ok: boolean; firstProblem?: string }>` using `replayPublic` on the on-chain transcript and public entries.
- CLI: `prover audit --rpc <url> --pool <addr> [--from-block n]`, `prover status --rpc --pool`, `prover prove --rpc --pool --private-key <hex> [--master <hex> | --sign] [--threads n]` (`--sign` derives the master secret by signing `MASTER_MESSAGE` with the private key, as the browser will with the wallet).

- [ ] **Step 1: The end-to-end test**

```bash
#!/usr/bin/env bash
# prover/scripts/e2e-anvil.sh — start anvil, deploy the test-profile stack, replay the
# test_main fixture and report through an impersonated forwarder. Prints a JSON with
# the addresses the e2e test needs. Requires forge, anvil, and plan-3 verifiers.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8547}"
anvil --port "$PORT" --silent --code-size-limit 100000 &
ANVIL=$!
trap 'kill $ANVIL' EXIT
sleep 2
export RPC="http://127.0.0.1:$PORT"
forge script script/E2EFixture.s.sol --rpc-url "$RPC" --broadcast -q \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96a2f0e40e --sig "run(string)" test_main \
  --json > /tmp/claude-1000/e2e-fixture.json 2>/dev/null || forge script script/E2EFixture.s.sol --rpc-url "$RPC" --broadcast --sig "run(string)" test_main
wait $ANVIL
```

The script above is a sketch of the orchestration; the deliverable is the pair below, which is what the test actually drives:

```solidity
// script/E2EFixture.s.sol — deploy the test-profile stack on a local chain and replay a fixture
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FixtureLoader} from "../test/sealed/FixtureLoader.sol";
import {IHonkVerifier} from "../src/interfaces/IHonkVerifier.sol";
import {IngestVerifierTest} from "../test/verifiers/IngestVerifierTest.sol";
import {TallyVerifierTest} from "../test/verifiers/TallyVerifierTest.sol";

/// Reuses the fixture loader as a script: deploys token, Poseidon2, the two test-profile
/// verifiers and the pool; replays the voters; closes; and prints the addresses. The
/// forwarder and coordinator are anvil's default accounts 1 and 2 so the TypeScript e2e
/// test can act as them.
contract E2EFixture is Script, FixtureLoader {
    function makeVerifiers() internal override returns (IHonkVerifier, IHonkVerifier) {
        return (IHonkVerifier(address(new IngestVerifierTest())), IHonkVerifier(address(new TallyVerifierTest())));
    }

    function run(string memory fixture) external {
        forwarder = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        coordinator = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
        loadFixture(fixture);
        vm.startBroadcast();
        deployFromFixtureBroadcast();
        replayVotersBroadcast();
        vm.stopBroadcast();
        console.log("POOL", address(pool));
        console.log("TOKEN", address(token));
        console.log("INPUTS_ROOT", vm.toString(fxBytes32(".inputsRoot")));
    }
}
```

`FixtureLoader` uses `vm.prank` for every voter, which does not work under `vm.startBroadcast` (broadcast sends from the script's key). Add to `FixtureLoader` two broadcast variants, `deployFromFixtureBroadcast()` and `replayVotersBroadcast()`, that instead fund each voter address with ETH (`vm.deal` is unavailable on a live chain: use `payable(a).transfer(1 ether)` from the broadcaster) and drive each voter's calls with `vm.startBroadcast(uint256 privateKey)` for deterministic keys derived as `uint256(keccak256(abi.encode("e2e", a)))` whose addresses replace the fixture addresses — **no**: the fixture addresses are fixed and the chains depend on them. The workable path is `anvil_impersonateAccount`: the script runs against anvil with `vm.rpc("anvil_impersonateAccount", ...)` unsupported in forge scripts, so do the replay from TypeScript instead:

Replace the Solidity script with a TypeScript replay in the e2e test itself (viem + anvil's `anvil_impersonateAccount` and `anvil_setBalance`), which is simpler and keeps `FixtureLoader` untouched:

```ts
// prover/test/e2e.test.ts
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, type Address, type Hex, encodeAbiParameters, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { encodeResultReport } from "@lib/report";
import { readPoolSnapshot } from "../src/core/chain";
import { rebuild } from "../src/core/state";
import { Prover } from "../src/core/prove";
import { runChain } from "../src/core/submit";
import { audit } from "../src/core/audit";

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const DEPLOYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96a2f0e40e");
const FORWARDER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const COORDINATOR = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"); // anvil account 2
const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/fixture_test_main.json", import.meta.url), "utf8"));
const artifact = (name: string) => JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
const poolAbi = JSON.parse(readFileSync(new URL("../../cre/src/abi/SealedRankedShares.json", import.meta.url), "utf8"));

let anvil: ChildProcess;
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
const deployer = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(RPC) });

async function deploy(name: string, args: unknown[] = [], abi?: any): Promise<Address> {
  const a = artifact(name);
  const hash = await deployer.deployContract({ abi: abi ?? a.abi, bytecode: a.bytecode.object as Hex, args } as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

describe("end to end on anvil with real verifiers", () => {
  beforeAll(async () => {
    execFileSync("forge", ["build", "-q"], { cwd: new URL("../..", import.meta.url).pathname });
    anvil = spawn("anvil", ["--port", String(PORT), "--silent", "--code-size-limit", "100000"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 2000));
  });
  afterAll(() => anvil.kill());

  test("replay test_main, report, prove, Proven, audit", async () => {
    const token = await deploy("MockERC20");
    const poseidon = await deploy("Poseidon2");
    const ingestV = await deploy("IngestVerifierTest");
    const tallyV = await deploy("TallyVerifierTest");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const cfg = {
      forwarder: FORWARDER, coordinator: COORDINATOR.address, poseidon, ingestVerifier: ingestV, tallyVerifier: tallyV,
      tallierPkX: toBig(fx.pk[0]), tallierPkY: toBig(fx.pk[1]), keySalt: fx.keySalt, nSealedMax: BigInt(fx.profile.nSealedMax), mMax: BigInt(fx.profile.mMax), batch: BigInt(fx.profile.batch),
      minDirectVote: toBig(fx.minDirectVote), minSealedVote: 1n, proofGrace: 86400n, abandonGrace: 604800n,
    };
    const pool = await deploy("SealedRankedShares", [token, DEPLOYER.address, deadline, cfg], poolAbi);
    const erc20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
    const w = (account: any) => createWalletClient({ account, chain: foundry, transport: http(RPC) });
    const send = async (account: Address | any, fn: () => Promise<Hex>) => pub.waitForTransactionReceipt({ hash: await fn() });

    // projects and opening
    for (const c of fx.costs) await send(DEPLOYER, () => deployer.writeContract({ address: pool, abi: poolAbi, functionName: "addProject", args: [toBig(c), DEPLOYER.address] }));
    await send(DEPLOYER, () => deployer.writeContract({ address: pool, abi: poolAbi, functionName: "openVoting" }));

    // voters, impersonated
    const org: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // anvil account 3
    await testClient.impersonateAccount({ address: org });
    await deployer.writeContract({ address: token, abi: erc20, functionName: "mint", args: [org, 1n << 62n] });
    let granted = 0n;
    for (const v of fx.voters) {
      const a = v.addr as Address;
      await testClient.impersonateAccount({ address: a });
      await testClient.setBalance({ address: a, value: 10n ** 18n });
      const direct = toBig(v.directWeight);
      const seat = toBig(v.seatWeight);
      if (direct > 0n) {
        await send(a, () => deployer.writeContract({ address: token, abi: erc20, functionName: "mint", args: [a, direct] }));
        await send(a, () => w(a).writeContract({ address: token, abi: erc20, functionName: "approve", args: [pool, direct] }));
        await send(a, () => w(a).writeContract({ address: pool, abi: poolAbi, functionName: "contribute", args: [direct] }));
      }
      if (seat > 0n) {
        await send(org, () => w(org).writeContract({ address: token, abi: erc20, functionName: "approve", args: [pool, seat] }));
        await send(org, () => w(org).writeContract({ address: pool, abi: poolAbi, functionName: "sponsor", args: [seat, [a]] }));
      }
      if (v.hasDirect) await send(a, () => w(a).writeContract({ address: pool, abi: poolAbi, functionName: "vote", args: [toHex(Uint8Array.from(v.directRanks))] }));
      granted += direct + seat;
    }
    for (const v of fx.voters) {
      if (!v.hasSealed) continue;
      const a = v.addr as Address;
      await send(a, () => w(a).writeContract({ address: pool, abi: poolAbi, functionName: "voteSealed", args: v.ciphertext.map(toBig) }));
    }
    const dust = toBig(fx.totalWeight) - granted;
    if (dust > 0n) {
      const nft = await deploy("MockERC721");
      await send(org, () => w(org).writeContract({ address: token, abi: erc20, functionName: "approve", args: [pool, dust] }));
      await send(org, () => w(org).writeContract({ address: pool, abi: poolAbi, functionName: "sponsorNFT", args: [dust, nft, dust] }));
    }

    // close
    await testClient.setNextBlockTimestamp({ timestamp: deadline });
    await testClient.mine({ blocks: 1 });
    while (!(await pub.readContract({ address: pool, abi: poolAbi, functionName: "closed" }))) {
      await send(DEPLOYER, () => deployer.writeContract({ address: pool, abi: poolAbi, functionName: "close", args: [25n] }));
    }
    expect(await pub.readContract({ address: pool, abi: poolAbi, functionName: "inputsRoot" })).toBe(fx.inputsRoot);

    // the DON's report, from the forwarder
    await testClient.impersonateAccount({ address: FORWARDER });
    await testClient.setBalance({ address: FORWARDER, value: 10n ** 18n });
    const report = encodeResultReport(fx.inputsRoot, fx.funded, fx.transcript.map((s: number[]) => s.map(BigInt)));
    await send(FORWARDER, () => w(FORWARDER).writeContract({ address: pool, abi: poolAbi, functionName: "onReport", args: ["0x", report] }));

    // audit before proving
    expect((await audit(pub, pool, 0n)).ok).toBe(true);

    // prove and submit as the coordinator
    await testClient.setBalance({ address: COORDINATOR.address, value: 10n ** 18n });
    const snapshot = await readPoolSnapshot(pub, pool, 0n);
    const plan = rebuild(snapshot, toBig(fx.sk));
    const prover = await Prover.create("test", 4);
    try {
      await runChain(pub, w(COORDINATOR), plan, snapshot, prover, () => {});
    } finally {
      await prover.destroy();
    }
    expect(Number(await pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(1); // Proven
    const funded = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "fundedProjects" })) as bigint[];
    expect(funded.map(Number)).toEqual(fx.funded);
  }, 600_000);
});
```

Keep the `E2EFixture.s.sol` idea out: the TypeScript replay above is the deliverable; do not create the Solidity script. `--code-size-limit 100000` on anvil is only a safety margin; the verifiers are 15–16 KB. The `send` helper waits for each receipt so anvil mines deterministically; `deployer.writeContract` is used to mint because `MockERC20.mint` is permissionless.

- [ ] **Step 2: Implement `submit.ts`, `audit.ts`, the CLI**

```ts
// prover/src/core/submit.ts
import type { Address, PublicClient, WalletClient } from "viem";
import abi from "../../../cre/src/abi/SealedRankedShares.json";
import { stateCommit } from "@lib/commitments";
import type { Snapshot } from "./chain";
import type { ProofPlan } from "./state";
import { ingestInputs, tallyInputs } from "./witness";
import type { Prover } from "./prove";

export async function runChain(client: PublicClient, wallet: WalletClient, plan: ProofPlan, snapshot: Snapshot, prover: Prover, log: (s: string) => void): Promise<void> {
  const pool = snapshot.pool as Address;
  const read = async <T,>(fn: string, args: unknown[] = []) => (await client.readContract({ address: pool, abi, functionName: fn, args } as any)) as T;
  const advance = async (proof: Uint8Array, pi: `0x${string}`[], restart: boolean) => {
    const hash = await wallet.writeContract({ address: pool, abi, functionName: "advance", args: [`0x${Buffer.from(proof).toString("hex")}`, pi, restart], account: wallet.account!, chain: wallet.chain } as any);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`advance reverted: ${hash}`);
    return receipt;
  };
  let cursor = Number(await read<bigint>("ingestCursor"));
  for (let k = cursor; k < plan.expected.ingest.length; k++) {
    log(`proving ingest batch ${k}`);
    const out = await prover.prove("ingest", ingestInputs(plan, k));
    const r = await advance(out.proof, out.publicInputs, false);
    log(`ingest ${k} accepted, gas ${r.gasUsed}`);
  }
  if (!(await read<boolean>("resultReported"))) {
    log("transcript not reported yet; stopping after ingest");
    return;
  }
  // find where the chain stands among our expected tally states
  let onChain = await read<bigint>("stateCommit");
  let g = plan.tallyGroups.findIndex((grp) => stateCommit(plan.profile, grp.stateIn) === onChain);
  let restart = false;
  if (g < 0) {
    log("on-chain tally state does not match this transcript; restarting from the ingested state");
    g = 0;
    restart = true;
  }
  for (; g < plan.tallyGroups.length; g++) {
    log(`proving tally group ${g}`);
    const out = await prover.prove("tally", tallyInputs(plan, g));
    const r = await advance(out.proof, out.publicInputs, restart);
    restart = false;
    log(`tally ${g} accepted, gas ${r.gasUsed}`);
  }
  const finality = Number(await read<bigint>("finality"));
  log(finality === 1 ? "Proven" : `finality ${finality}`);
}
```

```ts
// prover/src/core/audit.ts
import type { Address, PublicClient } from "viem";
import { publicEntries } from "@lib/entries";
import { replayPublic } from "@lib/pbear";
import { readPoolSnapshot } from "./chain";

export async function audit(client: PublicClient, pool: Address, fromBlock = 0n): Promise<{ ok: boolean; firstProblem?: string }> {
  const s = await readPoolSnapshot(client, pool, fromBlock);
  if (!s.resultReported || !s.transcript) return { ok: false, firstProblem: "no transcript reported yet" };
  const ok = replayPublic(s.costs, publicEntries(s.voters, s.m), s.transcript, s.totalWeight);
  if (!ok) return { ok, firstProblem: "the public block does not reproduce the reported transcript" };
  const funded = s.transcript.map((st) => st[s.m + 1]).filter((b) => b !== (1n << 64n) - 1n).map(Number);
  if (funded.join(",") !== s.provisional.join(",")) return { ok: false, firstProblem: "funded set differs from the transcript" };
  return { ok: true };
}
```

```ts
// prover/src/cli/index.ts
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toBig } from "@lib/field";
import { deriveSk, MASTER_MESSAGE } from "@lib/sealed";
import { readPoolSnapshot } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { audit } from "../core/audit";
import { masterFromSignatureHex } from "../core/key";
import { hexToBytes } from "viem";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) {
    if (def !== undefined) return def;
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  const client = createPublicClient({ transport: http(arg("rpc")) });
  const pool = arg("pool") as Address;
  const fromBlock = BigInt(arg("from-block", "0"));
  if (cmd === "audit") {
    const r = await audit(client, pool, fromBlock);
    console.log(r.ok ? "audit ok: the public block reproduces the reported transcript" : `audit FAILED: ${r.firstProblem}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === "status") {
    const s = await readPoolSnapshot(client, pool, fromBlock);
    console.log(JSON.stringify({ phase: s.phase, resultReported: s.resultReported, ingestCursor: s.ingestCursor, numBatches: s.numBatches, stateCommit: s.stateCommit.toString(16) }, null, 2));
    return;
  }
  if (cmd === "prove") {
    const account = privateKeyToAccount(arg("private-key") as Hex);
    const wallet = createWalletClient({ account, transport: http(arg("rpc")) });
    const s = await readPoolSnapshot(client, pool, fromBlock);
    if (s.coordinator.toLowerCase() !== account.address.toLowerCase()) console.warn("warning: this key is not the pool's coordinator; restarts would be rejected");
    const master = process.argv.includes("--sign") ? masterFromSignatureHex(await wallet.signMessage({ account, message: MASTER_MESSAGE })) : hexToBytes(arg("master") as Hex);
    const sk = deriveSk(master, hexToBytes(s.keySalt));
    const plan = rebuild(s, sk);
    if (plan.snapshot.pkX !== s.pkX) throw new Error("derived key does not match the pool's tallier key");
    const prover = await Prover.create(s.nSealedMax === 8 ? "test" : "default", Number(arg("threads", "4")));
    try {
      await runChain(client, wallet, plan, s, prover, (m) => console.log(m));
    } finally {
      await prover.destroy();
    }
    return;
  }
  console.log("usage: prover <audit|status|prove> --rpc <url> --pool <addr> [--from-block n] [--private-key 0x… (--master 0x… | --sign)] [--threads n]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`rebuild` should also verify the derived key against the pool: add `if (pubkey(sk).x !== s.pkX || pubkey(sk).y !== s.pkY) throw new Error("tallier key mismatch")` at its start (import `pubkey` from `@lib/grumpkin`), and drop the redundant check in the CLI.

Run: `cd prover && npm test` — expected: witness, prove and e2e tests pass (the e2e takes a minute or two: it proves 3 ingest and 3 tally groups of the test profile and submits 6 `advance` transactions). Then `npx tsx src/cli/index.ts audit --rpc http://127.0.0.1:8547 --pool <addr>` against a still-running anvil (start one by hand with the same steps, or add a `--keep` flag to the e2e that prints the pool address and leaves anvil up) to demo the CLI.

- [ ] **Step 3: Commit**

```bash
git add prover/src/core/submit.ts prover/src/core/audit.ts prover/src/cli prover/test/e2e.test.ts
git commit -m "Add proof submission, the public audit, the prover CLI and an anvil end-to-end test"
```

---

### Task 7: The coordinator page

**Files:**
- Create: `prover/src/web/index.html`, `prover/src/web/main.ts`, `prover/src/web/style.css`
- Modify: `prover/src/core/artifacts.ts` if the browser build needs `?url` imports for large JSON (Vite inlines JSON imports; the default ACIR is a few hundred KB, acceptable)

**Interfaces:**
- A single page: RPC URL and pool address inputs, "Connect wallet" (injected `window.ethereum` through viem's `custom` transport), "Sign for tallier key", status panel (phase, cursor, reported, `profileId` check), "Audit", "Prove and submit" (runs `runChain` with a progress log), and a warning when the connected account is not the coordinator.

- [ ] **Step 1: Page**

```html
<!-- prover/src/web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RankedShares coordinator</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main>
      <h1>RankedShares coordinator</h1>
      <label>RPC URL <input id="rpc" placeholder="Arc testnet RPC URL (chain id 5042002)" /></label>
      <label>Pool <input id="pool" placeholder="0x…" /></label>
      <div class="row">
        <button id="connect">Connect wallet</button>
        <button id="sign" disabled>Sign for tallier key</button>
        <button id="refresh">Refresh status</button>
        <button id="audit">Audit</button>
        <button id="prove" disabled>Prove and submit</button>
      </div>
      <pre id="status"></pre>
      <pre id="log"></pre>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

```ts
// prover/src/web/main.ts
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from "viem";
import { deriveSk, MASTER_MESSAGE } from "@lib/sealed";
import { pubkey } from "@lib/grumpkin";
import { hexToBytes } from "viem";
import { readPoolSnapshot } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { audit } from "../core/audit";
import { masterFromSignatureHex } from "../core/key";

const $ = (id: string) => document.getElementById(id)!;
const log = (m: string) => (($("log") as HTMLPreElement).textContent += m + "\n");
let account: Address | undefined;
let master: Uint8Array | undefined;

function clients() {
  const rpc = ($("rpc") as HTMLInputElement).value;
  const pub = createPublicClient({ transport: http(rpc) });
  const eth = (window as any).ethereum;
  const wallet = eth ? createWalletClient({ transport: custom(eth) }) : undefined;
  return { pub, wallet };
}

$("connect").onclick = async () => {
  const { wallet } = clients();
  if (!wallet) return log("no injected wallet found");
  [account] = await wallet.requestAddresses();
  log(`connected ${account}`);
  ($("sign") as HTMLButtonElement).disabled = false;
};

$("sign").onclick = async () => {
  const { wallet } = clients();
  const sig = (await wallet!.signMessage({ account: account!, message: MASTER_MESSAGE })) as Hex;
  master = masterFromSignatureHex(sig);
  log("tallier master secret derived from your signature (kept in memory only)");
  ($("prove") as HTMLButtonElement).disabled = false;
};

$("refresh").onclick = async () => {
  const { pub } = clients();
  const s = await readPoolSnapshot(pub, ($("pool") as HTMLInputElement).value as Address);
  ($("status") as HTMLPreElement).textContent = JSON.stringify(
    { phase: s.phase, resultReported: s.resultReported, ingestCursor: s.ingestCursor, numBatches: s.numBatches, tallyGroupsLeft: "run prove to compute", coordinator: s.coordinator, youAreCoordinator: account?.toLowerCase() === s.coordinator.toLowerCase() },
    null,
    2,
  );
};

$("audit").onclick = async () => {
  const { pub } = clients();
  const r = await audit(pub, ($("pool") as HTMLInputElement).value as Address);
  log(r.ok ? "audit ok" : `audit FAILED: ${r.firstProblem}`);
};

$("prove").onclick = async () => {
  const { pub, wallet } = clients();
  const pool = ($("pool") as HTMLInputElement).value as Address;
  const s = await readPoolSnapshot(pub, pool);
  const sk = deriveSk(master!, hexToBytes(s.keySalt));
  const pk = pubkey(sk);
  if (pk.x !== s.pkX || pk.y !== s.pkY) return log("this wallet is not the tallier of this pool");
  if (account!.toLowerCase() !== s.coordinator.toLowerCase()) log("warning: not the coordinator; a restart would be rejected");
  const plan = rebuild(s, sk);
  log(`${plan.expected.ingest.length} ingest batches, ${plan.tallyGroups.length} tally groups`);
  const prover = await Prover.create(s.nSealedMax === 8 ? "test" : "default", navigator.hardwareConcurrency ?? 4);
  try {
    await runChain(pub, wallet!, plan, s, prover, log);
  } finally {
    await prover.destroy();
  }
};
```

`style.css`: a readable single-column layout (system font, 720 px max width, monospace `pre` blocks with a border). `runChain` uses `wallet.writeContract` with `account`/`chain`: pass `account` explicitly in the browser (`{ ..., account }`); make `runChain` accept an optional `account` and thread it into `writeContract`.

- [ ] **Step 2: Build and smoke test**

Run: `cd prover && npm run build` — expected: `dist/` with the page and the bb.js/noir_js WASM assets. Serve with `npm run preview` (COOP/COEP headers set) and, in a browser with a wallet against the anvil chain of the e2e test (keep anvil running; import the coordinator key `0x5de4…365a` into the wallet), click through Connect → Sign → Refresh → Audit → Prove. Record the wall time of the first tally proof in the browser in the report; this is spike B12.1's browser measurement. If the machine has no browser available, document the exact manual steps in the README and state in the report that the browser run was not performed.

- [ ] **Step 3: Commit**

```bash
git add prover/src/web prover/src/core/submit.ts
git commit -m "Add the coordinator page: connect, sign, audit, prove and submit in the browser"
```

---

### Task 7b: The prove service (home-box deployment)

The user decided on 2026-09-05 (in a parallel session, before choosing Noir) that the operator's home desktop runs the prover as a long-running, permissionless "prove this pool" API rather than relying on a browser session. The Noir prover core makes that cheap: the service holds the master secret (from `RANKED_SHARES_MASTER` or derived once from a private key with `--sign`), derives each pool's key from its `keySalt`, and runs `runChain` per job. Proof bytes and public inputs reveal nothing beyond the public inputs, and `advance` is permissionless except for `restart`, so the service can either submit itself (with the coordinator key) or hand proofs back to whoever asked.

**Files:**
- Create: `prover/src/service/index.ts`, `prover/test/service.test.ts`

**Interfaces:**
- `prover serve --rpc <url> --port 8787 [--private-key 0x…] [--master 0x… | --sign] [--submit]`: Node HTTP server (no framework; `node:http`).
  - `POST /prove` body `{ "pool": "0x…" }` → `202 { "job": "<id>" }`; one job per pool at a time (a second request for a running pool returns its id); jobs cached by `inputsRoot` so a finished pool is not re-proven.
  - `GET /jobs/<id>` → `{ status: "queued" | "running" | "done" | "failed", pool, log: string[], proofs?: { kind, index, proof: 0x…, publicInputs: 0x…[] }[], finality?, error? }`.
  - `GET /health` → `{ ok: true, coordinator, submits: boolean }`.
  - With `--submit` the service sends `advance` itself (its key must be the coordinator for restarts); without it, it only produces and returns the proofs and the caller submits them.
- Internals: an in-memory queue (`Map<jobId, Job>`), one worker loop, `Prover.create(profile, threads = os.availableParallelism() - 1)` created once per profile and reused; a `runChain` variant that accepts an `onProof` callback instead of submitting, shared with the CLI.

- [ ] **Step 1: Test**

`prover/test/service.test.ts`: start the service in-process against the anvil chain of the e2e test (factor the e2e setup into a shared `prover/test/helpers/anvil.ts` that returns `{ pool, rpc, ... }` after replay, close and report), `POST /prove`, poll `GET /jobs/<id>` until `done`, assert the job carries `3 + 3` proofs whose `publicInputs` equal the fixture's `ingestProofs`/`tallyProofs` values, then submit them through `advance` from the test with the coordinator key and assert `Proven`. A second `POST /prove` for the same pool returns the cached job.

- [ ] **Step 2: Implement** the server over `node:http` with JSON bodies, the queue, the cache and the `--submit` mode, and add `serve` to `prover/src/cli/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add prover/src/service prover/test/service.test.ts prover/test/helpers prover/src/cli/index.ts
git commit -m "Add the prove service: a permissionless prove-this-pool API for the home box"
```

Deployment notes for the README (Task 8): run under a user systemd unit on the home machine, expose through a Cloudflare Tunnel or Tailscale Funnel rather than an open port, keep `/tmp` (a 16 GB tmpfs there) out of the proving path by setting `TMPDIR` to a disk directory, and size `--threads` to leave two cores free (the machine has 16 threads and 30 GiB).

---

### Task 8: Simulation, secrets, README

**Files:**
- Create: `cre/scripts/make-master-secret.mjs`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (B12.1, B12.4, B12.5 outcomes)

- [ ] **Step 1: Master secret without a file**

```js
// cre/scripts/make-master-secret.mjs — print the master secret derived from a wallet signature
// Usage: PRIVATE_KEY=0x… node scripts/make-master-secret.mjs | (read s; RANKED_SHARES_MASTER=$s cre secrets create workflows/sealed/secrets.yaml --target staging-settings)
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const sig = await account.signMessage({ message: "RankedShares tallier master secret v1" });
process.stdout.write(keccak256(sig) + "\n");
```

Document in the README that the same value is what the coordinator page derives from the same wallet, and that the pool's `tallierPkX/Y` for `DeploySealed` come from `deriveSk(master, keySalt)` (add `--print-pk --key-salt 0x…` to the script: derive `sk` and print `pubkey(sk)` using the `cre/src/lib` modules, so deployment and workflow agree by construction).

- [ ] **Step 2: Simulation (manual, documented)**

If the CRE CLI is installed and logged in: `cd cre/workflows/sealed && cre workflow simulate --target staging-settings --config config.staging.json ../../src/main.ts` against a pool on Arc testnet deployed with `DeployVerifiers` + `DeploySealed --profile test`, with `RANKED_SHARES_MASTER` in the simulation secrets. Record in the README whether the TEE handler ran in simulation and what it wrote. If the CLI cannot be run here, write the README section from the documented commands and say so in the report.

- [ ] **Step 3: README**

Add a "Off-chain: CRE workflow and prover" section: what each package does, `bun test` / `npm test`, the e2e test, the CLI commands, the page and its COOP/COEP requirement, the secrets flow, the `--sign` derivation, and the browser proving time measured in Task 7. Update the spec's B12.1 (browser measurement), B12.4 (report size and gas observed on anvil: the e2e's `onReport` receipt gas) and B12.5 (pure-TS crypto under bun; QuickJS run only if simulation happened).

- [ ] **Step 4: Commit**

```bash
git add cre/scripts/make-master-secret.mjs README.md docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md
git commit -m "Document the off-chain stack: secrets, simulation, prover and audit"
```

---

### Verification (end to end)

```
cd cre && bun test && bunx tsc --noEmit
cd prover && npm test && npm run build
python3 -W error -m unittest discover reference
forge test -q
```

What remains manual: the CRE simulation against Arc testnet (needs the CLI and an account), the browser run of the coordinator page, and the Arc gas price measurement (B12.7: `cast gas-price --rpc-url https://rpc.testnet.arc.network`).
