import { beforeEach, expect, test, vi } from "vitest";
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, keccak256, type PublicClient, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk/entity";
import { createWalletClient } from "@arkiv-network/sdk";
import { ballotAlias, ballotId, payloadReply } from "../../cre/src/lib/arkiv";

const state = vi.hoisted(() => ({ arkiv: {} as any, rpc: {} as any, signer: {} as any, creates: 0, fail: true, params: null as any }));
import { ballotStorageWorker, type StorageJournal } from "../../cre/scripts/lib/ballot-storage";
const factories = {
  createPublicClient: () => state.arkiv,
  createEvmClient: () => state.rpc,
  createSigner: () => state.signer,
  createWalletClient: (options: any) => ({ createEntity: async (params: any) => {
    state.creates++; state.params = params;
    await options.transport({}).request({ method: "eth_sendTransaction", params: [{ to: "0x4400000000000000000000000000000000000044", data: "0x1234", value: "0x0" }] });
    if (state.fail) throw new Error("Storage receipt timed out");
    return { entityKey: toHex(77n, { size: 32 }), expiresAt: 800000n };
  } }),
} as never;
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const pool = toHex(123n, { size: 20 }) as Address;
const payload = "0x0102" as Hex;
const id = ballotId(31337n, pool, account.address, false, 1n, payload);
const ref = { entityKey: id, payloadHash: keccak256(payload), revision: 1n, blockNumber: 10n };
const empty = { ...ref, revision: 0n };
const client = {
  getChainId: async () => 31337, getBlockNumber: async () => 10n,
  readContract: async ({ functionName }: any) => {
    if (functionName === "ballotFlowVersion") return 2n;
    if (functionName === "voterCount") return 1n;
    if (functionName === "kind") return "public";
    if (functionName === "votingDeadline") return 1000n;
    if (functionName === "projectCount") return 2n;
    return [[account.address], [80n], [0n], [ref], [empty]];
  },
  getLogs: async () => [{ args: { ballotId: id, revision: 1n, payload } }],
} as unknown as PublicClient;
beforeEach(() => {
  state.creates = 0; state.fail = true; state.params = null;
  state.rpc = { sendRawTransaction: vi.fn(async () => keccak256("0x1234")) };
  state.signer = { prepareTransactionRequest: vi.fn(async (tx) => tx), signTransaction: vi.fn(async () => "0x1234") };
  const query = { where: () => query, limit: () => query, fetch: async () => ({ entities: [] }) };
  state.arkiv = {
    getChainId: async () => 7738577, getBlock: async () => ({ number: 100n, timestamp: 100n }), select: () => query,
    getEntity: async () => ({ attributes: state.params.attributes, payload: new Uint8Array([1, 2]), expiresAt: 800000n, creationFlags: { readonly: true } }),
    waitForTransactionReceipt: async () => ({ status: "success", logs: [{
      address: "0x4400000000000000000000000000000000000044",
      topics: encodeEventTopics({ abi: ENTITY_EVENTS_ABI, eventName: "EntityCreated", args: { entityKey: toHex(77n, { size: 32 }), owner: account.address } }),
      data: encodeAbiParameters([{ type: "uint64" }, { type: "uint8" }], [800000n, 1]),
    }] }),
  };
});

test("background storage resumes a journaled transaction without another upload or signature", async () => {
  const journal: StorageJournal = {};
  const save = vi.fn(() => { if (journal[id]?.hash) expect(journal[id].hash).toBe(keccak256(journal[id].raw!)); });
  const worker = ballotStorageWorker({ poolClient: client, account, arkivRpc: "http://unused.invalid", journal, save }, factories);
  await expect(worker.syncPool(pool)).rejects.toThrow("Storage receipt timed out");
  expect(journal[id].raw).toBe("0x1234");
  expect(save).toHaveBeenCalled();
  expect(state.params.flags).toEqual({ readonly: true, permissionlessExtension: false });
  expect(state.params.attributes.voter.value).toBe(account.address);
  expect(ballotAlias(state.params.attributes, payload)).toBe(id);
  state.fail = false;
  await worker.syncPool(pool);
  expect(journal[id].verified).toBe(true);
  expect(journal[id].entityKey).toBe(toHex(77n, { size: 32 }));
  expect(state.creates).toBe(1);
  expect(state.signer.signTransaction).toHaveBeenCalledTimes(1);
  await worker.syncPool(pool);
  expect(state.creates).toBe(1);
});

test("the real Arkiv SDK journals the signed transaction before attempting broadcast", async () => {
  const journal: StorageJournal = {};
  state.arkiv.request = async ({ method }: { method: string }) => {
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_chainId") return "0x7614d1";
    throw new Error(`Unexpected RPC method: ${method}`);
  };
  state.rpc.sendRawTransaction.mockImplementation(async () => {
    expect(journal[id].raw).toBe("0x1234");
    expect(journal[id].hash).toBe(keccak256("0x1234"));
    throw new Error("Broadcast connection interrupted");
  });
  const worker = ballotStorageWorker({ poolClient: client, account, arkivRpc: "http://unused.invalid", journal, save: () => {} },
    { ...(factories as object), createWalletClient } as never);
  await expect(worker.syncPool(pool)).rejects.toThrow(/Transaction failed/);
  expect(state.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  expect(state.signer.signTransaction).toHaveBeenCalledTimes(1);
  expect(journal[id].hash).toBe(keccak256("0x1234"));
  // Resume through the confirmed transaction path without invoking the SDK again.
  const attributes = { ballot_id: { type: "bytes32", value: id }, pool_chain: { type: "u64", value: 31337n }, pool: { type: "addr", value: pool }, voter: { type: "addr", value: account.address }, ballot_mode: { type: "str", value: "public" }, revision: { type: "u256", value: 1n }, payload_hash: { type: "bytes32", value: keccak256(payload) } };
  state.arkiv.getEntity = async () => ({ attributes, payload: new Uint8Array([1, 2]) });
  state.rpc.sendRawTransaction.mockResolvedValue(journal[id].hash);
  await worker.syncPool(pool);
  expect(journal[id].verified).toBe(true);
  expect(state.signer.signTransaction).toHaveBeenCalledTimes(1);
});

test("forged aliases cannot attach different bytes, voters, pools, revisions or chains to an accepted ballot", async () => {
  const worker = ballotStorageWorker({ poolClient: client, account, arkivRpc: "http://unused.invalid", journal: {}, save: () => {} }, factories);
  await expect(worker.syncPool(pool)).rejects.toThrow();
  const attributes = state.params.attributes;
  expect(ballotAlias(attributes, payload)).toBe(id);
  for (const [name, value] of [["pool_chain", 1n], ["pool", toHex(555n, { size: 20 })], ["voter", pool], ["revision", 2n], ["ballot_mode", "sealed"]] as const) {
    expect(ballotAlias({ ...attributes, [name]: { ...attributes[name], value } }, payload)).toBeUndefined();
  }
  expect(ballotAlias(attributes, "0x0201")).toBeUndefined();
  const rows = Object.entries(attributes).map(([name, a]) => ({ name, ...a as object }));
  const reply = payloadReply({ result: { data: [{ key: toHex(77n, { size: 32 }), payload, attributes: rows }] } });
  expect(reply.get(id)).toBe(payload);
});
