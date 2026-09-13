import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RoundProvider, useRound } from "../app/context/rounds";

const swarm = vi.hoisted(() => ({ error: undefined as string | undefined, retry: vi.fn() }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, chainId: undefined }),
  useConnect: () => ({ connectAsync: async () => {}, connectors: [], isPending: false }),
  useDisconnect: () => ({ disconnect: () => {} }),
  useSwitchChain: () => ({ switchChainAsync: async () => {} }),
  usePublicClient: () => undefined,
  useWalletClient: () => ({ data: undefined }),
}));
vi.mock("../app/context/providers", async () => ({
  chain: { id: 31337, name: "Anvil" },
  Providers: ({ children }: { children: ReactNode }) => <>{children}</>,
  useRound: (await import("../app/context/rounds")).useRound,
  useSwarm: () => ({ client: undefined, info: undefined, ...swarm }),
}));
import { Shell } from "../app/root";

const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllEnvs(); swarm.error = undefined; swarm.retry.mockClear(); });
function Probe() {
  const location = useLocation(); const navigate = useNavigate(); const { pool } = useRound();
  return <><p data-testid="location">{location.pathname}{location.search}</p><p data-testid="pool">{pool || "none"}</p><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button><input aria-label="Draft" defaultValue="" /></>;
}
function mount(path = "/") {
  vi.stubEnv("VITE_POOL_ADDRESS", A);
  vi.stubEnv("VITE_ROUNDS", JSON.stringify([{ pool: A, name: "Community grants" }, { pool: B, name: "Builders fund" }]));
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><RoundProvider chainId={31337}><Shell><Probe /></Shell></RoundProvider></MemoryRouter></QueryClientProvider>);
}

test("global navigation has hierarchy and the directory never selects a default round", () => {
  mount();
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/deploy"]);
  expect(screen.queryByRole("navigation", { name: "Round pages" })).toBeNull();
  expect(screen.queryByText("Connect wallet")).toBeNull();
  expect(screen.getByTestId("pool").textContent).toBe("none");
});

test("round pages retain their address, actions are separate, and switching supports Back and Forward", () => {
  mount(`/vote?pool=${A}`);
  const pages = screen.getByRole("navigation", { name: "Round pages" });
  expect(within(pages).getAllByRole("link").map((a) => a.textContent)).toEqual(["Overview", "Proposals", "Vote", "Liquidity"]);
  expect(within(pages).getAllByRole("link").every((a) => a.getAttribute("href")?.endsWith(`?pool=${A}`))).toBe(true);
  expect(within(pages).getByRole("link", { name: "Vote" }).getAttribute("aria-current")).toBe("page");
  expect(within(screen.getByRole("navigation", { name: "Round actions" })).getAllByRole("link")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "A's ballot" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Switch round" }), { target: { value: B } });
  expect(screen.getByTestId("location").textContent).toBe(`/round?pool=${B}`);
  expect(screen.getByTestId("pool").textContent).toBe(B);
  expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByText("Back"));
  expect(screen.getByTestId("pool").textContent).toBe(A);
  expect(screen.getByTestId("location").textContent).toBe(`/vote?pool=${A}`);
  fireEvent.click(screen.getByText("Forward"));
  expect(screen.getByTestId("pool").textContent).toBe(B);
});

test("management exposes import, and global Create round leaves round navigation behind", () => {
  mount(`/import?pool=${B}`);
  const manage = screen.getByRole("navigation", { name: "Manage round" });
  expect(within(manage).getByRole("link", { name: "Import proposals" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /Create round/ }));
  expect(screen.getByTestId("location").textContent).toBe("/deploy");
  expect(screen.queryByRole("navigation", { name: "Round pages" })).toBeNull();
});

test("an invalid round never falls back to a different configured pool", () => {
  mount("/vote?pool=invalid");
  expect(screen.getByRole("link", { name: "Find or open a round" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Round pages" })).toBeNull();
});

test("background Swarm ID failure leaves public browsing usable and explicit retries show errors", () => {
  swarm.error = "The Swarm ID service did not respond.";
  mount(`/proposals?pool=${A}`);
  expect(screen.queryByText("Swarm ID could not load")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry Swarm ID" }));
  expect(swarm.retry).toHaveBeenCalledOnce();
  expect(screen.getByText("Swarm ID could not load")).toBeTruthy();
  expect(screen.getByText(swarm.error)).toBeTruthy();
});
