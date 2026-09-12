import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hexToBytes, toHex, type WalletClient } from "viem";
import { ballotExpiry, ballotRetentionUntil, BALLOT_RETENTION_SECONDS } from "../app/lib/ballot-retention";

const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@arkiv-network/sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@arkiv-network/sdk")>(),
  createWalletClient: () => ({ createEntity: mock.create }),
}));
import { arkiv, publishBallot, readPending, verifyPublished, type PublishedBallot } from "../app/lib/arkiv";

const head = { number: 5_000n, timestamp: 1_800_000_000n };
const deadline = head.timestamp + 3_601n;
const account = toHex(1n, { size: 20 });
const entityKey = toHex(2n, { size: 32 });
const wallet = {
  getAddresses: async () => [account], getChainId: async () => 7738577,
} as unknown as WalletClient;
let entity: any;

beforeEach(() => {
  vi.spyOn(arkiv, "getBlock").mockResolvedValue(head as never);
  vi.spyOn(arkiv, "getChainId").mockResolvedValue(7738577);
  vi.spyOn(arkiv, "getEntity").mockImplementation(async () => entity);
  const query = { where: vi.fn(), limit: vi.fn(), fetch: async () => ({ entities: [{ key: entityKey }] }) };
  query.where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  vi.spyOn(arkiv, "select").mockReturnValue(query as never);
  mock.create.mockImplementation(async (params) => {
    entity = {
      key: entityKey, creator: account, payload: params.payload,
      attributes: params.attributes, creationFlags: params.flags,
      expiresAt: params.expires.expiresAt,
    };
    return { txHash: toHex(3n, { size: 32 }), entityKey, expiresAt: entity.expiresAt };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  mock.create.mockReset();
  localStorage.clear();
});

test("fixed voting deadline survives upload timing and a wrong browser clock", () => {
  vi.spyOn(Date, "now").mockReturnValue(0);
  const first = ballotExpiry(deadline, head);
  const later = ballotExpiry(deadline, { number: head.number + 300n, timestamp: head.timestamp + 600n });
  expect(first.expiresAt).toBe(later.expiresAt);
  expect(first.until).toBe(deadline + 15n * 86_400n);
  expect(first.expiresAt).toBe(head.number + 649_801n); // ceil((3601 + 15 days) / 2)
  expect(first.expires.minLifetime).toBe(0n);
  expect(first.expires.expiresAt).toBe(first.expiresAt);
});

test("expired targets and unrepresentable expiry heights fail before sending", async () => {
  const b: PublishedBallot = { pool: account, account, chainId: 31337, kind: "public", isSealed: false, revision: "1", projects: 1, payload: "0x01" };
  await expect(publishBallot(wallet, b, head.timestamp - BALLOT_RETENTION_SECONDS)).rejects.toThrow("retention deadline");
  expect(mock.create).not.toHaveBeenCalled();
  expect(() => ballotExpiry(deadline, { ...head, number: (1n << 64n) - 1n })).toThrow("supported block range");
});

describe.each(["public", "noir", "cre", "zisk"] as const)("%s ballot retention", (kind) => {
  test("publishes unchanged bytes with native expiry and no permissionless extension", async () => {
    const b: PublishedBallot = {
      pool: account, account, chainId: 31337, kind, isSealed: kind !== "public",
      revision: "1", projects: 2, payload: kind === "public" ? "0x0102" : "0xdeadbeef",
    };
    await publishBallot(wallet, b, deadline);
    const params = mock.create.mock.calls[0][0];
    expect(params.payload).toEqual(hexToBytes(b.payload));
    expect(params.flags).toEqual({ readonly: true, permissionlessExtension: false });
    expect(params.attributes.retention_until).toEqual({ type: "u64", value: ballotRetentionUntil(deadline) });
    expect(BigInt(b.requestedExpiry!)).toBe(entity.expiresAt);
    expect(readPending()?.retentionUntil).toBe(ballotRetentionUntil(deadline).toString());
    expect(readPending()?.payload).toBe(b.payload);
    await expect(publishBallot(wallet, b, deadline)).rejects.toThrow("already has a storage transaction");
    expect(mock.create).toHaveBeenCalledOnce();
    entity.creationFlags.permissionlessExtension = true;
    await expect(verifyPublished(b)).rejects.toThrow("storage flags");
    entity.creationFlags.permissionlessExtension = false;
    entity.expiresAt += 1n;
    await expect(verifyPublished(b)).rejects.toThrow("expiry changed");
  });
});
