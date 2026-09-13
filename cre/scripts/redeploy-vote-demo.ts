// Redeploy the approved Arc testnet demo and replay 20 controlled wallets per pool.
// All private material and signed transactions stay in demo/.local.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  type Address, type Hex, concat, createWalletClient, decodeAbiParameters,
  encodeAbiParameters, encodeFunctionData, erc20Abi, hashDomain, hexToBytes,
  http, keccak256, parseAbi, parseEther, parseEventLogs, parseSignature,
  stringToHex, toHex, zeroAddress, zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { artifact, ARC, EURC, USDC, MOCK_FORWARDER, json, loadState, local, master, operator, root, save, unlock } from "./demo";
import { variedRanks } from "./vote-urbehub-demo";
import { Q } from "../src/lib/field";
import { pubkey } from "../src/lib/grumpkin";
import { decrypt, deriveSk, encrypt, validate } from "../src/lib/sealed";
import { decryptCre, deriveCreKey } from "../src/lib/lp";
import { ballotAbi, ballotId, ARKIV_RPC, payloadQuery, payloadReply, rosterPage } from "../src/lib/arkiv";
import { ballotStorageWorker, type StorageJournal } from "./lib/ballot-storage";
import { recoverPayload } from "../../prover/src/core/arkiv";

const statePath = resolve(local, "new-flow-state.json");
const vaultPath = resolve(local, "new-flow-voters.encrypted.json");
const receiptPath = resolve(root, "demo/new-flow-deployment.json");
const storagePath = resolve(local, "new-flow-arkiv.json");
const unit = 1_000_000n;
const sharedNames = ["poseidon", "ingestVerifier", "tallyVerifier", "poolManager", "positionDescriptor", "positionManager", "stateView"];
type Currency = "EURC" | "USDC";
export type DemoVoter = { address: Address; privateKey: Hex; ranks: Record<Currency, number[]>; payloads: Record<Currency, Hex> };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const password = () => readFileSync(resolve(local, "keystore-password"), "utf8").trim();
function scalar(order: bigint) { for (;;) { const x = BigInt(toHex(randomBytes(32))); if (x > 0n && x < order) return x; } }
export function decodeVault(path: string, aad: string) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  const d = createDecipheriv("aes-256-gcm", scryptSync(password(), Buffer.from(v.salt, "hex"), 32), Buffer.from(v.iv, "hex"));
  d.setAAD(Buffer.from(aad)); d.setAuthTag(Buffer.from(v.tag, "hex"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data, "hex")), d.final()]).toString());
}
export function encodeVault(path: string, aad: string, value: unknown) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", scryptSync(password(), salt, 32), iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(json(value)), c.final()]);
  save(path, { version: 2, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("hex"), iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data: data.toString("hex") });
}
function encryptCre(pk: Hex, address: Address, ranks: number[]): Hex {
  const sk = toHex(scalar(secp256k1.Point.Fn.ORDER), { size: 32 });
  const ephemeral = secp256k1.getPublicKey(hexToBytes(sk), true);
  const shared = secp256k1.getSharedSecret(hexToBytes(sk), hexToBytes(pk), true).slice(1);
  const key = keccak256(concat([stringToHex("RankedShares/sealed/secp256k1"), toHex(shared), address]));
  const pad = hexToBytes(keccak256(concat([key, "0x00"])));
  return concat([toHex(ephemeral), toHex(Uint8Array.from(ranks, (rank, i) => rank ^ pad[i]))]);
}
export function prepareNewDemo() {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, "utf8"));
  const old = loadState(), owner = unlock();
  if (owner.address.toLowerCase() !== old.deployer.toLowerCase()) throw Error("Unexpected organizer.");
  const noirSalt = toHex(randomBytes(32)), creSalt = toHex(randomBytes(32));
  const pk = pubkey(deriveSk(master(), hexToBytes(noirSalt)));
  // Keep the previously agreed deadline while it still leaves time to demonstrate voting.
  const deadline = BigInt(old.deadline) > BigInt(Math.floor(Date.now() / 1000)) + 3600n
    ? old.deadline : String(Math.floor(Date.now() / 1000) + 6 * 3600);
  const state = { version: 2, ballotFlowVersion: 2, demo: true, chainId: ARC,
    createdAt: new Date().toISOString(), deployer: owner.address, organizer: owner.address,
    recipient: old.recipient, deadline, rpc: old.rpc, forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress,
    replaces: { EURC: old.rounds.EURC.pool, USDC: old.rounds.USDC.pool },
    sharedContracts: Object.fromEntries(sharedNames.map(name => [name, old.contracts[name]])),
    rounds: {
      EURC: { id: "urbehub", token: EURC, kind: "noir", keySalt: noirSalt, tallierPkX: String(pk.x), tallierPkY: String(pk.y) },
      USDC: { id: "golem", token: USDC, kind: "lp-cre", keySalt: creSalt, tallierPk: toHex(secp256k1.getPublicKey(deriveCreKey(master(), creSalt), true)) },
    }, contracts: {}, transactions: {}, proposals: { EURC: [], USDC: [] }, ballots: { EURC: [], USDC: [] },
  };
  save(statePath, state);
  return state;
}
function voters(state: any): DemoVoter[] {
  const aad = `${ARC}:${state.createdAt}:v2-voters`;
  if (existsSync(vaultPath)) return decodeVault(vaultPath, aad);
  const old = decodeVault(resolve(local, "urbehub-voters.encrypted.json"), `${ARC}:${state.replaces.EURC.toLowerCase()}:demo-voters-v1`);
  if (old.voters.length !== 20) throw Error("Expected the 20 existing demo wallets.");
  const seen = new Set<string>();
  const list = old.voters.map((v: any, i: number) => {
    if (privateKeyToAccount(v.privateKey).address.toLowerCase() !== v.address.toLowerCase()) throw Error("Invalid wallet backup.");
    let usdc: number[];
    do { usdc = variedRanks(i, 6); } while (seen.has(JSON.stringify(usdc)));
    seen.add(JSON.stringify(usdc));
    const ranks = { EURC: v.ranks, USDC: usdc };
    if (!validate(ranks.EURC, 15)) throw Error("Invalid previous ranking.");
    const n = state.rounds.EURC;
    const noir = encrypt({ x: BigInt(n.tallierPkX), y: BigInt(n.tallierPkY) }, BigInt(v.address), ranks.EURC, scalar(Q));
    const payloads = i < 2
      ? { EURC: toHex(Uint8Array.from(ranks.EURC)), USDC: toHex(Uint8Array.from(ranks.USDC)) }
      : { EURC: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], noir), USDC: encryptCre(state.rounds.USDC.tallierPk, v.address, ranks.USDC) };
    return { address: v.address, privateKey: v.privateKey, ranks, payloads };
  });
  encodeVault(vaultPath, aad, list);
  return list;
}
function exportReceipts(state: any) {
  save(receiptPath, { version: 2, demo: true, chainId: ARC, simulationOnly: true,
    description: "Twenty operator-controlled wallets in each pool: two public contribution votes and eighteen encrypted sponsored-seat votes. No LP positions are represented by these demo votes.",
    organizer: state.organizer, recipient: state.recipient, deadline: state.deadline,
    deadlineUtc: new Date(Number(state.deadline) * 1000).toISOString(), forwarder: state.forwarder, workflowOwner: state.workflowOwner,
    replaces: state.replaces, sharedContracts: state.sharedContracts, contracts: state.contracts,
    rounds: state.rounds, proposals: state.proposals, ballots: state.ballots, verifiedAt: state.verifiedAt,
    transactions: Object.fromEntries(Object.entries(state.transactions).map(([label, tx]: any) => [label, { hash: tx.hash, blockNumber: tx.blockNumber, contractAddress: tx.contractAddress }])),
  });
}
function verifyVoterBackup(state: any, list: DemoVoter[]) {
  if (list.length !== 20 || new Set(list.map(v => v.address.toLowerCase())).size !== 20) throw Error("Expected 20 distinct demo wallets.");
  for (const currency of ["EURC", "USDC"] as const) {
    if (new Set(list.map(v => JSON.stringify(v.ranks[currency]))).size !== 20) throw Error("Demo rankings must differ.");
    const round = state.rounds[currency];
    for (const [i, v] of list.entries()) {
      if (privateKeyToAccount(v.privateKey).address.toLowerCase() !== v.address.toLowerCase()) throw Error("Invalid voter key.");
      const payload = v.payloads[currency];
      const decoded = i < 2 ? [...hexToBytes(payload)] : currency === "EURC"
        ? decrypt(deriveSk(master(), hexToBytes(round.keySalt)), BigInt(v.address), [...decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], payload)] as [bigint, bigint, bigint], 15)
        : decryptCre(deriveCreKey(master(), round.keySalt), v.address, payload, 6);
      if (!validate(v.ranks[currency], currency === "EURC" ? 15 : 6) || JSON.stringify(decoded) !== JSON.stringify(v.ranks[currency])) throw Error("Ballot backup failed encryption verification.");
    }
  }
}
async function deploy(state: any) {
  const op = operator(state, state.rpc, statePath);
  await op.guard();
  for (const name of sharedNames) {
    const address = state.sharedContracts[name];
    if (!address || !await op.pub.getCode({ address }) || await op.pub.getCode({ address }) === "0x") throw Error(`Missing shared helper: ${name}`);
  }
  if (BigInt(state.deadline) < (await op.pub.getBlock()).timestamp + 600n) throw Error("Deployment deadline is too close.");
  const n = state.rounds.EURC, c = state.rounds.USDC, helpers = state.sharedContracts;
  n.pool = await op.deploy("eurcPool", "NoirRankedShares", [EURC, state.organizer, BigInt(state.deadline), {
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000",
    coordinator: state.deployer, poseidon: helpers.poseidon, ingestVerifier: helpers.ingestVerifier, tallyVerifier: helpers.tallyVerifier,
    tallierPkX: BigInt(n.tallierPkX), tallierPkY: BigInt(n.tallierPkY), keySalt: n.keySalt,
    nSealedMax: 256n, mMax: 16n, batch: 32n, minDirectVote: unit, minSealedVote: unit, proofGrace: 3600n, abandonGrace: 86400n,
  }]); op.remember(); exportReceipts(state);
  c.pool = await op.deploy("usdcPool", "LPCreRankedShares", [{ token: USDC, owner: state.organizer, deadline: BigInt(state.deadline),
    tallierPk: c.tallierPk, keySalt: c.keySalt, minDirectVote: unit, abandonGrace: 86400n,
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000" }]); op.remember();
  c.lpModule = await op.deploy("lpModule", "LPVoting", [c.pool, helpers.positionManager, helpers.stateView, MOCK_FORWARDER, zeroAddress, "0x00000000000000000000"]);
  await op.write("attachLP", c.pool, artifact("LPCreRankedShares").abi, "setLPVoting", [c.lpModule]);
  for (const round of [n, c]) {
    const version = await op.pub.readContract({ address: round.pool, abi: ballotAbi, functionName: "ballotFlowVersion" });
    if (version !== 2n) throw Error("Unexpected deployed voting API.");
    round.privacy = await op.pub.readContract({ address: round.pool, abi: parseAbi(["function proposalPrivacy() view returns (address)"]), functionName: "proposalPrivacy" });
  }
  op.remember(); exportReceipts(state);
  console.log(`Version 2 pools deployed: EURC ${n.pool}; USDC ${c.pool}`);
}
async function importAndOpen(state: any, currency: Currency) {
  const op = operator(state, state.rpc, statePath), round = state.rounds[currency];
  const abi = artifact(currency === "EURC" ? "NoirRankedShares" : "LPCreRankedShares").abi;
  const uploads = JSON.parse(readFileSync(resolve(root, currency === "EURC" ? "demo/urbehub-public-uploads.json" : "demo/golem-public-uploads.json"), "utf8"));
  const original = JSON.parse(readFileSync(resolve(root, "swarm/pool-import-plan.json"), "utf8")).rounds.find((r: any) => r.currency === currency);
  if (uploads.encryption !== false || uploads.proposals.length !== original.proposals.length) throw Error("Invalid public proposal receipts.");
  for (const row of original.proposals) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    if (!doc || doc.sha256 !== row.sha256 || sha(readFileSync(resolve(root, row.source))) !== row.sha256 || doc.title !== row.title || doc.body !== row.body || doc.amountBaseUnits !== row.amountBaseUnits) throw Error("Proposal source or terms changed.");
    const expected = JSON.stringify({ version: 1, title: row.title, body: row.body, attachments: [] });
    const response = await fetch(`https://api.gateway.ethswarm.org/bytes/${doc.contentRef.slice(2)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || await response.text() !== expected) throw Error(`Swarm verification failed: ${row.title}`);
  }
  for (const [i, row] of original.proposals.entries()) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    const tx = await op.write(`${currency}:propose:${i}`, round.pool, abi, "propose", [doc.contentRef, zeroHash, BigInt(row.amountBaseUnits), state.recipient]);
    const event = parseEventLogs({ abi, eventName: "Proposed", logs: tx.logs }).find((e: any) => e.address.toLowerCase() === round.pool.toLowerCase()) as any;
    if (!event || event.args.proposalId !== BigInt(i)) throw Error("Unexpected proposal ID.");
    const accepted = await op.write(`${currency}:accept:${i}`, round.pool, abi, "acceptProposal", [BigInt(i), 1n]);
    state.proposals[currency][i] = { source: row.source, title: row.title, amountBaseUnits: row.amountBaseUnits, contentRef: doc.contentRef, proposer: state.organizer, recipient: state.recipient, proposalId: i, projectId: i, transactionHash: tx.transactionHash, acceptanceTransactionHash: accepted.transactionHash };
    op.remember(); exportReceipts(state);
    console.log(`${currency} accepted ${i + 1}/${original.proposals.length}: ${row.title}`);
  }
  await op.write(`${currency}:enableArkiv`, round.pool, abi, "enableArkivBallots");
  await op.write(`${currency}:open`, round.pool, abi, "openVoting");
  exportReceipts(state);
}
export async function vote(state: any, list: DemoVoter[], currency: Currency, persistPath = statePath, publish = exportReceipts) {
  const op = operator(state, state.rpc, persistPath), round = state.rounds[currency];
  const abi = artifact(currency === "EURC" ? "NoirRankedShares" : "LPCreRankedShares").abi;
  if (!state.transactions[`${currency}:sponsor`]) {
    const balance = await op.pub.readContract({ address: round.token, abi: erc20Abi, functionName: "balanceOf", args: [op.account.address] });
    if (balance < 20n * unit) throw Error(`Organizer needs 20 test ${currency} before voting.`);
  }
  await op.write(`${currency}:approveSponsor`, round.token, erc20Abi, "approve", [round.pool, 18n * unit]);
  await op.write(`${currency}:sponsor`, round.pool, abi, "sponsor", [18n * unit, list.slice(2).map(v => v.address)]);
  for (const [i, v] of list.entries()) {
    const account = privateKeyToAccount(v.privateKey);
    if (i < 2) await op.write(`${currency}:fundPublic:${i}`, round.token, erc20Abi, "transfer", [v.address, unit]);
    const gasLabel = `gas:${i}`;
    if (state.transactions[gasLabel] || await op.pub.getBalance({ address: v.address }) < parseEther("0.01")) await op.send(gasLabel, "0x", v.address, parseEther("0.05"));
    const label = `${currency}:cast:${i}`, sealed = i >= 2;
    const payload = v.payloads[currency], id = ballotId(BigInt(ARC), round.pool, v.address, sealed, 1n, payload);
    let tx = state.transactions[label];
    if (!tx) {
      const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(state.rpc) });
      let permit: { deadline: bigint; v: number; r: Hex; s: Hex } = { deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
      if (!sealed) {
        const permitAbi = parseAbi(["function name() view returns (string)", "function DOMAIN_SEPARATOR() view returns (bytes32)", "function nonces(address) view returns (uint256)"]);
        const [name, separator, nonce] = await Promise.all([
          op.pub.readContract({ address: round.token, abi: permitAbi, functionName: "name" }),
          op.pub.readContract({ address: round.token, abi: permitAbi, functionName: "DOMAIN_SEPARATOR" }),
          op.pub.readContract({ address: round.token, abi: permitAbi, functionName: "nonces", args: [v.address] }),
        ]);
        const types = { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } as const;
        const domain = ["1", "2"].map(version => ({ name, version, chainId: BigInt(ARC), verifyingContract: round.token as Address })).find(domain => hashDomain({ domain, types }) === separator);
        if (!domain) throw Error(`${currency} permit domain is unsupported; no vote has been sent.`);
        const deadline = BigInt(state.deadline);
        const signature = await wallet.signTypedData({ account, domain, types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { owner: v.address, spender: round.pool, value: unit, nonce, deadline } });
        const parsed = parseSignature(signature);
        permit = { deadline, r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt(parsed.yParity! + 27)) };
      }
      const args = [sealed ? 0n : unit, sealed, payload, 0n, permit] as const;
      await op.pub.simulateContract({ address: round.pool, abi: ballotAbi, functionName: "castBallot", args, account });
      const request = await wallet.prepareTransactionRequest({ account, chain: arcTestnet, to: round.pool, data: encodeFunctionData({ abi: ballotAbi, functionName: "castBallot", args }) });
      if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) > parseEther("0.05")) throw Error("Vote fee exceeds the demo limit.");
      const raw = await wallet.signTransaction(request);
      tx = state.transactions[label] = { hash: keccak256(raw), raw, id, voter: v.address };
      op.remember(); // Never broadcast before journaling.
    }
    if (tx.id !== id || tx.voter !== v.address) throw Error("Saved vote intent changed.");
    let receipt = await op.pub.getTransactionReceipt({ hash: tx.hash }).catch(() => undefined);
    if (!receipt) {
      await op.pub.sendRawTransaction({ serializedTransaction: tx.raw }).catch(() => undefined);
      receipt = await op.pub.waitForTransactionReceipt({ hash: tx.hash, timeout: 60000 });
    }
    if (receipt.status !== "success") throw Error(`Vote reverted: ${label}`);
    tx.blockNumber = String(receipt.blockNumber); op.remember();
    const ref = await op.pub.readContract({ address: round.pool, abi: ballotAbi, functionName: "ballotRefOf", args: [v.address, sealed] });
    if (ref.entityKey !== id || ref.payloadHash !== keccak256(payload) || ref.revision !== 1n) throw Error("Vote verification failed.");
    state.ballots[currency][i] = { number: i + 1, address: v.address, mode: sealed ? "encrypted" : "public", contributionBaseUnits: sealed ? "0" : String(unit), weightBaseUnits: String(unit), ballotId: id, transactionHash: tx.hash, blockNumber: tx.blockNumber, ...(sealed ? {} : { ranks: v.ranks[currency] }) };
    op.remember(); publish(state);
    console.log(`${currency} vote ${i + 1}/20 (${sealed ? "encrypted" : "public"}): ${tx.hash}`);
  }
}
async function sync(state: any) {
  const op = operator(state, state.rpc, statePath);
  const journal: StorageJournal = existsSync(storagePath) ? JSON.parse(readFileSync(storagePath, "utf8")) : {};
  const worker = ballotStorageWorker({ poolClient: op.pub, account: op.account, arkivRpc: ARKIV_RPC, journal, save: () => save(storagePath, journal), log: console.log });
  for (const currency of ["EURC", "USDC"] as const) {
    await worker.syncPool(state.rounds[currency].pool);
    for (const ballot of state.ballots[currency]) {
      const stored = journal[ballot.ballotId];
      if (!stored?.verified) throw Error("Ballot has not been stored.");
      Object.assign(ballot, { arkivEntityKey: stored.entityKey, arkivTransactionHash: stored.hash, expiresAtBlock: stored.expiresAt });
    }
  }
  op.remember(); exportReceipts(state);
}
async function verify(state: any, list: DemoVoter[]) {
  const op = operator(state, state.rpc, statePath);
  for (const currency of ["EURC", "USDC"] as const) {
    const round = state.rounds[currency], abi = artifact(currency === "EURC" ? "NoirRankedShares" : "LPCreRankedShares").abi;
    const read = (functionName: string, args: any[] = []) => op.pub.readContract({ address: round.pool, abi, functionName, args });
    const [count, budget, projects, open] = await Promise.all([read("voterCount"), read("totalWeight"), read("projectCount"), read("votingOpen")]);
    if (count !== 20n || budget !== 20n * unit || projects !== (currency === "EURC" ? 15n : 6n) || !open) throw Error(`Unexpected ${currency} roster or budget.`);
    // Both variants expose the accepted reference roster; only Noir exposes a
    // separate sealedCount getter. Count actual accepted references for either.
    const roster = rosterPage(await op.pub.readContract({ address: round.pool, abi: ballotAbi, functionName: "voterRefsFrom", args: [0n, 20n] }), 20);
    if (roster.filter(v => v.sealedRef.revision > 0n).length !== 18 || roster.filter(v => v.publicRef.revision > 0n).length !== 2) throw Error(`Unexpected ${currency} public/encrypted split.`);
    const ids = state.ballots[currency].map((b: any) => b.ballotId);
    const response = await fetch(ARKIV_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payloadQuery(ids)), signal: AbortSignal.timeout(30000) });
    const payloads = payloadReply(await response.json());
    for (const [i, v] of list.entries()) {
      const sealed = i >= 2, ref = await op.pub.readContract({ address: round.pool, abi: ballotAbi, functionName: "ballotRefOf", args: [v.address, sealed] });
      const payload = payloads.get(ref.entityKey);
      if (payload !== v.payloads[currency] || await recoverPayload(op.pub, round.pool, v.address, sealed, ref) !== payload) throw Error("Stored/event payload verification failed.");
      const decoded = !sealed ? [...hexToBytes(payload)] : currency === "EURC"
        ? decrypt(deriveSk(master(), hexToBytes(round.keySalt)), BigInt(v.address), [...decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], payload)] as [bigint, bigint, bigint], 15)
        : decryptCre(deriveCreKey(master(), round.keySalt), v.address, payload, 6);
      if (JSON.stringify(decoded) !== JSON.stringify(v.ranks[currency])) throw Error("Ranking verification failed.");
    }
    Object.assign(round, { projectCount: Number(projects), voterCount: 20, publicCount: 2, sealedCount: 18, budgetBaseUnits: String(budget), votingOpen: true });
    console.log(`${currency}: 20 votes verified, 2 public, 18 encrypted, all indexed in Arkiv.`);
  }
  state.verifiedAt = new Date().toISOString(); op.remember(); exportReceipts(state);
}
async function main() {
  const command = process.argv[2];
  if (!["prepare", "deploy", "broadcast", "sync", "verify"].includes(command)) throw Error("Usage: bun scripts/redeploy-vote-demo.ts prepare|deploy|broadcast|sync|verify");
  const state = prepareNewDemo(), list = voters(state);
  verifyVoterBackup(state, list);
  if (command === "prepare") { console.log(`Prepared 20 wallets for both pools. Deadline ${new Date(Number(state.deadline) * 1000).toISOString()}.`); return; }
  if (command === "deploy" || command === "broadcast") await deploy(state);
  if (command === "broadcast") {
    if (process.argv.includes("--public-golem")) { state.publicGolemApproved = true; save(statePath, state); }
    if (!state.publicGolemApproved) throw Error("Record the user's Golem public-import approval before broadcasting proposals.");
    for (const currency of ["EURC", "USDC"] as const) { await importAndOpen(state, currency); await vote(state, list, currency); }
  }
  if (command === "broadcast" || command === "sync") await sync(state);
  if (["broadcast", "sync", "verify"].includes(command)) await verify(state, list);
}
if (import.meta.main) main().catch(error => {
  console.error(`Demo stopped: ${String(error.shortMessage ?? error.message).replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 250)}`);
  process.exitCode = 1;
});
