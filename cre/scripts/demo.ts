// ETHOnline testnet operator. Production deployment paths are intentionally separate.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, encodeDeployData,
  encodeFunctionData, erc20Abi, getAddress, hexToBytes, http, keccak256,
  parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { deriveCreKey } from "../src/lib/lp";
import { deriveSk } from "../src/lib/sealed";
import { pubkey } from "../src/lib/grumpkin";
const proposalAbi = parseAbi([
  "function proposalPrivacy() view returns (address)", "function votingOpen() view returns (bool)",
  "function propose(bytes32 contentRef,bytes32 keyHash,uint256 cost,address recipient) returns (uint256)",
  "event Proposed(uint256 indexed proposalId,address indexed proposer,bytes32 contentRef,uint256 cost,address recipient)",
]);
const privacyAbi = parseAbi(["function organizerPublicKey() view returns (bytes)", "function setOrganizerKey(bytes)"]);
function publicKey(key: string) {
  const value = key.replace(/^0x/, "").toLowerCase();
  if (!/^(02|03)[\da-f]{64}$/.test(value)) throw new Error("Invalid Swarm sharing public key.");
  secp256k1.Point.fromHex(value).assertValidity();
  return value;
}

export const root = resolve(import.meta.dir, "../..");
export const local = resolve(root, "demo/.local");
const statePath = resolve(local, "state.json");
export const ARC = 5042002;
export const MOCK_FORWARDER = "0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1" as Address;
export const USDC = "0x3600000000000000000000000000000000000000" as Address;
export const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const RECIPIENT = "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF" as Address;
const KEYSTORE = resolve(local, "keystores/ethonline-demo");
const PASSWORD = resolve(local, "keystore-password");
const MASTER = resolve(local, "master-secret");
export const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
export function save(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const next = path + ".tmp";
  writeFileSync(next, json(data), { mode: 0o600 });
  renameSync(next, path);
}
export function artifact(name: string, v4 = false) {
  return JSON.parse(readFileSync(resolve(root, v4 ? "v4/out" : "out", `${name}.sol/${name}.json`), "utf8"));
}
function unlockKey(): Hex {
  // Foundry's output is captured, never forwarded to logs or a shell command line.
  let output: string;
  try {
    output = execFileSync("cast", ["wallet", "decrypt-keystore", "ethonline-demo", "--keystore-dir", dirname(KEYSTORE), "--color", "never"], {
      env: { ...process.env, CAST_UNSAFE_PASSWORD: readFileSync(PASSWORD, "utf8").trim() },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw new Error("Could not unlock the encrypted demo keystore. No key material was logged."); }
  const key = output.match(/(?:0x)?[\da-fA-F]{64}/)?.[0];
  if (!key) throw new Error("Foundry did not return a valid demo key.");
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}
export function unlock() { return privateKeyToAccount(unlockKey()); }
export function master(): Uint8Array { return hexToBytes(readFileSync(MASTER, "utf8").trim() as Hex); }
export function loadState() { return JSON.parse(readFileSync(statePath, "utf8")); }
export function clients(rpc: string, account = unlock()) {
  const chain = defineChain({ id: ARC, name: "Arc Testnet demo", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const transport = () => http(rpc, { retryCount: 3, retryDelay: 1000 });
  return { account, chain, pub: createPublicClient({ chain, transport: transport(), pollingInterval: rpc.startsWith("http://127.0.0.1:") ? 500 : 4000 }), wallet: createWalletClient({ account, chain, transport: transport() }) };
}
export function prepare(organizer: Address, deadline?: bigint) {
  if (existsSync(statePath)) return loadState();
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const account = unlock();
  if (!existsSync(MASTER)) writeFileSync(MASTER, toHex(randomBytes(32)) + "\n", { mode: 0o600, flag: "wx" });
  chmodSync(MASTER, 0o600);
  const noirSalt = toHex(randomBytes(32)), creSalt = toHex(randomBytes(32));
  const pk = pubkey(deriveSk(master(), hexToBytes(noirSalt)));
  const state = {
    version: 1, demo: true, chainId: ARC, createdAt: new Date().toISOString(),
    deployer: account.address, organizer: getAddress(organizer), recipient: RECIPIENT,
    // Long enough for importing/review; the rehearsal uses a separate local clock.
    deadline: (deadline ?? BigInt(Math.floor(Date.now() / 1000) + 6 * 3600)).toString(),
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress,
    rounds: {
      EURC: { id: "urbehub", token: EURC, keySalt: noirSalt, tallierPkX: pk.x.toString(), tallierPkY: pk.y.toString() },
      USDC: { id: "golem", token: USDC, keySalt: creSalt, tallierPk: toHex(secp256k1.getPublicKey(deriveCreKey(master(), creSalt), true)) },
    }, contracts: {}, transactions: {},
  };
  save(statePath, state);
  return state;
}

export function operator(state: any, rpc: string, persist = statePath) {
  const { pub, wallet, account, chain } = clients(rpc);
  const remember = () => save(persist, state);
  async function guard() {
    if (state.demo !== true || state.chainId !== ARC || await pub.getChainId() !== ARC) throw new Error("This operator is restricted to the Arc testnet demo.");
    if (account.address.toLowerCase() !== state.deployer.toLowerCase()) throw new Error("Demo keystore does not match the saved deployment.");
    if (state.rpc && state.rpc !== rpc) throw new Error("This transaction journal belongs to another RPC. Keep local rehearsals separate from Arc.");
  }
  async function send(label: string, data: Hex, to?: Address, value = 0n) {
    await guard();
    if (!state.rpc) { state.rpc = rpc; remember(); }
    const intent = keccak256(toHex(json({ from: account.address, chain: ARC, to: to?.toLowerCase(), data, value })));
    let tx = state.transactions[label];
    if (tx && tx.intent !== intent) throw new Error(`Configuration changed for ${label}; inspect the existing receipt before continuing.`);
    if (!tx) {
      const request = await wallet.prepareTransactionRequest({ account, chain, data, to, value });
      const raw = await wallet.signTransaction(request);
      tx = state.transactions[label] = { intent, hash: keccak256(raw), raw };
      // Persist the signed transaction before submitting; retries reuse the same nonce/hash.
      remember();
    }
    let receipt = await pub.getTransactionReceipt({ hash: tx.hash }).catch(() => undefined);
    if (!receipt) {
      const pending = await pub.getTransaction({ hash: tx.hash }).catch(() => undefined);
      if (!pending) await wallet.sendRawTransaction({ serializedTransaction: tx.raw });
      console.log(`${label}: waiting for ${tx.hash}`);
      receipt = await pub.waitForTransactionReceipt({ hash: tx.hash, timeout: 180_000 });
    }
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${tx.hash}. It will not be resent automatically.`);
    tx.blockNumber = receipt.blockNumber.toString();
    tx.contractAddress = receipt.contractAddress;
    remember();
    return receipt;
  }
  async function deploy(label: string, name: string, args: any[] = [], v4 = false) {
    const a = artifact(name, v4);
    const receipt = await send(label, encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }));
    const address = receipt.contractAddress!;
    if (!address || (await pub.getCode({ address })) === "0x") throw new Error(`No deployed code for ${label}.`);
    state.contracts[label] = address; remember();
    return address;
  }
  async function write(label: string, address: Address, abi: any, fn: string, args: any[] = []) {
    return send(label, encodeFunctionData({ abi, functionName: fn, args }), address);
  }
  return { pub, account, guard, send, deploy, write, remember };
}

export async function deployRounds(state: any, rpc: string, persist?: string) {
  const op = operator(state, rpc, persist);
  await op.guard();
  if (state.organizer.toLowerCase() !== state.deployer.toLowerCase()) throw new Error("This demo runner requires the organizer to be the generated demo wallet.");
  const now = (await op.pub.getBlock()).timestamp;
  if (BigInt(state.deadline) <= now + 600n) throw new Error("The saved voting deadline is too close. Choose a new deadline before any pool deployment.");
  for (const token of [USDC, EURC]) {
    if (Number(await op.pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })) !== 6) throw new Error("Unexpected Arc token decimals.");
  }
  for (const address of [PERMIT2, MOCK_FORWARDER]) {
    const code = await op.pub.getCode({ address });
    if (!code || code === "0x") throw new Error(`Required Arc infrastructure missing at ${address}.`);
  }
  console.log(`Demo organizer: ${state.organizer}; payout recipient: ${state.recipient}; deadline: ${new Date(Number(state.deadline) * 1000).toISOString()}`);
  const poseidon = await op.deploy("poseidon", "Poseidon2");
  const ingestVerifier = await op.deploy("ingestVerifier", "IngestVerifier");
  const tallyVerifier = await op.deploy("tallyVerifier", "TallyVerifier");
  const noir = state.rounds.EURC;
  noir.pool = await op.deploy("eurcPool", "NoirRankedShares", [EURC, state.organizer, BigInt(state.deadline), {
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000",
    coordinator: state.deployer, poseidon, ingestVerifier, tallyVerifier,
    tallierPkX: BigInt(noir.tallierPkX), tallierPkY: BigInt(noir.tallierPkY), keySalt: noir.keySalt,
    nSealedMax: 256n, mMax: 16n, batch: 32n, minDirectVote: 1_000_000n, minSealedVote: 1_000_000n,
    proofGrace: 3600n, abandonGrace: 86400n,
  }]);
  const manager = await op.deploy("poolManager", "PoolManager", [state.deployer], true);
  const descriptor = await op.deploy("positionDescriptor", "PositionDescriptor", [manager, zeroAddress, toHex("USDC", { size: 32 })], true);
  const pm = await op.deploy("positionManager", "PositionManager", [manager, PERMIT2, 300_000n, descriptor, zeroAddress], true);
  const view = await op.deploy("stateView", "StateView", [manager], true);
  const cre = state.rounds.USDC;
  cre.pool = await op.deploy("usdcPool", "LPCreRankedShares", [{ token: USDC, owner: state.organizer, deadline: BigInt(state.deadline),
    tallierPk: cre.tallierPk, keySalt: cre.keySalt, minDirectVote: 1_000_000n, abandonGrace: 86400n,
    forwarder: MOCK_FORWARDER, workflowOwner: zeroAddress, workflowName: "0x00000000000000000000" }]);
  cre.lpModule = await op.deploy("lpModule", "LPVoting", [cre.pool, pm, view, MOCK_FORWARDER, zeroAddress, "0x00000000000000000000"]);
  await op.write("attachLP", cre.pool, artifact("LPCreRankedShares").abi, "setLPVoting", [cre.lpModule]);
  for (const round of Object.values(state.rounds) as any[]) {
    round.privacy = await op.pub.readContract({ address: round.pool, abi: proposalAbi, functionName: "proposalPrivacy" });
    if (await op.pub.readContract({ address: round.pool, abi: proposalAbi, functionName: "votingOpen" })) throw new Error("Demo import pools must remain in review.");
  }
  op.remember();
  return state;
}

function selectedCurrency(currency?: string) {
  if (currency && !["EURC", "USDC"].includes(currency)) throw new Error("Choose EURC or USDC.");
  return currency;
}
export function exportPlan(state: any, path = resolve(root, "demo/import-plan.json"), currency?: string) {
  selectedCurrency(currency);
  const plan = JSON.parse(readFileSync(resolve(root, "swarm/pool-import-plan.json"), "utf8"));
  delete plan.organizerAndProposerAndRecipient;
  plan.demo = true; plan.organizer = state.organizer; plan.proposer = state.deployer; plan.recipient = state.recipient;
  if (currency) plan.rounds = plan.rounds.filter((round: any) => round.currency === currency);
  for (const round of plan.rounds) {
    const deployed = state.rounds[round.currency];
    if (!deployed.pool) throw new Error("Deploy both pools before exporting their import plan.");
    Object.assign(round, { pool: deployed.pool, organizer: state.organizer, votingDeadline: state.deadline,
      organizerSharingPublicKey: deployed.organizerSharingPublicKey ?? null, status: "awaiting_encrypted_upload" });
    const receiptPath = "demo/urbehub-proposal-receipts.json";
    if (round.currency === "EURC" && existsSync(resolve(root, receiptPath))) {
      const receipt = JSON.parse(readFileSync(resolve(root, receiptPath), "utf8"));
      if (receipt.pool?.toLowerCase() === deployed.pool.toLowerCase() && receipt.encryption === false) {
        round.reviewMode = "public";
        round.publicReceiptFile = receiptPath;
        round.status = receipt.verifiedAt ? "accepted_publicly" : "public_import_in_progress";
        plan.privacy = "EURC uses the explicitly approved public demo import; USDC retains encrypted review. Original Markdown copies are already public.";
      }
    }
    for (const row of round.proposals) {
      const actual = createHash("sha256").update(readFileSync(resolve(root, row.source))).digest("hex");
      if (actual !== row.sha256) throw new Error(`Source changed: ${row.source}`);
      row.proposer = state.deployer; row.recipient = state.recipient;
    }
  }
  save(path, plan);
  return plan;
}

export async function registerKey(state: any, rpc: string, key: string, currency?: string) {
  const selected = selectedCurrency(currency);
  const normalized = `0x${publicKey(key)}` as Hex;
  const op = operator(state, rpc);
  for (const [currency, round] of Object.entries(state.rounds) as [string, any][]) {
    if (selected && currency !== selected) continue;
    if (!round.privacy) throw new Error("Deploy both pools first.");
    const previous = await op.pub.readContract({ address: round.privacy, abi: privacyAbi, functionName: "organizerPublicKey" });
    if (previous.toLowerCase() !== normalized) await op.write(`${currency}:review-key:${normalized}`, round.privacy, privacyAbi, "setOrganizerKey", [normalized]);
    round.organizerSharingPublicKey = normalized;
    op.remember();
  }
  exportPlan(state, selected ? resolve(root, `demo/import-plan-${selected.toLowerCase()}.json`) : undefined, selected);
}

export async function importProposals(state: any, rpc: string, file: string, currency?: string) {
  selectedCurrency(currency);
  const uploaded = JSON.parse(readFileSync(file, "utf8"));
  const expected = exportPlan(state, currency ? resolve(root, `demo/import-plan-${currency.toLowerCase()}.json`) : undefined, currency);
  if (uploaded.version !== 1 || uploaded.chainId !== ARC || !Array.isArray(uploaded.rounds) || uploaded.rounds.length < expected.rounds.length || uploaded.rounds.length > 2) throw new Error("Invalid upload receipt file.");
  const op = operator(state, rpc);
  // Validate every row before the first transaction. No plaintext/public fallback.
  const queue: any[] = [];
  for (const round of expected.rounds) {
    const candidates = uploaded.rounds.filter((r: any) => r.currency === round.currency);
    if (candidates.length !== 1) throw new Error("Missing or duplicated round in upload receipts.");
    const got = candidates[0];
    if (!got || got.pool?.toLowerCase() !== round.pool.toLowerCase() || got.proposals?.length !== round.proposals.length) throw new Error("Upload receipt targets do not match the prepared pools.");
    for (const row of round.proposals) {
      const match = got.proposals.filter((p: any) => p.source === row.source);
      if (match.length !== 1) throw new Error(`Missing or duplicated upload: ${row.source}`);
      const p = match[0];
      for (const field of ["sha256", "amountBaseUnits", "proposer", "recipient", "title", "body"]) {
        if (p[field] !== row[field]) throw new Error(`Changed ${field} for ${row.source}.`);
      }
      if (!/^0x[\da-f]{64}$/i.test(p.privateReference) || !/^0x[\da-f]{64}$/i.test(p.keyHash) || /^0x0+$/.test(p.keyHash)) throw new Error(`No encrypted upload for ${row.source}.`);
      const response = await fetch(`https://api.gateway.ethswarm.org/bytes/${p.privateReference.slice(2)}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Cannot verify Swarm descriptor for ${row.source}.`);
      const d = await response.json() as any;
      if (d?.version !== 2 || d.kind !== "ranked-shares/private-proposal" || d.pool?.toLowerCase() !== round.pool.toLowerCase() || d.proposer?.toLowerCase() !== state.deployer.toLowerCase() || d.chainId !== ARC || d.keyHash !== p.keyHash.toLowerCase() || d.organizerPublicKey !== publicKey(round.organizerSharingPublicKey) || !d.access?.encryptedReference || !d.access?.historyReference) throw new Error(`Encrypted context mismatch: ${row.source}.`);
      queue.push({ round, row: p });
    }
  }
  for (const { round, row } of queue) {
    const receipt = await op.write(`proposal:${round.currency}:${row.sha256}`, round.pool, proposalAbi, "propose", [row.privateReference, row.keyHash, BigInt(row.amountBaseUnits), row.recipient]);
    const events = parseEventLogs({ abi: proposalAbi, logs: receipt.logs, eventName: "Proposed" });
    const event = events.find(e => e.address.toLowerCase() === round.pool.toLowerCase());
    if (!event) throw new Error("Proposal receipt is missing its Proposed event.");
    row.proposalId = event.args.proposalId.toString(); row.transactionHash = receipt.transactionHash;
    save(resolve(root, "demo/proposal-receipts.json"), uploaded);
    console.log(`${round.currency}: proposal ${row.proposalId} — ${row.title} (pending review)`);
  }
}

export function configure(state: any, rpc: string) {
  const dir = resolve(local, "cre");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, "project.yaml"), `demo:\n  rpcs:\n    - chain-name: arc-testnet\n      url: ${JSON.stringify(rpc)}\n`);
  for (const currency of ["EURC", "USDC"]) {
    const folder = resolve(dir, currency); mkdirSync(folder, { recursive: true, mode: 0o700 });
    const lp = currency === "USDC", round = state.rounds[currency];
    if (!round.pool) throw new Error("Deploy pools before configuring CRE.");
    writeFileSync(resolve(folder, "workflow.yaml"), `demo:\n  user-workflow:\n    workflow-name: ranked-shares-${currency.toLowerCase()}-simulation\n  workflow-artifacts:\n    workflow-path: ${JSON.stringify(resolve(root, lp ? "cre/src/lp-main.ts" : "cre/src/main.ts"))}\n    config-path: ./config.json\n    secrets-path: ${JSON.stringify(resolve(root, "cre/workflows/sealed/secrets.yaml"))}\n`);
    save(resolve(folder, "config.json"), { schedule: "0 */2 * * * *", chainSelectorName: "arc-testnet", pools: lp ? [] : [round.pool],
      ...(lp ? { lpModules: [round.lpModule], priceIntervalSeconds: 120 } : {}), closeChunk: 25, gasLimit: "10000000" });
  }
  return dir;
}

export async function simulate(state: any, rpc: string, currency: string, broadcast: boolean) {
  if (!["EURC", "USDC"].includes(currency)) throw new Error("Choose EURC or USDC.");
  const dir = configure(state, rpc), lp = currency === "USDC";
  // The generated account supplies simulation transaction signing only.
  const privateKey = unlockKey();
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== state.deployer.toLowerCase()) throw new Error("Signer mismatch.");
  const args = ["workflow", "simulate", resolve(dir, currency), "--project-root", dir, "--target", "demo", "--non-interactive", "--trigger-index", "0", "--wasm", resolve(root, lp ? "cre/dist/lp-workflow.wasm" : "cre/dist/workflow.wasm"), ...(broadcast ? ["--broadcast"] : [])];
  console.log(`Running ${currency} locally${broadcast ? " with testnet transactions" : " without broadcasting"}. No DON/enclave security in simulation.`);
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn("cre", args, { cwd: dir, stdio: "inherit", env: { ...process.env, CRE_ETH_PRIVATE_KEY: privateKey, CRE_RANKED_SHARES_MASTER: toHex(master()) } });
    child.on("error", () => reject(new Error("Could not start the CRE simulator.")));
    child.on("exit", code => code === 0 ? resolveDone() : reject(new Error(`CRE simulation exited ${code}.`)));
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log("Arc Testnet demo operator. See demo/README.md for account setup and simulation limitations.\nCommands:\n  prepare --organizer <address> [--deadline <unix-seconds>]\n  status\n  deploy\n  register-key --key <Swarm-sharing-public-key> [--round EURC|USDC]\n  export [--round EURC|USDC]\n  import --file <encrypted-upload-receipts.json> [--round EURC|USDC]\n  simulate --round EURC|USDC [--broadcast]\nOptional: --rpc <url>. Existing operations resume from the private transaction journal.");
    return;
  }
  const value = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
  let rpc = value("rpc") ?? "https://rpc.testnet.arc.io";
  if (command === "prepare") {
    const owner = value("organizer"); if (!owner) throw new Error("Pass the approved demo organizer with --organizer.");
    const state = prepare(getAddress(owner), value("deadline") ? BigInt(value("deadline")!) : undefined);
    console.log(json({ deployer: state.deployer, organizer: state.organizer, recipient: state.recipient, deadline: state.deadline })); return;
  }
  const state = loadState();
  rpc = value("rpc") ?? state.rpc ?? rpc;
  if (command === "status") {
    const op = operator(state, rpc); await op.guard();
    console.log(json({ ...state, transactions: Object.fromEntries(Object.entries(state.transactions).map(([k, v]: any) => [k, { hash: v.hash, blockNumber: v.blockNumber }])), nativeGasBalance: (await op.pub.getBalance({ address: state.deployer })).toString() }));
  } else if (command === "deploy") { await deployRounds(state, rpc); exportPlan(state); console.log("Both demo pools deployed in review. Import plan: demo/import-plan.json"); }
  else if (command === "register-key") { await registerKey(state, rpc, value("key") ?? "", value("round")); console.log("Organizer sharing key registered in the selected pools."); }
  else if (command === "import") await importProposals(state, rpc, value("file") ?? "", value("round"));
  else if (command === "export") {
    const currency = selectedCurrency(value("round"));
    const path = currency ? `demo/import-plan-${currency.toLowerCase()}.json` : "demo/import-plan.json";
    exportPlan(state, resolve(root, path), currency); console.log(path);
  }
  else if (command === "simulate") await simulate(state, rpc, value("round") ?? "", args.includes("--broadcast"));
  else throw new Error("Commands: prepare --organizer <address>; status; deploy; register-key --key <public-key>; export; import --file <receipt.json>; simulate --round EURC|USDC [--broadcast]. Optional --rpc.");
}
if (import.meta.main) main().catch((error) => {
  const message = String(error?.shortMessage ?? error?.message ?? "Unknown error").replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 300);
  console.error(`Demo operation failed: ${message}. Run status before retrying.`); process.exitCode = 1;
});
