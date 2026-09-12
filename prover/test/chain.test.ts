// prover/test/chain.test.ts — readPoolSnapshot's bounds, against a stubbed PublicClient
// (no anvil, no network): a pool that reports absurd counts must be rejected before the
// checkpoint and voter loops run, not paged through forever.
import { describe, expect, test, vi } from "vitest";
import { type PublicClient, keccak256, toHex } from "viem";
import { MAX_VOTERS, readPoolSnapshot } from "../src/core/chain";

const POOL = "0x00000000000000000000000000000000000000aa" as const;

/** A client whose `readContract` answers from `values`, recording what was asked for. */
function stubClient(values: Record<string, unknown>): { client: PublicClient; asked: string[] } {
  const asked: string[] = [];
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      asked.push(functionName);
      if (!(functionName in values)) throw new Error(`stub has no value for ${functionName}`);
      return values[functionName];
    },
    getBlockNumber: async () => 0n,
    getLogs: async () => [],
  } as unknown as PublicClient;
  return { client, asked };
}

// the `test` profile (8 / 4 / 2), a closed pool with nothing reported yet
const base: Record<string, unknown> = {
  phase: 3,
  costs: [1n, 2n, 3n, 4n],
  totalWeight: 100n,
  keySalt: `0x${"11".repeat(32)}`,
  batch: 2n,
  nSealedMax: 8n,
  mMax: 4n,
  tallierPkX: 1n,
  tallierPkY: 2n,
  coordinator: POOL,
  workflowOwner: "0x0000000000000000000000000000000000000000",
  workflowName: "0x00000000000000000000",
  sealedCount: 4n,
  numBatches: 2n,
  costsHash: 7n,
  inputsRoot: `0x${"22".repeat(32)}`,
  resultReported: false,
  transcriptHash: 0n,
  ingestCursor: 0n,
  stateCommit: 0n,
  ingestedState: 0n,
  provisionalResult: [],
  voterCount: 0n,
  checkpoint: 0n,
  votersFrom: [[], [], [], [], [], []],
};

describe("readPoolSnapshot bounds", () => {
  test("Arkiv pools load accepted payloads instead of empty legacy storage", async () => {
    const key = toHex(1n, { size: 32 });
    const payload = "0x01020304";
    const ref = { entityKey: key, payloadHash: keccak256(payload), revision: 1n, blockNumber: 0n };
    const { client, asked } = stubClient({ ...base, arkivBallots: true, voterCount: 1n, voterRefsFrom: [[POOL], [100n], [0n], [ref], [{ ...ref, revision: 0n }]] });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: { data: [{ key, payload }], blockNumber: "0x1" } }), { status: 200 }));
    try {
      const snapshot = await readPoolSnapshot(client, POOL);
      expect(snapshot.voters[0]).toMatchObject({ hasDirect: true, directPacked: 0x04030201n, ciphertext: null });
      expect(asked).not.toContain("votersFrom");
    } finally { fetch.mockRestore(); }
  });
  test("rejects a pool whose (nSealedMax, mMax, batch) is no known circuit profile", async () => {
    const { client } = stubClient({ ...base, nSealedMax: 999n });
    await expect(readPoolSnapshot(client, POOL)).rejects.toThrow(/no circuit profile for E=999 M=4 B=2/);
  });

  test("rejects numBatches above the profile's maximum, before reading any checkpoint", async () => {
    const { client, asked } = stubClient({ ...base, numBatches: 4096n });
    await expect(readPoolSnapshot(client, POOL)).rejects.toThrow(/numBatches=4096, above the test profile's maximum of 4/);
    expect(asked).not.toContain("checkpoint");
  });

  test("rejects voterCount above MAX_VOTERS, before paging any voter", async () => {
    const { client, asked } = stubClient({ ...base, voterCount: BigInt(MAX_VOTERS + 1) });
    await expect(readPoolSnapshot(client, POOL)).rejects.toThrow(new RegExp(`voterCount=${MAX_VOTERS + 1}, above MAX_VOTERS=${MAX_VOTERS}`));
    expect(asked).not.toContain("votersFrom");
    expect(asked).not.toContain("checkpoint");
  });

  test("a pool within bounds reads through", async () => {
    const { client } = stubClient(base);
    const s = await readPoolSnapshot(client, POOL);
    expect(s.numBatches).toBe(2);
    expect(s.checkpoints.length).toBe(3);
    expect(s.voters).toEqual([]);
    expect(s.transcript).toBe(null);
  });
});
