import { expect, test, vi } from "vitest";
import { decodeAbiParameters, hexToBytes, toHex, type PublicClient } from "viem";
import { validate, effectiveRanks } from "../../shared/ranks";
import { decrypt } from "../../cre/src/lib/sealed";
import { G, mul } from "../../cre/src/lib/grumpkin";
import { ballotPayload } from "../app/lib/ballots";
import { tierRanks, type TierAssignments } from "../app/lib/ballot-tiers";

test.each<{ assignments: TierAssignments; expected: number[] }>([
  { assignments: { 0: "must", 1: "must", 2: "should", 3: "nice" }, expected: [1, 1, 3, 4, 0] },
  { assignments: { 0: "nice", 1: "should", 2: "should" }, expected: [3, 1, 1, 0, 0] },
  { assignments: { 0: "must", 1: "nice", 2: "nice" }, expected: [1, 2, 2, 0, 0] },
  { assignments: { 0: "nice", 1: "nice", 2: "nice", 3: "nice", 4: "nice" }, expected: [1, 1, 1, 1, 1] },
  { assignments: {}, expected: [0, 0, 0, 0, 0] },
])("converts tied tiers and skips empty tiers: $expected", ({ assignments, expected }) => {
  const ranks = tierRanks([0, 1, 2, 3, 4], assignments);
  expect(ranks).toEqual(expected);
  expect(validate(ranks, 5)).toBe(true);
});

test("unplaced proposals share the lowest effective rank", () => {
  expect(effectiveRanks(tierRanks([0, 1, 2, 3], { 0: "must", 2: "nice" }), 4)).toEqual([1, 3, 2, 3]);
});

test("project identity and requested order govern ranks; stale assignments are ignored", () => {
  expect(tierRanks([8, 3, 1], { 3: "nice", 1: "must", 99: "must" })).toEqual([0, 2, 1]);
  expect(tierRanks([], { 0: "must" })).toEqual([]);
  expect(tierRanks([0], { 0: "nice" })).toEqual([1]);
  expect(tierRanks([0], {})).toEqual([0]);
});

test("255 proposals encode valid competition ranks including rank 255", () => {
  const ids = Array.from({ length: 255 }, (_, id) => id);
  const assignments: Record<number, "must" | "should" | "nice"> = {};
  for (const id of ids) assignments[id] = id < 253 ? "must" : id === 253 ? "should" : "nice";
  const ranks = tierRanks(ids, assignments);
  expect(ranks).toEqual([...Array(253).fill(1), 254, 255]);
  expect(validate(ranks, 255)).toBe(true);
});

test("every assignment across three proposals produces valid ranks", () => {
  const destinations = [undefined, "must", "should", "nice"] as const;
  for (const a of destinations) for (const b of destinations) for (const c of destinations) {
    expect(validate(tierRanks([0, 1, 2], { 0: a, 1: b, 2: c }), 3)).toBe(true);
  }
});

test("tier ranks survive public payload encoding and encrypted ballot round-trip", async () => {
  const secret = 17n;
  const pk = mul(secret, G);
  const client = { readContract: vi.fn(async ({ functionName }) => functionName === "tallierPkX" ? pk.x : pk.y) } as unknown as PublicClient;
  const pool = toHex(1n, { size: 20 });
  const voter = toHex(2n, { size: 20 });
  const ranks = tierRanks([0, 1, 2, 3, 4], { 0: "must", 1: "must", 2: "should", 3: "nice" });
  const publicPayload = await ballotPayload(client, pool, voter, "public", false, ranks);
  expect([...hexToBytes(publicPayload)]).toEqual([1, 1, 3, 4, 0]);
  const encryptedPayload = await ballotPayload(client, pool, voter, "noir", true, ranks);
  const ciphertext = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], encryptedPayload);
  expect(decrypt(secret, BigInt(voter), [...ciphertext], ranks.length)).toEqual([1, 1, 3, 4, 0]);
});
