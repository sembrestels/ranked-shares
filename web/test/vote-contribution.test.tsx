import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Address, createPublicClient, createTestClient, createWalletClient, defineChain, erc20Abi, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contributionAmount, sendContribution } from "../app/lib/contribution";
import { readVoting, votingBlockReason } from "../app/lib/ballots";

const state = vi.hoisted(() => ({ pool: undefined as Address | undefined, pub: null as any, wallet: null as any }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: state.wallet?.account.address }),
  usePublicClient: () => state.pub,
  useWalletClient: () => ({ data: state.wallet }),
  useSwitchChain: () => ({ switchChainAsync: async () => {} }),
}));
vi.mock("wagmi/actions", () => ({ getWalletClient: async () => state.wallet }));
vi.mock("../app/context/providers", () => ({
  chain: { id: 31337 }, config: {}, useRound: () => ({ pool: state.pool }), useSwarm: () => ({ client: undefined }),
}));
vi.mock("../app/lib/arkiv", async (original) => ({ ...await original<typeof import("../app/lib/arkiv")>(), loadPayloads: async () => new Map() }));
import VotePage from "../app/routes/vote";

const chain = defineChain({ id: 31337, name: "Anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8577"] } } });
// Anvil's public development key, used exclusively on the local test node.
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const pub = createPublicClient({ chain, transport: http(), pollingInterval: 50, cacheTime: 0 });
const node = createTestClient({ chain, mode: "anvil", transport: http() });
let snapshot: `0x${string}`;
const wallet = createWalletClient({ account, chain, transport: http() });
const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
let anvil: ChildProcess, token: Address;
const here = import.meta.url;
function artifact(name: string) { return JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, here), "utf8")); }
beforeAll(async () => {
  localStorage.clear();
  anvil = spawn("anvil", ["--port", "8577", "--silent"], { stdio: "pipe" });
  await waitFor(async () => expect(await pub.getChainId()).toBe(31337), { timeout: 10_000 });
  async function deploy(name: string, args: unknown[] = []) {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  }
  async function send(address: Address, name: string, functionName: string, args: unknown[] = []) {
    const hash = await wallet.writeContract({ address, abi: artifact(name).abi, functionName, args });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
  }
  token = await deploy("MockPermitToken");
  state.pool = await deploy("RankedShares", [token, account.address, (await pub.getBlock()).timestamp + 3600n]);
  await send(state.pool, "RankedShares", "enableArkivBallots");
  await send(state.pool, "RankedShares", "addProject", [parseEther("1"), account.address]);
  await send(state.pool, "RankedShares", "openVoting");
  await send(token, "MockPermitToken", "mint", [account.address, parseEther("2")]);
  state.pub = pub;
  state.wallet = wallet;
  snapshot = await node.snapshot();
}, 20_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await node.revert({ id: snapshot });
  snapshot = await node.snapshot();
});
afterEach(() => { cleanup(); query.clear(); });
afterAll(() => { cleanup(); query.clear(); anvil?.kill("SIGTERM"); });

test("public eligibility distinguishes sponsored seats, too little direct weight, and an already final ballot", async () => {
  const r = { ...await readVoting(pub, state.pool!, account.address), kind: "noir" as const, minimum: 1_000_000n, minimumSealed: 1_000_000n, seats: 1_000_000n };
  expect(votingBlockReason(r, undefined, false)).toMatch(/Connect your wallet/);
  expect(votingBlockReason(r, account.address, false)).toMatch(/direct contribution/);
  expect(votingBlockReason(r, account.address, true)).toBeUndefined();
  expect(votingBlockReason({ ...r, direct: 999_999n }, account.address, false)).toMatch(/direct contribution/);
  expect(votingBlockReason({ ...r, direct: 1_000_000n }, account.address, false)).toBeUndefined();
  expect(votingBlockReason({ ...r, publicRef: { ...r.publicRef!, revision: 1n } }, account.address, false)).toMatch(/already final/);
  expect(votingBlockReason({ ...r, timestamp: r.deadline }, account.address, false)).toMatch(/not open/);
});

test("amounts are exact and changed wallet accounts cannot send approval", async () => {
  expect(contributionAmount("1.000001", 6)).toBe(1_000_001n);
  for (const amount of ["0", "-1", "1.0000001", "1e6", "Infinity"]) expect(() => contributionAmount(amount, 6)).toThrow();
  await expect(sendContribution(pub, wallet, state.pool!, token, 1n, "approve")).rejects.toThrow(/account changed/);
  const wrongChain = { ...wallet, getChainId: async () => 1 };
  await expect(sendContribution(pub, wrongChain, state.pool!, account.address, 1n, "approve")).rejects.toThrow(/round's network/);
});

test("permit and contribution-vote use one transaction; a timeout resumes without another deposit", async () => {
  const page = () => <QueryClientProvider client={query}><VotePage /></QueryClientProvider>;
  let view = render(page());
  const input = await screen.findByLabelText("Contribution (PMT)");
  fireEvent.change(input, { target: { value: "3" } });
  expect((screen.getByRole("button", { name: "Contribute and vote" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText(/Your wallet needs 1 more PMT/).length).toBeGreaterThan(0);
  fireEvent.change(input, { target: { value: "1" } });
  const writes = vi.spyOn(wallet, "writeContract");
  const signatures = vi.spyOn(wallet, "signTypedData").mockRejectedValueOnce(new Error("User rejected the request"));
  fireEvent.click(screen.getByRole("button", { name: "Contribute and vote" }));
  await screen.findByText("User rejected the request");
  expect(writes).not.toHaveBeenCalled();
  expect((await readVoting(pub, state.pool!, account.address)).direct).toBe(0n);
  vi.spyOn(pub, "waitForTransactionReceipt").mockRejectedValueOnce(new Error("Confirmation timed out"));
  fireEvent.click(screen.getByRole("button", { name: "Resume vote" }));
  await screen.findByText("Confirmation timed out");
  const key = "ranked-shares.cast.pending.v2";
  expect(JSON.parse(localStorage.getItem(key)!).voteTx).toMatch(/^0x/);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes.mock.calls[0][0].functionName).toBe("castBallot");
  view.unmount(); query.clear(); view = render(page());
  fireEvent.click(await screen.findByRole("button", { name: "Check vote confirmation" }));
  await screen.findByText("Your vote is recorded. Arkiv storage syncs automatically; no further transaction is needed.", {}, { timeout: 10_000 });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(signatures).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(key)).toBeNull();
  expect((await readVoting(pub, state.pool!, account.address)).direct).toBe(parseEther("1"));
  expect(await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })).toBe(parseEther("1"));
  expect(await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, state.pool!] })).toBe(0n);
  view.unmount();
}, 20_000);

test("tokens without a recognized permit domain get one approval followed by the combined vote", async () => {
  const read = pub.readContract.bind(pub);
  vi.spyOn(pub, "readContract").mockImplementation((async (request: any) => {
    if (request.functionName === "DOMAIN_SEPARATOR") throw new Error("Permit unavailable");
    return read(request);
  }) as never);
  const writes = vi.spyOn(wallet, "writeContract");
  const signs = vi.spyOn(wallet, "signTypedData");
  const view = render(<QueryClientProvider client={query}><VotePage /></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText("Contribution (PMT)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Contribute and vote" }));
  await screen.findByText("Your vote is recorded. Arkiv storage syncs automatically; no further transaction is needed.", {}, { timeout: 10_000 });
  expect(writes.mock.calls.map(([request]) => request.functionName)).toEqual(["approve", "castBallot"]);
  expect(signs).not.toHaveBeenCalled();
  expect((await readVoting(pub, state.pool!, account.address)).direct).toBe(parseEther("1"));
  view.unmount();
}, 20_000);
