import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ballotAbi } from "../../cre/src/lib/arkiv";
import type { PublishedBallot } from "../app/lib/arkiv";

const state = vi.hoisted(() => ({
  pool: undefined as Address | undefined,
  pub: null as any,
  wallet: null as any,
  payloads: new Map<string, Hex>(),
  switchChain: vi.fn(),
  uploads: 0,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: state.wallet?.account.address }),
  usePublicClient: () => state.pub,
  useWalletClient: () => ({ data: state.wallet }),
  useSwitchChain: () => ({ switchChainAsync: state.switchChain }),
}));
vi.mock("wagmi/actions", () => ({ getWalletClient: async () => state.wallet }));
vi.mock(
  "../app/context/providers",
  () => ({
    chain: { id: 31337 },
    config: {},
    useRound: () => ({ pool: state.pool }),
    useSwarm: () => ({ client: undefined }),
  }),
);
vi.mock("../app/lib/arkiv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/arkiv")>();
  const verifyPublished = async (b: PublishedBallot) => {
    if (state.payloads.get(b.entityKey!) !== b.payload) {
      throw new Error("Missing test ballot");
    }
  };
  return {
    ...actual,
    publishBallot: async (_wallet: unknown, b: PublishedBallot) => {
      state.uploads++;
      b.entityKey = toHex(BigInt(state.uploads), { size: 32 });
      b.storageTx = toHex(77n, { size: 32 });
      b.expiresAt = "99999999";
      state.payloads.set(b.entityKey, b.payload);
      actual.savePending(b);
      return b;
    },
    resumePublication: async (b: PublishedBallot) => {
      await verifyPublished(b);
      return b;
    },
    verifyPublished,
    loadPayloads: async () => state.payloads,
  };
});
import VotePage from "../app/routes/vote";

const chain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8575"] } },
});
const transport = http();
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const pub = createPublicClient({ chain, transport, pollingInterval: 50 });
const wallet = createWalletClient({ account, chain, transport });
const query = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});
let anvil: ChildProcess;
const here = import.meta.url;
function artifact(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../out/${name}.sol/${name}.json`, here), "utf8"),
  );
}
beforeAll(async () => {
  localStorage.clear();
  anvil = spawn("anvil", ["--port", "8575", "--silent"], { stdio: "pipe" });
  await waitFor(async () => expect(await pub.getChainId()).toBe(31337), {
    timeout: 10_000,
  });
  async function deploy(name: string, args: unknown[] = []) {
    const a = artifact(name);
    const hash = await wallet.deployContract({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args,
    });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  }
  const token = await deploy("MockERC20");
  const pool = await deploy("RankedShares", [
    token,
    account.address,
    (await pub.getBlock()).timestamp + 3600n,
  ]);
  async function send(
    address: Address,
    abi: any,
    functionName: string,
    args: unknown[] = [],
  ) {
    const hash = await wallet.writeContract({
      address,
      abi,
      functionName,
      args,
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe(
      "success",
    );
  }
  const poolAbi = artifact("RankedShares").abi;
  await send(pool, poolAbi, "enableArkivBallots");
  await send(pool, poolAbi, "addProject", [50n, account.address]);
  await send(pool, poolAbi, "addProject", [30n, account.address]);
  await send(pool, poolAbi, "openVoting");
  await send(token, artifact("MockERC20").abi, "mint", [account.address, 80n]);
  await send(token, artifact("MockERC20").abi, "approve", [pool, 80n]);
  await send(pool, poolAbi, "contribute", [80n]);
  state.pool = pool;
  state.pub = pub;
  state.wallet = wallet;
}, 20_000);
afterAll(() => {
  cleanup();
  query.clear();
  anvil?.kill("SIGTERM");
});

test(
  "rendered ballot flow: store, reject pool signature, resume, and show live result",
  async () => {
    render(
      <QueryClientProvider client={query}>
        <VotePage />
      </QueryClientProvider>,
    );
    const first = await screen.findByLabelText("Project 1");
    fireEvent.change(first, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Project 2"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "1. Store ballot in Arkiv" }),
    );
    const confirm = await screen.findByRole("button", {
      name: "2. Confirm ballot in the round",
    });
    const write = vi.spyOn(wallet, "writeContract").mockRejectedValueOnce(
      new Error("User rejected the request"),
    );
    fireEvent.click(confirm);
    await screen.findByText("User rejected the request");
    expect(
      (await pub.readContract({
        address: state.pool!,
        abi: ballotAbi,
        functionName: "ballotRefOf",
        args: [account.address, false],
      })).revision,
    ).toBe(0n);
    fireEvent.click(
      screen.getByRole("button", { name: "2. Confirm ballot in the round" }),
    );
    await screen.findByText("Your ballot has been accepted by the round.", {}, {
      timeout: 10_000,
    });
    await screen.findByText(
      /Calculated in your browser from 1 accepted public ballot\./,
    );
    expect(state.uploads).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(state.switchChain).toHaveBeenCalledWith({ chainId: 7738577 });
    expect(
      (await pub.readContract({
        address: state.pool!,
        abi: ballotAbi,
        functionName: "ballotRefOf",
        args: [account.address, false],
      })).revision,
    ).toBe(1n);
  },
  15_000,
);
