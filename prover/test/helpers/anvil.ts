// prover/test/helpers/anvil.ts — spawn anvil, deploy the pool against the real Honk
// verifiers, replay a fixture's transcript and report it, shared by e2e.test.ts,
// service.test.ts and scripts/dev-pool.ts.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, toHex, type Account, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { encodeResultReport } from "@lib/report";

const repoRoot = new URL("../../..", import.meta.url).pathname;
const poolAbi = JSON.parse(readFileSync(new URL("../../../cre/src/abi/SealedRankedShares.json", import.meta.url), "utf8"));
const artifact = (name: string) => JSON.parse(readFileSync(new URL(`../../../out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
const DEFAULT_FIXTURE = new URL("../../../reference/vectors/fixture_test_main.json", import.meta.url);

// anvil's default (fixed-mnemonic) accounts 0-3.
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const FORWARDER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil account 1
export const COORDINATOR_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // anvil account 2
const ORG: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // anvil account 3

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
 * Deploy a fresh SealedRankedShares pool — token, Poseidon2, both test verifiers, and
 * the pool itself, configured from `fx` — without opening voting or closing it, so its
 * `inputsRoot` is still the zero default. Assumes anvil is already up at `rpc`. Cheap: a
 * handful of contract deployments, no voting, no proving.
 */
export async function deployUnclosedPool(rpc: string, fixture?: URL): Promise<Address> {
  const fx = loadFixture(fixture ?? DEFAULT_FIXTURE);
  const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
  const COORDINATOR = privateKeyToAccount(COORDINATOR_KEY);
  const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
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
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const cfg = {
    forwarder: FORWARDER,
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
  return deploy("SealedRankedShares", [token, DEPLOYER.address, deadline, cfg], poolAbi);
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
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent", "--code-size-limit", "100000"], { stdio: "ignore" });

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
  const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) });
  const deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(rpc) });

  await waitForRpc(pub);

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
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const cfg = {
    forwarder: FORWARDER,
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
  const pool = await deploy("SealedRankedShares", [token, DEPLOYER.address, deadline, cfg], poolAbi);

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
  await send(() => write(w(FORWARDER), { address: pool, abi: poolAbi, functionName: "onReport", args: ["0x", report] }));

  // fund the coordinator so it can pay for `advance`
  await testClient.setBalance({ address: COORDINATOR.address, value: 10n ** 18n });

  return {
    rpc,
    pool,
    token,
    coordinator: COORDINATOR,
    forwarder: FORWARDER,
    deployer: DEPLOYER,
    pub,
    fx,
    async stop() {
      await killAndWait(anvil);
    },
  };
}
