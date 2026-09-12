// prover/test/helpers/anvil.ts — spawn anvil, deploy the pool against the real Honk
// verifiers, replay a fixture's transcript and report it, shared by e2e.test.ts,
// service.test.ts and scripts/dev-pool.ts.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, encodePacked, http, parseAbi, toHex, zeroAddress, type Account, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { encodeResultReport } from "@lib/report";

// Indirected through a variable rather than the literal `import.meta.url` token: under a
// browser-flavoured Vite pool (the jsdom environment page.test.ts uses), the exact
// `new URL("...", import.meta.url)` pattern is statically rewritten into a dev-server
// asset URL (`http://…/@fs/…`) instead of staying a real `file://` URL, which breaks
// `readFileSync`. Assigning `import.meta.url` first defeats that static match while
// leaving the resolved path identical under plain Node (used by every other caller here).
const here = import.meta.url;
const repoRoot = new URL("../../..", here).pathname;
const poolAbi = JSON.parse(readFileSync(new URL("../../../cre/src/abi/NoirRankedShares.json", here), "utf8"));
const artifact = (name: string) => JSON.parse(readFileSync(new URL(`../../../out/${name}.sol/${name}.json`, here), "utf8"));
const DEFAULT_FIXTURE = new URL("../../../reference/vectors/noir/fixture_test_main.json", here);

// anvil's default (fixed-mnemonic) accounts 0-3.
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const FORWARDER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil account 1
export const COORDINATOR_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // anvil account 2
const ORG: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // anvil account 3

/** The pool `Config` fields for a workflow. */
export type WorkflowConfig = { workflowOwner: Address; workflowName: Hex };
/**
 * `onReport`'s workflow check turned off: the zero owner accepts a report from any
 * workflow reaching the forwarder, which is what these helpers need — they report from
 * the `FORWARDER` account directly, with no KeystoneForwarder metadata to present. A
 * pool deployed this way must never hold real funds.
 */
export const NO_WORKFLOW_CHECK: WorkflowConfig = { workflowOwner: zeroAddress, workflowName: `0x${"00".repeat(10)}` };

/**
 * The metadata a KeystoneForwarder prepends to a verified report: `bytes32 workflowId ‖
 * bytes10 workflowName ‖ address workflowOwner`, 62 bytes, at the offsets
 * `checkWorkflow` (src/lib/CreMetadata.sol) reads.
 */
export function workflowMetadata(owner: Address, name: Hex = NO_WORKFLOW_CHECK.workflowName, workflowId: Hex = `0x${"00".repeat(31)}01`): Hex {
  return encodePacked(["bytes32", "bytes10", "address"], [workflowId, name, owner]);
}

// The fixture's `transcript` field stores the NONE sentinel (2^64 - 1) as a bare JSON
// number, which plain JSON.parse rounds to a double and corrupts; quote any run of 16+
// digits that isn't already inside a string before parsing, so it survives as a decimal
// string BigInt() can read exactly.
export function loadFixture(url: URL): any {
  const raw = readFileSync(url, "utf8");
  const safe = raw.replace(/([:[,]\s*)(\d{16,})(\s*[,\]}])/g, '$1"$2"$3');
  return JSON.parse(safe);
}

async function waitForRpc(pub: PublicClient): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await pub.getChainId();
      return;
    } catch {
      if (Date.now() > deadline) throw new Error("anvil did not come up in time");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Kill `anvil` and wait for it to actually exit (a no-op if it already has). */
function killAndWait(anvil: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (anvil.exitCode !== null || anvil.signalCode !== null) {
      resolve();
      return;
    }
    anvil.once("exit", () => resolve());
    anvil.kill();
  });
}

/**
 * Deploy a fresh NoirRankedShares pool — token, Poseidon2, both test verifiers, and
 * the pool itself, configured from `fx` — without opening voting or closing it, so its
 * `inputsRoot` is still the zero default. Assumes anvil is already up at `rpc`. Cheap: a
 * handful of contract deployments, no voting, no proving. `workflow` is the workflow
 * `onReport` authorizes; the default turns that check off.
 */
export async function deployUnclosedPool(rpc: string, fixture?: URL, workflow: WorkflowConfig = NO_WORKFLOW_CHECK): Promise<Address> {
  const fx = loadFixture(fixture ?? DEFAULT_FIXTURE);
  const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
  const COORDINATOR = privateKeyToAccount(COORDINATOR_KEY);
  const pub = createPublicClient({ pollingInterval: 50, chain: foundry, transport: http(rpc) });
  const deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(rpc) });
  const deploy = async (name: string, args: unknown[] = [], abi?: any): Promise<Address> => {
    const a = artifact(name);
    const hash = await deployerWallet.deployContract({ abi: abi ?? a.abi, bytecode: a.bytecode.object as Hex, args } as any);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  };
  const token = await deploy("MockERC20");
  const poseidon = await deploy("Poseidon2");
  const ingestV = await deploy("IngestVerifierTest");
  const tallyV = await deploy("TallyVerifierTest");
  const deadline = (await pub.getBlock()).timestamp + 3600n;
  const cfg = {
    forwarder: FORWARDER,
    ...workflow,
    coordinator: COORDINATOR.address,
    poseidon,
    ingestVerifier: ingestV,
    tallyVerifier: tallyV,
    tallierPkX: toBig(fx.pk[0]),
    tallierPkY: toBig(fx.pk[1]),
    keySalt: fx.keySalt,
    nSealedMax: BigInt(fx.profile.nSealedMax),
    mMax: BigInt(fx.profile.mMax),
    batch: BigInt(fx.profile.batch),
    minDirectVote: toBig(fx.minDirectVote),
    minSealedVote: 1n,
    proofGrace: 86400n,
    abandonGrace: 604800n,
  };
  return deploy("NoirRankedShares", [token, DEPLOYER.address, deadline, cfg], poolAbi);
}

/**
 * A closed pool with `n` public voters, one weight unit and one ballot each, and no
 * sealed ballots — enough to make `votersFrom` need more than one page. Assumes anvil is
 * already up at `rpc`. Returns the pool and the voter addresses in registration order.
 */
export async function deployVoterPool(rpc: string, n: number, fixture?: URL): Promise<{ pool: Address; voters: Address[] }> {
  const fx = loadFixture(fixture ?? DEFAULT_FIXTURE);
  const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
  const COORDINATOR = privateKeyToAccount(COORDINATOR_KEY);
  const pub = createPublicClient({ pollingInterval: 50, chain: foundry, transport: http(rpc) });
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) });
  const deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(rpc) });
  const write = (client: any, params: unknown): Promise<Hex> => client.writeContract(params);
  const send = async (fn: () => Promise<Hex>) => {
    const receipt = await pub.waitForTransactionReceipt({ hash: await fn() });
    if (receipt.status !== "success") throw new Error(`tx reverted: ${receipt.transactionHash}`);
    return receipt;
  };
  const deploy = async (name: string, args: unknown[] = [], abi?: any): Promise<Address> => {
    const a = artifact(name);
    const hash = await deployerWallet.deployContract({ abi: abi ?? a.abi, bytecode: a.bytecode.object as Hex, args } as any);
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  };

  const token = await deploy("MockERC20");
  const poseidon = await deploy("Poseidon2");
  const ingestV = await deploy("IngestVerifierTest");
  const tallyV = await deploy("TallyVerifierTest");
  const deadline = (await pub.getBlock()).timestamp + 3600n;
  const pool = await deploy(
    "NoirRankedShares",
    [
      token,
      DEPLOYER.address,
      deadline,
      {
        forwarder: FORWARDER,
        ...NO_WORKFLOW_CHECK,
        coordinator: COORDINATOR.address,
        poseidon,
        ingestVerifier: ingestV,
        tallyVerifier: tallyV,
        tallierPkX: toBig(fx.pk[0]),
        tallierPkY: toBig(fx.pk[1]),
        keySalt: fx.keySalt,
        nSealedMax: BigInt(fx.profile.nSealedMax),
        mMax: BigInt(fx.profile.mMax),
        batch: BigInt(fx.profile.batch),
        minDirectVote: 1n,
        minSealedVote: 1n,
        proofGrace: 86400n,
        abandonGrace: 604800n,
      },
    ],
    poolAbi,
  );

  const erc20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
  const w = (account: any) => createWalletClient({ account, chain: foundry, transport: http(rpc) });
  await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "addProject", args: [2n, DEPLOYER.address] }));
  await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "openVoting" }));

  const voters: Address[] = [];
  for (let i = 0; i < n; i++) {
    const a = `0x${(BigInt("0x1000000000000000000000000000000000000000") + BigInt(i)).toString(16).padStart(40, "0")}` as Address;
    voters.push(a);
    await testClient.impersonateAccount({ address: a });
    await testClient.setBalance({ address: a, value: 10n ** 18n });
    await send(() => write(deployerWallet, { address: token, abi: erc20, functionName: "mint", args: [a, 1n] }));
    await send(() => write(w(a), { address: token, abi: erc20, functionName: "approve", args: [pool, 1n] }));
    await send(() => write(w(a), { address: pool, abi: poolAbi, functionName: "contribute", args: [1n] }));
    await send(() => write(w(a), { address: pool, abi: poolAbi, functionName: "vote", args: [toHex(Uint8Array.from([1]))] }));
  }

  await testClient.setNextBlockTimestamp({ timestamp: deadline });
  await testClient.mine({ blocks: 1 });
  while (!(await pub.readContract({ address: pool, abi: poolAbi, functionName: "closed" }))) {
    await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "close", args: [25n] }));
  }
  return { pool, voters };
}

export type FixtureChain = {
  rpc: string;
  pool: Address;
  token: Address;
  coordinator: Account;
  forwarder: Address;
  deployer: Account;
  pub: PublicClient;
  fx: any;
  /** Gas used by the forwarder's `onReport` call that reports the fixture's transcript. */
  reportGas: bigint;
  /** Byte length of the ABI-encoded report passed to `onReport`. */
  reportBytes: number;
  stop(): Promise<void>;
};

/**
 * Spawn anvil on `port`, deploy MockERC20/Poseidon2/IngestVerifierTest/TallyVerifierTest
 * and the pool from `fixture` (default `fixture_test_main.json`), replay the fixture's
 * projects/voters/sealed-ballots and close it, then report the transcript as the
 * forwarder. Returns once the pool is reported and ready to prove.
 */
export async function startFixtureChain(opts: { port: number; fixture?: URL }): Promise<FixtureChain> {
  const { port } = opts;
  const rpc = `http://127.0.0.1:${port}`;
  const fx = loadFixture(opts.fixture ?? DEFAULT_FIXTURE);
  const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
  const COORDINATOR = privateKeyToAccount(COORDINATOR_KEY);

  execFileSync("forge", ["build", "-q"], { cwd: repoRoot });
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });

  try {
    return await setUpFixtureChain(rpc, fx, DEPLOYER, COORDINATOR, anvil);
  } catch (e) {
    // Nothing after `spawn` succeeded (a deploy reverted, the replay produced the wrong
    // inputsRoot, the close loop threw, ...): don't orphan the anvil child.
    await killAndWait(anvil);
    throw e;
  }
}

async function setUpFixtureChain(rpc: string, fx: any, DEPLOYER: Account, COORDINATOR: Account, anvil: ChildProcess): Promise<FixtureChain> {
  const pub = createPublicClient({ pollingInterval: 50, chain: foundry, transport: http(rpc) });
  await waitForRpc(pub);
  const { pool, token, reportGas, reportBytes } = await replayFixturePool(rpc, fx);
  return {
    rpc,
    pool,
    token,
    coordinator: COORDINATOR,
    forwarder: FORWARDER,
    deployer: DEPLOYER,
    pub,
    fx,
    reportGas,
    reportBytes,
    async stop() {
      await killAndWait(anvil);
    },
  };
}

export type ReplayedPool = { pool: Address; token: Address; reportGas: bigint; reportBytes: number };

/**
 * Deploy and drive one pool from `fx` on an anvil that is already up: verifiers, the
 * pool, the fixture's projects/voters/sealed ballots, `close`, and the forwarder's
 * kind-1 report. Called once by `startFixtureChain`, and again by tests that need a
 * second, independent pool on the same chain.
 */
export async function replayFixturePool(rpc: string, fx: any): Promise<ReplayedPool> {
  const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
  const COORDINATOR = privateKeyToAccount(COORDINATOR_KEY);
  const pub = createPublicClient({ pollingInterval: 50, chain: foundry, transport: http(rpc) });
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) });
  const deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(rpc) });

  const deploy = async (name: string, args: unknown[] = [], abi?: any): Promise<Address> => {
    const a = artifact(name);
    const hash = await deployerWallet.deployContract({ abi: abi ?? a.abi, bytecode: a.bytecode.object as Hex, args } as any);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  };

  const token = await deploy("MockERC20");
  const poseidon = await deploy("Poseidon2");
  const ingestV = await deploy("IngestVerifierTest");
  const tallyV = await deploy("TallyVerifierTest");
  // From the chain's clock, not the wall clock: a second pool replayed on the same anvil
  // starts from a block timestamp the first replay has already warped past the deadline.
  const deadline = (await pub.getBlock()).timestamp + 3600n;
  const cfg = {
    forwarder: FORWARDER,
    ...NO_WORKFLOW_CHECK,
    coordinator: COORDINATOR.address,
    poseidon,
    ingestVerifier: ingestV,
    tallyVerifier: tallyV,
    tallierPkX: toBig(fx.pk[0]),
    tallierPkY: toBig(fx.pk[1]),
    keySalt: fx.keySalt,
    nSealedMax: BigInt(fx.profile.nSealedMax),
    mMax: BigInt(fx.profile.mMax),
    batch: BigInt(fx.profile.batch),
    minDirectVote: toBig(fx.minDirectVote),
    minSealedVote: 1n,
    proofGrace: 86400n,
    abandonGrace: 604800n,
  };
  const pool = await deploy("NoirRankedShares", [token, DEPLOYER.address, deadline, cfg], poolAbi);

  const erc20 = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
  const w = (account: any) => createWalletClient({ account, chain: foundry, transport: http(rpc) });
  // viem's overload resolution wants a bound `Account` object to infer `account` as
  // optional; our impersonated clients are keyed by a plain address, so every call
  // here is cast loosely and `send` just waits for the receipt.
  const write = (client: any, params: unknown): Promise<Hex> => client.writeContract(params);
  const send = async (fn: () => Promise<Hex>) => {
    const receipt = await pub.waitForTransactionReceipt({ hash: await fn() });
    if (receipt.status !== "success") throw new Error(`tx reverted: ${receipt.transactionHash}`);
    return receipt;
  };

  // projects and opening
  for (const c of fx.costs) await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "addProject", args: [toBig(c), DEPLOYER.address] }));
  await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "openVoting" }));

  // voters, impersonated
  await testClient.impersonateAccount({ address: ORG });
  await testClient.setBalance({ address: ORG, value: 10n ** 18n });
  await send(() => write(deployerWallet, { address: token, abi: erc20, functionName: "mint", args: [ORG, 1n << 62n] }));
  let granted = 0n;
  for (const v of fx.voters) {
    const a = v.addr as Address;
    await testClient.impersonateAccount({ address: a });
    await testClient.setBalance({ address: a, value: 10n ** 18n });
    const direct = toBig(v.directWeight);
    const seat = toBig(v.seatWeight);
    if (direct > 0n) {
      await send(() => write(deployerWallet, { address: token, abi: erc20, functionName: "mint", args: [a, direct] }));
      await send(() => write(w(a), { address: token, abi: erc20, functionName: "approve", args: [pool, direct] }));
      await send(() => write(w(a), { address: pool, abi: poolAbi, functionName: "contribute", args: [direct] }));
    }
    if (seat > 0n) {
      await send(() => write(w(ORG), { address: token, abi: erc20, functionName: "approve", args: [pool, seat] }));
      await send(() => write(w(ORG), { address: pool, abi: poolAbi, functionName: "sponsor", args: [seat, [a]] }));
    }
    if (v.hasDirect) await send(() => write(w(a), { address: pool, abi: poolAbi, functionName: "vote", args: [toHex(Uint8Array.from(v.directRanks))] }));
    granted += direct + seat;
  }
  for (const v of fx.voters) {
    if (!v.hasSealed) continue;
    const a = v.addr as Address;
    await send(() => write(w(a), { address: pool, abi: poolAbi, functionName: "voteSealed", args: v.ciphertext.map(toBig) }));
  }
  const dust = toBig(fx.totalWeight) - granted;
  if (dust > 0n) {
    const nft = await deploy("MockERC721");
    await send(() => write(w(ORG), { address: token, abi: erc20, functionName: "approve", args: [pool, dust] }));
    await send(() => write(w(ORG), { address: pool, abi: poolAbi, functionName: "sponsorNFT", args: [dust, nft, dust] }));
  }

  // close
  await testClient.setNextBlockTimestamp({ timestamp: deadline });
  await testClient.mine({ blocks: 1 });
  while (!(await pub.readContract({ address: pool, abi: poolAbi, functionName: "closed" }))) {
    await send(() => write(deployerWallet, { address: pool, abi: poolAbi, functionName: "close", args: [25n] }));
  }
  const inputsRoot = await pub.readContract({ address: pool, abi: poolAbi, functionName: "inputsRoot" });
  if (inputsRoot !== fx.inputsRoot) throw new Error(`replay produced inputsRoot ${inputsRoot}, fixture says ${fx.inputsRoot}`);

  // the DON's report, from the forwarder
  await testClient.impersonateAccount({ address: FORWARDER });
  await testClient.setBalance({ address: FORWARDER, value: 10n ** 18n });
  const report = encodeResultReport(fx.inputsRoot, fx.funded, fx.transcript.map((s: (number | string)[]) => s.map((x) => BigInt(x))));
  const reportReceipt = await send(() => write(w(FORWARDER), { address: pool, abi: poolAbi, functionName: "onReport", args: ["0x", report] }));

  // fund the coordinator so it can pay for `advance`
  await testClient.setBalance({ address: COORDINATOR.address, value: 10n ** 18n });

  return { pool, token, reportGas: reportReceipt.gasUsed, reportBytes: (report.length - 2) / 2 };
}
