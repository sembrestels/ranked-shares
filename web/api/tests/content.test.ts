import { assertEquals } from "@std/assert";
import { createContent, MAX_NEGATIVE } from "../services/content.ts";
import {
  type PrivateStorage,
  uploadPrivateProposal,
  ZERO_KEY,
} from "../../app/lib/private-proposals.ts";
import { type Hex, toHex } from "viem";

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
    now: () => 0,
  });
  assertEquals(await c.get(ZERO), { status: "none", content: null, reason: null });
});

Deno.test("content: no gateway configured is unavailable with a reason", async () => {
  const c = createContent({
    beeUrl: null,
    fetch: fetchWith(() => new Response("x")).f,
    timeoutMs: 100,
    now: () => 0,
  });
  assertEquals(await c.get(REF), {
    status: "unavailable",
    content: null,
    reason: "no gateway configured",
  });
});

Deno.test("content: fetches /bytes/<ref>, parses the manifest, and caches by reference", async () => {
  const { f, urls } = fetchWith(() => new Response(manifest));
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => 0 });
  const first = await c.get(REF);
  assertEquals(first.status, "ok");
  assertEquals(first.content?.title, "Audit");
  await c.get(REF);
  assertEquals(urls, [`http://bee/bytes/${"ab".repeat(32)}`]);
});

Deno.test("content: a 404, a timeout, and unparseable bytes are unavailable, and are not cached forever", async () => {
  let t = 0;
  const { f, urls } = fetchWith((url) => {
    if (url.endsWith("cc".repeat(32))) return new Response("nope", { status: 404 });
    if (url.endsWith("dd".repeat(32))) {
      return Promise.reject(new DOMException("timed out", "TimeoutError"));
    }
    return new Response(new TextEncoder().encode("not json"));
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => t });
  const gone = await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(gone.status, "unavailable");
  assertEquals(gone.reason, "gateway answered 404");
  const slow = await c.get(("0x" + "dd".repeat(32)) as `0x${string}`);
  assertEquals(slow.status, "unavailable");
  const junk = await c.get(("0x" + "ee".repeat(32)) as `0x${string}`);
  assertEquals(junk.status, "unavailable");
  t = 61; // past the negative-cache TTL
  await c.get(("0x" + "cc".repeat(32)) as `0x${string}`);
  assertEquals(urls.length, 4);
});

Deno.test("content: a failure is negative-cached for 60s, then refetched", async () => {
  let calls = 0;
  let t = 0;
  const { f } = fetchWith(() => {
    calls++;
    return new Response("nope", { status: 503 });
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => t });
  const first = await c.get(REF);
  assertEquals(first.status, "unavailable");
  assertEquals(calls, 1);
  t = 30;
  const second = await c.get(REF);
  assertEquals(second, first);
  assertEquals(calls, 1);
  t = 59; // still within the 60s TTL
  await c.get(REF);
  assertEquals(calls, 1);
  t = 60; // TTL has elapsed
  const third = await c.get(REF);
  assertEquals(third.status, "unavailable");
  assertEquals(calls, 2);
});

Deno.test("content: the negative cache is bounded to MAX_NEGATIVE entries, forgetting the oldest", async () => {
  const { f, urls } = fetchWith(() => new Response("nope", { status: 503 }));
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => 0 });
  const refFor = (i: number) => ("0x" + (i + 1).toString(16).padStart(64, "0")) as `0x${string}`;
  for (let i = 0; i < MAX_NEGATIVE + 1; i++) {
    await c.get(refFor(i));
  }
  assertEquals(urls.length, MAX_NEGATIVE + 1);
  // The first (oldest) failing ref was forgotten: fetching it again issues a new request,
  // even though `now()` never advanced past the negative TTL.
  await c.get(refFor(0));
  assertEquals(urls.length, MAX_NEGATIVE + 2);
});

Deno.test("content: a ref that fails then succeeds is served from the positive cache with no negative entry", async () => {
  let ok = false;
  let t = 0;
  const { f, urls } = fetchWith(() =>
    ok ? new Response(manifest) : new Response("nope", { status: 503 })
  );
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => t });
  const first = await c.get(REF);
  assertEquals(first.status, "unavailable");
  t = 60; // past the negative TTL, so a retry is attempted
  ok = true;
  const second = await c.get(REF);
  assertEquals(second.status, "ok");
  assertEquals(urls.length, 2);
  ok = false; // the gateway would fail again, but REF is now served from the positive cache
  const third = await c.get(REF);
  assertEquals(third.status, "ok");
  assertEquals(urls.length, 2);
});

Deno.test("content: a too-large declared length is unavailable and the body is not read", async () => {
  const { f } = fetchWith(() => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("body should not be read");
      },
    });
    return new Response(body, { headers: { "content-length": "3000000" } });
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => 0 });
  const res = await c.get(REF);
  assertEquals(res.status, "unavailable");
  assertEquals(res.reason, "content too large");
});

Deno.test("content: private review never reaches the public API; publication resolves without a stale cache or ACT identity", async () => {
  const objects = new Map<string, Uint8Array>();
  let key = ZERO_KEY;
  const pk = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const storage = {
    connectionInfo: { identity: { id: "test", sharingPublicKey: pk }, canUpload: true },
    // deno-lint-ignore require-await
    uploadData: async (data: Uint8Array) => {
      const reference = (objects.size + 1).toString(16).padStart(64, "0");
      objects.set(reference, new Uint8Array(data));
      return { reference };
    },
    // deno-lint-ignore require-await
    actUploadData: async (data: Uint8Array) => {
      key = toHex(data);
      return {
        encryptedReference: "ab".repeat(64),
        historyReference: "cd".repeat(64),
        publisherPubKey: pk,
      };
    },
  } as unknown as PrivateStorage;
  const upload = await uploadPrivateProposal(storage, {
    title: "Private pitch",
    body: "Reviewed text",
    files: [],
  }, {
    chainId: 31337,
    pool: `0x${"ab".repeat(20)}`,
    proposer: `0x${"cd".repeat(20)}`,
    organizerPublicKey: pk,
  }, () => {});
  const { f, urls } = fetchWith((url) => {
    const data = objects.get(url.split("/").at(-1)!);
    return data ? new Response(new Uint8Array(data)) : new Response("Missing", { status: 404 });
  });
  const c = createContent({ beeUrl: "http://bee", fetch: f, timeoutMs: 100, now: () => 0 });
  assertEquals((await c.get(upload.reference)).status, "private");
  assertEquals(urls.length, 1); // no payload fetch or ACT call before publication
  assertEquals((await c.get(upload.reference, ZERO_KEY)).content, null);
  assertEquals((await c.get(upload.reference, key)).content?.title, "Private pitch");
  assertEquals((await c.get(upload.reference)).content, null); // cannot leak through positive cache
  assertEquals(
    (await c.get(upload.reference, `0x${"ff".repeat(32)}` as Hex)).status,
    "unavailable",
  );
  assertEquals((await c.get(upload.reference, key)).content?.body, "Reviewed text");
});
