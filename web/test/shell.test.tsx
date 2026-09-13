import { expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, chainId: undefined }),
  useConnect: () => ({ connectAsync: async () => {}, connectors: [], isPending: false }),
  useDisconnect: () => ({ disconnect: () => {} }),
  useSwitchChain: () => ({ switchChainAsync: async () => {} }),
  usePublicClient: () => undefined,
  useWalletClient: () => ({ data: undefined }),
}));
vi.mock("../app/context/providers", () => ({
  chain: { id: 31337, name: "Anvil" },
  Providers: ({ children }: { children: ReactNode }) => <>{children}</>,
  useRound: () => ({ pool: undefined, setPool: () => {}, after: undefined, markMined: () => {} }),
  useSwarm: () => ({ client: undefined, info: undefined, error: undefined, retry: () => {} }),
}));
import { Shell } from "../app/root";

test("the shell has the wordmark, the four navigation links, and the stage bar slot", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><Shell><p>page</p></Shell></MemoryRouter>
    </QueryClientProvider>,
  );
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Round", "Proposals", "Vote", "Liquidity", "Submit an idea", "Organizer"]);
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/proposals", "/vote", "/liquidity", "/submit", "/setup"]);
  expect(screen.getByText("page")).toBeTruthy();
  expect(screen.getByRole("contentinfo").textContent).toContain("check this result yourself");
});
