// A short, explicitly simulated EURC round. Existing pools and journals stay intact.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Hex, decodeAbiParameters, encodeAbiParameters, erc20Abi, hexToBytes, parseEventLogs, toHex, zeroAddress, zeroHash } from "viem";
import { ARC, EURC, MOCK_FORWARDER, artifact, local, master, operator, root, save, simulate, unlock } from "./demo";
import { decodeVault, encodeVault, vote, type DemoVoter } from "./redeploy-vote-demo";
import { Q } from "../src/lib/field";
import { pubkey } from "../src/lib/grumpkin";
import { decrypt, deriveSk, encrypt, validate } from "../src/lib/sealed";
import { pbearTranscript } from "../src/lib/pbear";
import { ARKIV_RPC, ballotAbi, payloadQuery, payloadReply, rosterPage } from "../src/lib/arkiv";
import { recoverPayload } from "../../prover/src/core/arkiv";
import { ballotStorageWorker, type StorageJournal } from "./lib/ballot-storage";

export const shortStatePath = resolve(local, "short-round-state.json");
const vaultPath = resolve(local, "short-round-voters.encrypted.json");
const storagePath = resolve(local, "short-round-arkiv.json");
const receiptPath = resolve(root, "demo/short-round-deployment.json");
const unit = 1_000_000n;
const abi = artifact("NoirRankedShares").abi;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function scalar() {
  for (;;) { const x = BigInt(toHex(randomBytes(32))); if (x > 0n && x < Q) return x; }
}
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function randomRanking() {
  // Broad agreement on affordable shared equipment and facilities, with varied
  // ordering and ties inside each priority group. Competition ranks stay valid.
  const priorities = [shuffle([9, 3, 0, 7, 10, 11]), shuffle([5, 2, 6, 14]), shuffle([1, 4, 8, 12, 13])];
  const ranks = new Array<number>(15).fill(0);
  let seen = 0;
  for (const group of priorities) {
    for (let cursor = 0; cursor < group.length;) {
      const size = Math.min(randomInt(1, 4), group.length - cursor);
      for (const id of group.slice(cursor, cursor + size)) ranks[id] = seen + 1;
      cursor += size; seen += size;
    }
  }
  return ranks;
}

export function publishShort(state: any) {
  save(receiptPath, {
    version: 1, demo: true, simulationOnly: true, chainId: ARC,
    description: "20 controlled demo voters: 2 public contribution votes and 18 encrypted sponsored-seat votes. Original Urbe Hub texts; on-chain requests divided by 1000 for a 20 test EURC budget.",
    organizer: state.organizer, recipient: state.recipient, createdAt: state.createdAt,
    pool: state.rounds.EURC.pool, round: state.rounds.EURC,
    deadline: state.deadline, deadlineUtc: state.deadline ? new Date(Number(state.deadline) * 1000).toISOString() : undefined,
    openedAt: state.openedAt, closedAt: state.closedAt, verifiedAt: state.verifiedAt,
    requestsScaleDivisor: 1000, budgetBaseUnits: "20000000",
    proposals: state.proposals.EURC, ballots: state.ballots.EURC,
    finality: state.finality, fundedProjects: state.fundedProjects, spentBaseUnits: state.spentBaseUnits,
    provisionalFundedProjects: state.provisionalFunded, reportTransactionHash: state.reportTransactionHash,
    auditedAt: state.auditedAt, proofTransactions: state.proofTransactions,
    transactions: Object.fromEntries(Object.entries(state.transactions).map(([label, tx]: any) => [label, { hash: tx.hash, blockNumber: tx.blockNumber, contractAddress: tx.contractAddress }])),
  });
}
export function loadShort() { return readJson(shortStatePath); }
function voters(state: any): DemoVoter[] { return decodeVault(vaultPath, `${ARC}:${state.createdAt}:short-round`); }

function prepare() {
  if (existsSync(shortStatePath)) return loadShort();
  const previous = readJson(resolve(local, "new-flow-state.json"));
  const account = unlock();
  if (account.address.toLowerCase() !== previous.deployer.toLowerCase()) throw Error("Unexpected organizer.");
  const originals = readJson(resolve(root, "swarm/pool-import-plan.json")).rounds.find((r: any) => r.currency === "EURC").proposals;
  const costs = originals.map((p: any) => BigInt(p.amountBaseUnits) / 1000n) as bigint[];
  if (costs.length !== 15 || costs.reduce((a, b) => a + b, 0n) !== 32_250_000n) throw Error("Unexpected source budgets.");
  const keySalt = toHex(randomBytes(32));
  const key = pubkey(deriveSk(master(), hexToBytes(keySalt)));
  const state: any = { version: 1, demo: true, chainId: ARC, createdAt: new Date().toISOString(), deployer: account.address, organizer: account.address,
    recipient: previous.recipient, rpc: previous.rpc, sharedContracts: previous.sharedContracts,
    rounds: { EURC: { token: EURC, kind: "noir", keySalt, tallierPkX: String(key.x), tallierPkY: String(key.y) }, USDC: previous.rounds.USDC },
    contracts: {}, transactions: {}, proposals: { EURC: [] }, ballots: { EURC: [] }, costs: costs.map(String),
  };
  const oldVoters: DemoVoter[] = decodeVault(resolve(local, "new-flow-voters.encrypted.json"), `${ARC}:${previous.createdAt}:v2-voters`);
  const seen = new Set<string>();
  const list = oldVoters.map((v, i) => {
    let ranks: number[];
    do { ranks = randomRanking(); } while (seen.has(JSON.stringify(ranks)));
    seen.add(JSON.stringify(ranks));
    const payload = i < 2 ? toHex(Uint8Array.from(ranks)) : encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], encrypt(key, BigInt(v.address), ranks, scalar()));
    return { ...v, ranks: { ...v.ranks, EURC: ranks }, payloads: { ...v.payloads, EURC: payload } };
  });
  const entries = list.map(v => ({ weight: unit, ballot: v.ranks.EURC }));
  const result = pbearTranscript(costs, entries.slice(0, 2), entries.slice(2), 20n * unit);
  if (result.funded.length < 8) throw Error("The generated demo does not fund enough proposals.");
  state.expectedFunded = result.funded;
  state.expectedSpent = String(result.funded.reduce((total, id) => total + costs[id], 0n));
  encodeVault(vaultPath, `${ARC}:${state.createdAt}:short-round`, list);
  save(shortStatePath, state); publishShort(state);
  console.log(`Prepared 20 distinct rankings; expected ${result.funded.length} funded proposals, ${Number(state.expectedSpent) / 1e6} EURC allocated.`);
  return state;
}
function verifyBackup(state: any, list: DemoVoter[]) {
  if (list.length !== 20 || new Set(list.map(v => v.address.toLowerCase())).size !== 20 || new Set(list.map(v => JSON.stringify(v.ranks.EURC))).size !== 20) throw Error("Expected 20 distinct demo voters and rankings.");
  const sk = deriveSk(master(), hexToBytes(state.rounds.EURC.keySalt));
  for (const [i, voter] of list.entries()) {
    const decoded = i < 2 ? [...hexToBytes(voter.payloads.EURC)] : decrypt(sk, BigInt(voter.address), [...decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], voter.payloads.EURC)] as [bigint, bigint, bigint], 15);
    if (!validate(voter.ranks.EURC, 15) || JSON.stringify(decoded) !== JSON.stringify(voter.ranks.EURC)) throw Error("Ballot encryption check failed.");
  }
}
async function deployAndVote(state: any, list: DemoVoter[]) {
  const op = operator(state, state.rpc, shortStatePath), round = state.rounds.EURC;
  await op.guard();
  const originals = readJson(resolve(root, "swarm/pool-import-plan.json")).rounds.find((r: any) => r.currency === "EURC").proposals;
  const uploads = readJson(resolve(root, "demo/urbehub-public-uploads.json"));
  // Download checks happen before starting the short immutable deadline.
  for (const row of originals) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    if (!doc || doc.sha256 !== row.sha256 || digest(readFileSync(resolve(root, row.source))) !== row.sha256) throw Error("Proposal source changed.");
    const response = await fetch(`https://api.gateway.ethswarm.org/bytes/${doc.contentRef.slice(2)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || await response.text() !== JSON.stringify({ version: 1, title: row.title, body: row.body, attachments: [] })) throw Error("Public proposal verification failed.");
  }
  if (!state.transactions["EURC:sponsor"] && await op.pub.readContract({ address: EURC, abi: erc20Abi, functionName: "balanceOf", args: [op.account.address] }) < 20n * unit) throw Error("Organizer needs 20 test EURC.");
  if (!state.deadline) { state.deadline = String((await op.pub.getBlock()).timestamp + 600n); op.remember(); }
  const helpers = state.sharedContracts;
  round.pool = await op.deploy("eurcPool", "NoirRankedShares", [EURC, state.organizer, BigInt(state.deadline), {
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000", coordinator: state.deployer,
    poseidon: helpers.poseidon, ingestVerifier: helpers.ingestVerifier, tallyVerifier: helpers.tallyVerifier,
    tallierPkX: BigInt(round.tallierPkX), tallierPkY: BigInt(round.tallierPkY), keySalt: round.keySalt,
    nSealedMax: 256n, mMax: 16n, batch: 32n, minDirectVote: unit, minSealedVote: unit, proofGrace: 3600n, abandonGrace: 86400n,
  }]); op.remember(); publishShort(state);
  console.log(`Short EURC pool ${round.pool}; deadline ${new Date(Number(state.deadline) * 1000).toISOString()}`);
  for (const [i, row] of originals.entries()) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    const receipt = await op.write(`propose:${i}`, round.pool, abi, "propose", [doc.contentRef, zeroHash, BigInt(state.costs[i]), state.recipient]);
    const event = parseEventLogs({ abi, eventName: "Proposed", logs: receipt.logs }).find((e: any) => e.address.toLowerCase() === round.pool.toLowerCase()) as any;
    if (!event || event.args.proposalId !== BigInt(i)) throw Error("Unexpected proposal ID.");
    const accepted = await op.write(`accept:${i}`, round.pool, abi, "acceptProposal", [BigInt(i), 1n]);
    state.proposals.EURC[i] = { proposalId: i, projectId: i, title: row.title, source: row.source, sourceSha256: row.sha256, contentRef: doc.contentRef,
      originalAmountBaseUnits: row.amountBaseUnits, amountBaseUnits: state.costs[i], recipient: state.recipient, transactionHash: receipt.transactionHash, acceptanceTransactionHash: accepted.transactionHash };
    op.remember(); publishShort(state);
  }
  await op.write("enableArkiv", round.pool, abi, "enableArkivBallots");
  const opened = await op.write("openVoting", round.pool, abi, "openVoting");
  state.openedAt = Number((await op.pub.getBlock({ blockNumber: opened.blockNumber })).timestamp);
  op.remember(); publishShort(state);
  console.log(`Voting open for ${Number(state.deadline) - state.openedAt} seconds.`);
  await vote(state, list, "EURC", shortStatePath, publishShort);
}
async function sync(state: any) {
  if (existsSync(`${resolve(local, "new-flow-arkiv.json")}.lock`)) throw Error("Pause the other organizer-funded storage worker before syncing this round.");
  const op = operator(state, state.rpc, shortStatePath);
  const journal: StorageJournal = existsSync(storagePath) ? readJson(storagePath) : {};
  const worker = ballotStorageWorker({ poolClient: op.pub, account: op.account, arkivRpc: ARKIV_RPC, journal, save: () => save(storagePath, journal), log: console.log });
  await worker.syncPool(state.rounds.EURC.pool);
  for (const ballot of state.ballots.EURC) {
    const stored = journal[ballot.ballotId];
    if (!stored?.verified) throw Error("Ballot not stored yet.");
    Object.assign(ballot, { arkivEntityKey: stored.entityKey, arkivTransactionHash: stored.hash, expiresAtBlock: stored.expiresAt });
  }
  op.remember(); publishShort(state);
}
async function verify(state: any, list: DemoVoter[]) {
  const op = operator(state, state.rpc, shortStatePath), pool = state.rounds.EURC.pool;
  const [count, sealed, budget] = await Promise.all(["voterCount", "sealedCount", "totalWeight"].map(functionName => op.pub.readContract({ address: pool, abi, functionName })));
  if (count !== 20n || sealed !== 18n || budget !== 20n * unit) throw Error("Unexpected roster or budget.");
  const response = await fetch(ARKIV_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payloadQuery(state.ballots.EURC.map((b: any) => b.ballotId))), signal: AbortSignal.timeout(30000) });
  const payloads = payloadReply(await response.json());
  for (const [i, voter] of list.entries()) {
    const ref = await op.pub.readContract({ address: pool, abi: ballotAbi, functionName: "ballotRefOf", args: [voter.address, i >= 2] });
    if (payloads.get(ref.entityKey) !== voter.payloads.EURC || await recoverPayload(op.pub, pool, voter.address, i >= 2, ref) !== voter.payloads.EURC) throw Error("Stored ballot does not match accepted vote.");
  }
  state.verifiedAt = new Date().toISOString(); op.remember(); publishShort(state);
  console.log("Verified 20 votes: 2 public, 18 encrypted, all stored in Arkiv.");
}
async function close(state: any) {
  const op = operator(state, state.rpc, shortStatePath), pool = state.rounds.EURC.pool;
  if (await op.pub.readContract({ address: pool, abi, functionName: "closed" })) return;
  const now = (await op.pub.getBlock()).timestamp;
  if (now < BigInt(state.deadline)) throw Error(`Voting is still open for ${BigInt(state.deadline) - now} seconds.`);
  const count = await op.pub.readContract({ address: pool, abi: ballotAbi, functionName: "voterCount" });
  if (count > 100n) throw Error("Unexpected demo roster size.");
  const cursor = await op.pub.readContract({ address: pool, abi, functionName: "closeCursor" }) as bigint;
  const roster = rosterPage(await op.pub.readContract({ address: pool, abi: ballotAbi, functionName: "voterRefsFrom", args: [cursor, 20n] }), Number(count - cursor > 20n ? 20n : count - cursor));
  const ballots = [];
  for (const row of roster) ballots.push({ publicBallot: row.publicRef.revision ? await recoverPayload(op.pub, pool, row.address, false, row.publicRef) : "0x", sealedBallot: row.sealedRef.revision ? await recoverPayload(op.pub, pool, row.address, true, row.sealedRef) : "0x" });
  const receipt = await op.write(`close:${cursor}`, pool, ballotAbi, "closeArkiv", [cursor, ballots]);
  if (!await op.pub.readContract({ address: pool, abi, functionName: "closed" })) return close(state);
  state.closedAt = Number((await op.pub.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  op.remember(); publishShort(state);
  console.log(`Voting closed: ${receipt.transactionHash}`);
}
async function report(state: any) {
  const op = operator(state, state.rpc, shortStatePath), pool = state.rounds.EURC.pool;
  if (!await op.pub.readContract({ address: pool, abi, functionName: "resultReported" })) await simulate(state, state.rpc, "EURC", true, resolve(local, "short-round-cre"));
  if (!await op.pub.readContract({ address: pool, abi, functionName: "resultReported" })) throw Error("CRE result not reported yet.");
  const funded = await op.pub.readContract({ address: pool, abi, functionName: "provisionalResult" }) as bigint[];
  const reports = await op.pub.getContractEvents({ address: pool, abi, eventName: "ProvisionalResult", fromBlock: BigInt(state.transactions.eurcPool.blockNumber), toBlock: "latest" });
  state.reportTransactionHash = reports.at(-1)?.transactionHash;
  state.provisionalFunded = funded.map(Number); op.remember(); publishShort(state);
  console.log(`CRE reported ${funded.length} funded proposals.`);
}
async function main() {
  const command = process.argv[2];
  if (!["prepare", "deploy-vote", "sync", "verify", "close", "report", "status"].includes(command)) throw Error("Use prepare|deploy-vote|sync|verify|close|report|status.");
  const state = prepare(), list = voters(state); verifyBackup(state, list);
  if (command === "deploy-vote") await deployAndVote(state, list);
  if (command === "sync") { await sync(state); await verify(state, list); }
  if (command === "verify") await verify(state, list);
  if (command === "close") await close(state);
  if (command === "report") await report(state);
  if (command === "status") console.log(JSON.stringify({ pool: state.rounds.EURC.pool, deadline: state.deadline, votes: state.ballots.EURC.length, closedAt: state.closedAt, finality: state.finality }));
}
if (import.meta.main) main().catch(error => { console.error(`Short demo stopped: ${String(error.shortMessage ?? error.message).replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 250)}`); process.exitCode = 1; });
