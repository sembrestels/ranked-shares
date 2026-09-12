import { assertEquals, assertRejects } from "@std/assert";
import { custom, HttpRequestError, toHex } from "viem";
import { noirAbi, plainAbi, sealedAbi } from "../chain/abi.ts";
import { createClient } from "../chain/client.ts";
import { detectKind } from "../chain/kind.ts";
import { fakeTransport, POOL } from "./fake-pool.ts";

const clientFor = (
  abi: typeof plainAbi | typeof sealedAbi | typeof noirAbi,
  handlers: Record<string, () => unknown>,
) =>
  createClient({
    rpcUrls: ["http://fake"],
    chainId: 31337,
    transport: fakeTransport([{ address: POOL, abi, handlers }]).transport,
  });

Deno.test("detectKind: kind() = zisk", async () => {
  const client = clientFor(sealedAbi, { kind: () => "zisk" });
  assertEquals(await detectKind(client, POOL, 100n), "zisk");
});

Deno.test("detectKind: kind() = cre", async () => {
  const client = clientFor(sealedAbi, { kind: () => "cre" });
  assertEquals(await detectKind(client, POOL, 100n), "cre");
});

Deno.test("detectKind: kind() = public is the plain pool", async () => {
  const client = clientFor(plainAbi, { kind: () => "public" });
  assertEquals(await detectKind(client, POOL, 100n), "plain");
});

Deno.test("detectKind: kind() = noir is noir without probing profileId", async () => {
  const { transport, calls } = fakeTransport([{
    address: POOL,
    abi: noirAbi,
    handlers: { kind: () => "noir" },
  }]);
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  assertEquals(await detectKind(client, POOL, 100n), "noir");
  assertEquals(calls.filter((m) => m === "eth_call").length, 1);
});

Deno.test("detectKind: no kind() but profileId() = noir", async () => {
  const client = clientFor(noirAbi, { profileId: () => "0x" + "ab".repeat(32) });
  assertEquals(await detectKind(client, POOL, 100n), "noir");
});

Deno.test("detectKind: neither = plain", async () => {
  const client = clientFor(plainAbi, { tallyDone: () => false });
  assertEquals(await detectKind(client, POOL, 100n), "plain");
});

Deno.test("detectKind: a transport failure rejects instead of falling through to plain", async () => {
  const transport = custom({
    // deno-lint-ignore require-await
    async request({ method }: { method: string }) {
      if (method === "eth_chainId") return toHex(31337);
      if (method === "eth_blockNumber") return toHex(100n);
      throw new HttpRequestError({ url: "http://fake", cause: new Error("connection refused") });
    },
  });
  const client = createClient({ rpcUrls: ["http://fake"], chainId: 31337, transport });
  await assertRejects(() => detectKind(client, POOL, 100n));
});
