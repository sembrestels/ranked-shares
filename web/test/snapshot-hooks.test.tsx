import { afterEach, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ after: undefined as number | undefined, pool: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }) }));
vi.mock("../app/context/providers", () => ({
  useRound: () => ({ pool: state.pool, after: state.after, markMined: () => {} }),
}));
import { useProject, useRoundSnapshot, useVoter } from "../app/hooks/use-snapshot";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
afterEach(() => { vi.unstubAllGlobals(); state.pool = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; });

test.each(["round", "project", "voter"])("switching pools never carries previous %s data", async (kind) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sharedWrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let resolveSecond!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("0x5FbDB")) return new Response(JSON.stringify({ marker: "round A" }));
    return new Promise<Response>((resolve) => { resolveSecond = resolve; });
  }));
  const hook = kind === "round" ? useRoundSnapshot : kind === "project" ? () => useProject(0) : useVoter;
  const { result, rerender } = renderHook(hook as typeof useRoundSnapshot, { wrapper: sharedWrapper });
  await waitFor(() => expect(result.current.data).toEqual({ marker: "round A" }));
  state.pool = "0x0000000000000000000000000000000000000002";
  rerender();
  expect(result.current.data).toBeUndefined();
  resolveSecond(new Response(JSON.stringify({ marker: "round B" })));
  await waitFor(() => expect(result.current.data).toEqual({ marker: "round B" }));
});

test("useRoundSnapshot fetches the configured pool and passes after", async () => {
  state.after = 42;
  const f = vi.fn(async () => new Response(JSON.stringify({ block: 42 }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  const { result } = renderHook(() => useRoundSnapshot(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual({ block: 42 }));
  expect(f).toHaveBeenCalledWith("/api/round?pool=0x5FbDB2315678afecb367f032d93F642f64180aa3&after=42");
});

test("behind: only when both are known and the block is older", async () => {
  const { behind } = await import("../app/hooks/use-snapshot");
  expect(behind(10, 12)).toBe(true);
  expect(behind(12, 12)).toBe(false);
  expect(behind(undefined, 12)).toBe(false);
  expect(behind(10, undefined)).toBe(false);
});

test("useVoter fetches the connected address", async () => {
  state.after = undefined;
  const f = vi.fn(async (_url?: string) => new Response(JSON.stringify({ inRoster: true }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  const { result } = renderHook(() => useVoter(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual({ inRoster: true }));
  expect(String(f.mock.calls[0][0])).toBe(
    "/api/voter/0x70997970C51812dc3A010C7d01b50e0d17dc79C8?pool=0x5FbDB2315678afecb367f032d93F642f64180aa3",
  );
});

test("useProject: switching ids does not leak the previous project's data as a placeholder", async () => {
  state.after = undefined;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sharedWrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let resolveSecond!: (response: Response) => void;
  const f = vi.fn(async (input?: string) => {
    if (String(input).includes("/api/project/0")) return new Response(JSON.stringify({ id: 0, title: "Project 0" }), { status: 200 });
    return new Promise<Response>((resolve) => { resolveSecond = resolve; });
  });
  vi.stubGlobal("fetch", f);
  const { result, rerender } = renderHook(({ id }: { id: number }) => useProject(id), { wrapper: sharedWrapper, initialProps: { id: 0 } });
  await waitFor(() => expect(result.current.data).toEqual({ id: 0, title: "Project 0" }));
  rerender({ id: 1 });
  expect(result.current.data).toBeUndefined();
  resolveSecond(new Response(JSON.stringify({ id: 1, title: "Project 1" }), { status: 200 }));
  await waitFor(() => expect(result.current.data).toEqual({ id: 1, title: "Project 1" }));
});
