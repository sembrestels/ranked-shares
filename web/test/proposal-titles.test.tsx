import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProposalTitles } from "../app/hooks/use-proposal-titles";
import { openSnapshot } from "./fixtures/snapshots";
import type { RoundSnapshot } from "../app/lib/api-types";

const firstRef = `0x${"ab".repeat(32)}` as const;
const secondRef = `0x${"cd".repeat(32)}` as const;
const project = { ...openSnapshot.projects[0], title: null };
const content = (title: string) => Response.json({ version: 1, title, body: "Proposal details", attachments: [] });
const clients: QueryClient[] = [];
function mount(snapshot: RoundSnapshot | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retryDelay: 0 } } });
  clients.push(client);
  return renderHook(({ value }) => useProposalTitles(value), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    initialProps: { value: snapshot },
  });
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

test("Swarm titles arrive independently, leave funding visible, and are cached across snapshot polls", async () => {
  let finishFirst!: (response: Response) => void;
  const fetch = vi.fn(async (url: string) => url.includes(firstRef.slice(2))
    ? new Promise<Response>((resolve) => { finishFirst = resolve; }) : content("Community kitchen"));
  vi.stubGlobal("fetch", fetch);
  const snapshot = { ...openSnapshot, projects: [project, { ...project, id: 1, contentRef: secondRef }] };
  const { result, rerender } = mount(snapshot);
  await waitFor(() => expect(result.current.snapshot?.projects[1].title).toBe("Community kitchen"));
  expect(result.current.snapshot?.projects[0].title).toBe("Loading proposal title…");
  expect(result.current.snapshot?.projects[0].cost).toBe(project.cost);
  finishFirst(content("3D printing station"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.snapshot?.projects[0].title).toBe("3D printing station");
  rerender({ value: { ...snapshot, block: snapshot.block + 1 } });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url]) => url.includes("/bytes/"))).toBe(true);
});

test("changing round or revision cannot display the previous proposal's cached title", async () => {
  let finishSecond!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes(firstRef.slice(2))
    ? content("Original title") : new Promise<Response>((resolve) => { finishSecond = resolve; })));
  const { result, rerender } = mount({ ...openSnapshot, projects: [project] });
  await waitFor(() => expect(result.current.snapshot?.projects[0].title).toBe("Original title"));
  rerender({ value: { ...openSnapshot, pool: "0x0000000000000000000000000000000000000002", projects: [{ ...project, contentRef: secondRef }] } });
  expect(result.current.snapshot?.projects[0].title).toBe("Loading proposal title…");
  finishSecond(content("Different round proposal"));
  await waitFor(() => expect(result.current.snapshot?.projects[0].title).toBe("Different round proposal"));
});

test("unavailable titles keep amounts visible and can be retried", async () => {
  const fetch = vi.fn(async () => new Response("Unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const { result } = mount({ ...openSnapshot, projects: [project] });
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.snapshot?.projects[0]).toMatchObject({ title: "Proposal 1 · Title unavailable", cost: project.cost });
  fetch.mockImplementation(async () => content("Recovered title"));
  await act(async () => { await result.current.retry(); });
  await waitFor(() => expect(result.current.snapshot?.projects[0].title).toBe("Recovered title"));
  expect(result.current.failed).toBe(false);
});

test("no round, existing API titles, and empty content references need no Swarm request", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { result, rerender } = mount(undefined);
  expect(result.current.snapshot).toBeUndefined();
  expect(result.current.loading).toBe(false);
  rerender({ value: openSnapshot });
  expect(result.current.snapshot?.projects[0].title).toBe(openSnapshot.projects[0].title);
  expect(result.current.loading).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
