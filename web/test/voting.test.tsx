import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  hexToBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ballotAbi } from "../../cre/src/lib/arkiv";
import type { PublishedBallot } from "../app/lib/arkiv";
import { arkiv } from "../app/lib/arkiv";

const state = vi.hoisted(() => ({
  pool: undefined as Address | undefined,
  pub: null as any,
  wallet: null as any,
  payloads: new Map<string, Hex>(),
  switchChain: vi.fn(),
  uploads: 0,
  failNextUpload: false,
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
      if (state.failNextUpload) {
        state.failNextUpload = false;
        throw new Error("Ballot storage is temporarily unavailable.");
      }
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
  await send(pool, poolAbi, "addProject", [20n, account.address]);
  await send(pool, poolAbi, "addProject", [10n, account.address]);
  await send(pool, poolAbi, "addProject", [5n, account.address]);
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
  "rendered ballot flow: resume voting, finalize the tally, and expire review payloads",
  async () => {
    const view = render(
      <QueryClientProvider client={query}>
        <VotePage />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Project 1" });
    fireEvent.click(screen.getByRole("button", { name: "Project 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Move here: Must fund" }));
    const savedPool = state.pool;
    state.pool = undefined;
    view.rerender(<QueryClientProvider client={query}><VotePage /></QueryClientProvider>);
    await screen.findByText("Choose a pool above to vote and view results.");
    state.pool = savedPool;
    view.rerender(<QueryClientProvider client={query}><VotePage /></QueryClientProvider>);
    await screen.findByRole("button", { name: "Project 1" });
    expect(within(screen.getByRole("region", { name: /^Unplaced proposals/ })).getAllByRole("button")).toHaveLength(5);
    for (const [project, tier] of [[1, "Must fund"], [2, "Must fund"], [3, "Should fund"], [4, "Nice to have"]]) {
      fireEvent.click(screen.getByRole("button", { name: `Project ${project}` }));
      fireEvent.click(screen.getByRole("button", { name: `Move here: ${tier}` }));
    }
    const write = vi.spyOn(wallet, "writeContract").mockRejectedValueOnce(new Error("User rejected the request"));
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    await screen.findByText("User rejected the request");
    expect(state.uploads).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Resume vote" }));
    await screen.findByText("Your vote is recorded. Arkiv storage syncs automatically; no further transaction is needed.", {}, { timeout: 10_000 });
    expect(within(await screen.findByRole("region", { name: /^Unplaced proposals/ })).getAllByRole("button")).toHaveLength(5);
    await screen.findByText(/Calculated in your browser from 1 accepted public ballot\./);
    expect(state.uploads).toBe(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(state.switchChain).not.toHaveBeenCalledWith({ chainId: 7738577 });
    const acceptedRef = await pub.readContract({ address: state.pool!, abi: ballotAbi, functionName: "ballotRefOf", args: [account.address, false] });
    expect(acceptedRef.revision).toBe(1n);
    state.payloads.set(acceptedRef.entityKey, "0x0101030400");

    // Finalize the real local pool, then let the simulated Arkiv node expire its
    // entity. The rendered route must drop review contents, not its final result.
    let arkivHead = 100n;
    vi.spyOn(arkiv, "getChainId").mockResolvedValue(7738577);
    vi.spyOn(arkiv, "getBlockNumber").mockImplementation(async () => arkivHead);
    const reviewQuery = { where: vi.fn(), atBlock: vi.fn(), limit: vi.fn(), fetch: async () => ({
      blockNumber: arkivHead,
      entities: arkivHead < 101n ? [{ key: acceptedRef.entityKey, payload: hexToBytes("0x0101030400"), expiresAt: 101n }] : [],
      hasNextPage: () => false,
    }) };
    reviewQuery.where.mockReturnValue(reviewQuery);
    reviewQuery.atBlock.mockReturnValue(reviewQuery);
    reviewQuery.limit.mockReturnValue(reviewQuery);
    vi.spyOn(arkiv, "select").mockReturnValue(reviewQuery as never);
    await pub.request({ method: "evm_increaseTime", params: [3601] } as never);
    await pub.request({ method: "evm_mine" } as never);
    for (const [functionName, args] of [["startTally", []], ["runArkiv", [20n, ["0x0101030400"]]]] as const) {
      const hash = await wallet.writeContract({ address: state.pool!, abi: artifact("RankedShares").abi, functionName, args });
      expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    }
    await query.invalidateQueries({ queryKey: ["voting"] });
    await screen.findByText("Final funded projects");
    await screen.findByText(/1 of 1 accepted ballots are available for review/);
    expect(screen.getByText("1, 1, 3, 4, 0")).toBeTruthy();
    arkivHead = 101n;
    await query.invalidateQueries({ queryKey: ["arkiv-ballot-review"] });
    await screen.findByText(/Ballot review period ended/);
    expect(screen.queryByText("1, 1, 3, 4, 0")).toBeNull();
    expect(screen.getByText("Final funded projects")).toBeTruthy();
  },
  15_000,
);
