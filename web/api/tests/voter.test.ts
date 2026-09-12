import { assertEquals } from "@std/assert";
import { noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { readVoter } from "../chain/read.ts";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { A, B, fakeTransport, POOL } from "./fake-pool.ts";
import { openSnapshot } from "./fixtures.ts";

const same = (x: unknown, y: string) => (x as string).toLowerCase() === y.toLowerCase();

Deno.test("readVoter: plain pool", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: plainAbi,
    handlers: {
      weightOf: ([a]) => same(a, A) ? 1_000n : 0n,
      ballotOf: ([a]) => same(a, A) ? "0x0102" : "0x",
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "plain", A, 100n), {
    weight: { direct: "1000", seats: "0", total: "1000" },
    ballot: { public: { ranks: [1, 2] }, sealed: false },
  });
  assertEquals(await readVoter(client, POOL, "plain", B, 100n), {
    weight: { direct: "0", seats: "0", total: "0" },
    ballot: { public: null, sealed: false },
  });
});

Deno.test("readVoter: zisk pool with a sealed ballot", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: sealedAbi,
    handlers: {
      directWeight: () => 0n,
      seatWeight: () => 500n,
      directBallotOf: () => "0x",
      sealedOf: () => "0x" + "cd".repeat(35),
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "zisk", B, 100n), {
    weight: { direct: "0", seats: "500", total: "500" },
    ballot: { public: null, sealed: true },
  });
});

Deno.test("readVoter: zisk pool in Arkiv mode reports presence from ballotRefOf", async () => {
  const ref = (k: bigint) => ({
    entityKey: ("0x" + k.toString(16).padStart(64, "0")) as `0x${string}`,
    payloadHash: ("0x" + "11".repeat(32)) as `0x${string}`,
    revision: k === 0n ? 0n : 1n,
    blockNumber: k === 0n ? 0n : 120n,
  });
  const { transport } = fakeTransport([{
    address: POOL,
    abi: sealedAbi,
    handlers: {
      arkivBallots: () => true,
      directWeight: () => 0n,
      seatWeight: () => 500n,
      directBallotOf: () => {
        throw new Error("legacy getter");
      },
      ballotRefOf: ([, isSealed]) => (isSealed ? ref(2n) : ref(0n)),
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "zisk", B, 100n), {
    weight: { direct: "0", seats: "500", total: "500" },
    ballot: { public: null, sealed: true },
  });
});

Deno.test("readVoter: noir pool reports presence without decoding the packed ballot", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: noirAbi,
    handlers: {
      directWeight: () => 7n,
      seatWeight: () => 0n,
      hasDirect: () => true,
      directBallotOf: () => 5n,
      sealedOf: () => [0n, 0n, 0n],
    },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await readVoter(client, POOL, "noir", A, 100n), {
    weight: { direct: "7", seats: "0", total: "7" },
    ballot: { public: { ranks: [] }, sealed: false },
  });
});

Deno.test("GET /api/voter/:address joins the snapshot's roster and validates the address", async () => {
  const { transport } = fakeTransport([{
    address: POOL,
    abi: sealedAbi,
    handlers: {
      directWeight: () => 1_000n,
      seatWeight: () => 0n,
      directBallotOf: () => "0x0102",
      sealedOf: () => "0x",
    },
  }]);
  const deps: Deps = {
    config: loadConfig({ POOL_ADDRESS: POOL }),
    client: createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport }),
    snapshots: {
      // deno-lint-ignore require-await
      get: async () => ({ snapshot: openSnapshot, roster: new Set([A.toLowerCase()]) }),
    },
    // deno-lint-ignore require-await
    content: { get: async () => ({ status: "none", content: null, reason: null }) },
    now: () => 0,
    log: () => {},
  };
  const app = createApp(deps);
  const res = await app.fetch(new Request(`http://x/api/voter/${A.toLowerCase()}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    address: A,
    block: 123,
    weight: { direct: "1000", seats: "0", total: "1000" },
    ballot: { public: { ranks: [1, 2] }, sealed: false },
    inRoster: true,
  });
  const other = await (await app.fetch(new Request(`http://x/api/voter/${B}`))).json();
  assertEquals(other.inRoster, false);
  assertEquals((await app.fetch(new Request("http://x/api/voter/0x12"))).status, 400);
});
