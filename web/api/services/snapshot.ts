/** Per-pool cache of the round snapshot: TTL, single-flight, and a minimum
 * block for the refetch after a user's own transaction. Spec decisions 6, 7. */
import type { Address, Hex } from "viem";
import type { ProjectView, RoundFacts } from "../chain/read.ts";
import { type Stage, stageOf } from "./stage.ts";

export type SnapshotProject = ProjectView & { title: string | null };
export type RoundSnapshot = Omit<RoundFacts, "projects"> & {
  projects: SnapshotProject[];
  at: number;
  stage: Stage;
};
const ZERO_REF = "0x" + "00".repeat(32);
export interface Snapshot {
  snapshot: RoundSnapshot;
  roster: Set<string>;
}
export interface Snapshots {
  get(pool: Address, minBlock?: number): Promise<Snapshot>;
}

interface Entry {
  at: number;
  value: Snapshot | null;
  pending: Promise<Snapshot> | null;
}

/** How many pools' snapshots to keep at once, so an attacker cycling through
 * ?pool= addresses cannot grow the cache without bound. */
const MAX_ENTRIES = 64;

export function createSnapshots(opts: {
  read: (pool: Address) => Promise<{ facts: RoundFacts; roster: Set<string> }>;
  /** A project's pitch title by content reference; null when there is none or it fails. */
  titleOf: (ref: Hex) => Promise<string | null>;
  ttlMs: number;
  now: () => number;
}): Snapshots {
  const entries = new Map<string, Entry>();

  function fresh(e: Entry | undefined, minBlock?: number): Snapshot | null {
    if (!e?.value) return null;
    if ((opts.now() - e.at) * 1000 >= opts.ttlMs) return null;
    if (minBlock !== undefined && e.value.snapshot.block < minBlock) return null;
    return e.value;
  }

  function evictIfFull() {
    if (entries.size <= MAX_ENTRIES) return;
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of entries) {
      // An in-flight read (including a first-time pool, whose `at` is 0)
      // must never be evicted: doing so would drop it from the map while a
      // concurrent caller's get() is about to look it up, making that caller
      // start a duplicate read instead of joining the one already running.
      if (v.pending !== null) continue;
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) entries.delete(oldestKey);
  }

  function start(key: string, pool: Address): Promise<Snapshot> {
    const e = entries.get(key) ?? { at: 0, value: null, pending: null };
    // A single .catch after the whole chain, not a second .then argument: a
    // second .then argument only catches a rejection of opts.read itself, not
    // a throw from anywhere later in the chain (per-project titles, stageOf,
    // the entries.set below) — such a throw would otherwise leave `pending`
    // pointed at a rejected promise forever, poisoning every later get().
    const pending = opts.read(pool)
      .then(async ({ facts, roster }) => {
        const projects: SnapshotProject[] = await Promise.all(facts.projects.map(async (p) => ({
          ...p,
          // Wrapped so a titleOf that throws synchronously (not just one
          // that rejects) is also swallowed to null.
          title: p.contentRef.toLowerCase() === ZERO_REF
            ? null
            : await Promise.resolve().then(() => opts.titleOf(p.contentRef)).catch(() => null),
        })));
        const at = opts.now();
        const value = { snapshot: { ...facts, projects, at, stage: stageOf(facts, at) }, roster };
        entries.set(key, { at, value, pending: null });
        evictIfFull();
        return value;
      })
      .catch((err) => {
        if (e.value === null) entries.delete(key);
        else entries.set(key, { at: e.at, value: e.value, pending: null });
        throw err;
      });
    entries.set(key, { ...e, pending });
    return pending;
  }

  return {
    async get(pool, minBlock) {
      const key = pool.toLowerCase();
      const cached = fresh(entries.get(key), minBlock);
      if (cached) return cached;
      const e = entries.get(key);
      let value = await (e?.pending ?? start(key, pool));
      if (minBlock !== undefined && value.snapshot.block < minBlock) {
        value = await (entries.get(key)?.pending ?? start(key, pool));
      }
      return value;
    },
  };
}
