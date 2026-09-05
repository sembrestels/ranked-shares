// prover/test/e2e.test.ts — replay the test_main fixture on anvil against the real
// Honk verifiers, report as the forwarder, prove the whole chain and audit it.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { encodeResultReport } from "@lib/report";
import { readPoolSnapshot } from "../src/core/chain";
import { rebuild } from "../src/core/state";
import { Prover } from "../src/core/prove";
import { runChain } from "../src/core/submit";
import { audit } from "../src/core/audit";

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's default (fixed-mnemonic) accounts 0 and 2.
const DEPLOYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const FORWARDER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil account 1
const COORDINATOR = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"); // anvil account 2
const ORG: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // anvil account 3

// The fixture's `transcript` field stores the NONE sentinel (2^64 - 1) as a bare JSON
// number, which plain JSON.parse rounds to a double and corrupts; quote any run of 16+
// digits that isn't already inside a string before parsing, so it survives as a decimal
// string BigInt() can read exactly.
function loadFixture(url: URL): any {
  const raw = readFileSync(url, "utf8");
  const safe = raw.replace(/([:[,]\s*)(\d{16,})(\s*[,\]}])/g, '$1"$2"$3');
  return JSON.parse(safe);
}

const repoRoot = new URL("../..", import.meta.url).pathname;
const fx = loadFixture(new URL("../../reference/vectors/fixture_test_main.json", import.meta.url));
const artifact = (name: string) => JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
const poolAbi = JSON.parse(readFileSync(new URL("../../cre/src/abi/SealedRankedShares.json", import.meta.url), "utf8"));

let anvil: ChildProcess;
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
const deployer = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(RPC) });

async function waitForRpc(): Promise<void> {
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

async function deploy(name: string, args: unknown[] = [], abi?: any): Promise<Address> {
  const a = artifact(name);
  const hash = await deployer.deployContract({ abi: abi ?? a.abi, bytecode: a.bytecode.object as Hex, args } as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

describe("end to end on anvil with real verifiers", () => {
  beforeAll(async () => {
    execFileSync("forge", ["build", "-q"], { cwd: repoRoot });
    anvil = spawn("anvil", ["--port", String(PORT), "--silent", "--code-size-limit", "100000"], { stdio: "ignore" });
    await waitForRpc();
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  test(
    "replay test_main, report, prove, Proven, audit",
    async () => {
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
      const w = (account: any) => createWalletClient({ account, chain: foundry, transport: http(RPC) });
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
      for (const c of fx.costs) await send(() => write(deployer, { address: pool, abi: poolAbi, functionName: "addProject", args: [toBig(c), DEPLOYER.address] }));
      await send(() => write(deployer, { address: pool, abi: poolAbi, functionName: "openVoting" }));

      // voters, impersonated
      await testClient.impersonateAccount({ address: ORG });
      await testClient.setBalance({ address: ORG, value: 10n ** 18n });
      await send(() => write(deployer, { address: token, abi: erc20, functionName: "mint", args: [ORG, 1n << 62n] }));
      let granted = 0n;
      for (const v of fx.voters) {
        const a = v.addr as Address;
        await testClient.impersonateAccount({ address: a });
        await testClient.setBalance({ address: a, value: 10n ** 18n });
        const direct = toBig(v.directWeight);
        const seat = toBig(v.seatWeight);
        if (direct > 0n) {
          await send(() => write(deployer, { address: token, abi: erc20, functionName: "mint", args: [a, direct] }));
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
        await send(() => write(deployer, { address: pool, abi: poolAbi, functionName: "close", args: [25n] }));
      }
      expect(await pub.readContract({ address: pool, abi: poolAbi, functionName: "inputsRoot" })).toBe(fx.inputsRoot);

      // the DON's report, from the forwarder
      await testClient.impersonateAccount({ address: FORWARDER });
      await testClient.setBalance({ address: FORWARDER, value: 10n ** 18n });
      const report = encodeResultReport(fx.inputsRoot, fx.funded, fx.transcript.map((s: (number | string)[]) => s.map((x) => BigInt(x))));
      await send(() => write(w(FORWARDER), { address: pool, abi: poolAbi, functionName: "onReport", args: ["0x", report] }));

      // audit before proving
      expect((await audit(pub, pool, 0n)).ok).toBe(true);

      // prove and submit as the coordinator
      await testClient.setBalance({ address: COORDINATOR.address, value: 10n ** 18n });
      const snapshot = await readPoolSnapshot(pub, pool, 0n);
      const plan = rebuild(snapshot, toBig(fx.sk));
      const prover = await Prover.create("test", 4);
      const started = Date.now();
      try {
        await runChain(pub, w(COORDINATOR), plan, snapshot, prover, (m) => console.log(`[runChain] ${m}`));
      } finally {
        await prover.destroy();
      }
      console.log(`e2e proof chain: ${((Date.now() - started) / 1000).toFixed(1)}s`);
      expect(Number(await pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(1); // Proven
      const funded = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "fundedProjects" })) as bigint[];
      expect(funded.map(Number)).toEqual(fx.funded);

      // audit still holds once Proven
      expect((await audit(pub, pool, 0n)).ok).toBe(true);
    },
    600_000,
  );
});
