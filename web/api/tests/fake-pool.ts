/** A viem transport that answers eth_call from handler functions, so chain
 * reads are tested without a node. Unknown functions revert, like a real
 * contract without that selector, which is what detectKind relies on. */
import {
  type Abi,
  type Address,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  toHex,
} from "viem";

export interface FakeContract {
  address: Address;
  abi: Abi;
  handlers: Record<string, (args: readonly unknown[]) => unknown>;
}

export function fakeTransport(contracts: FakeContract[], block = 100n) {
  const byAddr = new Map(contracts.map((c) => [c.address.toLowerCase(), c]));
  const calls: string[] = [];
  const transport = custom({
    // deno-lint-ignore require-await
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      if (method === "eth_chainId") return toHex(31337);
      if (method === "eth_blockNumber") return toHex(block);
      if (method === "eth_call") {
        const [{ to, data }] = params as [{ to: Address; data: Hex }];
        const c = byAddr.get(to.toLowerCase());
        if (!c) throw new Error(`no contract at ${to}`);
        let functionName: string;
        let args: readonly unknown[];
        try {
          const d = decodeFunctionData({ abi: c.abi, data });
          functionName = d.functionName;
          args = d.args ?? [];
        } catch {
          throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
        }
        const h = c.handlers[functionName];
        if (!h) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
        return encodeFunctionResult({ abi: c.abi, functionName, result: h(args) as never });
      }
      throw new Error(`unexpected rpc method ${method}`);
    },
  });
  return { transport, calls };
}

export const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
export const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
export const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
export const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
