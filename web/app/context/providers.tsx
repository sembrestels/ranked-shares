import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, injected, WagmiProvider } from "wagmi";
import { defineChain } from "viem";
import type { ConnectionInfo, SwarmIdClient } from "@snaha/swarm-id";
import { errorMessage } from "../lib/proposals";
import { initializeSwarm } from "../lib/swarm";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { networkDefaults, rpcTransport, rpcUrlsFor } from "../../network";
import { RoundProvider } from "./rounds";
export { useRound } from "./rounds";

const env = import.meta.env;
const defaults = networkDefaults(Number(env.VITE_CHAIN_ID || 5042002));
export const chain = defineChain({
  ...defaults,
  name: env.VITE_CHAIN_NAME || defaults.name,
  nativeCurrency: {
    name: env.VITE_NATIVE_SYMBOL || defaults.nativeCurrency.symbol,
    symbol: env.VITE_NATIVE_SYMBOL || defaults.nativeCurrency.symbol,
    decimals: 18,
  },
  rpcUrls: { default: { http: rpcUrlsFor(defaults.id, env.VITE_RPC_URL) } },
});
export const config = createConfig({
  chains: [chain, tiramisu],
  connectors: [injected()],
  batch: { multicall: { wait: 16, batchSize: 8192 } },
  transports: { [chain.id]: rpcTransport(chain.rpcUrls.default.http), [tiramisu.id]: http(env.VITE_ARKIV_RPC_URL) },
  ssr: true,
});

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
  const [client, setClient] = useState<SwarmIdClient>();
  const [info, setInfo] = useState<ConnectionInfo>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
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
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RoundProvider chainId={chain.id}>
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
        </RoundProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
