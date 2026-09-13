// Demo DAO token, DAO/USDC and DAO/EURC Uniswap v4 pairs on the shared Arc
// deployment, LP sponsorships on the open CRE Liquidity round, and one position
// per pair for each of the 20 demo voters, registered from their own wallets.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address, type Hex, createWalletClient, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, http, isAddress, keccak256,
  parseAbi, parseEther, parseEventLogs, toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC, EURC, USDC, artifact, local, operator, root, save, unlock } from "./demo";
import { decodeVault, type DemoVoter } from "./redeploy-vote-demo";

const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const sourceRun = flag("--round") ?? "open-cre-round";
const statePath = resolve(local, "dao-seats-state.json");
const receiptPath = resolve(root, "demo/dao-seats-deployment.json");
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const unit = 1_000_000n;
const LIQUIDITY = 2_000_000n, LOWER = -600, UPPER = 600, MAX_AMOUNT = 70_000n, MINIMUM_VALUE = 10_000n, SPONSOR_AMOUNT = 5n * unit;
const BATCH = 5;
type Pair = "USDC" | "EURC";
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const poolKeyType = { type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] } as const;
const permit2Abi = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const lpAbi = artifact("LPVoting").abi, poolAbi = artifact("LPCreRankedShares").abi;
const pmAbi = artifact("PositionManager", true).abi, managerAbi = artifact("PoolManager", true).abi;

function publish(state: any) {
  save(receiptPath, {
    version: 1, demo: true, chainId: ARC, createdAt: state.createdAt, organizer: state.organizer,
    description: "Permissionless demo DAO token with no economic value, two Uniswap v4 pairs at an initial 1:1 price, LP sponsorships of 5 test USDC each on the open CRE Liquidity round, and one small position per pair for each of the 20 operator-controlled demo wallets. Positions are registered with the LP voting module so their value accrues weight over time.",
    round: { run: sourceRun, pool: state.crePool, lpModule: state.lpModule, deadline: state.deadline },
    sharedContracts: state.sharedContracts, contracts: state.contracts, pairs: state.pairs, positions: state.positions, gifts: state.gifts ?? [],
    liquidityPerPosition: String(LIQUIDITY), tickRange: [LOWER, UPPER],
    transactions: Object.fromEntries(Object.entries(state.transactions).map(([label, tx]: any) => [label, { hash: tx.hash, blockNumber: tx.blockNumber, contractAddress: tx.contractAddress }])),
  });
}
function prepare() {
  if (existsSync(statePath)) return readJson(statePath);
  const round = readJson(resolve(local, `${sourceRun}-state.json`));
  const account = unlock();
  if (account.address.toLowerCase() !== round.deployer.toLowerCase()) throw Error("Unexpected organizer.");
  if (!round.rounds.USDC.pool || !round.rounds.USDC.lpModule) throw Error("The CRE Liquidity round has no pool or LP module yet.");
  const state = { version: 1, demo: true, chainId: ARC, createdAt: new Date().toISOString(), deployer: account.address, organizer: account.address, rpc: round.rpc,
    sourceRun, crePool: round.rounds.USDC.pool, lpModule: round.rounds.USDC.lpModule, deadline: round.deadline, sharedContracts: round.sharedContracts,
    contracts: {}, transactions: {}, pairs: {} as Record<Pair, any>, positions: { USDC: [], EURC: [] } as Record<Pair, any[]> };
  save(statePath, state); return state;
}
function voters(state: any): DemoVoter[] {
  const round = readJson(resolve(local, `${sourceRun}-state.json`));
  const list = decodeVault(resolve(local, `${sourceRun}-voters.encrypted.json`), `${ARC}:${round.createdAt}:${sourceRun}`);
  if (list.length !== 20) throw Error("Expected the 20 demo voters.");
  return list;
}
const stableOf = (pair: Pair) => pair === "USDC" ? USDC : EURC;
function keyOf(dao: Address, stable: Address) {
  const [currency0, currency1] = dao.toLowerCase() < stable.toLowerCase() ? [dao, stable] : [stable, dao];
  return { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" as Address };
}

async function deploy(state: any) {
  const op = operator(state, state.rpc, statePath); await op.guard();
  const helpers = state.sharedContracts;
  if (Number(state.deadline) < Math.floor(Date.now() / 1000) + 600) throw Error("The CRE round deadline is too close.");
  const dao = state.contracts.daoToken ?? await op.deploy("daoToken", "DemoToken", ["RankedShares Demo DAO", "DAO"], true);
  await op.write("mintDao", dao, artifact("DemoToken", true).abi, "mint", [state.organizer, 100n * unit]);
  publish(state);
  for (const pair of ["USDC", "EURC"] as Pair[]) {
    const key = keyOf(dao, stableOf(pair));
    const poolId = keccak256(encodeAbiParameters([poolKeyType], [key]));
    await op.write(`init:${pair}`, helpers.poolManager, managerAbi, "initialize", [key, 1n << 96n]);
    state.pairs[pair] = { ...state.pairs[pair], key, poolId, stable: stableOf(pair) }; op.remember(); publish(state);
    console.log(`${pair} pair ${poolId} initialized at 1:1.`);
  }
  await op.write("approveSponsorLP", USDC, erc20Abi, "approve", [state.crePool, 2n * SPONSOR_AMOUNT]);
  for (const pair of ["USDC", "EURC"] as Pair[]) {
    if (state.pairs[pair].sponsorshipId === undefined) {
      const id = await op.pub.readContract({ address: state.lpModule, abi: lpAbi, functionName: "sponsorshipCount" }) as bigint;
      const receipt = await op.write(`sponsorLP:${pair}`, state.crePool, poolAbi, "sponsorLP", [SPONSOR_AMOUNT, state.pairs[pair].key, stableOf(pair), MINIMUM_VALUE]);
      const event = parseEventLogs({ abi: lpAbi, eventName: "SponsoredLP", logs: receipt.logs })[0] as any;
      state.pairs[pair].sponsorshipId = Number(event?.args.id ?? id); state.pairs[pair].sponsorAmountBaseUnits = String(SPONSOR_AMOUNT);
      op.remember(); publish(state);
    }
    console.log(`${pair} pair sponsored: sponsorship ${state.pairs[pair].sponsorshipId}, ${Number(SPONSOR_AMOUNT) / 1e6} USDC.`);
  }
}
async function positions(state: any, list: DemoVoter[], pair: Pair) {
  const op = operator(state, state.rpc, statePath); await op.guard();
  const dao = state.contracts.daoToken as Address, stable = stableOf(pair), key = state.pairs[pair]?.key, pm = state.sharedContracts.positionManager as Address;
  if (!key) throw Error("Run deploy first.");
  const need = BigInt(list.length) * MAX_AMOUNT;
  if (!state.transactions[`mint:${pair}:0`] && await op.pub.readContract({ address: stable, abi: erc20Abi, functionName: "balanceOf", args: [state.organizer] }) < need) throw Error(`Organizer needs ${Number(need) / 1e6} test ${pair} for the positions.`);
  const expiry = Number(state.deadline) + 86400;
  for (const [label, token] of [["dao", dao], [pair, stable]] as const) {
    await op.write(`approvePermit2:${label}:${pair}`, token, erc20Abi, "approve", [PERMIT2, need]);
    await op.write(`permit2:${label}:${pair}`, PERMIT2, permit2Abi, "approve", [token, pm, need, expiry]);
  }
  for (let start = 0; start < list.length; start += BATCH) {
    const batch = list.slice(start, start + BATCH), label = `mint:${pair}:${start}`;
    if (!state.transactions[label]?.blockNumber) {
      const params = batch.map(v => encodeAbiParameters(
        [poolKeyType, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
        [key, LOWER, UPPER, LIQUIDITY, MAX_AMOUNT, MAX_AMOUNT, v.address, "0x"]));
      params.push(encodeAbiParameters([{ type: "address" }, { type: "address" }], [key.currency0, key.currency1]));
      const actions = ("0x" + "02".repeat(batch.length) + "0d") as Hex;
      const receipt = await op.write(label, pm, pmAbi, "modifyLiquidities", [encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]), BigInt(expiry)]);
      const transfers = parseEventLogs({ abi: pmAbi, eventName: "Transfer", logs: receipt.logs }).filter((e: any) => e.address.toLowerCase() === pm.toLowerCase()) as any[];
      if (transfers.length !== batch.length) throw Error("Unexpected mint events.");
      for (const [i, v] of batch.entries()) {
        const tokenId = transfers[i].args.id ?? transfers[i].args.tokenId;
        if (transfers[i].args.to.toLowerCase() !== v.address.toLowerCase()) throw Error("Position minted to the wrong wallet.");
        state.positions[pair][start + i] = { number: start + i + 1, owner: v.address, tokenId: String(tokenId), transactionHash: receipt.transactionHash };
      }
      op.remember(); publish(state);
    }
    console.log(`${pair} positions ${start + 1}-${start + batch.length} minted.`);
  }
  for (const p of state.positions[pair]) {
    if ((await op.pub.readContract({ address: pm, abi: pmAbi, functionName: "ownerOf", args: [BigInt(p.tokenId)] }) as string).toLowerCase() !== p.owner.toLowerCase()) throw Error("Position ownership check failed.");
  }
}
async function subscribe(state: any, list: DemoVoter[], pair: Pair) {
  const op = operator(state, state.rpc, statePath); await op.guard();
  const pm = state.sharedContracts.positionManager as Address, id = state.pairs[pair]?.sponsorshipId;
  if (id === undefined || state.positions[pair].length !== 20) throw Error("Mint the positions first.");
  const data = encodeAbiParameters([{ type: "uint256" }], [BigInt(id)]);
  for (const [i, v] of list.entries()) {
    const position = state.positions[pair][i], label = `subscribe:${pair}:${i}`;
    if (position.owner.toLowerCase() !== v.address.toLowerCase()) throw Error("Voter and position mismatch.");
    if (await op.pub.getBalance({ address: v.address }) < parseEther("0.01")) await op.send(`gas:${pair}:${i}`, "0x", v.address, parseEther("0.03"));
    const account = privateKeyToAccount(v.privateKey);
    let tx = state.transactions[label];
    if (!tx) {
      const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(state.rpc) });
      const args = [BigInt(position.tokenId), state.lpModule, data] as const;
      await op.pub.simulateContract({ address: pm, abi: pmAbi, functionName: "subscribe", args, account });
      const request = await wallet.prepareTransactionRequest({ account, chain: arcTestnet, to: pm, data: encodeFunctionData({ abi: pmAbi, functionName: "subscribe", args }) });
      if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) > parseEther("0.05")) throw Error("Registration fee exceeds the demo limit.");
      const raw = await wallet.signTransaction(request);
      tx = state.transactions[label] = { hash: keccak256(raw), raw, tokenId: position.tokenId, voter: v.address };
      op.remember();
    }
    let receipt = await op.pub.getTransactionReceipt({ hash: tx.hash }).catch(() => undefined);
    if (!receipt) {
      await op.pub.sendRawTransaction({ serializedTransaction: tx.raw }).catch(() => undefined);
      receipt = await op.pub.waitForTransactionReceipt({ hash: tx.hash, timeout: 60000 });
    }
    if (receipt.status !== "success") throw Error(`Registration reverted: ${label}`);
    tx.blockNumber = String(receipt.blockNumber);
    position.subscribeTransactionHash = tx.hash; position.sponsorshipId = id;
    op.remember(); publish(state);
    console.log(`${pair} position ${i + 1}/20 registered: ${tx.hash}`);
  }
  const registered = await op.pub.readContract({ address: state.lpModule, abi: lpAbi, functionName: "positions", args: [BigInt(id)] }) as any[];
  if (registered.filter(p => p.active).length < 20) throw Error("Not all positions are active in the LP module.");
  console.log(`${pair} sponsorship ${id}: ${registered.length} active positions accruing weight.`);
}
// One extra position for an outside wallet, minted from the organizer's tokens.
async function gift(state: any, to: Address, pair: Pair) {
  const op = operator(state, state.rpc, statePath); await op.guard();
  const dao = state.contracts.daoToken as Address, stable = stableOf(pair), key = state.pairs[pair]?.key, pm = state.sharedContracts.positionManager as Address;
  if (!key || !isAddress(to)) throw Error("Run deploy first and pass a checksummed --to address.");
  const label = `gift:${pair}:${to.toLowerCase()}`, expiry = Number(state.deadline) + 86400;
  if (!state.transactions[label]) {
    for (const [name, token] of [["dao", dao], [pair, stable]] as const) {
      if (await op.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [state.organizer] }) < MAX_AMOUNT) throw Error(`Organizer needs ${Number(MAX_AMOUNT) / 1e6} ${name === "dao" ? "DAO" : pair} for the position.`);
      await op.write(`approvePermit2:${name}:${pair}:${to.toLowerCase()}`, token, erc20Abi, "approve", [PERMIT2, MAX_AMOUNT]);
      await op.write(`permit2:${name}:${pair}:${to.toLowerCase()}`, PERMIT2, permit2Abi, "approve", [token, pm, MAX_AMOUNT, expiry]);
    }
  }
  const params = [encodeAbiParameters(
    [poolKeyType, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
    [key, LOWER, UPPER, LIQUIDITY, MAX_AMOUNT, MAX_AMOUNT, to, "0x"]), encodeAbiParameters([{ type: "address" }, { type: "address" }], [key.currency0, key.currency1])];
  const receipt = await op.write(label, pm, pmAbi, "modifyLiquidities", [encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x020d", params]), BigInt(expiry)]);
  const transfer = parseEventLogs({ abi: pmAbi, eventName: "Transfer", logs: receipt.logs }).find((e: any) => e.address.toLowerCase() === pm.toLowerCase() && e.args.to.toLowerCase() === to.toLowerCase()) as any;
  if (!transfer) throw Error("No position minted.");
  const tokenId = String(transfer.args.id ?? transfer.args.tokenId);
  state.gifts = state.gifts ?? [];
  if (!state.gifts.some((g: any) => g.transactionHash === receipt.transactionHash)) state.gifts.push({ pair, owner: to, tokenId, sponsorshipId: state.pairs[pair].sponsorshipId, transactionHash: receipt.transactionHash });
  op.remember(); publish(state);
  console.log(`${pair} position ${tokenId} minted to ${to}: ${receipt.transactionHash}`);
}
async function main() {
  const command = process.argv[2], pair = (flag("--pair") ?? "USDC") as Pair;
  if (!["deploy", "positions", "subscribe", "gift", "status"].includes(command) || !["USDC", "EURC"].includes(pair)) throw Error("Use deploy | positions --pair USDC|EURC | subscribe --pair USDC|EURC | gift --to 0xADDRESS [--pair USDC|EURC] | status [--round NAME].");
  const state = prepare();
  if (command === "deploy") await deploy(state);
  if (command === "positions") await positions(state, voters(state), pair);
  if (command === "subscribe") await subscribe(state, voters(state), pair);
  if (command === "gift") await gift(state, getAddress(flag("--to") ?? ""), pair);
  if (command === "status") console.log(JSON.stringify({ daoToken: state.contracts.daoToken, pairs: state.pairs, positions: { USDC: state.positions.USDC.length, EURC: state.positions.EURC.length } }));
}
if (import.meta.main) main().catch(error => { console.error(`DAO seats demo stopped: ${String(error.shortMessage ?? error.message).replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 250)}`); process.exitCode = 1; });
