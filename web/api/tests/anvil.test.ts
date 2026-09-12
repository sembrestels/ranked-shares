/** End to end against a real plain pool on Anvil: deploy, contribute, vote,
 * then read /api/round and /api/voter through the app. Skipped when anvil is
 * not installed or the Foundry artifacts are missing (run `forge build`). */
import { assertEquals } from "@std/assert";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "../bootstrap.ts";

const PORT = 8574;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const donor = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const writeAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function addProject(uint256 cost, address recipient) returns (uint256)",
  "function openVoting()",
  "function contribute(uint256 amount)",
  "function vote(bytes ranks)",
]);

function artifact(name: string) {
  const path = new URL(`../../../out/${name}.sol/${name}.json`, import.meta.url);
  return JSON.parse(Deno.readTextFileSync(path)) as { abi: unknown[]; bytecode: { object: Hex } };
}

function available(): boolean {
  try {
    artifact("RankedShares");
    artifact("MockERC20");
    return new Deno.Command("anvil", { args: ["--version"], stdout: "null", stderr: "null" })
      .outputSync().success;
  } catch {
    return false;
  }
}

Deno.test({
  name: "anvil: /api/round and /api/voter reflect a real plain pool",
  ignore: !available(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const anvil = new Deno.Command("anvil", {
      args: ["--port", String(PORT), "--silent"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    try {
      const pub = createPublicClient({ chain, transport: http(RPC) });
      for (let i = 0; i < 50; i++) {
        try {
          await pub.getBlockNumber();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const wallet = (account: typeof owner) =>
        createWalletClient({ account, chain, transport: http(RPC) });
      const deploy = async (name: string, args: unknown[] = []) => {
        const a = artifact(name);
        const hash = await wallet(owner).deployContract({
          abi: a.abi as any,
          bytecode: a.bytecode.object,
          args: args as any,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return receipt.contractAddress as Address;
      };
      const send = async (
        account: typeof owner,
        address: Address,
        functionName: string,
        args: unknown[],
      ) => {
        const hash = await wallet(account).writeContract(
          { address, abi: writeAbi, functionName: functionName as any, args: args as any } as any,
        );
        return pub.waitForTransactionReceipt({ hash });
      };
      const block = await pub.getBlock();
      const token = await deploy("MockERC20");
      const pool = await deploy("RankedShares", [token, owner.address, block.timestamp + 3600n]);
      const unit = 10n ** 18n;
      await send(owner, pool, "addProject", [4000n * unit, donor.address]);
      await send(owner, pool, "addProject", [2500n * unit, owner.address]);
      await send(owner, pool, "openVoting", []);
      for (const [who, amount] of [[owner, 1000n * unit], [donor, 300n * unit]] as const) {
        await send(who, token, "mint", [who.address, amount]);
        await send(who, token, "approve", [pool, amount]);
        await send(who, pool, "contribute", [amount]);
      }
      await send(owner, pool, "vote", ["0x0102"]);
      const last = await send(donor, pool, "vote", ["0x0201"]);

      const { app } = createServer({ RPC_URL: RPC, CHAIN_ID: "31337", POOL_ADDRESS: pool });
      const round =
        await (await app.fetch(new Request(`http://x/api/round?after=${last.blockNumber}`))).json();
      assertEquals(round.kind, "plain");
      assertEquals(round.phase, "open");
      assertEquals(round.stage.current, "open");
      assertEquals(round.token.symbol, "MCK");
      assertEquals(round.projects.map((p: { commitment: string }) => p.commitment), [
        (1000n * unit).toString(),
        (300n * unit).toString(),
      ]);
      assertEquals(round.projects[0].cost, (4000n * unit).toString());
      assertEquals(round.voterCount, 2);
      assertEquals(round.totalWeight, (1300n * unit).toString());

      const voter = await (await app.fetch(new Request(`http://x/api/voter/${owner.address}`)))
        .json();
      assertEquals(voter.weight.total, (1000n * unit).toString());
      assertEquals(voter.ballot, { public: { ranks: [1, 2] }, sealed: false });
      assertEquals(voter.inRoster, true);

      const project = await (await app.fetch(new Request("http://x/api/project/1"))).json();
      assertEquals(project.project.commitment, (300n * unit).toString());
      assertEquals(project.project.title, null);
      assertEquals(project.contentStatus, "none");
    } finally {
      anvil.kill("SIGTERM");
      await anvil.status;
    }
  },
});
