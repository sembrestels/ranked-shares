import { expect, test } from "vitest";
import { custom, decodeFunctionData, encodeFunctionResult, parseAbi, toHex } from "viem";
import { projectFacts, projectIds, roundFacts } from "../app/lib/build-chain";

const abi = parseAbi([
  "function projectCount() view returns (uint256)",
  "function cost(uint256) view returns (uint256)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function votingDeadline() view returns (uint64)",
  "function token() view returns (address)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const handlers: Record<string, (args: readonly unknown[]) => unknown> = {
  projectCount: () => 2n,
  cost: ([id]) => (Number(id) === 0 ? 4_000_000_000n : 2_500_000_000n),
  contentRefOf: ([id]) => (Number(id) === 0 ? "0x" + "ab".repeat(32) : "0x" + "00".repeat(32)),
  votingDeadline: () => 1_700_003_600n,
  token: () => TOKEN,
  symbol: () => "USDC",
  decimals: () => 6,
};
const transport = custom({
  async request({ method, params }: { method: string; params?: unknown[] }) {
    if (method === "eth_chainId") return toHex(31337);
    if (method !== "eth_call") throw new Error(method);
    const [{ data }] = params as [{ data: `0x${string}` }];
    const { functionName, args } = decodeFunctionData({ abi, data });
    return encodeFunctionResult({ abi, functionName, result: handlers[functionName](args ?? []) as never });
  },
});
const cfg = { rpc: "http://fake", pool: POOL as `0x${string}` };
const fetchTitle = (async () => new Response(new TextEncoder().encode(JSON.stringify({ version: 1, title: "Audit", body: "", attachments: [] })))) as unknown as typeof fetch;

test("projectIds reads the count", async () => {
  expect(await projectIds(cfg, transport)).toEqual([0, 1]);
});

test("projectFacts reads cost, token, and the title through the gateway", async () => {
  expect(await projectFacts(0, cfg, transport, "http://bee", fetchTitle)).toEqual({ title: "Audit", cost: "4000000000", decimals: 6, symbol: "USDC" });
  expect(await projectFacts(1, cfg, transport, "http://bee", fetchTitle)).toEqual({ title: null, cost: "2500000000", decimals: 6, symbol: "USDC" });
});

test("roundFacts reads the deadline", async () => {
  expect(await roundFacts(cfg, transport, "Autumn grants")).toEqual({ name: "Autumn grants", votingDeadline: 1_700_003_600 });
});

test("projectFacts rejects when the token's decimals read fails, rather than guessing 18", async () => {
  const failingTransport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_chainId") return toHex(31337);
      if (method !== "eth_call") throw new Error(method);
      const [{ data }] = params as [{ data: `0x${string}` }];
      const { functionName, args } = decodeFunctionData({ abi, data });
      if (functionName === "decimals") throw new Error("execution reverted");
      return encodeFunctionResult({ abi, functionName, result: handlers[functionName](args ?? []) as never });
    },
  });
  await expect(projectFacts(0, cfg, failingTransport, "http://bee", fetchTitle)).rejects.toThrow();
});
