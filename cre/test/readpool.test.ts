// cre/test/readpool.test.ts — readPool (ABI decode, paging, the Closing early return)
// against the CRE SDK's own EVMClient test double, not a structural fake: the SDK ships
// `newTestRuntime` + `EvmMock`/`addContractMock` (@chainlink/cre-sdk/test) which decode
// calldata and re-encode results with viem exactly the way the real EVMClient does, so
// this exercises the same `evm.callContract(runtime, ...).result()` path `readPool` uses.
import { describe, expect } from "bun:test";
import { addContractMock, EvmMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { cre } from "@chainlink/cre-sdk";
import { erc20Abi, type Address, type Hex, encodeAbiParameters, keccak256, toHex } from "viem";
// The CRE SDK types every `node:fs` export as `never` (WASM guardrail), so the fixture
// comes in as a JSON import, like the other vector tests.
import fixture from "../../reference/vectors/noir/fixture_test_main.json";
import poolAbi from "../src/abi/NoirRankedShares.json";
import { toBig } from "../src/lib/field";
import { readPool } from "../src/workflow";
import { processPool } from "../src/workflow";

const fx = fixture as any;
const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

const POOL: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x2222222222222222222222222222222222222222";
const CHAIN_SELECTOR = 909606746561742123n; // arbitrary; only has to agree between EvmMock.testInstance and EVMClient
const CLOSE_CHUNK = 25;

/** A fresh runtime + EVMClient wired to a fresh EvmMock, per test. */
function setup() {
  const runtime = newTestRuntime<never>();
  const evmMock = EvmMock.testInstance(CHAIN_SELECTOR);
  const evm = new cre.capabilities.EVMClient(CHAIN_SELECTOR);
  const pool = addContractMock(evmMock, { address: POOL, abi: poolAbi as any });
  return { runtime, evm, evmMock, pool };
}

/** Registers every Tally-phase getter from the fixture, honouring `votersFrom`'s `count`
 * (rather than assuming the module-private `VOTER_PAGE`), so a page smaller than the
 * voter count still assembles correctly. */
function mockTally(pool: ReturnType<typeof setup>["pool"], voters: any[] = fx.voters): { votersFromCalls: [number, number][] } {
  const votersFromCalls: [number, number][] = [];
  pool.phase = () => 3n;
  pool.resultReported = () => false;
  pool.costs = () => fx.costs.map(toBig);
  pool.totalWeight = () => toBig(fx.totalWeight);
  pool.keySalt = () => fx.keySalt;
  pool.inputsRoot = () => fx.inputsRoot;
  pool.batch = () => BigInt(fx.profile.batch);
  pool.voterCount = () => BigInt(voters.length);
  pool.votersFrom = (...args: readonly unknown[]) => {
    const start = Number(args[0] as bigint);
    const count = Number(args[1] as bigint);
    votersFromCalls.push([start, count]);
    const page = voters.slice(start, start + count);
    return [
      page.map((v: any) => v.addr),
      page.map((v: any) => toBig(v.directWeight)),
      page.map((v: any) => toBig(v.directPacked)),
      page.map((v: any) => toBig(v.seatWeight)),
      page.map((v: any) => (v.hasSealed ? v.ciphertext.map(toBig) : [0n, 0n, 0n])),
      page.map((v: any) => v.hasDirect),
    ];
  };
  return { votersFromCalls };
}

function expectedVoters(voters: any[] = fx.voters) {
  return voters.map((v: any) => ({
    addr: toBig(v.addr),
    directWeight: toBig(v.directWeight),
    seatWeight: toBig(v.seatWeight),
    hasDirect: v.hasDirect,
    directPacked: toBig(v.directPacked),
    ciphertext: v.hasSealed ? v.ciphertext.map(toBig) : null,
  }));
}

describe("readPool", () => {
  test("Arkiv references reconstruct exactly the existing fixture and tally report", async () => {
    const { runtime, evm, pool } = setup();
    mockTally(pool);
    pool.arkivBallots = () => true;
    pool.votersFrom = () => { throw new Error("Arkiv must not use legacy ballot getters"); };
    const payloads = new Map<string, Hex>();
    const ref = (index: number, bytes: Hex, present: boolean) => {
      const entityKey = toHex(BigInt(index), { size: 32 });
      if (present) payloads.set(entityKey, bytes);
      return { entityKey, payloadHash: keccak256(bytes), revision: present ? 1n : 0n, blockNumber: 1n };
    };
    const rows = fx.voters.map((v: any, i: number) => ({
      address: v.addr, direct: toBig(v.directWeight), seats: toBig(v.seatWeight),
      pub: ref(i + 1, v.hasDirect ? toHex(new Uint8Array(v.directRanks)) : "0x", v.hasDirect),
      sealed: ref(i + 1000, v.hasSealed ? encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], v.ciphertext.map(toBig)) : "0x", v.hasSealed),
    }));
    pool.voterRefsFrom = (start: unknown, count: unknown) => {
      const page = rows.slice(Number(start), Number(start) + Number(count));
      return [page.map((v: any) => v.address), page.map((v: any) => v.direct), page.map((v: any) => v.seats), page.map((v: any) => v.pub), page.map((v: any) => v.sealed)];
    };
    const reads = readPool(runtime, evm, POOL, CLOSE_CHUNK, () => payloads);
    expect(reads.phase).toBe(3);
    if (reads.phase !== 3) throw new Error("expected tally");
    expect(reads.voters).toEqual(expectedVoters());
    expect(processPool(reads, hexBytes(fx.master))?.kind).toBe(1);
    payloads.clear();
    expect(() => readPool(runtime, evm, POOL, CLOSE_CHUNK, () => payloads)).toThrow("missing");
  });

  test("Arkiv closing produces a cursor-bound kind-3 report", async () => {
    const { runtime, evm, evmMock, pool } = setup();
    pool.phase = () => 2n; pool.arkivBallots = () => true; pool.closeCursor = () => 0n;
    pool.totalWeight = () => 0n; pool.token = () => TOKEN; pool.voterCount = () => 0n;
    pool.voterRefsFrom = () => [[], [], [], [], []];
    const token = addContractMock(evmMock, { address: TOKEN, abi: erc20Abi });
    token.balanceOf = () => 0n;
    const out = readPool(runtime, evm, POOL, CLOSE_CHUNK, () => new Map());
    expect(processPool(out, new Uint8Array(32))?.kind).toBe(3);
  });

  test("Tally: assembles exactly what processPool's own tests feed in", async () => {
    const { runtime, evm, pool } = setup();
    mockTally(pool);
    const out = readPool(runtime, evm, POOL, CLOSE_CHUNK);
    expect(out).toEqual({
      phase: 3,
      resultReported: false,
      m: fx.m,
      costs: fx.costs.map(toBig),
      totalWeight: toBig(fx.totalWeight),
      keySalt: hexBytes(fx.keySalt),
      inputsRoot: fx.inputsRoot,
      batch: fx.profile.batch,
      voters: expectedVoters(),
      closeChunk: CLOSE_CHUNK,
    } as any);
  });

  test("Tally: pages a roster larger than a single page", async () => {
    const { runtime, evm, pool } = setup();
    // 61 synthetic voters, each a plain direct voter with weight 1 and a trivial ballot —
    // more than readPool's own page size, so votersFrom must be called more than once and
    // the pages must reassemble in order.
    const n = 61;
    const voters = Array.from({ length: n }, (_, i) => ({
      addr: `0x${(0x1000 + i).toString(16).padStart(40, "0")}`,
      directWeight: "0x0000000000000000000000000000000000000000000000000000000000000001",
      seatWeight: "0x0000000000000000000000000000000000000000000000000000000000000000",
      hasDirect: true,
      hasSealed: false,
      directPacked: "0x0000000000000000000000000000000000000000000000000000000000000001",
      ciphertext: null,
    }));
    const { votersFromCalls } = mockTally(pool, voters);
    const out = readPool(runtime, evm, POOL, CLOSE_CHUNK) as any;
    expect(out.voters).toEqual(expectedVoters(voters));
    expect(votersFromCalls.length).toBeGreaterThan(1);
    // every requested page actually honoured `count` rather than assuming a fixed size
    expect(votersFromCalls.reduce((sum, [, count]) => sum + count, 0)).toBeGreaterThanOrEqual(n);
  });

  test("Closing: returns after closeCursor/totalWeight/token/balance, never touching the Tally-only reads", async () => {
    const { runtime, evm, evmMock, pool } = setup();
    pool.phase = () => 2n;
    pool.closeCursor = () => 0n;
    pool.totalWeight = () => 1000n;
    pool.token = () => TOKEN;
    // No resultReported/costs/keySalt/inputsRoot/batch/voterCount/votersFrom handlers are
    // set: addContractMock throws "no handler set" if readPool ever reaches for them.
    const token = addContractMock(evmMock, { address: TOKEN, abi: erc20Abi });
    token.balanceOf = () => 900n;
    const out = readPool(runtime, evm, POOL, CLOSE_CHUNK);
    expect(out).toEqual({ phase: 2, closeChunk: CLOSE_CHUNK, closeCursor: 0, totalWeight: 1000n, balance: 900n } as any);
  });
});
