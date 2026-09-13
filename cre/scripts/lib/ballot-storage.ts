import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { addr, bytes32, str, u64, u256 } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk/entity";
import { type Account, type Address, createPublicClient as createEvmClient, createWalletClient as createSigner, custom, decodeEventLog, type Hex, hexToBytes, http, keccak256, parseAbi, type PublicClient, toHex } from "viem";
import { ballotAbi, ballotAlias, ballotId, BALLOT_SCHEMA, MAX_VOTERS, rosterPage } from "../../src/lib/arkiv";
import { recoverPayload } from "../../../prover/src/core/arkiv";
import { ballotExpiry } from "../../../web/app/lib/ballot-retention";

export type StorageRecord = { raw?: Hex; hash?: Hex; entityKey?: Hex; verified?: boolean; expiresAt: string; retentionUntil: string };
export type StorageJournal = Record<string, StorageRecord>;
const poolAbi = parseAbi(["function kind() view returns (string)", "function votingDeadline() view returns (uint64)", "function projectCount() view returns (uint256)"]);

/** Only accepted on-chain ballots can spend this worker's storage budget.
 * Signed transactions are persisted before broadcast and resumed verbatim. */
export function ballotStorageWorker(options: {
  poolClient: PublicClient; account: Account; arkivRpc: string;
  journal: StorageJournal; save: () => void; log?: (message: string) => void;
}, clients = { createPublicClient, createWalletClient, createEvmClient, createSigner }) {
  const { poolClient: client, account, journal, save } = options;
  const arkiv = clients.createPublicClient({ chain: tiramisu, transport: http(options.arkivRpc), pollingInterval: 1000 });
  const rpc = clients.createEvmClient({ chain: tiramisu, transport: http(options.arkivRpc) });
  const signer = clients.createSigner({ chain: tiramisu, account, transport: http(options.arkivRpc) });
  async function confirm(id: Hex, record: StorageRecord) {
    // Re-broadcasting the same signed transaction cannot create a second entity.
    await rpc.sendRawTransaction({ serializedTransaction: record.raw! }).catch(() => undefined);
    const receipt = await arkiv.waitForTransactionReceipt({ hash: record.hash!, timeout: 60_000 });
    if (receipt.status !== "success") {
      delete journal[id]; save();
      throw new Error(`Storage transaction reverted for ${id}; the next run can retry.`);
    }
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== "0x4400000000000000000000000000000000000044") continue;
      try {
        const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, eventName: "EntityCreated", data: log.data, topics: log.topics });
        if (event.args.owner.toLowerCase() === account.address.toLowerCase()) {
          record.entityKey = event.args.entityKey;
          record.expiresAt = event.args.expiresAt.toString();
        }
      } catch { /* Other engine events. */ }
    }
    if (!record.entityKey) throw new Error(`No entity in the confirmed storage transaction for ${id}.`);
    save();
  }
  async function syncPool(pool: Address) {
    if (await arkiv.getChainId() !== tiramisu.id) throw new Error("Storage RPC is on the wrong chain.");
    const chainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const at = { address: pool, abi: ballotAbi, blockNumber } as const;
    if (await client.readContract({ ...at, functionName: "ballotFlowVersion" }) !== 2n) throw new Error("Storage worker requires a version 2 pool.");
    const [count, kind, deadline, projects] = await Promise.all([
      client.readContract({ ...at, functionName: "voterCount" }),
      client.readContract({ ...at, abi: poolAbi, functionName: "kind" }),
      client.readContract({ ...at, abi: poolAbi, functionName: "votingDeadline" }),
      client.readContract({ ...at, abi: poolAbi, functionName: "projectCount" }),
    ]);
    if (count > BigInt(MAX_VOTERS) || projects > 255n) throw new Error("Pool exceeds supported limits.");
    const storageHead = await arkiv.getBlock();
    if (storageHead.timestamp >= deadline + 15n * 86400n) return;
    for (let start = 0n; start < count; start += 50n) {
      const rows = rosterPage(await client.readContract({ ...at, functionName: "voterRefsFrom", args: [start, 50n] }), Number(count - start < 50n ? count - start : 50n));
      for (const voter of rows) for (const sealed of [false, true]) {
        const ref = sealed ? voter.sealedRef : voter.publicRef;
        if (!ref.revision) continue;
        const id = ref.entityKey.toLowerCase() as Hex;
        if (journal[id]?.verified) continue;
        const payload = await recoverPayload(client, pool, voter.address, sealed, ref);
        if (ballotId(BigInt(chainId), pool, voter.address, sealed, ref.revision, payload) !== id) continue; // legacy direct upload
        let record = journal[id];
        if (record?.entityKey) {
          // A prior read-back may have timed out after a successful upload.
        } else if (record?.hash) {
          await confirm(id, record);
        } else {
          const existing = await arkiv.select({ key: true, payload: true, attributes: true }).where(eq("ballot_id", bytes32(id))).limit(50).fetch();
          const found = existing.entities.find((e) => ballotAlias(e.attributes, toHex(e.payload)) === id);
          if (found) {
            const entity = await arkiv.getEntity(found.key);
            if (entity.creator.toLowerCase() === account.address.toLowerCase() && entity.creationFlags.readonly && !entity.creationFlags.permissionlessExtension && entity.expiresAt > storageHead.number && String(entity.attributes.retention_until?.value) === String(deadline + 15n * 86400n)) {
              journal[id] = { entityKey: found.key, verified: true, expiresAt: entity.expiresAt.toString(), retentionUntil: (deadline + 15n * 86400n).toString() }; save(); continue;
            }
          }
          const retention = ballotExpiry(deadline, await arkiv.getBlock());
          record = { expiresAt: retention.expiresAt.toString(), retentionUntil: retention.until.toString() };
          journal[id] = record;
          // Give the SDK a JSON-RPC account so every write passes through this
          // transport. A local account would sign and broadcast inside viem,
          // bypassing the durable journal below.
          const wallet = clients.createWalletClient({ account: account.address, chain: tiramisu, transport: custom({
            request: async ({ method, params }) => {
              if (method !== "eth_sendTransaction") return arkiv.request({ method, params } as never);
              const tx = (params as any[])[0];
              const request = await signer.prepareTransactionRequest({ account, to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0), ...(tx.gas ? { gas: BigInt(tx.gas) } : {}) });
              if (!account.signTransaction) throw new Error("The storage worker requires a local signing account.");
              const raw = await signer.signTransaction(request);
              record.raw = raw;
              record.hash = keccak256(raw);
              save();
              return rpc.sendRawTransaction({ serializedTransaction: raw });
            },
          }, { retryCount: 0 }) });
          const result = await wallet.createEntity({
            payload: hexToBytes(payload), contentType: "application/octet-stream",
            attributes: { schema: str(BALLOT_SCHEMA), ballot_id: bytes32(id), pool_chain: u64(BigInt(chainId)), pool: addr(pool), voter: addr(voter.address), pool_kind: str(kind), ballot_mode: str(sealed ? "sealed" : "public"), revision: u256(ref.revision), projects: u64(projects), payload_hash: bytes32(ref.payloadHash), retention_until: u64(retention.until) },
            flags: { readonly: true, permissionlessExtension: false }, expires: retention.expires,
          });
          record.entityKey = result.entityKey;
          record.expiresAt = result.expiresAt.toString();
          save();
        }
        const entity = await arkiv.getEntity(record.entityKey!);
        if (ballotAlias(entity.attributes, toHex(entity.payload)) !== id) throw new Error("Stored ballot did not match the accepted vote.");
        record.verified = true; save();
        options.log?.(`Stored ballot ${id} in Arkiv entity ${record.entityKey}`);
      }
    }
  }
  return { syncPool };
}
