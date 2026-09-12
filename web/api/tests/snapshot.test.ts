import { assertEquals, assertRejects } from "@std/assert";
import { createSnapshots } from "../services/snapshot.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

const facts = (block: number) => {
  const { at: _at, stage: _stage, projects, ...rest } = openSnapshot;
  return {
    facts: { ...rest, block, projects: projects.map(({ title: _t, ...p }) => p) },
    roster: new Set<string>(),
  };
};
// deno-lint-ignore require-await
const noTitle = async () => null;

Deno.test("snapshots: reads once within the TTL and stamps at and stage", async () => {
  let reads = 0;
  let t = 1_000;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => {
      reads++;
      return facts(10);
    },
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => t,
  });
  const first = await s.get(POOL);
  assertEquals(first.snapshot.at, 1_000);
  assertEquals(first.snapshot.stage.current, "open");
  assertEquals(first.snapshot.projects.map((p) => p.title), [null, null]);
  t = 1_010;
  await s.get(POOL);
  assertEquals(reads, 1);
  t = 1_016;
  await s.get(POOL);
  assertEquals(reads, 2);
});

Deno.test("snapshots: concurrent callers share one read", async () => {
  let reads = 0;
  const s = createSnapshots({
    read: async () => {
      reads++;
      await new Promise((r) => setTimeout(r, 5));
      return facts(10);
    },
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => 1_000,
  });
  await Promise.all([s.get(POOL), s.get(POOL), s.get(POOL)]);
  assertEquals(reads, 1);
});

Deno.test("snapshots: minBlock forces a re-read when the cache is older, at most twice", async () => {
  const blocks = [10, 10, 12];
  let reads = 0;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => facts(blocks[reads++]),
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => 1_000,
  });
  await s.get(POOL);
  const r = await s.get(POOL, 12);
  assertEquals(r.snapshot.block, 12);
  assertEquals(reads, 3);
});

Deno.test("snapshots: a failed read rejects and keeps the last good value for the next call", async () => {
  let fail = false;
  let t = 1_000;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => {
      if (fail) throw new Error("rpc");
      return facts(10);
    },
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => t,
  });
  await s.get(POOL);
  fail = true;
  t = 1_020;
  await assertRejects(() => s.get(POOL), Error, "rpc");
  fail = false;
  const again = await s.get(POOL);
  assertEquals(again.snapshot.block, 10);
});

Deno.test("snapshots: titles come from titleOf per content reference; a zero reference or a failure gives null", async () => {
  const asked: string[] = [];
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => facts(10),
    // deno-lint-ignore require-await
    titleOf: async (ref) => {
      asked.push(ref);
      if (ref.startsWith("0xabab")) return "Formal audit of the tally";
      throw new Error("gateway down");
    },
    ttlMs: 15_000,
    now: () => 1_000,
  });
  const { snapshot } = await s.get(POOL);
  assertEquals(snapshot.projects.map((p) => p.title), ["Formal audit of the tally", null]);
  assertEquals(asked.length, 1);
});

Deno.test("snapshots: a titleOf that throws synchronously gives null and does not poison the cache", async () => {
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => facts(10),
    titleOf: (() => {
      throw new Error("boom");
    }) as unknown as (ref: `0x${string}`) => Promise<string | null>,
    ttlMs: 15_000,
    now: () => 1_000,
  });
  const first = await s.get(POOL);
  assertEquals(first.snapshot.projects.map((p) => p.title), [null, null]);
  const second = await s.get(POOL);
  assertEquals(second.snapshot.projects.map((p) => p.title), [null, null]);
});

Deno.test("snapshots: a failed first read leaves no entry, so the next read tries again", async () => {
  let reads = 0;
  let fail = true;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => {
      reads++;
      if (fail) throw new Error("rpc");
      return facts(10);
    },
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => 1_000,
  });
  await assertRejects(() => s.get(POOL), Error, "rpc");
  assertEquals(reads, 1);
  fail = false;
  const again = await s.get(POOL);
  assertEquals(again.snapshot.block, 10);
  assertEquals(reads, 2);
});

Deno.test("snapshots: bounds the cache to 64 pools, evicting the oldest on the 65th", async () => {
  const addressFor = (i: number) => `0x${i.toString(16).padStart(40, "0")}` as `0x${string}`;
  let reads = 0;
  let t = 0;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => {
      reads++;
      return facts(10);
    },
    titleOf: noTitle,
    ttlMs: 1_000_000_000, // far longer than the test runs, so entries stay fresh
    now: () => t,
  });
  for (let i = 1; i <= 64; i++) {
    t = i;
    await s.get(addressFor(i));
  }
  assertEquals(reads, 64);
  // The 65th pool evicts pool #1, the oldest `at`.
  t = 65;
  await s.get(addressFor(65));
  assertEquals(reads, 65);
  // Pool #1 was evicted: reading it again is a fresh read.
  t = 66;
  await s.get(addressFor(1));
  assertEquals(reads, 66);
  // A recent pool (#64) is still cached: reading it triggers no read.
  t = 67;
  await s.get(addressFor(64));
  assertEquals(reads, 66);
});

Deno.test("snapshots: a failure inside the success handler resets the cache instead of poisoning it", async () => {
  let reads = 0;
  let broken = true;
  const s = createSnapshots({
    // deno-lint-ignore require-await
    read: async () => {
      reads++;
      const f = facts(10);
      return broken
        ? {
          facts: { ...f.facts, projects: null as unknown as typeof f.facts.projects },
          roster: f.roster,
        }
        : f;
    },
    titleOf: noTitle,
    ttlMs: 15_000,
    now: () => 1_000,
  });
  await assertRejects(() => s.get(POOL));
  assertEquals(reads, 1);
  broken = false;
  const again = await s.get(POOL);
  assertEquals(again.snapshot.block, 10);
  assertEquals(reads, 2);
});
