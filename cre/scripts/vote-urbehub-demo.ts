// Twenty operator-controlled test wallets, restricted to the approved Arc demo.
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, custom, encodeAbiParameters, encodeFunctionData, erc20Abi,
  formatEther, hexToBytes, http, keccak256, parseEther, toHex,
  type Address, type Chain, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { createPublicClient as arkivPublic, createWalletClient as arkivWallet, ExpirationTime } from "@arkiv-network/sdk";
import { addr, bytes32, str, u64, u256 } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { and, eq } from "@arkiv-network/sdk/query";
import { BALLOT_SCHEMA, ARKIV_RPC } from "../src/lib/arkiv";
import { artifact, ARC, EURC, json, loadState, local, master, root, save, unlock } from "./demo";
import { decrypt, deriveSk, encrypt, validate } from "../src/lib/sealed";
import { Q } from "../src/lib/field";

const POOL = "0x35a7915dc29c67805b7323e5a0384f919c9cf210" as Address;
const COUNT = 20;
const GAS = parseEther("0.05");
const ARKIV_GAS = parseEther("0.02");
const SEAT = 1_000_000n;
const TOTAL = SEAT * BigInt(COUNT);
const vaultPath = resolve(local, "urbehub-voters.encrypted.json");
type Voter = { address: Address; privateKey: Hex; ranks: number[]; ciphertext: string[] };
type Plan = { version: number; chainId: number; pool: Address; createdAt: string; voters: Voter[] };
type Tx = { intent: Hex; hash: Hex; raw: Hex; chainId: number; block?: string; fee?: string };
type Storage = { salt: string; expiresAt: string; retentionUntil: string; entityKey?: Hex; transactionHash?: Hex };
type Journal = { chainId: number; pool: Address; rehearsal: boolean; transactions: Record<string, Tx>; storage?: Record<string, Storage> };

function scalar() {
  for (;;) {
    const n = BigInt(toHex(randomBytes(32)));
    if (n > 0n && n < Q) return n;
  }
}

export function variedRanks(index: number, projects = 15) {
  const order = Array.from({ length: projects }, (_, i) => i);
  for (let i = projects - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const ranks = new Array<number>(projects).fill(0);
  const included = index % 4 === 1 ? 5 : index % 4 === 3 ? 10 : projects;
  order.slice(0, included).forEach((project, position) => {
    ranks[project] = index % 4 === 2 ? Math.floor(position / 3) * 3 + 1 : position + 1;
  });
  if (!validate(ranks, projects)) throw Error("Invalid generated competition ranks.");
  return ranks;
}

function password() { return readFileSync(resolve(local, "keystore-password"), "utf8").trim(); }
function loadPlan(): Plan {
  const vault = JSON.parse(readFileSync(vaultPath, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(password(), Buffer.from(vault.salt, "hex"), 32), Buffer.from(vault.iv, "hex"));
  decipher.setAAD(Buffer.from(`${ARC}:${POOL}:demo-voters-v1`));
  decipher.setAuthTag(Buffer.from(vault.tag, "hex"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(vault.data, "hex")), decipher.final()]).toString());
}
function plan(state: any): Plan {
  if (existsSync(vaultPath)) return loadPlan();
  const pk = { x: BigInt(state.rounds.EURC.tallierPkX), y: BigInt(state.rounds.EURC.tallierPkY) };
  const voters: Voter[] = [], seen = new Set<string>();
  for (let i = 0; i < COUNT; i++) {
    let ranks: number[];
    do { ranks = variedRanks(i); } while (seen.has(JSON.stringify(ranks)));
    seen.add(JSON.stringify(ranks));
    const privateKey = generatePrivateKey(), { address } = privateKeyToAccount(privateKey);
    voters.push({ privateKey, address, ranks, ciphertext: encrypt(pk, BigInt(address), ranks, scalar()).map(String) });
  }
  const result: Plan = { version: 1, chainId: ARC, pool: POOL, createdAt: new Date().toISOString(), voters };
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(password(), salt, 32), iv);
  cipher.setAAD(Buffer.from(`${ARC}:${POOL}:demo-voters-v1`));
  const data = Buffer.concat([cipher.update(json(result)), cipher.final()]);
  save(vaultPath, { version: 1, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("hex") });
  return result;
}

function verifyPlan(p: Plan, state: any) {
  if (p.version !== 1 || p.chainId !== ARC || p.pool !== POOL || p.voters.length !== COUNT) throw Error("Unexpected voter plan.");
  if (new Set(p.voters.map(v => v.address.toLowerCase())).size !== COUNT || new Set(p.voters.map(v => JSON.stringify(v.ranks))).size !== COUNT) throw Error("Voters and rankings must be distinct.");
  const sk = deriveSk(master(), hexToBytes(state.rounds.EURC.keySalt));
  for (const v of p.voters) {
    if (privateKeyToAccount(v.privateKey).address !== v.address || !validate(v.ranks, 15)) throw Error("Invalid encrypted voter backup.");
    const decoded = decrypt(sk, BigInt(v.address), v.ciphertext.map(BigInt) as [bigint, bigint, bigint], 15);
    if (JSON.stringify(decoded) !== JSON.stringify(v.ranks)) throw Error("Ballot failed local decryption verification.");
  }
}

async function run(state: any, p: Plan, rpc: string, rehearsal: boolean, setupOnly = false) {
  if (rehearsal && rpc !== "http://127.0.0.1:8555") throw Error("Rehearsals may only write to the local fork.");
  verifyPlan(p, state);
  const owner = unlock(), abi = artifact("NoirRankedShares").abi;
  const pub = createPublicClient({ chain: arcTestnet, transport: http(rpc, { timeout: 15_000, retryCount: 3 }), batch: { multicall: { wait: 16, batchSize: 8192 } }, pollingInterval: rehearsal ? 100 : 2000 });
  const journalPath = resolve(local, rehearsal ? "urbehub-voters-rehearsal.json" : "urbehub-voters-journal.json");
  const receiptPath = resolve(root, rehearsal ? "demo/.local/urbehub-votes-rehearsal.json" : "demo/urbehub-vote-receipts.json");
  const journal: Journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : { chainId: ARC, pool: POOL, rehearsal, transactions: {} };
  journal.storage ??= {};
  const arkiv = arkivPublic({ chain: tiramisu, transport: rehearsal
    ? custom({ request: async () => { throw Error("Arkiv network access is disabled during local rehearsals."); } })
    : http(ARKIV_RPC, { timeout: 15_000, retryCount: 3 }) });
  if (journal.pool !== POOL || journal.chainId !== ARC || journal.rehearsal !== rehearsal) throw Error("Unexpected transaction journal.");
  const read = (functionName: string, args: any[] = []) => pub.readContract({ address: POOL, abi, functionName, args });
  const [chainId, organizer, token, count, deadline, minimum, arkivEnabled, x, y, block] = await Promise.all([
    pub.getChainId(), read("owner"), read("token"), read("projectCount"), read("votingDeadline"),
    read("minSealedVote"), read("arkivBallots"), read("tallierPkX"), read("tallierPkY"), pub.getBlock(),
  ]);
  if (chainId !== ARC || String(organizer).toLowerCase() !== owner.address.toLowerCase() || String(token).toLowerCase() !== EURC.toLowerCase() || count !== 15n || minimum !== SEAT || String(x) !== state.rounds.EURC.tallierPkX || String(y) !== state.rounds.EURC.tallierPkY) throw Error("Pool settings do not match this demo.");
  if (BigInt(deadline as bigint) <= block.timestamp + 600n) throw Error("The voting deadline is too close for this run.");
  const imports = JSON.parse(readFileSync(resolve(root, "demo/urbehub-proposal-receipts.json"), "utf8"));
  for (const row of imports.proposals) {
    const proposal = await read("proposals", [BigInt(row.proposalId)]) as any[];
    if (proposal[4] !== 1 || proposal[1] !== row.contentRef || String(proposal[2]) !== row.amountBaseUnits || String(proposal[5]) !== row.projectId) throw Error("An accepted proposal changed.");
  }
  if (!journal.transactions.sponsor) {
    if (await read("voterCount") !== 0n || await read("totalWeight") !== 0n) throw Error("Unexpected voters or budget before demo sponsorship.");
    const eurc = await pub.readContract({ address: EURC, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] });
    if (eurc < TOTAL) throw Error("Organizer needs 20 test EURC to sponsor the voters.");
  }
  const unfunded = p.voters.filter(v => !journal.transactions[`gas:${v.address}`]).length;
  if (await pub.getBalance({ address: owner.address }) < GAS * BigInt(unfunded) + parseEther("0.2")) throw Error("Organizer has insufficient gas for the remaining transfers.");
  if (!rehearsal && !setupOnly) {
    if (await arkiv.getChainId() !== tiramisu.id) throw Error("Unexpected Arkiv chain.");
    const missing = p.voters.filter(v => !journal.transactions[`arkiv-gas:${v.address}`]).length;
    if (await arkiv.getBalance({ address: owner.address }) < ARKIV_GAS * BigInt(missing) + parseEther("0.01")) {
      throw Error("Fund the organizer with at least 0.41 test GLM on Arkiv Tiramisu before the storage run.");
    }
  }

  async function send(label: string, account: ReturnType<typeof privateKeyToAccount>, to: Address, data: Hex = "0x", value = 0n, storageNetwork = false) {
    if (rehearsal && storageNetwork) throw Error("Live Arkiv transactions are disabled during local rehearsals.");
    const chain: Chain = storageNetwork ? tiramisu : arcTestnet;
    const reader = storageNetwork ? arkiv : pub;
    const wallet = createWalletClient({ account, chain, transport: http(storageNetwork ? ARKIV_RPC : rpc, { timeout: 15_000, retryCount: 3 }) });
    const intent = keccak256(toHex(json({ chainId: chain.id, from: account.address, to, data, value })));
    let tx = journal.transactions[label];
    if (tx && tx.intent !== intent) throw Error("Transaction intent changed: " + label);
    if (!tx) {
      const request = await wallet.prepareTransactionRequest({ account, chain, to, data, value });
      const maxFee = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
      if (maxFee > (storageNetwork ? ARKIV_GAS : account.address === owner.address ? parseEther("0.1") : GAS)) throw Error("Gas estimate exceeds the demo limit: " + label);
      const raw = await wallet.signTransaction(request);
      tx = journal.transactions[label] = { intent, raw, hash: keccak256(raw), chainId: chain.id };
      save(journalPath, journal); // Save before broadcasting; retries cannot double-fund or double-sponsor.
    }
    let receipt = await reader.getTransactionReceipt({ hash: tx.hash }).catch(() => undefined);
    if (!receipt) {
      const pending = await reader.getTransaction({ hash: tx.hash }).catch(() => undefined);
      if (!pending) await wallet.sendRawTransaction({ serializedTransaction: tx.raw });
      receipt = await reader.waitForTransactionReceipt({ hash: tx.hash, timeout: 120_000 });
    }
    if (receipt.status !== "success") throw Error("Transaction reverted; inspect before resuming: " + label);
    tx.block = String(receipt.blockNumber);
    tx.fee = String(receipt.gasUsed * receipt.effectiveGasPrice);
    save(journalPath, journal);
    console.log(`${label}: confirmed ${tx.hash}`);
    return tx;
  }
  const write = (label: string, functionName: string, args: any[] = []) => send(label, owner, POOL, encodeFunctionData({ abi, functionName, args }));
  async function publish(voter: Voter, payload: Hex): Promise<Hex> {
    if (rehearsal) return keccak256(payload); // The local Arc fork tests reference binding; live publication uses real Arkiv.
    await send(`arkiv-gas:${voter.address}`, owner, voter.address, "0x", ARKIV_GAS, true);
    let record = journal.storage![voter.address];
    if (!record) {
      const head = await arkiv.getBlock();
      const until = BigInt(deadline as bigint) + 15n * 24n * 60n * 60n;
      record = journal.storage![voter.address] = { salt: String(BigInt(toHex(randomBytes(16)))),
        expiresAt: String(head.number + (until - head.timestamp + 1n) / 2n), retentionUntil: String(until) };
      save(journalPath, journal);
    }
    const attributes = {
      schema: str(BALLOT_SCHEMA), pool_chain: u64(BigInt(ARC)), pool: addr(POOL), voter: addr(voter.address),
      pool_kind: str("noir"), ballot_mode: str("sealed"), revision: u256(1n), projects: u64(15n),
      payload_hash: bytes32(keccak256(payload)), retention_until: u64(BigInt(record.retentionUntil)),
    };
    const storageWallet = arkivWallet({ account: voter.address, chain: tiramisu,
      transport: custom({ request: async ({ method, params }) => {
        if (method === "eth_sendTransaction") {
          const request = (params as any[])[0];
          if (request.from.toLowerCase() !== voter.address.toLowerCase() || request.to.toLowerCase() !== "0x4400000000000000000000000000000000000044" || BigInt(request.value ?? 0) !== 0n) throw Error("Unexpected Arkiv transaction.");
          return (await send(`arkiv-store:${voter.address}`, privateKeyToAccount(voter.privateKey), request.to, request.data, 0n, true)).hash;
        }
        return arkiv.request({ method, params } as never);
      } }, { retryCount: 0 }),
    });
    const result = await storageWallet.createEntity({ payload: hexToBytes(payload), contentType: "application/octet-stream", attributes,
      flags: { readonly: true, permissionlessExtension: false }, salt: BigInt(record.salt), expires: ExpirationTime.atBlock(BigInt(record.expiresAt)) });
    record.entityKey = result.entityKey;
    record.transactionHash = result.txHash;
    save(journalPath, journal);
    const entity = await arkiv.getEntity(result.entityKey);
    if (toHex(entity.payload) !== payload || entity.creator.toLowerCase() !== voter.address.toLowerCase() || !entity.creationFlags.readonly || entity.creationFlags.permissionlessExtension || entity.expiresAt !== BigInt(record.expiresAt)) throw Error("Arkiv ballot verification failed.");
    for (const [name, value] of Object.entries(attributes)) {
      if (entity.attributes[name]?.type !== value.type || String(entity.attributes[name]?.value).toLowerCase() !== String(value.value).toLowerCase()) throw Error("Arkiv ballot attributes changed.");
    }
    const indexed = await arkiv.select({ key: true }).where(and(...Object.entries(attributes).map(([name, value]) => eq(name, value)))).limit(10).fetch();
    if (!indexed.entities.some(e => e.key.toLowerCase() === result.entityKey.toLowerCase())) throw Error("Arkiv has not indexed the ballot yet. Resume to retry.");
    return result.entityKey;
  }
  const exportReceipts = (verified = false) => save(receiptPath, {
    version: 1, demo: true, description: "20 operator-controlled demo wallets; distinct encrypted rankings, not independent participants.",
    chainId: ARC, pool: POOL, organizer: owner.address, votingDeadline: String(deadline),
    arkivBallots: true, arkivChainId: tiramisu.id, arkivGasGLMPerWallet: "0.02",
    ...(verified ? { verifiedAt: new Date().toISOString(), votingOpen: true, sealedCount: COUNT } : {}),
    sponsorshipEURC: "20", seatWeightEURC: "1", gasUSDCPerWallet: "0.05",
    totalGasUSDCTransferred: formatEther(GAS * BigInt(p.voters.filter(v => journal.transactions[`gas:${v.address}`]?.block).length)),
    openTransaction: journal.transactions.open?.hash, sponsorshipTransaction: journal.transactions.sponsor?.hash,
    voters: p.voters.map((v, i) => ({ number: i + 1, address: v.address,
      gasTransaction: journal.transactions[`gas:${v.address}`]?.hash,
      arkivGasTransaction: journal.transactions[`arkiv-gas:${v.address}`]?.hash,
      arkivEntityKey: journal.storage![v.address]?.entityKey,
      arkivStorageTransaction: journal.storage![v.address]?.transactionHash,
      arkivExpiresAtBlock: journal.storage![v.address]?.expiresAt,
      voteTransaction: journal.transactions[`vote:${v.address}`]?.hash,
      voteConfirmed: !!journal.transactions[`vote:${v.address}`]?.block })),
    transactionFeesUSDC: formatEther(Object.values(journal.transactions).filter(tx => tx.chainId === ARC).reduce((sum, tx) => sum + BigInt(tx.fee ?? 0), 0n)),
    transactionFeesGLM: formatEther(Object.values(journal.transactions).filter(tx => tx.chainId === tiramisu.id).reduce((sum, tx) => sum + BigInt(tx.fee ?? 0), 0n)),
  });

  if (!arkivEnabled) await write("enable-arkiv", "enableArkivBallots");
  if (journal.transactions.open || !await read("votingOpen")) await write("open", "openVoting");
  const allowance = await pub.readContract({ address: EURC, abi: erc20Abi, functionName: "allowance", args: [owner.address, POOL] });
  if ((!journal.transactions.sponsor && allowance < TOTAL) || journal.transactions.approve) {
    await send("approve", owner, EURC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL, TOTAL] }));
  }
  await write("sponsor", "sponsor", [TOTAL, p.voters.map(v => v.address)]);
  for (const voter of p.voters) await send(`gas:${voter.address}`, owner, voter.address, "0x", GAS);
  exportReceipts();
  if (setupOnly) { console.log("SETUP PASSED: Arkiv enabled, voting open, 20 sponsored wallets funded with Arc gas."); return; }
  for (const [index, voter] of p.voters.entries()) {
    const weight = await read("seatWeight", [voter.address]);
    if (weight !== SEAT) throw Error("Unexpected voter weight.");
    const payload = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], voter.ciphertext.map(BigInt) as [bigint, bigint, bigint]);
    const entityKey = await publish(voter, payload);
    await send(`vote:${voter.address}`, privateKeyToAccount(voter.privateKey), POOL,
      encodeFunctionData({ abi, functionName: "voteSealedArkiv", args: [entityKey, payload, 0n] }));
    const actual = await read("ballotRefOf", [voter.address, true]) as { entityKey: Hex; payloadHash: Hex; revision: bigint };
    if (actual.entityKey !== entityKey || actual.payloadHash !== keccak256(payload) || actual.revision !== 1n) throw Error("Stored ballot reference does not match the encrypted plan.");
    exportReceipts();
    console.log(`Verified encrypted ballot ${index + 1}/${COUNT}`);
  }
  if (await read("sealedCount") !== BigInt(COUNT) || await read("voterCount") !== BigInt(COUNT) || await read("totalWeight") !== TOTAL || !await read("votingOpen")) throw Error("Unexpected final voting state.");
  exportReceipts(true);
  console.log(`${rehearsal ? "REHEARSAL" : "ARC"} PASSED: voting open, 20 funded wallets, 20 distinct encrypted ballots, 20 EURC budget.`);
}

async function main() {
  const state = loadState();
  if (state.chainId !== ARC || state.demo !== true || state.rounds.EURC.pool.toLowerCase() !== POOL) throw Error("Unexpected demo deployment.");
  const rehearsal = process.argv.includes("--rehearse"), broadcast = process.argv.includes("--broadcast"), setupOnly = process.argv.includes("--setup");
  if (["--rehearse", "--broadcast", "--setup", "--prepare"].filter(mode => process.argv.includes(mode)).length !== 1) throw Error("Choose exactly one execution mode.");
  if (!rehearsal && !broadcast && !process.argv.includes("--prepare") && !setupOnly) throw Error("Use --prepare, --rehearse, --setup, or --broadcast for this Arc demo.");
  if (rehearsal && broadcast) throw Error("Choose one execution mode.");
  const p = plan(state);
  verifyPlan(p, state);
  console.log("Prepared and verified 20 distinct ballots. Wallet keys and rankings are in the encrypted local backup.");
  if (!rehearsal && !broadcast && !setupOnly) return;
  if (broadcast || setupOnly) return run(state, p, state.rpc, false, setupOnly);
  const rpc = "http://127.0.0.1:8555";
  // New fork, fresh local journal. The encrypted voter backup is shared with the live run.
  save(resolve(local, "urbehub-voters-rehearsal.json"), { chainId: ARC, pool: POOL, rehearsal: true, transactions: {} });
  const node = spawn("anvil", ["--host", "127.0.0.1", "--port", "8555", "--chain-id", String(ARC), "--fork-url", state.rpc, "--silent"], { stdio: "ignore" });
  try {
    const check = createPublicClient({ transport: http(rpc, { retryCount: 0 }) });
    for (let i = 0; ; i++) {
      try { await check.getChainId(); break; } catch { if (i === 100) throw Error("Rehearsal fork did not start."); await Bun.sleep(100); }
    }
    await run(state, p, rpc, true, true);
    await run(state, p, rpc, true);
    await run(state, p, rpc, true); // Resume must reuse all 43 transactions and retain exactly 20 ballots.
  } finally { node.kill(); }
}
if (import.meta.main) main().catch(error => {
  console.error("Voting stopped: " + String(error.shortMessage || error.message).replace(/0x[0-9a-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 240));
  process.exitCode = 1;
});
