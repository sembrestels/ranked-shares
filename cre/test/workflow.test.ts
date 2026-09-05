import { describe, expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
// The CRE SDK types every `node:fs` export as `never` (WASM guardrail), so the
// fixture comes in as a JSON import, like the other vector tests.
import fixture from "../../reference/vectors/fixture_test_main.json";
import { toBig } from "../src/lib/field";
import { type PoolReads, processPool } from "../src/workflow";

const fx = fixture as any;
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

describe("processPool", () => {
  test("Closing yields a kind-2 close report", () => {
    const out = processPool(reads(2), hexBytes(fx.master));
    expect(out?.kind).toBe(2);
  });

  test("Tally without a report yields the fixture result and transcript", () => {
    const out = processPool(reads(3), hexBytes(fx.master));
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
    const r = reads(3);
    r.inputsRoot = `0x${"00".repeat(32)}`;
    expect(() => processPool(r, hexBytes(fx.master))).toThrow(/inputsRoot/);
  });

  test("Tally with a report already there does nothing", () => {
    const r = reads(3);
    r.resultReported = true;
    expect(processPool(r, hexBytes(fx.master))).toBeNull();
  });
});
