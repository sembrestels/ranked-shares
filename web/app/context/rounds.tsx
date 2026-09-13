import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { getAddress, isAddress, type Address } from "viem";
import { configuredRounds, mergeRounds, parseRounds, roundsStorageKey, type RoundEntry } from "../lib/round-directory";

type RoundContext = {
  pool?: Address;
  setPool: (pool: Address) => void;
  after?: number;
  markMined: (block: number, target?: Address) => void;
};
const Round = createContext<RoundContext>({ setPool: () => {}, markMined: () => {} });
const Directory = createContext<{ rounds: RoundEntry[]; remember: (entry: RoundEntry) => void }>({ rounds: [], remember: () => {} });
export const useRound = () => useContext(Round);
export const useRoundDirectory = () => useContext(Directory);

export function RoundProvider({ children, chainId }: { children: ReactNode; chainId: number }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(search).get("pool");
  // Global pages never silently select the configured round. Legacy round routes
  // without a query retain their configured fallback; invalid queries do not.
  const value = requested ?? (pathname !== "/" && pathname !== "/deploy" ? import.meta.env.VITE_POOL_ADDRESS : undefined);
  const pool = value && isAddress(value) ? getAddress(value) : undefined;
  const [mined, setMined] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<RoundEntry[]>([]);
  const storageKey = roundsStorageKey(chainId);
  useEffect(() => {
    function restore() {
      try { setSaved(parseRounds(localStorage.getItem(storageKey))); } catch { /* Storage may be disabled. */ }
    }
    restore();
    function changed(event: StorageEvent) { if (event.key === storageKey || event.key === null) restore(); }
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [storageKey]);

  function remember(entry: RoundEntry) {
    setSaved((previous) => {
      let stored: RoundEntry[] = [];
      try { stored = parseRounds(localStorage.getItem(storageKey)); } catch { /* Use memory. */ }
      const next = mergeRounds(previous, stored, [entry]);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep navigation usable without storage. */ }
      return next;
    });
  }
  useEffect(() => { if (pool) remember({ pool }); }, [pool, storageKey]);

  function setPool(next: Address) {
    remember({ pool: next });
    const params = new URLSearchParams(search);
    params.set("pool", getAddress(next));
    navigate({ pathname, search: `?${params}` });
  }
  // Each callback stays tied to its originating pool if a transaction finishes
  // after the user has moved to another round.
  function markMined(block: number, target = pool) {
    if (target) {
      const key = getAddress(target);
      setMined((previous) => ({ ...previous, [key]: Math.max(previous[key] ?? 0, block) }));
    }
  }
  return <Round.Provider value={{ pool, setPool, after: pool ? mined[pool] : undefined, markMined }}>
    <Directory.Provider value={{ rounds: mergeRounds(configuredRounds(), saved, pool ? [{ pool }] : []), remember }}>
      {children}
    </Directory.Provider>
  </Round.Provider>;
}
