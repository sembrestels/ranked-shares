import { describe, expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import { encodeCloseReport, encodeResultReport } from "../src/lib/report";

describe("report encoding", () => {
  test("kind 1 decodes as the contract does", () => {
    const bytes = encodeResultReport(`0x${"11".repeat(32)}`, [0, 1], [[1n, 40n, 0n, 0n, 40n]]);
    const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], bytes);
    expect(kind).toBe(1);
    const [root, order, transcript] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }],
      payload as `0x${string}`,
    );
    expect(root).toBe(`0x${"11".repeat(32)}`);
    expect(order).toEqual([0n, 1n]);
    expect(transcript).toEqual([1n, 40n, 0n, 0n, 40n]);
  });

  test("kind 2", () => {
    const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], encodeCloseReport(25));
    expect(kind).toBe(2);
    expect(decodeAbiParameters([{ type: "uint256" }], payload as `0x${string}`)[0]).toBe(25n);
  });
});
