// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi } from "viem";
import { createClient } from "../api/chain/client";
import { rpcUrlsFor } from "../network";

afterEach(() => vi.unstubAllGlobals());

test("concurrent Arc reads batch at the requested block and fall back when an RPC is rate limited", async () => {
  const abi = parseAbi(["function owner() view returns (address)", "function proposalCount() view returns (uint256)"]);
  const owner = "0x0000000000000000000000000000000000000001";
  const requests: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    requests.push({ url: String(url), body });
    if (String(url).includes("primary")) {
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32005, message: "rate limit exceeded" } });
    }
    const aggregate = decodeFunctionData({ abi: multicall3Abi, data: body.params[0].data });
    if (aggregate.functionName !== "aggregate3") throw new Error("Expected batched reads");
    const results = aggregate.args[0].map(({ callData }) => {
      const { functionName } = decodeFunctionData({ abi, data: callData });
      return { success: true, returnData: functionName === "owner"
        ? encodeFunctionResult({ abi, functionName, result: owner })
        : encodeFunctionResult({ abi, functionName, result: 15n }) };
    });
    return Response.json({ jsonrpc: "2.0", id: body.id,
      result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }) });
  }));
  const client = createClient({ chainId: 5042002, rpcUrls: ["https://primary.test", "https://secondary.test"] });
  const common = { address: owner, abi, blockNumber: 123n } as const;
  expect(await Promise.all([
    client.readContract({ ...common, functionName: "owner" }),
    client.readContract({ ...common, functionName: "proposalCount" }),
  ])).toEqual([owner, 15n]);
  expect(requests).toHaveLength(2);
  expect(requests.map(({ url }) => url)).toEqual(["https://primary.test/", "https://secondary.test/"]);
  for (const { body } of requests) {
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to.toLowerCase()).toBe("0xca11bde05977b3631167028862be2a173976ca11");
    expect(body.params[1]).toBe("0x7b");
    expect(decodeFunctionData({ abi: multicall3Abi, data: body.params[0].data }).args[0]).toHaveLength(2);
  }
});

test("explicit RPC overrides remain exclusive and local chains keep their local endpoint", () => {
  expect(rpcUrlsFor(5042002, " https://one.test, https://two.test , ")).toEqual(["https://one.test", "https://two.test"]);
  expect(rpcUrlsFor(31337)).toEqual(["http://127.0.0.1:8545"]);
});
