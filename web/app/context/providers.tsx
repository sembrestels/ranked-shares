import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, injected, WagmiProvider } from "wagmi";
import { type Address, defineChain, isAddress } from "viem";
import type { ConnectionInfo, SwarmIdClient } from "@snaha/swarm-id";
import { errorMessage } from "../lib/proposals";
import { initializeSwarm } from "../lib/swarm";
import { tiramisu } from "@arkiv-network/sdk/chains";

const env = import.meta.env;
export const chain = defineChain({
  id: Number(env.VITE_CHAIN_ID || 31337),
  name: env.VITE_CHAIN_NAME || "Anvil",
  nativeCurrency: {
    name: env.VITE_NATIVE_SYMBOL || "ETH",
    symbol: env.VITE_NATIVE_SYMBOL || "ETH",
    decimals: 18,
  },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || "http://127.0.0.1:8545"] } },
});
export const config = createConfig({
  chains: [chain, tiramisu],
  connectors: [injected()],
  transports: { [chain.id]: http(), [tiramisu.id]: http(env.VITE_ARKIV_RPC_URL) },
  ssr: true,
});

type RoundContext = {
  pool?: Address;
  setPool: (pool: Address) => void;
  /** Block number of the user's last mined transaction; the API re-reads past it. */
  after?: number;
  markMined: (block: number) => void;
};
const Round = createContext<RoundContext>({ setPool: () => {}, markMined: () => {} });
export const useRound = () => useContext(Round);
type SwarmContext = {
  client?: SwarmIdClient;
  info?: ConnectionInfo;
  error?: string;
  retry: () => void;
};
const Swarm = createContext<SwarmContext>({ retry: () => {} });
export const useSwarm = () => useContext(Swarm);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [pool, setPool] = useState<Address | undefined>(
    isAddress(env.VITE_POOL_ADDRESS || "")
      ? env.VITE_POOL_ADDRESS as Address
      : undefined,
  );
  const [after, setAfter] = useState<number>();
  const markMined = (block: number) => setAfter((prev) => (prev === undefined || block > prev ? block : prev));
  const [client, setClient] = useState<SwarmIdClient>();
  const [info, setInfo] = useState<ConnectionInfo>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const value = new URLSearchParams(location.search).get("pool");
    if (value && isAddress(value)) setPool(value);
  }, []);
  useEffect(() => {
    let disposed = false;
    let storage: SwarmIdClient | undefined;
    setError(undefined);
    setClient(undefined);
    setInfo(undefined);
    // Browser-only lazy import: neither SSR nor unrelated pool reads need the SDK.
    import("@snaha/swarm-id").then(async ({ SwarmIdClient }) => {
      if (disposed) return;
      storage = new SwarmIdClient({
        iframeOrigin: env.VITE_SWARM_ID_ORIGIN || "https://swarm-id.snaha.net",
        metadata: {
          name: "RankedShares",
          description:
            "Submit proposals and supporting files for community funding.",
        },
        onConnectionChange: (next) => {
          if (!disposed) setInfo(next);
        },
      });
      await initializeSwarm(storage);
      if (!disposed) {
        setClient(storage);
        setInfo(storage.connectionInfo);
      }
    }).catch((err) => {
      storage?.destroy();
      if (!disposed) {
        setError(errorMessage(err));
        setInfo(undefined);
      }
    });
    return () => {
      disposed = true;
      storage?.destroy();
    };
  }, [attempt]);
  function selectPool(value: Address) {
    setPool(value);
    const url = new URL(location.href);
    url.searchParams.set("pool", value);
    history.replaceState(null, "", url);
  }
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Round.Provider value={{ pool, setPool: selectPool, after, markMined }}>
          <Swarm.Provider
            value={{
              client,
              info,
              error,
              retry: () => setAttempt((n) => n + 1),
            }}
          >
            {children}
          </Swarm.Provider>
        </Round.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
