// Full CLI rehearsal on a disposable local chain. Never changes the live import pools.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createPublicClient, hexToBytes, http, parseAbi } from "viem";
import { artifact, clients, deployRounds, loadState, local, operator, save, simulate, USDC, EURC, MOCK_FORWARDER } from "./demo";
import { encrypt } from "../src/lib/sealed";

const rpc = "http://127.0.0.1:8552";
const node = spawn("anvil", ["--host", "127.0.0.1", "--port", "8552", "--chain-id", "5042002", "--silent"], { stdio: "ignore" });
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 8553, async fetch(req) {
  const body = await req.text();
  const message = JSON.parse(body);
  const reply = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const text = await reply.text();
  console.log("SIM RPC", message.method, message.params?.[0]?.to ?? "", message.params?.[1] ?? "", JSON.parse(text).error?.message ?? `result length ${String(JSON.parse(text).result).length}`);
  return new Response(text, { headers: { "Content-Type": "application/json" } });
} });
const { pub, account } = clients(rpc);
const state = structuredClone(loadState());
state.contracts = {}; state.transactions = {};
delete state.rpc;
const path = resolve(local, "rehearsal-state.json");
const upstream = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
async function request(method: string, params: any[]) { return pub.request({ method, params } as any); }
try {
  for (let i = 0; ; i++) {
    try { await pub.getChainId(); break; } catch { if (i === 100) throw new Error("Local Anvil did not start."); await Bun.sleep(100); }
  }
  await request("anvil_setBalance", [account.address, "0x3635c9adc5dea00000"]);
  for (const address of [MOCK_FORWARDER, "0x000000000022D473030F116dDEE9F6B43aC78BA3"] as const) {
    const code = await upstream.getCode({ address });
    if (!code || code === "0x") throw new Error("Missing Arc simulator infrastructure.");
    await request("anvil_setCode", [address, code]);
  }
  const op = operator(state, rpc, path);
  for (const [symbol, address] of [["USDC", USDC], ["EURC", EURC]] as const) {
    const source = await op.deploy(`local${symbol}`, "DemoToken", [symbol, symbol], true);
    await request("anvil_setCode", [address, await pub.getCode({ address: source })]);
    await op.write(`localMint${symbol}`, address, artifact("DemoToken", true).abi, "mint", [account.address, 100_000_000_000n]);
  }
  await deployRounds(state, rpc, path);
  const pool = state.rounds.EURC.pool;
  const abi = artifact("NoirRankedShares").abi;
  await op.write("rehearsalProjectA", pool, abi, "addProject", [1_000_000n, state.recipient]);
  await op.write("rehearsalProjectB", pool, abi, "addProject", [2_000_000n, state.recipient]);
  await op.write("rehearsalOpen", pool, abi, "openVoting");
  await op.write("rehearsalApprove", EURC, parseAbi(["function approve(address,uint256) returns (bool)"]), "approve", [pool, 10_000_000n]);
  await op.write("rehearsalSponsor", pool, abi, "sponsor", [10_000_000n, [account.address]]);
  const ciphertext = encrypt({ x: BigInt(state.rounds.EURC.tallierPkX), y: BigInt(state.rounds.EURC.tallierPkY) }, BigInt(account.address), [1, 2], 73n);
  await op.write("rehearsalBallot", pool, abi, "voteSealed", ciphertext);
  await request("evm_setNextBlockTimestamp", [Number(state.deadline) + 1]);
  await request("evm_mine", []);
  // CRE reads finalized blocks. Anvil's finalized tag lags its latest block.
  await request("anvil_mine", ["0x60"]);
  // First run closes the ballot commitment; second decrypts/tallies and reports.
  await simulate(state, "http://127.0.0.1:8553", "EURC", true);
  if (!(await pub.readContract({ address: pool, abi, functionName: "closed" }))) throw new Error("CRE did not close the rehearsal pool.");
  await request("anvil_mine", ["0x60"]);
  await simulate(state, "http://127.0.0.1:8553", "EURC", true);
  const reported = await pub.readContract({ address: pool, abi, functionName: "resultReported" });
  if (!reported) throw new Error("CRE did not deliver the sealed tally.");
  const funded = await pub.readContract({ address: pool, abi, functionName: "provisionalResult" }) as bigint[];
  console.log("Rehearsal funded project IDs:", funded.map(String).join(","));
  if (funded.map(String).join(",") !== "0,1") throw new Error("Unexpected rehearsal funding result.");
  save(resolve(local, "rehearsal-result.json"), { testedAt: new Date().toISOString(), environment: "local Anvil, simulated CRE TEE", chainId: 5042002,
    eurcPool: pool, usdcPool: state.rounds.USDC.pool, encryptedBallots: 1, resultReported: reported, provisionalFundedProjects: funded,
    note: "Real Noir verifiers deployed; this CLI rehearsal checks CRE reporting. The separate prover E2E test checks Proven finality." });
  console.log("REHEARSAL PASSED: two pools deployed; CRE closed and tallied an encrypted ballot; provisional funding order 0,1.");
} finally {
  node.kill();
  proxy.stop();
}
