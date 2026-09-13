// Public, read-only judge reproduction: no wallet, keystore, or credentials needed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient as createArkivClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { key } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk/entity";
import { type Address, type Hex, createPublicClient, decodeEventLog, http, keccak256, toHex } from "viem";
import { ARKIV_RPC, ballotAbi, ballotAlias } from "../src/lib/arkiv";

const root = fileURLToPath(new URL("../../", import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
type Row = { dataset: string; pool: Address; voter: Address; creator: Address; mode: "public" | "encrypted"; entityKey: Hex; creationTransactionHash: Hex; voteTransactionHash: Hex; ballotId?: Hex };
function manifest(): Row[] {
  const v2 = json("demo/new-flow-deployment.json"), short = json("demo/short-round-deployment.json"), old = json("demo/urbehub-vote-receipts.json");
  const rows: Row[] = [];
  for (const currency of ["EURC", "USDC"]) for (const ballot of v2.ballots[currency]) rows.push({ dataset: `${currency}-v2`, pool: v2.rounds[currency].pool, voter: ballot.address, creator: v2.organizer, mode: ballot.mode, entityKey: ballot.arkivEntityKey, creationTransactionHash: ballot.arkivTransactionHash, voteTransactionHash: ballot.transactionHash, ballotId: ballot.ballotId });
  for (const ballot of short.ballots) rows.push({ dataset: "EURC-short", pool: short.pool, voter: ballot.address, creator: short.organizer, mode: ballot.mode, entityKey: ballot.arkivEntityKey, creationTransactionHash: ballot.arkivTransactionHash, voteTransactionHash: ballot.transactionHash, ballotId: ballot.ballotId });
  for (const ballot of old.voters) rows.push({ dataset: "EURC-legacy", pool: old.pool, voter: ballot.address, creator: ballot.address, mode: "encrypted", entityKey: ballot.arkivEntityKey, creationTransactionHash: ballot.arkivStorageTransaction, voteTransactionHash: ballot.voteTransaction });
  if (rows.length !== 80 || new Set(rows.map(r => r.entityKey)).size !== 80 || rows.some(r => !r.entityKey || !r.creationTransactionHash)) throw Error("Incomplete or duplicated public evidence manifest.");
  return rows;
}
async function main() {
  const arkiv = createArkivClient({ chain: tiramisu, transport: http(ARKIV_RPC) });
  const arc = createPublicClient({ transport: http("https://rpc.blockdaemon.testnet.arc.network") });
  if (await arkiv.getChainId() !== 7738577 || await arc.getChainId() !== 5042002) throw Error("Unexpected chain.");
  const all = manifest(), seen = new Set<string>();
  const selected = process.argv.includes("--all") ? all : all.filter(row => {
    const group = `${row.dataset}:${row.mode}`;
    if (seen.has(group)) return false;
    seen.add(group); return true;
  });
  const head = await arkiv.getBlock();
  const records: any[] = [], receipts: any[] = [];
  for (const row of selected) {
    const [entity, receipt, transaction, query, ref] = await Promise.all([
      arkiv.getEntity(row.entityKey),
      arkiv.getTransactionReceipt({ hash: row.creationTransactionHash }),
      arkiv.getTransaction({ hash: row.creationTransactionHash }),
      arkiv.select({ key: true, payload: true, attributes: true }).where(eq("$key", key(row.entityKey))).atBlock(head.number).limit(1).fetch(),
      arc.readContract({ address: row.pool, abi: ballotAbi, functionName: "ballotRefOf", args: [row.voter, row.mode === "encrypted"] }),
    ]);
    if (receipt.status !== "success" || transaction.from.toLowerCase() !== row.creator.toLowerCase() || entity.creator.toLowerCase() !== row.creator.toLowerCase()) throw Error(`Creator/receipt mismatch for ${row.entityKey}.`);
    const creation = receipt.logs.flatMap(log => {
      if (log.address.toLowerCase() !== "0x4400000000000000000000000000000000000044") return [];
      try { const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, eventName: "EntityCreated", data: log.data, topics: log.topics }); return event.args.entityKey.toLowerCase() === row.entityKey.toLowerCase() ? [event.args] : []; }
      catch { return []; }
    });
    if (creation.length !== 1 || creation[0].owner.toLowerCase() !== row.creator.toLowerCase()) throw Error(`Missing creation event for ${row.entityKey}.`);
    const payload = toHex(entity.payload), hash = keccak256(payload);
    if (query.blockNumber !== head.number || query.entities.length !== 1 || toHex(query.entities[0].payload) !== payload || entity.expiresAt <= head.number) throw Error(`Entity is not available in the live query: ${row.entityKey}.`);
    if (ref.entityKey.toLowerCase() !== (row.ballotId ?? row.entityKey).toLowerCase() || ref.payloadHash !== hash) throw Error(`Entity no longer matches the accepted Arc ballot: ${row.entityKey}.`);
    if (row.ballotId && ballotAlias(entity.attributes, payload) !== row.ballotId) throw Error("Typed ballot alias mismatch.");
    if (!entity.creationFlags.readonly || entity.creationFlags.permissionlessExtension) throw Error("Unexpected creation flags.");
    const record = { ...row, creator: entity.creator, currentOwner: entity.owner, creationBlock: receipt.blockNumber.toString(), creationExpiresAtBlock: creation[0].expiresAt.toString(), expiresAtBlock: entity.expiresAt.toString(), payloadHash: hash, payloadBytes: entity.payload.length,
      readonly: entity.creationFlags.readonly, permissionlessExtension: entity.creationFlags.permissionlessExtension,
      queryMatchedAtBlock: head.number.toString(), acceptedArcRevision: ref.revision.toString(), attributes: entity.attributes,
    };
    records.push(record);
    receipts.push({ entityKey: row.entityKey, transactionHash: row.creationTransactionHash, from: transaction.from, receipt });
    console.log(`${row.dataset} ${row.mode}: creator, owner, creation receipt, live query and accepted Arc hash verified (${row.entityKey}).`);
  }
  const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
  if (process.argv.includes("--write")) {
    if (!process.argv.includes("--all")) throw Error("Use --all --write to refresh the full evidence files.");
    writeFileSync(`${root}arkiv/evidence.json`, stringify({ version: 1, checkedAt: new Date().toISOString(), arkivChainId: 7738577, arcChainId: 5042002, arkivBlock: head.number.toString(), publicRpc: ARKIV_RPC, records }));
    writeFileSync(`${root}arkiv/creation-receipts.json`, stringify({ version: 1, arkivChainId: 7738577, receipts }));
  }
  console.log(`Verified ${records.length} real Tiramisu entities. No fixture data or write transactions were used.`);
}
main().catch(error => { console.error(`Evidence verification failed: ${error.shortMessage ?? error.message}`); process.exitCode = 1; });
