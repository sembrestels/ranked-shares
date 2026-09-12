import { assertEquals, assertRejects } from "@std/assert";
import type { Address } from "viem";
import { erc20Abi, noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { PoolTooLargeError, readRound } from "../chain/read.ts";
import { A, B, fakeTransport, POOL, TOKEN } from "./fake-pool.ts";

const ZERO = "0x" + "00".repeat(32);
// Anvil default accounts #2-#4: distinct addresses for multi-voter roster paging.
const C = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const D = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const E = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;
const tokenContract = {
  address: TOKEN,
  abi: erc20Abi,
  handlers: { symbol: () => "USDC", decimals: () => 6 },
};
const common = {
  token: () => TOKEN,
  owner: () => A,
  votingDeadline: () => 1_700_003_600n,
  totalWeight: () => 1_300n,
  spent: () => 0n,
  claimedTotal: () => 0n,
  projectCount: () => 2n,
  cost: ([id]: readonly unknown[]) => [4_000n, 2_500n][Number(id)],
  recipientOf: () => B,
  contentRefOf: ([id]: readonly unknown[]) => Number(id) === 0 ? "0x" + "ab".repeat(32) : ZERO,
  funded: () => false,
  claimed: () => false,
  fundedProjects: () => [],
  proposalCount: () => 3n,
  voterCount: () => 2n,
};

Deno.test("readRound: plain pool in the open phase", async () => {
  const { transport, calls } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: plainAbi,
      handlers: {
        ...common,
        phase: () => 1,
        votingOpen: () => true,
        tallyStarted: () => false,
        tallyDone: () => false,
        rankLevel: () => 0n,
        voterAt: ([i]) => [A, B][Number(i)],
        ballotOf: ([a]) => (a as string).toLowerCase() === A.toLowerCase() ? "0x0102" : "0x0201",
        weightOf: ([a]) => (a as string).toLowerCase() === A.toLowerCase() ? 1_000n : 300n,
      },
    },
  ], 123n);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts, roster } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "plain");
  assertEquals(facts.block, 123);
  assertEquals(facts.phase, "open");
  assertEquals(facts.votingDeadline, 1_700_003_600);
  assertEquals(facts.token, { address: TOKEN, symbol: "USDC", decimals: 6 });
  assertEquals(facts.projects.map((p) => p.commitment), ["1000", "300"]);
  assertEquals(facts.projects[0].cost, "4000");
  assertEquals(facts.projects[0].contentRef, "0x" + "ab".repeat(32));
  assertEquals(facts.projects[1].contentRef, ZERO);
  assertEquals(facts.sealed, { total: "0", count: 0, commitmentsAvailable: true });
  assertEquals(facts.closing, null);
  assertEquals(facts.proving, null);
  assertEquals(facts.finality, null);
  assertEquals(facts.graces, { abandonFrom: null, provisionalFrom: null });
  assertEquals(facts.voterCount, 2);
  assertEquals(facts.proposalCount, 3);
  assertEquals(roster, new Set([A.toLowerCase(), B.toLowerCase()]));
  assertEquals(calls.filter((m) => m === "eth_blockNumber").length, 1);
});

Deno.test("readRound: zisk pool in the tally phase with sealed ballots", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: sealedAbi,
      handlers: {
        ...common,
        kind: () => "zisk",
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        totalSeatWeight: () => 500n,
        votersFrom: ([start, count]) => {
          if (BigInt(start as bigint) !== 0n || BigInt(count as bigint) !== 2n) {
            throw new Error("bad page");
          }
          return [[A, B], [1_000n, 0n], [0n, 500n], ["0x0102", "0x"], [
            "0x",
            "0x" + "cd".repeat(35),
          ]];
        },
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "zisk");
  assertEquals(facts.phase, "tally");
  assertEquals(facts.projects.map((p) => p.commitment), ["1000", "0"]);
  assertEquals(facts.sealed, { total: "500", count: 1, commitmentsAvailable: true });
  assertEquals(facts.closing, { closed: true, cursor: 2 });
  assertEquals(facts.proving, null);
  assertEquals(facts.graces, { abandonFrom: 1_700_003_600 + 604_800, provisionalFrom: null });
});

Deno.test("readRound: zisk pool done and proven", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: sealedAbi,
      handlers: {
        ...common,
        kind: () => "zisk",
        phase: () => 4,
        votingOpen: () => true,
        finality: () => 1,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        totalSeatWeight: () => 500n,
        spent: () => 4_000n,
        claimedTotal: () => 0n,
        funded: ([id]) => Number(id) === 0,
        fundedProjects: () => [0n],
        votersFrom: () => [[A, B], [1_000n, 0n], [0n, 500n], ["0x0102", "0x"], [
          "0x",
          "0x" + "cd".repeat(35),
        ]],
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.phase, "done");
  assertEquals(facts.finality, "proven");
  assertEquals(facts.fundedOrder, [0]);
  assertEquals(facts.projects[0].funded, true);
  assertEquals(facts.graces.abandonFrom, null);
});

Deno.test("readRound: noir pool reports sealed count and no commitments", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: noirAbi,
      handlers: {
        ...common,
        profileId: () => "0x" + "ab".repeat(32),
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 2n,
        abandonGrace: () => 604_800n,
        proofGrace: () => 86_400n,
        reportedAt: () => 1_700_010_000n,
        resultReported: () => true,
        ingestCursor: () => 1n,
        numBatches: () => 4n,
        sealedCount: () => 1n,
        totalSeatWeight: () => 500n,
        votersFrom:
          () => [[A, B], [1_000n, 0n], [5n, 0n], [0n, 500n], [[0n, 0n, 0n], [1n, 2n, 3n]], [
            true,
            false,
          ]],
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts, roster } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.kind, "noir");
  assertEquals(facts.sealed, { total: "500", count: 1, commitmentsAvailable: false });
  assertEquals(facts.projects.map((p) => p.commitment), ["0", "0"]);
  assertEquals(facts.proving, { accepted: 1, total: 4 });
  assertEquals(facts.graces, {
    abandonFrom: 1_700_003_600 + 604_800,
    provisionalFrom: 1_700_010_000 + 86_400,
  });
  assertEquals(roster.size, 2);
});

Deno.test("readRound: token symbol falls back to 'tokens'", async () => {
  const { transport } = fakeTransport([
    { address: TOKEN, abi: erc20Abi, handlers: { decimals: () => 18 } },
    {
      address: POOL,
      abi: plainAbi,
      handlers: {
        ...common,
        phase: () => 0,
        votingOpen: () => false,
        tallyStarted: () => false,
        tallyDone: () => false,
        rankLevel: () => 0n,
        voterCount: () => 0n,
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 200, chainId: 31337 });
  assertEquals(facts.token.symbol, "tokens");
  assertEquals(facts.phase, "setup");
});

Deno.test("readRound: a pool reporting more voters than the limit rejects without reading them", async () => {
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: plainAbi,
      handlers: {
        ...common,
        phase: () => 1,
        votingOpen: () => true,
        tallyStarted: () => false,
        tallyDone: () => false,
        rankLevel: () => 0n,
        voterCount: () => 10_001n,
        voterAt: () => {
          throw new Error("voterAt should not be called");
        },
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  await assertRejects(
    () => readRound(client, POOL, { rosterPage: 200, chainId: 31337 }),
    PoolTooLargeError,
    "pool too large: 2 projects, 10001 voters",
  );
});

Deno.test("readRound: zisk pool pages the roster and sums commitments across pages", async () => {
  const voters: [Address, bigint][] = [[C, 100n], [D, 200n], [E, 300n]];
  let calls = 0;
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: sealedAbi,
      handlers: {
        ...common,
        kind: () => "zisk",
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 3n,
        abandonGrace: () => 604_800n,
        totalSeatWeight: () => 0n,
        projectCount: () => 1n,
        cost: () => 4_000n,
        contentRefOf: () => ZERO,
        voterCount: () => 3n,
        votersFrom: ([start, count]) => {
          assertEquals([Number(start as bigint), Number(count as bigint)], [calls, 1]);
          const [addr, weight] = voters[calls];
          calls++;
          // ballot "0x01": the pool's one project ranked first.
          return [[addr], [weight], [0n], ["0x01"], ["0x"]];
        },
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { facts } = await readRound(client, POOL, { rosterPage: 1, chainId: 31337 });
  assertEquals(calls, 3);
  assertEquals(facts.projects.map((p) => p.commitment), ["600"]);
});

Deno.test("readRound: noir pool pages the roster and reports every address", async () => {
  const addresses = [C, D, E];
  let calls = 0;
  const { transport } = fakeTransport([
    tokenContract,
    {
      address: POOL,
      abi: noirAbi,
      handlers: {
        ...common,
        profileId: () => "0x" + "ab".repeat(32),
        phase: () => 3,
        votingOpen: () => true,
        finality: () => 0,
        closed: () => true,
        closeCursor: () => 3n,
        abandonGrace: () => 604_800n,
        proofGrace: () => 86_400n,
        reportedAt: () => 0n,
        resultReported: () => false,
        ingestCursor: () => 0n,
        numBatches: () => 4n,
        sealedCount: () => 0n,
        totalSeatWeight: () => 0n,
        voterCount: () => 3n,
        votersFrom: ([start, count]) => {
          assertEquals([Number(start as bigint), Number(count as bigint)], [calls, 1]);
          const addr = addresses[calls];
          calls++;
          return [[addr], [0n], [0n], [0n], [[0n, 0n, 0n]], [false]];
        },
      },
    },
  ]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  const { roster } = await readRound(client, POOL, { rosterPage: 1, chainId: 31337 });
  assertEquals(calls, 3);
  assertEquals(roster.size, 3);
});
