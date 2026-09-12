import { assertEquals } from "@std/assert";
import { createContent } from "../services/content.ts";

const REF = ("0x" + "ab".repeat(32)) as `0x${string}`;
const ZERO = ("0x" + "00".repeat(32)) as `0x${string}`;
const manifest = new TextEncoder().encode(
  JSON.stringify({ version: 1, title: "Audit", body: "Hello", attachments: [] }),
);

const fetchWith = (handler: (url: string) => Response | Promise<Response>) => {
  const urls: string[] = [];
  // deno-lint-ignore require-await
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { f, urls };
};

Deno.test("content: zero reference is none", async () => {
  const c = createContent({
    beeUrl: "http://bee",
    fetch: fetchWith(() => new Response("x")).f,
    timeoutMs: 100,
  });
  assertEquals(await c.get(ZERO), { status: "none", content: null, reason: null });
});

Deno.test("content: no gateway configured is unavailable with a reason", async () => {
  const c = createContent({
    beeUrl: null,
    fetch: fetchWith(() => new Response("x")).f,
    timeoutMs: 100,
  });
  assertEquals(await c.get(REF), {
    status: "unavailable",
    content: null,
    reason: "no gateway configured",
  });
});

Deno.test("content: fetches /bytes/<ref>, parses the manifest, and caches by reference", async () => {
  const { f, urls } = fetchWith(() => new Response(manifest));
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100 });
  const first = await c.get(REF);
  assertEquals(first.status, "ok");
  assertEquals(first.content?.title, "Audit");
  await c.get(REF);
  assertEquals(urls, [`http://bee/bytes/${"ab".repeat(32)}`]);
});

Deno.test("content: a 404, a timeout, and unparseable bytes are unavailable and not cached", async () => {
  const { f, urls } = fetchWith((url) => {
    if (url.endsWith("cc".repeat(32))) return new Response("nope", { status: 404 });
    if (url.endsWith("dd".repeat(32))) {
      return Promise.reject(new DOMException("timed out", "TimeoutError"));
    }
    return new Response(new TextEncoder().encode("not json"));
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100 });
  const gone = await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(gone.status, "unavailable");
  assertEquals(gone.reason, "gateway answered 404");
  const slow = await c.get(("0x" + "dd".repeat(32)) as `0x${string}`);
  assertEquals(slow.status, "unavailable");
  const junk = await c.get(("0x" + "ee".repeat(32)) as `0x${string}`);
  assertEquals(junk.status, "unavailable");
  await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(urls.length, 4);
});
