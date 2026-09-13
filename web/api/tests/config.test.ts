import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "../config.ts";

Deno.test("loadConfig: defaults", () => {
  const c = loadConfig({});
  assertEquals(c.port, 8000);
  assertEquals(c.rpcUrls, ["https://rpc.testnet.arc.io"]);
  assertEquals(c.chainId, 5042002);
  assertEquals(c.poolAddress, null);
  assertEquals(c.webOrigins, ["http://localhost:5174"]);
  assertEquals(c.beeUrl, null);
  assertEquals(c.snapshotTtlMs, 15_000);
  assertEquals(c.rosterPage, 200);
  assertEquals(c.contentTimeoutMs, 5_000);
});

Deno.test("loadConfig: explicit Anvil chain retains the local RPC default", () => {
  const c = loadConfig({ CHAIN_ID: "31337" });
  assertEquals(c.chainId, 31337);
  assertEquals(c.rpcUrls, ["http://127.0.0.1:8545"]);
});

Deno.test("loadConfig: VITE_ fallbacks, lists, checksummed pool, trailing slash trimmed", () => {
  const c = loadConfig({
    VITE_RPC_URL: "http://a , http://b",
    VITE_CHAIN_ID: "5042002",
    VITE_POOL_ADDRESS: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    BEE_URL: "http://bee:1633/",
    WEB_ORIGIN: "https://ranked.example, http://localhost:5174",
  });
  assertEquals(c.rpcUrls, ["http://a", "http://b"]);
  assertEquals(c.chainId, 5042002);
  assertEquals(c.poolAddress, "0x5FbDB2315678afecb367f032d93F642f64180aa3");
  assertEquals(c.beeUrl, "http://bee:1633");
  assertEquals(c.webOrigins, ["https://ranked.example", "http://localhost:5174"]);
});

Deno.test("loadConfig: API variables win over VITE_ ones", () => {
  const c = loadConfig({
    RPC_URL: "http://api",
    VITE_RPC_URL: "http://vite",
    CHAIN_ID: "7",
    VITE_CHAIN_ID: "8",
  });
  assertEquals(c.rpcUrls, ["http://api"]);
  assertEquals(c.chainId, 7);
});

Deno.test("loadConfig: rejects a malformed pool and a non-numeric port", () => {
  assertThrows(() => loadConfig({ POOL_ADDRESS: "0x12" }), Error, "POOL_ADDRESS");
  assertThrows(() => loadConfig({ PORT: "eighty" }), Error, "PORT");
});
