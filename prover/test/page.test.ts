// @vitest-environment jsdom
// prover/test/page.test.ts — a smoke test for the coordinator page (prover/src/web/):
// load the real `<main>` markup, stub out window.ethereum (Refresh/Audit never touch it),
// point it at a live anvil fixture chain and drive Refresh + Audit through actual clicks.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startFixtureChain, type FixtureChain } from "./helpers/anvil";

const PORT = 8551;

// jsdom (as of the version vitest's "jsdom" environment uses) doesn't implement `fetch`
// itself, so it doesn't overwrite the global; Node's own `fetch` (global since Node 18)
// should already be there. Set it explicitly anyway so viem's `http` transport has one
// regardless of how a given jsdom/vitest pairing wires globals.
if (typeof globalThis.fetch === "undefined") {
  throw new Error("no global fetch available in the jsdom test environment");
}

let chain: FixtureChain;
const fixtureMaster = "0x4d885451f27e770ee4b6aad84a413591ed03109df0def6b88fd104818c323740"; // reference/vectors/fixture_test_main.json .master
let ethereumCalls = 0;
const ethereumRequests: { method: string; params?: unknown[] }[] = [];

beforeAll(async () => {
  chain = await startFixtureChain({ port: PORT });

  // The real page markup, not a hand-rolled stand-in: `<main>…</main>` out of index.html.
  // Indirected through `here` rather than the literal `import.meta.url` token: under this
  // jsdom pool, Vite statically rewrites the exact `new URL("...", import.meta.url)`
  // pattern into a dev-server asset URL instead of a `file://` one (see helpers/anvil.ts).
  const here = import.meta.url;
  const html = readFileSync(new URL("../src/web/index.html", here), "utf8");
  const main = /<main>[\s\S]*<\/main>/.exec(html);
  if (!main) throw new Error("index.html has no <main> block");
  document.body.innerHTML = main[0];

  // A minimal injected-wallet stub. Refresh and Audit must never call it — asserted below.
  (window as any).ethereum = {
    request: async (req: { method: string; params?: unknown[] }) => {
      ethereumCalls++;
      ethereumRequests.push(req);
      // Behave like a wallet that does not know the chain yet: refuse the first switch with
      // EIP-3085's 4902, accept the add, then accept the switch.
      if (req.method === "wallet_switchEthereumChain" && !ethereumRequests.some((r) => r.method === "wallet_addEthereumChain")) {
        throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      }
      return [];
    },
  };

  // Hand the chain to the page the way dev-pool's printed URL does: through the query
  // string, so the prefill path in main.ts is what fills the inputs, not this test.
  window.history.replaceState(null, "", `/?rpc=${encodeURIComponent(chain.rpc)}&pool=${chain.pool}`);

  // Binds the button handlers against the DOM just built; must run after the markup is in
  // place and the query string is set, since main.ts reads `?rpc=&pool=` and looks up
  // elements by id at module-evaluation time.
  await import("../src/web/main.ts");
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

/** Poll an element's text until `predicate` holds, or fail after `timeoutMs`. */
async function waitForText(id: string, predicate: (text: string) => boolean, timeoutMs = 20_000): Promise<string> {
  const el = document.getElementById(id)!;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = el.textContent ?? "";
    if (predicate(text)) return text;
    if (Date.now() > deadline) throw new Error(`timed out waiting for #${id}; last text: ${text}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("the coordinator page", () => {
  test("prefills the RPC URL and pool address from the query string", () => {
    expect((document.getElementById("rpc") as HTMLInputElement).value).toBe(chain.rpc);
    expect((document.getElementById("pool") as HTMLInputElement).value).toBe(chain.pool);
  });

  test(
    "Refresh reports resultReported and the pool's coordinator; Audit says ok; window.ethereum is never touched",
    async () => {
      document.getElementById("refresh")!.dispatchEvent(new MouseEvent("click"));
      const statusText = await waitForText("status", (t) => t.includes("resultReported"));
      const status = JSON.parse(statusText);
      expect(status.resultReported).toBe(true);
      expect(status.coordinator.toLowerCase()).toBe(chain.coordinator.address.toLowerCase());
      expect(status.youAreCoordinator).toBe("not connected");

      document.getElementById("audit")!.dispatchEvent(new MouseEvent("click"));
      await waitForText("log", (t) => t.includes("audit ok"));

      expect(ethereumCalls).toBe(0);
    },
    60_000,
  );

  test("Switch wallet to RPC chain adds the chain on 4902 and reports it", async () => {
    const before = ethereumRequests.length;
    document.getElementById("switch-chain")!.dispatchEvent(new MouseEvent("click"));
    await waitForText("log", (t) => t.includes("wallet on chain 31337 (Anvil (local))"));
    const calls = ethereumRequests.slice(before).map((r) => r.method);
    expect(calls).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
    const add = ethereumRequests.slice(before)[1]!.params![0] as { chainId: string; rpcUrls: string[]; chainName: string };
    expect(add.chainId).toBe("0x7a69");
    expect(add.rpcUrls).toEqual([chain.rpc]);
    expect(add.chainName).toBe("Anvil (local)");
  }, 30_000);

  test("Use master secret loads a pasted hex master, clears the input and enables Prove", async () => {
    const input = document.getElementById("master") as HTMLInputElement;
    const prove = document.getElementById("prove") as HTMLButtonElement;
    const logEl = document.getElementById("log")!;
    expect(prove.disabled).toBe(true);

    input.value = "0x1234";
    document.getElementById("use-master")!.dispatchEvent(new MouseEvent("click"));
    await waitForText("log", (t) => t.includes("error: master secret must be 0x followed by 64 hex characters"));
    expect(prove.disabled).toBe(true);

    input.value = fixtureMaster;
    document.getElementById("use-master")!.dispatchEvent(new MouseEvent("click"));
    await waitForText("log", (t) => t.includes("master secret loaded from the input"));
    expect(input.value).toBe("");
    expect(prove.disabled).toBe(false);
    expect(logEl.textContent).not.toContain(fixtureMaster.slice(2, 12));
  }, 30_000);

  test("Audit with a bad RPC URL writes an error line to #log via the guard path", async () => {
    const rpcInput = document.getElementById("rpc") as HTMLInputElement;
    const logEl = document.getElementById("log")!;
    const before = logEl.textContent ?? "";
    rpcInput.value = "http://127.0.0.1:1"; // nothing listens on port 1: fails fast

    document.getElementById("audit")!.dispatchEvent(new MouseEvent("click"));
    await waitForText("log", (t) => t !== before && t.includes("error:"));

    rpcInput.value = chain.rpc; // restore, in case test order ever changes
  }, 30_000);
});
