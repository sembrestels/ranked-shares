import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
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
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { proposalAbi } from "../app/lib/proposals";
import { assertWallet } from "../app/lib/transactions";

const state = vi.hoisted(() => ({
  pool: undefined as Address | undefined,
  address: undefined as Address | undefined,
  pub: null as any,
  wallet: null as any,
  storage: null as any,
}));
vi.mock(
  "wagmi",
  () => ({
    useAccount: () => ({ address: state.address, chainId: 31337 }),
    usePublicClient: () => state.pub,
    useWalletClient: () => ({ data: state.wallet }),
  }),
);
vi.mock("../app/context/providers", () => ({
  chain: { id: 31337 },
  useRound: () => ({ pool: state.pool }),
  useSwarm: () => ({
    client: state.storage,
    info: state.storage.connectionInfo,
  }),
}));
import SubmitPage from "../app/routes/submit";
import { ProposalBoard } from "../app/routes/board";

const chain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8573"] } },
});
const transport = http(chain.rpcUrls.default.http[0]);
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const proposer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const pub = createPublicClient({ chain, transport, pollingInterval: 50 });
let anvil: ChildProcess;
let pool: Address;
const query = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});
const content = new Map<string, Uint8Array>();
const here = import.meta.url;
function artifact(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../out/${name}.sol/${name}.json`, here), "utf8"),
  );
}
function asAccount(account: typeof owner) {
  state.address = account.address;
  state.wallet = createWalletClient({
    account,
    chain,
    transport,
    pollingInterval: 50,
  });
}

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", "8573", "--silent"], { stdio: "pipe" });
  let spawnError: Error | undefined;
  anvil.on("error", (error) => {
    spawnError = error;
  });
  await waitFor(async () => {
    if (spawnError) throw spawnError;
    expect(await pub.getChainId()).toBe(31337);
  }, { timeout: 10_000 });
  state.pub = pub;
  asAccount(owner);
  async function deploy(name: string, args: unknown[] = []) {
    const data = artifact(name);
    const hash = await state.wallet.deployContract({
      abi: data.abi,
      bytecode: data.bytecode.object,
      args,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  }
  const token = await deploy("MockERC20");
  const block = await pub.getBlock();
  pool = await deploy("RankedShares", [
    token,
    owner.address,
    block.timestamp + 3600n,
  ]);
  state.pool = pool;
  state.storage = {
    connectionInfo: { identity: { name: "Pau" }, canUpload: true },
    uploadData: vi.fn(async (bytes: Uint8Array) => {
      const reference = keccak256(toHex(bytes)).slice(2);
      content.set(reference, bytes);
      return { reference };
    }),
    downloadData: vi.fn(async (reference: string) => {
      const bytes = content.get(reference);
      if (!bytes) throw new Error("Unavailable");
      return bytes;
    }),
  };
  asAccount(proposer);
}, 20_000);

afterAll(async () => {
  cleanup();
  query.clear();
  anvil?.kill("SIGTERM");
});
afterEach(cleanup);

test(
  "real chain: submit, proposer and organizer edits, declined wallet retries, and revision-specific acceptance",
  async () => {
    const mountSubmit = () =>
      render(
        <QueryClientProvider client={query}>
          <SubmitPage />
        </QueryClientProvider>,
      );
    let view = mountSubmit();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", {
          name: "Upload to Swarm",
        }) as HTMLButtonElement).disabled,
      ).toBe(false)
    );
    fireEvent.change(screen.getByLabelText("Proposal title"), {
      target: { value: "Community workshop" },
    });
    fireEvent.change(screen.getByLabelText("Your proposal"), {
      target: {
        value: "A workshop for everyone. <script>never run this</script>",
      },
    });
    fireEvent.change(screen.getByLabelText(/Requested amount/), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload to Swarm" }));
    await screen.findByRole("button", { name: "Submit proposal" });
    expect(state.storage.uploadData).toHaveBeenCalledTimes(1);
    // A declined signature must keep the public upload for a later transaction.
    const write = vi.spyOn(state.wallet, "writeContract").mockRejectedValueOnce(
      new Error("User rejected the request"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
    await screen.findByText("User rejected the request");
    expect(
      await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "proposalCount",
      }),
    ).toBe(0n);
    write.mockRestore();
    view.unmount();
    view = mountSubmit(); // reload recovery uses only the saved public content reference
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit proposal" }),
    );
    await screen.findByText("Proposal received.", {}, { timeout: 10_000 });
    expect(state.storage.uploadData).toHaveBeenCalledTimes(1);
    const pending = await pub.readContract({
      address: pool,
      abi: proposalAbi,
      functionName: "proposals",
      args: [0n],
    });
    expect(pending[4]).toBe(0);
    expect(pending[0].toLowerCase()).toBe(proposer.address.toLowerCase());
    view.unmount();

    view = render(
      <QueryClientProvider client={query}>
        <ProposalBoard review />
      </QueryClientProvider>,
    );
    await screen.findByText("Pending review");
    expect(screen.queryByRole("button", { name: "Accept proposal" }))
      .toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    await screen.findByLabelText("Proposal title");
    expect((screen.getByLabelText("Proposal title") as HTMLInputElement).value)
      .toBe("Community workshop");
    fireEvent.change(screen.getByLabelText("Proposal title"), {
      target: { value: "Community workshop revised by proposer" },
    });
    fireEvent.change(screen.getByLabelText(/Requested amount/), {
      target: { value: "30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload revised proposal" }),
    );
    await screen.findByRole("button", { name: "Save revision" });
    const editWrite = vi.spyOn(state.wallet, "writeContract")
      .mockRejectedValueOnce(new Error("Edit signature declined"));
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await screen.findByText("Edit signature declined");
    expect(state.storage.uploadData).toHaveBeenCalledTimes(2);
    editWrite.mockRestore();
    fireEvent.click(await screen.findByRole("button", { name: "Save revision" }));
    await screen.findByText(
      "Revision saved. The proposal is still pending organizer review.",
      {},
      { timeout: 10_000 },
    );
    expect(state.storage.uploadData).toHaveBeenCalledTimes(2);
    expect(
      await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "proposalRevision",
        args: [0n],
      }),
    ).toBe(2n);
    view.unmount();
    asAccount(owner);
    view = render(
      <QueryClientProvider client={query}>
        <ProposalBoard review />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Read proposal" }),
    );
    await screen.findByText("Community workshop revised by proposer");
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    await screen.findByLabelText("Your proposal");
    fireEvent.change(screen.getByLabelText("Your proposal"), {
      target: { value: "The organizer clarified the schedule." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload revised proposal" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Save revision" }),
    );
    await screen.findByText(
      "Revision saved. The proposal is still pending organizer review.",
      {},
      { timeout: 10_000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Read proposal" }));
    await screen.findByText("The organizer clarified the schedule.");
    const revised = await pub.readContract({
      address: pool,
      abi: proposalAbi,
      functionName: "proposals",
      args: [0n],
    });
    expect(revised[0].toLowerCase()).toBe(proposer.address.toLowerCase());
    expect(revised[1]).not.toBe(pending[1]);
    expect(revised[2]).toBe(30n * 10n ** 18n);
    expect(
      await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "proposalRevision",
        args: [0n],
      }),
    ).toBe(3n);
    expect(
      (await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "proposalEditor",
        args: [0n],
      })).toLowerCase(),
    ).toBe(owner.address.toLowerCase());
    fireEvent.click(screen.getByRole("button", { name: "Accept proposal" }));
    await screen.findByText("Accepted", {}, { timeout: 10_000 });
    const accepted = await pub.readContract({
      address: pool,
      abi: proposalAbi,
      functionName: "proposals",
      args: [0n],
    });
    expect(accepted[4]).toBe(1);
    expect(
      await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "contentRefOf",
        args: [accepted[5]],
      }),
    ).toBe(revised[1]);
    expect(screen.queryByRole("button", { name: "Edit proposal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject proposal" }))
      .toBeNull();
    view.unmount();

    // Another proposal exercises rejection through the same rendered organizer flow.
    asAccount(proposer);
    const hash = await state.wallet.writeContract({
      address: pool,
      abi: proposalAbi,
      functionName: "propose",
      args: [pending[1], 1n, proposer.address],
    });
    await pub.waitForTransactionReceipt({ hash });
    await query.invalidateQueries({ queryKey: ["pool"] });
    asAccount(owner);
    view = render(
      <QueryClientProvider client={query}>
        <ProposalBoard review />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Reject proposal" }),
    );
    await screen.findByText("Rejected", {}, { timeout: 10_000 });
    expect(
      (await pub.readContract({
        address: pool,
        abi: proposalAbi,
        functionName: "proposals",
        args: [1n],
      }))[4],
    ).toBe(2);
    view.unmount();
  },
  45_000,
);

test(
  "a concurrent edit preserves the draft and requires loading the latest revision",
  async () => {
    asAccount(proposer);
    const reference = await state.storage.uploadData(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        title: "Concurrent edits",
        body: "Original",
        attachments: [],
      })),
    );
    const id = await pub.readContract({
      address: pool,
      abi: proposalAbi,
      functionName: "proposalCount",
    });
    const hash = await state.wallet.writeContract({
      address: pool,
      abi: proposalAbi,
      functionName: "propose",
      args: [`0x${reference.reference}`, 5n, proposer.address],
    });
    await pub.waitForTransactionReceipt({ hash });
    query.clear();
    const view = render(
      <QueryClientProvider client={query}>
        <ProposalBoard />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit proposal" }),
    );
    await screen.findByLabelText("Your proposal");
    fireEvent.change(screen.getByLabelText("Your proposal"), {
      target: { value: "My unsaved work" },
    });
    const organizer = createWalletClient({ account: owner, chain, transport });
    const update = await organizer.writeContract({
      address: pool,
      abi: proposalAbi,
      functionName: "editProposal",
      args: [id, 1n, `0x${reference.reference}`, 6n, proposer.address],
    });
    await pub.waitForTransactionReceipt({ hash: update });
    await query.invalidateQueries({ queryKey: ["pool"] });
    await screen.findByText(/Someone saved a newer revision/);
    expect(
      (screen.getByLabelText("Your proposal") as HTMLTextAreaElement).value,
    ).toBe("My unsaved work");
    expect(
      (screen.getByRole("button", {
        name: "Upload revised proposal",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard edits and load latest revision",
      }),
    );
    await screen.findByText("Based on revision 2");
    expect(
      (screen.getByLabelText("Your proposal") as HTMLTextAreaElement).value,
    ).toBe("Original");
    expect(
      (screen.getByLabelText(/Requested amount/) as HTMLInputElement).value,
    ).toBe("0.000000000000000006");
    view.unmount();
  },
  15_000,
);

test("account and network changes are rejected before any transaction", async () => {
  asAccount(owner);
  await expect(assertWallet(pub, state.wallet, proposer.address)).rejects
    .toThrow("account changed");
  const chainId = vi.spyOn(state.wallet, "getChainId").mockResolvedValueOnce(1);
  await expect(assertWallet(pub, state.wallet, owner.address)).rejects.toThrow(
    "network",
  );
  chainId.mockRestore();
});
