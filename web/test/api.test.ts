import { expect, test, vi } from "vitest";
import { ApiError, fetchProject, fetchRound, fetchVoter } from "../app/lib/api";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

test("fetchRound builds the query string and returns the body", async () => {
  const f = vi.fn(async () => ok({ block: 7 }));
  const out = await fetchRound("0xabc", 12, f as unknown as typeof fetch);
  expect(f).toHaveBeenCalledWith("/api/round?pool=0xabc&after=12");
  expect(out).toEqual({ block: 7 });
});

test("fetchProject and fetchVoter omit unset parameters", async () => {
  const f = vi.fn(async (_url?: string) => ok({}));
  await fetchProject(3, undefined, undefined, f as unknown as typeof fetch);
  await fetchVoter("0xdef", "0xabc", 5, f as unknown as typeof fetch);
  expect(f.mock.calls.map((c) => c[0])).toEqual(["/api/project/3", "/api/voter/0xdef?pool=0xabc&after=5"]);
});

test("errors carry the API's message and status", async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ error: "rpc unavailable" }), { status: 502 }));
  await expect(fetchRound(undefined, undefined, f as unknown as typeof fetch)).rejects.toMatchObject({
    name: "ApiError",
    status: 502,
    message: "rpc unavailable",
  });
  const g = vi.fn(async () => new Response("<html>", { status: 500 }));
  await expect(fetchRound(undefined, undefined, g as unknown as typeof fetch)).rejects.toBeInstanceOf(ApiError);
});
