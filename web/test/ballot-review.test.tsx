import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { hexToBytes, keccak256, toHex, type Hex, type PublicClient } from "viem";
import { arkiv } from "../app/lib/arkiv";
import { readBallotReview } from "../app/lib/ballot-review";
import { BallotReview, PublicResults } from "../app/components/voting";
import { publicResults, type VotingRound } from "../app/lib/ballots";

const pool = toHex(1n, { size: 20 });
const voter = toHex(2n, { size: 20 });
const empty = { entityKey: toHex(0n, { size: 32 }), payloadHash: toHex(0n, { size: 32 }), revision: 0n, blockNumber: 0n };
const pub = { entityKey: toHex(3n, { size: 32 }), payloadHash: keccak256("0x0102"), revision: 2n, blockNumber: 30n };
const sealed = { entityKey: toHex(4n, { size: 32 }), payloadHash: keccak256("0xabcdef"), revision: 1n, blockNumber: 31n };
const getTransaction = vi.fn();
const readContract = vi.fn();
const client = { getBlockNumber: async () => 40n, readContract, getTransaction } as unknown as PublicClient;
let head = 100n;
let rows: { key: Hex; payload: Uint8Array; expiresAt: bigint }[] = [];
let broken = false;
const queries: string[] = [];
const atBlocks: bigint[] = [];
beforeEach(() => {
  head = 100n;
  broken = false;
  queries.length = 0;
  atBlocks.length = 0;
  rows = [
    { key: pub.entityKey, payload: hexToBytes("0x0102"), expiresAt: 101n },
    { key: sealed.entityKey, payload: hexToBytes("0xabcdef"), expiresAt: 101n },
  ];
  readContract.mockImplementation(async ({ functionName, blockNumber }) => {
    expect(blockNumber).toBe(40n);
    if (functionName === "fundedProjects") return [1n];
    if (functionName === "voterCount") return 1n;
    return [[voter], [10n], [20n], [pub], [sealed]];
  });
  vi.spyOn(arkiv, "getChainId").mockResolvedValue(7738577);
  vi.spyOn(arkiv, "getBlockNumber").mockImplementation(async () => head);
  vi.spyOn(arkiv, "select").mockImplementation(() => {
    let block = 0n;
    const query = {
      where: vi.fn((predicate) => { queries.push(String(predicate)); return query; }),
      atBlock: vi.fn((height) => { block = height; atBlocks.push(height); return query; }),
      limit: vi.fn(() => query),
      fetch: async () => {
        if (broken) throw new Error("RPC offline");
        return {
          blockNumber: block,
          // Simulate the node's native expiry, without a delete or cleanup call.
          entities: rows.filter((r) => r.expiresAt > block), hasNextPage: () => false,
        };
      },
    };
    return query as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); readContract.mockReset(); getTransaction.mockReset(); });

const props = { until: 2_000_000_000n, final: true, limit: 50, onMore: () => {}, loading: false };
test("native expiry removes public and encrypted contents while final results stay visible", async () => {
  const before = await readBallotReview(client, pool);
  expect(before.rows.map((r) => r.status)).toEqual(["available", "available"]);
  const result = await publicResults(client, pool, { kind: "noir", phase: 4, block: 40n } as VotingRound);
  const view = (data: typeof before) => <>
    <PublicResults titles={["First", "Second"]} {...result} block={40n} sealedPool />
    <BallotReview {...props} data={data} />
  </>;
  const rendered = render(view(before));
  expect(screen.getByText("1, 2")).toBeTruthy();
  expect(screen.getByText("0xabcdef")).toBeTruthy();
  head = 101n;
  const after = await readBallotReview(client, pool, before.rows);
  expect(after.rows.map((r) => r.status)).toEqual(["expiry-passed", "expiry-passed"]);
  expect(after.rows.every((r) => r.payload === undefined)).toBe(true);
  rendered.rerender(view(after));
  expect(screen.queryByText("1, 2")).toBeNull();
  expect(screen.queryByText("0xabcdef")).toBeNull();
  expect(screen.getByText(/Ballot review period ended/)).toBeTruthy();
  expect(screen.getByText("Second")).toBeTruthy();
  expect(screen.getByText("Final funded projects")).toBeTruthy();
  expect(queries[0]).toBe(queries[1]);
  expect(atBlocks).toEqual([100n, 101n]);
  expect(getTransaction).not.toHaveBeenCalled();
});

test("an owner extension observed at refresh keeps the actual live entity visible", async () => {
  const before = await readBallotReview(client, pool);
  rows[0].expiresAt = 150n;
  head = 101n;
  const after = await readBallotReview(client, pool, before.rows);
  expect(after.rows[0]).toMatchObject({ status: "available", payload: "0x0102", expiresAt: 150n });
  expect(after.rows[1]).toMatchObject({ status: "expiry-passed" });
});

test("unknown absence and altered payloads are not labeled natural expiry or recovered", async () => {
  rows = [{ ...rows[0], payload: hexToBytes("0x0201") }];
  const result = await readBallotReview(client, pool);
  expect(result.rows.map((r) => r.status)).toEqual(["invalid", "unavailable"]);
  expect(result.rows.every((r) => r.payload === undefined)).toBe(true);
  expect(getTransaction).not.toHaveBeenCalled();
});

test("RPC errors hide prior contents without reporting expired or empty ballots", async () => {
  const before = await readBallotReview(client, pool);
  broken = true;
  await expect(readBallotReview(client, pool, before.rows)).rejects.toThrow("RPC offline");
  render(<BallotReview {...props} data={before} error="RPC offline" />);
  expect(screen.getByRole("alert").textContent).toContain("Cached ballot contents are hidden");
  expect(screen.queryByText("1, 2")).toBeNull();
  expect(screen.queryByText(/Ballot review period ended/)).toBeNull();
});

test("all cursor pages are pinned to the same Arkiv block and rogue keys never enter review", async () => {
  const next = vi.fn(async () => ({ blockNumber: head, entities: [rows[1]], hasNextPage: () => false }));
  const q = { where: vi.fn(), atBlock: vi.fn(), limit: vi.fn(), fetch: async () => ({
    blockNumber: head, entities: [rows[0], { ...rows[0], key: toHex(99n, { size: 32 }) }], hasNextPage: () => true, next,
  }) };
  q.where.mockReturnValue(q); q.atBlock.mockReturnValue(q); q.limit.mockReturnValue(q);
  vi.mocked(arkiv.select).mockReturnValue(q as never);
  const result = await readBallotReview(client, pool);
  expect(result.rows.map((r) => r.entityKey)).toEqual([pub.entityKey, sealed.entityKey]);
  expect(q.atBlock).toHaveBeenCalledWith(head);
  expect(next).toHaveBeenCalledOnce();
  next.mockResolvedValueOnce({ blockNumber: head - 1n, entities: [rows[1]], hasNextPage: () => false });
  await expect(readBallotReview(client, pool)).rejects.toThrow("different snapshot");
});

test("replacements do not inherit the previous entity's expiry metadata", async () => {
  const before = await readBallotReview(client, pool);
  head = 102n;
  readContract.mockImplementation(async ({ functionName }) => functionName === "voterCount" ? 1n
    : [[voter], [10n], [0n], [{ ...pub, entityKey: toHex(10n, { size: 32 }), revision: 3n }], [empty]]);
  const after = await readBallotReview(client, pool, before.rows);
  expect(after.rows).toHaveLength(1);
  expect(after.rows[0]).toMatchObject({ status: "unavailable", expiresAt: undefined, revision: 3n });
});
