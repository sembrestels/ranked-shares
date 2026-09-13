import { getAddress, isAddress, type Address } from "viem";
import type { RoundSnapshot } from "./api-types";

export interface RoundEntry { pool: Address; name?: string }

export function parseRounds(raw: string | null | undefined): RoundEntry[] {
  try {
    const values: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(values)) return [];
    return mergeRounds(values.flatMap((value): RoundEntry[] => {
      if (!value || typeof value !== "object" || typeof value.pool !== "string" || !isAddress(value.pool)) return [];
      return [{ pool: getAddress(value.pool), name: typeof value.name === "string" ? value.name.trim().slice(0, 100) || undefined : undefined }];
    }));
  } catch { return []; }
}

export function mergeRounds(...lists: RoundEntry[][]): RoundEntry[] {
  const rounds = new Map<string, RoundEntry>();
  for (const entry of lists.flat()) {
    const key = entry.pool.toLowerCase();
    const previous = rounds.get(key);
    rounds.set(key, { pool: getAddress(entry.pool), name: entry.name || previous?.name });
  }
  return [...rounds.values()];
}

export function configuredRounds(): RoundEntry[] {
  const pool = import.meta.env.VITE_POOL_ADDRESS as string | undefined;
  return mergeRounds(
    pool && isAddress(pool) ? [{ pool, name: import.meta.env.VITE_ROUND_NAME || undefined }] : [],
    parseRounds(import.meta.env.VITE_ROUNDS),
  );
}

export const roundHref = (pool: string, path = "/round") => `${path}?pool=${pool}`;
export const roundName = (entry: RoundEntry) => entry.name || `Round ${entry.pool.slice(0, 6)}…${entry.pool.slice(-4)}`;
export const roundsStorageKey = (chainId: number) => `rankedshares:rounds:${chainId}`;

export function roundStatus(snapshot: RoundSnapshot, now: number) {
  if (snapshot.phase === "done") return "Completed";
  if (snapshot.phase === "setup") return "Accepting proposals";
  if (snapshot.phase === "open") return now >= snapshot.votingDeadline ? "Voting ended" : "Voting open";
  return snapshot.phase === "closing" ? "Closing ballots" : "Counting votes";
}
