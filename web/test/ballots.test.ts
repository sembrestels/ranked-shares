import { readArkivVoters } from "../../prover/src/core/arkiv";
import { describe, expect, test, vi } from "vitest";
import {
  encodeFunctionData,
  type Hex,
  keccak256,
  type PublicClient,
  toHex,
} from "viem";
import secpVectors from "../../reference/vectors/zisk/sealed.json";
import { encryptSecp } from "../app/lib/ballots";
import {
  ballotAbi,
  type BallotRef,
  checkedPayload,
  payloadQuery,
  payloadReply,
} from "../../cre/src/lib/arkiv";
import { validate } from "../../shared/ranks";
import { pbearTranscript } from "../../shared/pbear";

const pool = "0x0000000000000000000000000000000000000011";
const empty: BallotRef = {
  entityKey: toHex(0n, { size: 32 }),
  payloadHash: toHex(0n, { size: 32 }),
  revision: 0n,
  blockNumber: 0n,
};
const ref = (i: number, payload: Hex): BallotRef => ({
  entityKey: toHex(BigInt(i + 1), { size: 32 }),
  payloadHash: keccak256(payload),
  revision: 1n,
  blockNumber: 5n,
});

describe("Arkiv ballot integrity", () => {
  test("reassembles multiple pages in pool order, ignoring rogue and stale rows", async () => {
    const rows = Array.from(
      { length: 61 },
      (_, i) => ({
        address: toHex(BigInt(i + 100), { size: 20 }),
        ref: ref(i, "0x0102"),
      }),
    );
    const readContract = vi.fn(async ({ functionName, args, blockNumber }) => {
      expect(blockNumber).toBe(123n);
      if (functionName === "voterCount") return 61n;
      const page = rows.slice(Number(args[0]), Number(args[0] + args[1]));
      return [
        page.map((r) => r.address),
        page.map(() => 10n),
        page.map(() => 0n),
        page.map((r) => r.ref),
        page.map(() => empty),
      ];
    });
    const load = vi.fn(async (keys: readonly Hex[]) =>
      new Map<string, Hex>(
        [...keys].reverse().map((key): [string, Hex] => [key, "0x0102"]).concat(
          [[toHex(999n, { size: 32 }), "0xffff"]],
        ),
      )
    );
    const voters = await readArkivVoters(
      { readContract } as unknown as PublicClient,
      pool,
      { blockNumber: 123n, load },
    );
    expect(voters.map((v) => v.address)).toEqual(rows.map((r) => r.address));
    expect(load).toHaveBeenCalledTimes(2);
    expect(
      voters.every((v) =>
        v.publicBallot === "0x0102" && v.sealedBallot === "0x"
      ),
    ).toBe(true);
  });

  test("missing accepted bytes recover from the bounded original vote transaction", async () => {
    const voter = toHex(123n, { size: 20 });
    const reference = ref(1, "0x0000");
    const blockHash = toHex(99n, { size: 32 });
    const getLogs = vi.fn(async (
      _request: unknown,
    ) => [{
      args: { revision: 1n },
      transactionHash: toHex(5n, { size: 32 }),
      blockHash,
    }]);
    const getTransaction = vi.fn(async () => ({
      to: pool,
      from: voter,
      blockHash,
      input: encodeFunctionData({
        abi: ballotAbi,
        functionName: "voteArkiv",
        args: [reference.entityKey, "0x0000", 0n],
      }),
    }));
    const client = {
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "voterCount"
          ? 1n
          : [[voter], [10n], [0n], [reference], [empty]],
      getLogs,
      getTransaction,
    } as unknown as PublicClient;
    const [resolved] = await readArkivVoters(client, pool, {
      blockNumber: 9n,
      load: async () => new Map(),
    });
    expect(resolved.publicBallot).toBe("0x0000");
    expect(resolved.recovered).toBe(1);
    expect(getLogs.mock.calls[0][0]).toMatchObject({
      fromBlock: 5n,
      toBlock: 5n,
    });
    getTransaction.mockResolvedValue({
      to: pool,
      from: voter,
      blockHash,
      input: encodeFunctionData({
        abi: ballotAbi,
        functionName: "voteArkiv",
        args: [reference.entityKey, "0x0102", 0n],
      }),
    });
    await expect(
      readArkivVoters(client, pool, {
        blockNumber: 9n,
        load: async () => new Map(),
      }),
    ).rejects.toThrow("does not match");
  });

  test("never treats a missing or corrupt accepted ballot as an abstention", () => {
    expect(checkedPayload(empty, undefined)).toBe("0x");
    expect(() => checkedPayload(ref(1, "0x0102"), undefined)).toThrow(
      "missing",
    );
    expect(() => checkedPayload(ref(1, "0x0102"), "0x0201")).toThrow(
      "does not match",
    );
    expect(() => payloadQuery(["0x' OR true" as Hex])).toThrow("Invalid");
    expect(() => payloadReply({ result: { data: [], cursor: "more" } }))
      .toThrow("complete");
  });

  test("incomplete roster pages fail before calculating results", async () => {
    const client = {
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "voterCount" ? 1n : [[], [], [], [], []],
    } as unknown as PublicClient;
    await expect(readArkivVoters(client, pool, { blockNumber: 1n })).rejects
      .toThrow("Incomplete voter roster");
  });
});

test("CRE and ZisK browser encryption matches every Python vector", () => {
  for (const v of secpVectors.vectors) {
    expect(encryptSecp(v.pk as Hex, v.voter as Hex, v.ranks, BigInt(v.k))).toBe(
      v.ciphertext,
    );
  }
});

test("browser tally uses shared PB-EAR and rejects fractional ranks", () => {
  expect(validate([1.5, 2], 2)).toBe(false);
  expect(validate([1, 1, 3], 3)).toBe(true);
  const publicEntries = [{ weight: 40n, ballot: [1, 2] }, {
    weight: 40n,
    ballot: [2, 1],
  }];
  expect(pbearTranscript([50n, 30n], publicEntries, [], 80n).funded).toEqual([
    1,
    0,
  ]);
});
