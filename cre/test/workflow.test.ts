import { describe, expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
// The CRE SDK types every `node:fs` export as `never` (WASM guardrail), so the
// fixture comes in as a JSON import, like the other vector tests.
import fixture from "../../reference/vectors/noir/fixture_test_main.json";
import { toBig } from "../src/lib/field";
import { type PoolReads, processPool, validPools } from "../src/workflow";

const fx = fixture as any;
const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

function tallyReads(): Extract<PoolReads, { phase: 3 }> {
  return {
    phase: 3,
    resultReported: false,
    m: fx.m,
    costs: fx.costs.map(toBig),
    totalWeight: toBig(fx.totalWeight),
    keySalt: hexBytes(fx.keySalt),
    inputsRoot: fx.inputsRoot,
    batch: fx.profile.batch,
    closeChunk: 25,
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

function closingReads(over: Partial<Extract<PoolReads, { phase: 2 }>> = {}): Extract<PoolReads, { phase: 2 }> {
  return { phase: 2, closeChunk: 25, closeCursor: 0, totalWeight: toBig(fx.totalWeight), balance: toBig(fx.totalWeight), ...over };
}

describe("processPool", () => {
  test("Closing at cursor 0 with a sufficient balance yields a kind-2 close report", () => {
    const out = processPool(closingReads(), hexBytes(fx.master));
    expect(out?.kind).toBe(2);
  });

  test("Closing at cursor 0 with a balance below totalWeight is blocked (would revert on chain)", () => {
    const r = closingReads({ balance: toBig(fx.totalWeight) - 1n });
    expect(processPool(r, hexBytes(fx.master))).toBeNull();
  });

  test("Closing mid-chain (cursor > 0) yields a kind-2 close report regardless of balance", () => {
    // `_close` only enforces the balance check once, at closeCursor === 0.
    const r = closingReads({ closeCursor: 5, balance: 0n });
    const out = processPool(r, hexBytes(fx.master));
    expect(out?.kind).toBe(2);
  });

  test("Tally without a report yields the fixture result and transcript", () => {
    const out = processPool(tallyReads(), hexBytes(fx.master));
    expect(out?.kind).toBe(1);
    const [, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], out!.report);
    const [root, order, transcript] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }],
      payload as `0x${string}`,
    );
    expect(root).toBe(fx.inputsRoot);
    expect(order.map(Number)).toEqual(fx.funded);
    expect(transcript.map(Number)).toEqual(fx.transcript.flat());
  });

  test("a wrong inputsRoot aborts without a report", () => {
    const r = tallyReads();
    r.inputsRoot = `0x${"00".repeat(32)}`;
    expect(() => processPool(r, hexBytes(fx.master))).toThrow(/inputsRoot/);
  });

  test("Tally with a report already there does nothing", () => {
    const r = tallyReads();
    r.resultReported = true;
    expect(processPool(r, hexBytes(fx.master))).toBeNull();
  });
});

describe("validPools", () => {
  test("the zero-address placeholder is skipped, never reaching processPool", () => {
    const real = "0x1111111111111111111111111111111111111111";
    const { valid, skipped } = validPools({ pools: ["0x0000000000000000000000000000000000000000", real] });
    expect(valid).toEqual([real]);
    expect(skipped).toEqual(["0x0000000000000000000000000000000000000000"]);
  });

  test("a malformed address is skipped too", () => {
    const { valid, skipped } = validPools({ pools: ["not-an-address"] });
    expect(valid).toEqual([]);
    expect(skipped).toEqual(["not-an-address"]);
  });
});
