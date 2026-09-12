import { assertEquals } from "@std/assert";
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

Deno.test("detectKind: no kind() but profileId() = noir", async () => {
  const client = clientFor(noirAbi, { profileId: () => "0x" + "ab".repeat(32) });
  assertEquals(await detectKind(client, POOL, 100n), "noir");
});

Deno.test("detectKind: neither = plain", async () => {
  const client = clientFor(plainAbi, { tallyDone: () => false });
  assertEquals(await detectKind(client, POOL, 100n), "plain");
});
