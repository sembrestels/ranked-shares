import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type Hex,
  hexToBytes,
  keccak256,
  type PublicClient,
  toHex,
  type WalletClient,
} from "viem";
import {
  arkiv,
  attributes,
  loadPayloads,
  type PublishedBallot,
  readPending,
  savePending,
  verifyPublished,
} from "../app/lib/arkiv";
import { commitBallot } from "../app/lib/ballots";

const ballot = (): PublishedBallot => ({
  pool: toHex(1n, { size: 20 }),
  account: toHex(2n, { size: 20 }),
  chainId: 31337,
  kind: "public",
  isSealed: false,
  revision: "1",
  payload: "0x0102",
  projects: 2,
  entityKey: toHex(5n, { size: 32 }),
  storageTx: toHex(6n, { size: 32 }),
});
const entity = (b: PublishedBallot) => ({
  key: b.entityKey!,
  creator: b.account,
  payload: hexToBytes(b.payload),
  attributes: attributes(b),
  creationFlags: { readonly: true, permissionlessExtension: true },
});
function mockStored(b: PublishedBallot) {
  const get = vi.spyOn(arkiv, "getEntity").mockResolvedValue(
    entity(b) as never,
  );
  const where = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ entities: [{ key: b.entityKey }] });
  const query = { where, limit: vi.fn(), fetch };
  where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  vi.spyOn(arkiv, "select").mockReturnValue(query as never);
  return { get, where };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Arkiv storage verification", () => {
  test("checks hash, creator, flags and every typed attribute before confirmation", async () => {
    const b = ballot();
    const { get, where } = mockStored(b);
    await verifyPublished(b);
    expect(String(where.mock.calls[0][0])).toContain("pool_chain = u64(31337)");
    expect(String(where.mock.calls[0][0])).toContain("revision = u256(1)");
    for (
      const wrong of [
        { ...entity(b), payload: hexToBytes("0x0201") },
        { ...entity(b), creator: toHex(99n, { size: 20 }) },
        {
          ...entity(b),
          attributes: {
            ...attributes(b),
            pool: { type: "addr", value: toHex(99n, { size: 20 }) },
          },
        },
        {
          ...entity(b),
          creationFlags: { readonly: false, permissionlessExtension: true },
        },
      ]
    ) {
      get.mockResolvedValueOnce(wrong as never);
      await expect(verifyPublished(b)).rejects.toThrow();
    }
  });

  test("reads every SDK cursor page, including an exactly full first page", async () => {
    const keys = [toHex(1n, { size: 32 }), toHex(2n, { size: 32 })];
    const next = vi.fn(async () => ({
      entities: [{ key: keys[1], payload: hexToBytes("0x0201") }],
      hasNextPage: () => false,
    }));
    const page = {
      entities: [{ key: keys[0], payload: hexToBytes("0x0102") }],
      hasNextPage: () => true,
      next,
    };
    const query = {
      where: vi.fn(),
      limit: vi.fn(),
      fetch: vi.fn(async () => page),
    };
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    vi.spyOn(arkiv, "select").mockReturnValue(query as never);
    expect(await loadPayloads(keys)).toEqual(
      new Map([[keys[0], "0x0102"], [keys[1], "0x0201"]]),
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

test("declined and interrupted pool confirmation resumes without repeating the vote", async () => {
  const b = ballot();
  mockStored(b);
  savePending(b);
  const reference = {
    entityKey: b.entityKey,
    payloadHash: keccak256(b.payload),
    revision: 1n,
    blockNumber: 4n,
  };
  const receipt = vi.fn().mockRejectedValueOnce(new Error("Receipt timeout"))
    .mockResolvedValue({ status: "success" });
  const write = vi.fn().mockRejectedValueOnce(new Error("User rejected"))
    .mockResolvedValue(toHex(7n, { size: 32 }));
  const wallet = {
    getAddresses: async () => [b.account],
    getChainId: async () => b.chainId,
    writeContract: write,
  } as unknown as WalletClient;
  const pub = {
    getChainId: async () => b.chainId,
    simulateContract: async () => ({ request: {} }),
    waitForTransactionReceipt: receipt,
    readContract: async () => reference,
  } as unknown as PublicClient;
  await expect(commitBallot(pub, wallet, b)).rejects.toThrow("User rejected");
  expect(readPending()?.entityKey).toBe(b.entityKey);
  await expect(commitBallot(pub, wallet, b)).rejects.toThrow("Receipt timeout");
  expect(readPending()?.voteTx).toBe(toHex(7n, { size: 32 }));
  await commitBallot(pub, wallet, readPending()!);
  expect(write).toHaveBeenCalledTimes(2); // rejection then one sent vote; no third send
  expect(readPending()).toBeUndefined();
});

test("account or chain changes fail before a ballot transaction can be sent", async () => {
  const b = ballot();
  const write = vi.fn();
  const pub = { getChainId: async () => 31337 } as unknown as PublicClient;
  const wallet = {
    getAddresses: async () => [toHex(3n, { size: 20 })],
    getChainId: async () => 31337,
    writeContract: write,
  } as unknown as WalletClient;
  await expect(commitBallot(pub, wallet, b)).rejects.toThrow("account changed");
  expect(write).not.toHaveBeenCalled();
});
