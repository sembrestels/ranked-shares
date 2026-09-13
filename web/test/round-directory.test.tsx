import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoundProvider, useRound, useRoundDirectory } from "../app/context/rounds";
import { configuredRounds, parseRounds, roundsStorageKey } from "../app/lib/round-directory";
import { openSnapshot, provenSnapshot } from "./fixtures/snapshots";

vi.mock("../app/context/providers", () => ({ chain: { id: 31337, name: "Anvil" } }));
import RoundsPage, { clientLoader } from "../app/routes/rounds";
const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";
const C = "0x0000000000000000000000000000000000000003";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function Destination() { const { search } = useLocation(); return <p>Opened {search}</p>; }
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><RoundProvider chainId={31337}><Routes><Route path="/" element={<RoundsPage />} /><Route path="/round" element={<Destination />} /></Routes></RoundProvider></MemoryRouter></QueryClientProvider>);
}
test("lists concurrent rounds, searches and filters without conflating their status", async () => {
  vi.stubEnv("VITE_POOL_ADDRESS", "");
  vi.stubEnv("VITE_ROUNDS", JSON.stringify([{ pool: A, name: "Community grants" }, { pool: B, name: "Builders fund" }, { pool: C, name: "Previous round" }]));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const pool = new URL(url, "http://localhost").searchParams.get("pool");
    return new Response(JSON.stringify({ ...(pool === C ? provenSnapshot : openSnapshot), pool, votingDeadline: Math.floor(Date.now() / 1000) + 3600 }));
  }));
  mount();
  await waitFor(() => expect(screen.getAllByText("Voting open")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Active" }));
  expect(screen.getByRole("link", { name: "Community grants" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Builders fund" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Previous round" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Find a round"), { target: { value: "builders" } });
  expect(screen.queryByRole("link", { name: "Community grants" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Find a round"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Completed" }));
  expect(screen.getByRole("link", { name: "Previous round" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Builders fund" })).toBeNull();
});

test("opens and remembers a validated round with its label; invalid input makes no request", async () => {
  vi.stubEnv("VITE_POOL_ADDRESS", ""); vi.stubEnv("VITE_ROUNDS", "");
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ...openSnapshot, pool: B })));
  vi.stubGlobal("fetch", fetch);
  mount();
  fireEvent.change(screen.getByLabelText("Round address"), { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Open round" }));
  expect(screen.getByRole("alert").textContent).toContain("valid round contract address");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Round address"), { target: { value: B } });
  fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Builders fund" } });
  fireEvent.click(screen.getByRole("button", { name: "Open round" }));
  await screen.findByText(`Opened ?pool=${B}`);
  expect(parseRounds(localStorage.getItem(roundsStorageKey(31337)))).toEqual([{ pool: B, name: "Builders fund" }]);
});

test("failed lookup preserves the address and does not save a broken round", async () => {
  vi.stubEnv("VITE_POOL_ADDRESS", ""); vi.stubEnv("VITE_ROUNDS", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No round contract" }), { status: 400 })));
  mount();
  fireEvent.change(screen.getByLabelText("Round address"), { target: { value: B } });
  fireEvent.click(screen.getByRole("button", { name: "Open round" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Round address") as HTMLInputElement).value).toBe(B);
  expect(parseRounds(localStorage.getItem(roundsStorageKey(31337)))).toEqual([]);
});

test("legacy links redirect to their overview and plain home stays a directory", () => {
  expect(clientLoader({ request: new Request(`http://localhost/?pool=${B}`) } as any)?.headers.get("Location")).toBe(`/round?pool=${B}`);
  expect(clientLoader({ request: new Request("http://localhost/") } as any)).toBeNull();
});

test("damaged storage is tolerated; addresses deduplicate and names remain pool-specific", () => {
  expect(parseRounds("not json")).toEqual([]);
  expect(parseRounds('[null,{"pool":"bad"},{}]')).toEqual([]);
  vi.stubEnv("VITE_POOL_ADDRESS", A); vi.stubEnv("VITE_ROUND_NAME", "Default grants");
  vi.stubEnv("VITE_ROUNDS", JSON.stringify([{ pool: A }, { pool: B, name: "Builders" }, { pool: B }]));
  expect(configuredRounds()).toEqual([{ pool: A, name: "Default grants" }, { pool: B, name: "Builders" }]);
});

test("minimum block and late receipts stay tied to their originating round", () => {
  let lateReceipt!: (block: number) => void;
  function Probe() {
    const round = useRound(); const navigate = useNavigate(); const { rounds } = useRoundDirectory();
    return <><p data-testid="after">{round.after ?? "none"}</p><p data-testid="names">{rounds.map((r) => r.name).join(",")}</p>
      <button onClick={() => { lateReceipt = round.markMined; navigate(`/round?pool=${B}`); }}>Switch</button>
      <button onClick={() => navigate(-1)}>Back</button></>;
  }
  localStorage.setItem(roundsStorageKey(31337), JSON.stringify([{ pool: A, name: "Saved label" }]));
  render(<MemoryRouter initialEntries={[`/round?pool=${A}`]}><RoundProvider chainId={31337}><Probe /></RoundProvider></MemoryRouter>);
  expect(screen.getByTestId("names").textContent).toContain("Saved label");
  fireEvent.click(screen.getByText("Switch"));
  act(() => lateReceipt(100));
  expect(screen.getByTestId("after").textContent).toBe("none");
  fireEvent.click(screen.getByText("Back"));
  expect(screen.getByTestId("after").textContent).toBe("100");
});
