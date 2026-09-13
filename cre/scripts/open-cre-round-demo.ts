// A CRE Liquidity (USDC) round with the 15 Urbe Hub proposals and 20 controlled
// demo voters. Mirrors short-round-demo.ts for the LPCreRankedShares variant.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { erc20Abi, hexToBytes, parseAbi, parseEventLogs, toHex, zeroAddress, zeroHash } from "viem";
import { ARC, USDC, MOCK_FORWARDER, artifact, local, master, operator, root, save, simulate, unlock } from "./demo";
import { decodeVault, encodeVault, encryptCre, vote, type DemoVoter } from "./redeploy-vote-demo";
import { randomRanking } from "./short-round-demo";
import { decryptCre, deriveCreKey } from "../src/lib/lp";
import { validate } from "../src/lib/sealed";
import { pbearTranscript } from "../src/lib/pbear";
import { ARKIV_RPC, ballotAbi, payloadQuery, payloadReply, rosterPage } from "../src/lib/arkiv";
import { recoverPayload } from "../../prover/src/core/arkiv";
import { ballotStorageWorker, type StorageJournal } from "./lib/ballot-storage";

// `--run NAME` selects an independent run; `--open-seconds N` or `--deadline UNIX`
// fixes the voting window when `prepare` first creates that run.
const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
export const runName = flag("--run") ?? "open-cre-round";
if (!/^[a-z0-9-]{1,40}$/.test(runName)) throw Error("Run names use lowercase letters, digits and dashes.");
export const statePath = resolve(local, `${runName}-state.json`);
const vaultPath = resolve(local, `${runName}-voters.encrypted.json`);
const storagePath = resolve(local, `${runName}-arkiv.json`);
const receiptPath = resolve(root, `demo/${runName}-deployment.json`);
const unit = 1_000_000n;
const abi = artifact("LPCreRankedShares").abi;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function publish(state: any) {
  save(receiptPath, {
    version: 1, demo: true, simulationOnly: true, chainId: ARC, run: runName,
    description: `20 controlled demo voters in a CRE Liquidity pool: 2 public contribution votes and 18 encrypted sponsored-seat votes. Original Urbe Hub texts; on-chain requests divided by 1000 for a 20 test USDC budget. No LP positions are represented. Voting window ${state.openSeconds} seconds.`,
    organizer: state.organizer, recipient: state.recipient, createdAt: state.createdAt,
    pool: state.rounds.USDC.pool, round: state.rounds.USDC, contracts: state.contracts,
    deadline: state.deadline, deadlineUtc: state.deadline ? new Date(Number(state.deadline) * 1000).toISOString() : undefined,
    openedAt: state.openedAt, closedAt: state.closedAt, verifiedAt: state.verifiedAt,
    requestsScaleDivisor: 1000, budgetBaseUnits: "20000000",
    proposals: state.proposals.USDC, ballots: state.ballots.USDC,
    provisionalFundedProjects: state.provisionalFunded, reportTransactionHash: state.reportTransactionHash,
    transactions: Object.fromEntries(Object.entries(state.transactions).map(([label, tx]: any) => [label, { hash: tx.hash, blockNumber: tx.blockNumber, contractAddress: tx.contractAddress }])),
  });
}
export function load() { return readJson(statePath); }
function voters(state: any): DemoVoter[] { return decodeVault(vaultPath, `${ARC}:${state.createdAt}:${runName}`); }

function prepare() {
  if (existsSync(statePath)) return load();
  const previous = readJson(resolve(local, "new-flow-state.json"));
  const account = unlock();
  if (account.address.toLowerCase() !== previous.deployer.toLowerCase()) throw Error("Unexpected organizer.");
  const originals = readJson(resolve(root, "swarm/pool-import-plan.json")).rounds.find((r: any) => r.currency === "EURC").proposals;
  const costs = originals.map((p: any) => BigInt(p.amountBaseUnits) / 1000n) as bigint[];
  if (costs.length !== 15 || costs.reduce((a, b) => a + b, 0n) !== 32_250_000n) throw Error("Unexpected source budgets.");
  const now = Math.floor(Date.now() / 1000);
  const deadline = flag("--deadline") ? Number(flag("--deadline")) : undefined;
  const openSeconds = deadline ? deadline - now : Number(flag("--open-seconds") ?? 21600);
  if (!Number.isInteger(openSeconds) || openSeconds < 600 || openSeconds > 7 * 86400) throw Error("The voting window must be between 600 and 604800 seconds.");
  const keySalt = toHex(randomBytes(32));
  const tallierPk = toHex(secp256k1.getPublicKey(deriveCreKey(master(), keySalt), true));
  const state: any = { version: 1, demo: true, chainId: ARC, run: runName, openSeconds, createdAt: new Date().toISOString(), deployer: account.address, organizer: account.address,
    recipient: previous.recipient, rpc: previous.rpc, sharedContracts: previous.sharedContracts,
    rounds: { USDC: { id: "urbehub", token: USDC, kind: "lp-cre", keySalt, tallierPk } },
    contracts: {}, transactions: {}, proposals: { USDC: [] }, ballots: { USDC: [] }, costs: costs.map(String),
    ...(deadline ? { deadline: String(deadline) } : {}),
  };
  const oldVoters: DemoVoter[] = decodeVault(resolve(local, "new-flow-voters.encrypted.json"), `${ARC}:${previous.createdAt}:v2-voters`);
  const seen = new Set<string>();
  const list = oldVoters.map((v, i) => {
    let ranks: number[];
    do { ranks = randomRanking(); } while (seen.has(JSON.stringify(ranks)));
    seen.add(JSON.stringify(ranks));
    const payload = i < 2 ? toHex(Uint8Array.from(ranks)) : encryptCre(tallierPk, v.address, ranks);
    return { ...v, ranks: { ...v.ranks, USDC: ranks }, payloads: { ...v.payloads, USDC: payload } };
  });
  const entries = list.map(v => ({ weight: unit, ballot: v.ranks.USDC }));
  const result = pbearTranscript(costs, entries.slice(0, 2), entries.slice(2), 20n * unit);
  if (result.funded.length < 8) throw Error("The generated demo does not fund enough proposals.");
  state.expectedFunded = result.funded;
  state.expectedSpent = String(result.funded.reduce((total, id) => total + costs[id], 0n));
  encodeVault(vaultPath, `${ARC}:${state.createdAt}:${runName}`, list);
  save(statePath, state); publish(state);
  console.log(`Prepared 20 distinct rankings; expected ${result.funded.length} funded proposals, ${Number(state.expectedSpent) / 1e6} USDC allocated.`);
  return state;
}
function verifyBackup(state: any, list: DemoVoter[]) {
  if (list.length !== 20 || new Set(list.map(v => v.address.toLowerCase())).size !== 20 || new Set(list.map(v => JSON.stringify(v.ranks.USDC))).size !== 20) throw Error("Expected 20 distinct demo voters and rankings.");
  const key = deriveCreKey(master(), state.rounds.USDC.keySalt);
  for (const [i, voter] of list.entries()) {
    const decoded = i < 2 ? [...hexToBytes(voter.payloads.USDC)] : decryptCre(key, voter.address, voter.payloads.USDC, 15);
    if (!validate(voter.ranks.USDC, 15) || JSON.stringify(decoded) !== JSON.stringify(voter.ranks.USDC)) throw Error("Ballot encryption check failed.");
  }
}
async function deployAndVote(state: any, list: DemoVoter[]) {
  const op = operator(state, state.rpc, statePath), round = state.rounds.USDC, helpers = state.sharedContracts;
  await op.guard();
  for (const name of ["positionManager", "stateView"]) {
    if (!helpers[name] || (await op.pub.getCode({ address: helpers[name] })) === "0x") throw Error(`Missing shared helper: ${name}`);
  }
  const originals = readJson(resolve(root, "swarm/pool-import-plan.json")).rounds.find((r: any) => r.currency === "EURC").proposals;
  const uploads = readJson(resolve(root, "demo/urbehub-public-uploads.json"));
  for (const row of originals) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    if (!doc || doc.sha256 !== row.sha256 || digest(readFileSync(resolve(root, row.source))) !== row.sha256) throw Error("Proposal source changed.");
    const response = await fetch(`https://api.gateway.ethswarm.org/bytes/${doc.contentRef.slice(2)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || await response.text() !== JSON.stringify({ version: 1, title: row.title, body: row.body, attachments: [] })) throw Error("Public proposal verification failed.");
  }
  // Sponsorship (18) plus two public contributions (2) plus gas for 20 voters and the operator.
  if (!state.transactions["USDC:sponsor"] && await op.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [op.account.address] }) < 22n * unit) throw Error("Organizer needs at least 22 test USDC.");
  const now = (await op.pub.getBlock()).timestamp;
  if (!state.deadline) { state.deadline = String(now + BigInt(state.openSeconds)); op.remember(); }
  if (!state.transactions.usdcPool && BigInt(state.deadline) < now + 600n) throw Error("The saved deadline is too close to deploy.");
  round.pool = await op.deploy("usdcPool", "LPCreRankedShares", [{ token: USDC, owner: state.organizer, deadline: BigInt(state.deadline),
    tallierPk: round.tallierPk, keySalt: round.keySalt, minDirectVote: unit, abandonGrace: 86400n,
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000" }]); op.remember(); publish(state);
  round.lpModule = await op.deploy("lpModule", "LPVoting", [round.pool, helpers.positionManager, helpers.stateView, MOCK_FORWARDER, zeroAddress, "0x00000000000000000000"]);
  await op.write("attachLP", round.pool, abi, "setLPVoting", [round.lpModule]);
  if (await op.pub.readContract({ address: round.pool, abi: ballotAbi, functionName: "ballotFlowVersion" }) !== 2n) throw Error("Unexpected deployed voting API.");
  round.privacy = await op.pub.readContract({ address: round.pool, abi: parseAbi(["function proposalPrivacy() view returns (address)"]), functionName: "proposalPrivacy" });
  op.remember(); publish(state);
  console.log(`CRE Liquidity USDC pool ${round.pool} (LP module ${round.lpModule}); deadline ${new Date(Number(state.deadline) * 1000).toISOString()}`);
  for (const [i, row] of originals.entries()) {
    const doc = uploads.proposals.find((p: any) => p.source === row.source);
    const receipt = await op.write(`propose:${i}`, round.pool, abi, "propose", [doc.contentRef, zeroHash, BigInt(state.costs[i]), state.recipient]);
    const event = parseEventLogs({ abi, eventName: "Proposed", logs: receipt.logs }).find((e: any) => e.address.toLowerCase() === round.pool.toLowerCase()) as any;
    if (!event || event.args.proposalId !== BigInt(i)) throw Error("Unexpected proposal ID.");
    const accepted = await op.write(`accept:${i}`, round.pool, abi, "acceptProposal", [BigInt(i), 1n]);
    state.proposals.USDC[i] = { proposalId: i, projectId: i, title: row.title, source: row.source, sourceSha256: row.sha256, contentRef: doc.contentRef,
      originalAmountBaseUnits: row.amountBaseUnits, amountBaseUnits: state.costs[i], recipient: state.recipient, transactionHash: receipt.transactionHash, acceptanceTransactionHash: accepted.transactionHash };
    op.remember(); publish(state);
    console.log(`Accepted ${i + 1}/15: ${row.title}`);
  }
  await op.write("enableArkiv", round.pool, abi, "enableArkivBallots");
  const opened = await op.write("openVoting", round.pool, abi, "openVoting");
  state.openedAt = Number((await op.pub.getBlock({ blockNumber: opened.blockNumber })).timestamp);
  op.remember(); publish(state);
  console.log(`Voting open for ${Number(state.deadline) - state.openedAt} seconds.`);
  await vote(state, list, "USDC", statePath, publish);
}
async function sync(state: any) {
  if (existsSync(`${resolve(local, "new-flow-arkiv.json")}.lock`)) throw Error("Pause the other organizer-funded storage worker before syncing this round.");
  const op = operator(state, state.rpc, statePath);
  const journal: StorageJournal = existsSync(storagePath) ? readJson(storagePath) : {};
  const worker = ballotStorageWorker({ poolClient: op.pub, account: op.account, arkivRpc: ARKIV_RPC, journal, save: () => save(storagePath, journal), log: console.log });
  await worker.syncPool(state.rounds.USDC.pool);
  for (const ballot of state.ballots.USDC) {
    const stored = journal[ballot.ballotId];
    if (!stored?.verified) throw Error("Ballot not stored yet.");
    Object.assign(ballot, { arkivEntityKey: stored.entityKey, arkivTransactionHash: stored.hash, expiresAtBlock: stored.expiresAt });
  }
  op.remember(); publish(state);
}
async function verify(state: any, list: DemoVoter[]) {
  const op = operator(state, state.rpc, statePath), pool = state.rounds.USDC.pool;
  const [count, budget, projects, open] = await Promise.all(["voterCount", "totalWeight", "projectCount", "votingOpen"].map(functionName => op.pub.readContract({ address: pool, abi, functionName })));
  if (count !== 20n || budget !== 20n * unit || projects !== 15n || !open) throw Error("Unexpected roster, budget or project count.");
  const roster = rosterPage(await op.pub.readContract({ address: pool, abi: ballotAbi, functionName: "voterRefsFrom", args: [0n, 20n] }), 20);
  if (roster.filter(v => v.sealedRef.revision > 0n).length !== 18 || roster.filter(v => v.publicRef.revision > 0n).length !== 2) throw Error("Unexpected public/encrypted split.");
  const response = await fetch(ARKIV_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payloadQuery(state.ballots.USDC.map((b: any) => b.ballotId))), signal: AbortSignal.timeout(30000) });
  const payloads = payloadReply(await response.json());
  for (const [i, voter] of list.entries()) {
    const ref = await op.pub.readContract({ address: pool, abi: ballotAbi, functionName: "ballotRefOf", args: [voter.address, i >= 2] });
    if (payloads.get(ref.entityKey) !== voter.payloads.USDC || await recoverPayload(op.pub, pool, voter.address, i >= 2, ref) !== voter.payloads.USDC) throw Error("Stored ballot does not match accepted vote.");
  }
  state.verifiedAt = new Date().toISOString(); op.remember(); publish(state);
  console.log("Verified 20 votes: 2 public, 18 encrypted, all stored in Arkiv.");
}
async function close(state: any) {
  const op = operator(state, state.rpc, statePath), pool = state.rounds.USDC.pool;
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
  op.remember(); publish(state);
  console.log(`Voting closed: ${receipt.transactionHash}`);
}
async function report(state: any) {
  const op = operator(state, state.rpc, statePath), pool = state.rounds.USDC.pool;
  const fundedProjects = () => op.pub.readContract({ address: pool, abi, functionName: "fundedProjects" }) as Promise<bigint[]>;
  if (!(await fundedProjects()).length) await simulate(state, state.rpc, "USDC", true, resolve(local, `${runName}-cre`));
  const funded = await fundedProjects();
  if (!funded.length) throw Error("CRE result not reported yet.");
  state.provisionalFunded = funded.map(Number); op.remember(); publish(state);
  console.log(`CRE reported ${funded.length} funded proposals.`);
}
async function main() {
  const command = process.argv[2];
  if (!["prepare", "deploy-vote", "sync", "verify", "close", "report", "status"].includes(command)) throw Error("Use prepare|deploy-vote|sync|verify|close|report|status [--run NAME] [--open-seconds N | --deadline UNIX].");
  const state = prepare(), list = voters(state); verifyBackup(state, list);
  if (command === "deploy-vote") await deployAndVote(state, list);
  if (command === "sync") { await sync(state); await verify(state, list); }
  if (command === "verify") await verify(state, list);
  if (command === "close") await close(state);
  if (command === "report") await report(state);
  if (command === "status") console.log(JSON.stringify({ pool: state.rounds.USDC.pool, deadline: state.deadline, votes: state.ballots.USDC.length, closedAt: state.closedAt }));
}
if (import.meta.main) main().catch(error => { console.error(`CRE demo stopped: ${String(error.shortMessage ?? error.message).replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 250)}`); process.exitCode = 1; });
