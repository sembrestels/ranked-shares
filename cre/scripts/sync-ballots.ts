import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Address, createPublicClient, http, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ARKIV_RPC } from "../src/lib/arkiv";
import { ballotStorageWorker, type StorageJournal } from "./lib/ballot-storage";
import { local, unlock } from "./demo";

const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
const pools = args.includes("--pools") ? value("--pools").split(",") : [];
if (!pools.length || pools.some((p) => !isAddress(p))) throw new Error("Usage: bun scripts/sync-ballots.ts --pools 0xPool[,0xPool] [--watch] [--rpc URL] [--state FILE]");
const path = resolve(args.includes("--state") ? value("--state") : `${local}/arkiv-sync.json`);
const journal: StorageJournal = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
// One process owns this journal and signing nonce stream. A crash leaves the
// lock for an operator to inspect before resuming the saved transactions.
const lockPath = `${path}.lock`;
const lock = openSync(lockPath, "wx", 0o600);
writeFileSync(lock, String(process.pid));
process.on("exit", () => { closeSync(lock); unlinkSync(lockPath); });
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
const save = () => { writeFileSync(`${path}.tmp`, JSON.stringify(journal), { mode: 0o600 }); renameSync(`${path}.tmp`, path); };
const account = process.env.ARKIV_STORAGE_PRIVATE_KEY ? privateKeyToAccount(process.env.ARKIV_STORAGE_PRIVATE_KEY as `0x${string}`) : unlock();
const client = createPublicClient({ chain: arcTestnet, transport: http(args.includes("--rpc") ? value("--rpc") : "https://rpc.blockdaemon.testnet.arc.network") });
const worker = ballotStorageWorker({ poolClient: client, account, arkivRpc: process.env.ARKIV_RPC_URL || ARKIV_RPC, journal, save, log: console.log });
do {
  for (const pool of pools) {
    try { await worker.syncPool(pool as Address); }
    catch (e) { console.error(`Storage sync failed for ${pool}: ${e instanceof Error ? e.name : "unknown error"}. Saved transactions will resume on retry.`); if (!args.includes("--watch")) process.exitCode = 1; }
  }
  if (!args.includes("--watch")) break;
  await Bun.sleep(15_000);
} while (true);
