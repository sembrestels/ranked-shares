import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendDeployment } from "../app/lib/deploy-transaction";
import { constructorFields, initialValues, parameterName } from "../app/lib/deployment";
import { loadRoundArtifact } from "../app/lib/deployment-catalog";
import { proofProfile, type SealedKind } from "../app/lib/round-configuration";
import { restoreRoundDeployment, runRoundDeployment, type RoundDeployment } from "../app/lib/round-deployment";

const state = vi.hoisted(() => ({
  address: undefined as Address | undefined, chainId: 31337, pub: null as any, wallet: null as any,
  setPool: vi.fn(), markMined: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: state.address, chainId: state.chainId }),
  usePublicClient: () => state.pub, useWalletClient: () => ({ data: state.wallet }),
  useConnect: () => ({ connectors: [], connectAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock("../app/context/providers", () => ({
  chain: { id: 31337, name: "Anvil", nativeCurrency: { symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8576"] } } },
  useRound: () => ({ setPool: state.setPool, markMined: state.markMined }),
}));
import DeployPage from "../app/routes/deploy";
import { clientLoader as roundEntryLoader } from "../app/routes/round";

const chain = defineChain({ id: 31337, name: "Anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8576"] } } });
const transport = http(chain.rpcUrls.default.http[0]);
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const client = createPublicClient({ chain, transport, pollingInterval: 25 });
const wallet = createWalletClient({ chain, transport, account });
let anvil: ChildProcess;
let token: Address;
let eurc: Address;
const mount = () => render(<MemoryRouter><DeployPage /></MemoryRouter>);
const here = import.meta.url;
const fixture = () => JSON.parse(readFileSync(new URL("../../out/MockERC20.sol/MockERC20.json", here), "utf8"));

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", "8576", "--silent"], { stdio: "pipe" });
  let spawnError: Error | undefined;
  anvil.on("error", (error) => { spawnError = error; });
  await waitFor(async () => { if (spawnError) throw spawnError; expect(await client.getChainId()).toBe(31337); }, { timeout: 10000 });
  state.address = account.address; state.pub = client; state.wallet = wallet;
  const artifact = JSON.parse(readFileSync(new URL("../../out/MockStablecoin.sol/MockStablecoin.json", here), "utf8"));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
  token = (await client.waitForTransactionReceipt({ hash })).contractAddress!;
  const eurcHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
  eurc = (await client.waitForTransactionReceipt({ hash: eurcHash })).contractAddress!;
  vi.stubEnv("VITE_USDC_ADDRESS", token);
  vi.stubEnv("VITE_EURC_ADDRESS", eurc);
}, 15000);
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.stubEnv("VITE_TALLY_SERVICE_URL", ""); vi.stubEnv("VITE_POOL_ADDRESS", ""); state.setPool.mockClear(); state.markMined.mockClear(); state.wallet = wallet; state.chainId = 31337; state.address = account.address; });
afterAll(() => { anvil?.kill("SIGTERM"); vi.unstubAllEnvs(); });

async function fillRound(fundingToken = token) {
  await screen.findByLabelText("Funding token");
  fireEvent.change(screen.getByLabelText("Funding token"), { target: { value: fundingToken } });
  fireEvent.change(screen.getByLabelText("Voting deadline"), { target: { value: "2099-06-01T12:30" } });
}

test("opening an overview without a round returns to the rounds directory", async () => {
  vi.stubEnv("VITE_POOL_ADDRESS", "");
  const router = createMemoryRouter([
    { path: "/round", loader: ({ request }) => roundEntryLoader({ request } as Parameters<typeof roundEntryLoader>[0]), element: <p>Existing round</p>, hydrateFallbackElement: <p>Loading…</p> },
    { path: "/", element: <p>Funding rounds directory</p> },
  ], { initialEntries: ["/round"] });
  render(<RouterProvider router={router} />);
  await screen.findByText("Funding rounds directory");
  expect(router.state.location.pathname).toBe("/");
  expect(router.state.historyAction).toBe("REPLACE");
  expect(screen.queryByRole("link", { name: "Deploy a round" })).toBeNull();
  router.dispose();
});

test.each(["link", "configuration"])("an existing round from %s keeps the round page", async (source) => {
  vi.stubEnv("VITE_POOL_ADDRESS", source === "configuration" ? token : "");
  const entry = source === "link" ? `/round?pool=${token}` : "/round";
  const router = createMemoryRouter([
    { path: "/round", loader: ({ request }) => roundEntryLoader({ request } as Parameters<typeof roundEntryLoader>[0]), element: <p>Existing round</p>, hydrateFallbackElement: <p>Loading…</p> },
    { path: "/deploy", element: <DeployPage /> },
  ], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  await screen.findByText("Existing round");
  expect(router.state.location.pathname).toBe("/round");
  expect(screen.queryByRole("combobox", { name: "Round type" })).toBeNull();
  router.dispose();
});

test.each(["USDC", "EURC"])("rendered round form deploys with %s and selects the confirmed round", async (symbol) => {
  const fundingToken = symbol === "USDC" ? token : eurc;
  mount(); await fillRound(fundingToken);
  const selector = screen.getByRole("combobox", { name: "Funding token" }) as HTMLSelectElement;
  expect(Array.from(selector.options, (option) => option.text)).toEqual(["USDC", "EURC"]);
  expect(screen.queryByLabelText("Organizer address")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Deploy round" }));
  await screen.findByRole("heading", { name: "Your round is ready for setup." }, { timeout: 15000 });
  expect(state.setPool).toHaveBeenCalledTimes(1);
  const pool = state.setPool.mock.calls[0][0] as Address;
  const abi = parseAbi(["function owner() view returns (address)", "function token() view returns (address)", "function votingDeadline() view returns (uint64)", "function proposalPrivacy() view returns (address)"]);
  expect((await client.readContract({ address: pool, abi, functionName: "owner" })).toLowerCase()).toBe(account.address.toLowerCase());
  expect((await client.readContract({ address: pool, abi, functionName: "token" })).toLowerCase()).toBe(fundingToken.toLowerCase());
  expect(await client.readContract({ address: pool, abi, functionName: "votingDeadline" })).toBe(BigInt(new Date("2099-06-01T12:30").getTime() / 1000));
  const privacy = await client.readContract({ address: pool, abi, functionName: "proposalPrivacy" });
  expect(await client.getCode({ address: privacy })).not.toBe("0x");
  expect(screen.getByRole("link", { name: "Set up this round" }).getAttribute("href")).toBe(`/setup?pool=${pool}`);
}, 20000);

test("validation and rejected signatures keep entered values and allow a retry", async () => {
  const send = vi.fn().mockRejectedValue(new Error("User rejected the request."));
  state.wallet = { ...wallet, sendTransaction: send };
  mount(); await screen.findByLabelText("Funding token");
  fireEvent.click(screen.getByRole("button", { name: "Deploy round" }));
  await screen.findByRole("alert"); expect(send).not.toHaveBeenCalled();
  await fillRound();
  fireEvent.click(screen.getByRole("button", { name: "Deploy round" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/rejected|declined/i));
  expect((screen.getByLabelText("Funding token") as HTMLSelectElement).value).toBe(token);
  expect((screen.getByRole("button", { name: "Deploy round" }) as HTMLButtonElement).disabled).toBe(false);
});

test("custom artifact imports and deploys without replacing the selected round", async () => {
  mount(); await screen.findByLabelText("Funding token");
  fireEvent.change(screen.getByLabelText("Round type"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Artifact or ABI JSON"), { target: { value: JSON.stringify(fixture()) } });
  fireEvent.click(screen.getByRole("button", { name: "Load constructor" }));
  expect(screen.getByText("This contract has no constructor arguments.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Deploy contract" }));
  await screen.findByRole("heading", { name: "Your contract is deployed." }, { timeout: 15000 });
  expect(state.setPool).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Set up this round" })).toBeNull();
}, 20000);

test("reopening the form confirms a persisted deployment without sending a duplicate", async () => {
  const artifact = fixture();
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
  localStorage.setItem("ranked-shares:deployment:31337", JSON.stringify({ hash, account: account.address, chainId: 31337, name: "Recovered token", round: false }));
  const send = vi.fn(); state.wallet = { ...wallet, sendTransaction: send };
  mount();
  await screen.findByRole("heading", { name: "Your contract is deployed." }, { timeout: 15000 });
  expect(send).not.toHaveBeenCalled();
  expect(localStorage.getItem("ranked-shares:deployment:31337")).toBeNull();
}, 20000);

test("deployment guards block a wrong RPC and an account change after gas estimation", async () => {
  const send = vi.fn();
  await expect(sendDeployment({ ...client, getChainId: async () => 1 } as any, { ...wallet, sendTransaction: send } as any,
    account.address, chain, "0x6000", 0n, vi.fn())).rejects.toThrow(/RPC/);
  const addresses = vi.fn().mockResolvedValueOnce([account.address]).mockResolvedValueOnce([token]);
  await expect(sendDeployment({ ...client, estimateGas: async () => 100n } as any,
    { ...wallet, getAddresses: addresses, sendTransaction: send } as any, account.address, chain, "0x6000", 0n, vi.fn())).rejects.toThrow(/account changed/);
  expect(send).not.toHaveBeenCalled();
});

test("round forms expose only organizer choices and block sealed deployment without a tally service", async () => {
  mount(); await fillRound();
  for (const kind of ["CreRankedShares", "NoirRankedShares", "ZiskRankedShares", "LPCreRankedShares"]) {
    fireEvent.change(screen.getByLabelText("Round type"), { target: { value: kind } });
    await screen.findByLabelText("Funding token");
    await screen.findByText(/Tally service setup is still needed/);
    expect((screen.getByRole("button", { name: "Deploy round" }) as HTMLButtonElement).disabled).toBe(true);
    for (const label of ["Tallier public key", "Key salt", "CRE forwarder", "Poseidon contract", "Ingest verifier", "Maximum sealed voters", "Circuit root"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    const minimum = screen.getByLabelText("Minimum direct vote (USDC)") as HTMLInputElement;
    expect(minimum.value).toBe("0");
    expect(minimum.closest("details")!.open).toBe(false);
    expect(screen.queryByLabelText("Organizer address")).toBeNull();
  }
});

test("organizer follows wallet changes until an explicit override, and resetting the override follows again", async () => {
  const view = mount(); await fillRound();
  state.address = token;
  view.rerender(<MemoryRouter><DeployPage /></MemoryRouter>);
  fireEvent.click(screen.getByLabelText("Use a different organizer"));
  expect((screen.getByLabelText("Organizer address") as HTMLInputElement).value).toBe(token);
  fireEvent.change(screen.getByLabelText("Organizer address"), { target: { value: eurc } });
  state.address = account.address;
  view.rerender(<MemoryRouter><DeployPage /></MemoryRouter>);
  expect((screen.getByLabelText("Organizer address") as HTMLInputElement).value).toBe(eurc);
  fireEvent.click(screen.getByLabelText("Use a different organizer"));
  fireEvent.click(screen.getByLabelText("Use a different organizer"));
  expect((screen.getByLabelText("Organizer address") as HTMLInputElement).value).toBe(account.address);
});

const serviceUrl = "https://tally.example.test";
const publicKey = "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
function mockTally(manager?: Address, options: { registerFails?: boolean; dependencies?: Record<string, Address> } = {}) {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith(serviceUrl)) return originalFetch(input, init);
    const url = new URL(String(input));
    const data = init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(url.searchParams.entries());
    data.chainId = Number(data.chainId);
    if (url.pathname === "/capabilities") return Response.json({ ...data, ready: true });
    if (url.pathname === "/rounds") {
      requests.push(data);
      return Response.json({ ...data, monitoring: "reserved", key: { publicKey, salt: `0x${"12".repeat(32)}`, x: "1", y: BigInt("0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c").toString() },
        workflow: { forwarder: token, owner: account.address, name: "ranked-shares-test" }, coordinator: account.address,
        guest: { programVK: proofProfile.zisk.programVK }, dependencies: options.dependencies,
        liquidity: { manager, stateView: manager } });
    }
    if (options.registerFails) return new Response("Unavailable", { status: 503 });
    return Response.json({ id: url.pathname.split("/")[2], round: data.round, monitoring: "active" });
  });
  vi.stubGlobal("fetch", mock);
  return { requests, mock };
}
async function sealedDraft(kind: SealedKind, owner = account.address) {
  const artifact = await loadRoundArtifact(kind);
  const values = initialValues(artifact, true, chain.id, owner);
  for (const field of constructorFields(artifact, true)) {
    const name = parameterName(field.parameter);
    if (name === "deadline" || name === "votingDeadline") values[field.key] = "2099-06-01T12:30";
    if (name === "minDirectVote") values[field.key] = "1.25";
    if (name === "minSealedVote") values[field.key] = "0.000001";
  }
  const draft: RoundDeployment = { version: 1, id: crypto.randomUUID(), kind, chainId: chain.id, account: account.address,
    serviceUrl, values, buildId: keccak256(artifact.bytecode), steps: {} };
  return { draft, artifact, client, wallet, chain, onProgress: vi.fn(), onSave: vi.fn() };
}

test("the three-choice sealed form provisions, deploys and selects a monitored round", async () => {
  mockTally(); vi.stubEnv("VITE_TALLY_SERVICE_URL", serviceUrl);
  mount(); await fillRound();
  fireEvent.change(screen.getByLabelText("Round type"), { target: { value: "CreRankedShares" } });
  await screen.findByText(/Tally service ready/);
  await fillRound();
  fireEvent.click(screen.getByRole("button", { name: "Deploy round" }));
  await screen.findByRole("heading", { name: "Your round is ready for setup." }, { timeout: 15000 });
  expect(state.setPool).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Set up this round" }).getAttribute("href")).toBe(`/setup?pool=${state.setPool.mock.calls[0][0]}`);
}, 20000);

test.each(["CreRankedShares", "NoirRankedShares", "ZiskRankedShares", "LPCreRankedShares"] as const)("%s deploys with resolved configuration and registers only after setup completes", async (kind) => {
  let manager: Address | undefined;
  if (kind === "LPCreRankedShares") {
    const mock = JSON.parse(readFileSync(new URL("../../out/LPVoting.t.sol/MockV4.json", here), "utf8"));
    manager = (await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object }) })).contractAddress!;
  }
  const service = mockTally(manager);
  const owner = kind === "LPCreRankedShares" ? eurc : account.address;
  const context = await sealedDraft(kind, owner);
  const deployed = await runRoundDeployment(context);
  expect(restoreRoundDeployment(chain.id)).toBeUndefined();
  const abi = parseAbi(["function owner() view returns (address)", "function minDirectVote() view returns (uint256)", "function lpVoting() view returns (address)"]);
  expect((await client.readContract({ address: deployed.contractAddress, abi, functionName: "owner" })).toLowerCase()).toBe(owner.toLowerCase());
  expect(await client.readContract({ address: deployed.contractAddress, abi, functionName: "minDirectVote" })).toBe(1250000n);
  if (kind === "LPCreRankedShares") {
    const lp = await client.readContract({ address: deployed.contractAddress, abi, functionName: "lpVoting" });
    expect(await client.getCode({ address: lp })).not.toBe("0x");
    const last = context.onSave.mock.calls.at(-1)![0] as RoundDeployment;
    expect(Object.keys(last.steps)).toEqual(["round", "liquidity", "attach", "organizer"]);
  }
  if (kind === "NoirRankedShares") {
    const noirAbi = parseAbi(["function nSealedMax() view returns (uint256)", "function mMax() view returns (uint256)", "function minSealedVote() view returns (uint256)"]);
    expect(await client.readContract({ address: deployed.contractAddress, abi: noirAbi, functionName: "nSealedMax" })).toBe(256n);
    expect(await client.readContract({ address: deployed.contractAddress, abi: noirAbi, functionName: "mMax" })).toBe(16n);
    expect(await client.readContract({ address: deployed.contractAddress, abi: noirAbi, functionName: "minSealedVote" })).toBe(1n);
    const send = vi.fn(wallet.sendTransaction);
    const second = await sealedDraft(kind);
    await runRoundDeployment({ ...second, wallet: { ...wallet, sendTransaction: send } as any });
    expect(send).toHaveBeenCalledTimes(1); // shared builds are reused by chain + runtime hash
  }
  expect(service.requests[0].organizer).toBe(owner);
}, 45000);

test("a mined round waits for tally registration and resumes without another transaction", async () => {
  const options = { registerFails: true };
  const service = mockTally(undefined, options);
  const context = await sealedDraft("CreRankedShares");
  await expect(runRoundDeployment(context)).rejects.toThrow(/unavailable/);
  const draft = restoreRoundDeployment(chain.id)!;
  expect(draft.steps.round.hash).toBeTruthy();
  options.registerFails = false;
  const send = vi.fn();
  await runRoundDeployment({ ...context, draft, wallet: { ...wallet, sendTransaction: send } as any });
  expect(send).not.toHaveBeenCalled();
  expect(service.requests).toHaveLength(1);
}, 20000);

test("receipt lookup failure keeps the shared dependency hash and resuming never deploys it twice", async () => {
  mockTally();
  const context = await sealedDraft("ZiskRankedShares");
  await expect(runRoundDeployment({ ...context, client: { ...client, waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("RPC temporarily unavailable")) } as any })).rejects.toThrow(/RPC temporarily/);
  const draft = restoreRoundDeployment(chain.id)!;
  expect(draft.steps.ZiskVerifier.hash).toBeTruthy();
  const send = vi.fn(wallet.sendTransaction);
  await runRoundDeployment({ ...context, draft, wallet: { ...wallet, sendTransaction: send } as any });
  expect(send).toHaveBeenCalledTimes(1); // only the round remains
}, 20000);

test("a mismatched shared verifier is rejected before any wallet transaction", async () => {
  mockTally(undefined, { dependencies: { ZiskVerifier: token } });
  const context = await sealedDraft("ZiskRankedShares");
  const send = vi.fn();
  await expect(runRoundDeployment({ ...context, wallet: { ...wallet, sendTransaction: send } })).rejects.toThrow(/does not match/);
  expect(send).not.toHaveBeenCalled();
});
