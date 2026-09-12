import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { addr, bytes32, key, str, u256, u64 } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk/entity";
import { and, eq, or } from "@arkiv-network/sdk/query";
import {
  type Address,
  custom,
  decodeEventLog,
  type Hex,
  hexToBytes,
  http,
  keccak256,
  toHex,
  type WalletClient,
} from "viem";
import {
  ARKIV_RPC,
  BALLOT_SCHEMA,
  checkedPayload,
} from "../../../cre/src/lib/arkiv";

export const arkivChain = tiramisu;
export const arkiv = createPublicClient({
  chain: tiramisu,
  transport: http(import.meta.env.VITE_ARKIV_RPC_URL || ARKIV_RPC),
});
export type PublishedBallot = {
  pool: Address;
  chainId: number;
  account: Address;
  kind: "public" | "cre" | "zisk" | "noir";
  isSealed: boolean;
  revision: string;
  payload: Hex;
  projects: number;
  storageTx?: Hex;
  entityKey?: Hex;
  expiresAt?: string;
  voteTx?: Hex;
};
const JOURNAL_KEY = "ranked-shares.arkiv.pending.v1";
export function readPending(): PublishedBallot | undefined {
  const text = localStorage.getItem(JOURNAL_KEY);
  if (!text) return;
  try {
    return JSON.parse(text) as PublishedBallot;
  } catch {
    throw new Error(
      "The saved ballot could not be read. Keep a copy of your transaction hashes before clearing browser storage.",
    );
  }
}
export function savePending(ballot?: PublishedBallot) {
  if (ballot) localStorage.setItem(JOURNAL_KEY, JSON.stringify(ballot));
  else localStorage.removeItem(JOURNAL_KEY);
}
export function attributes(ballot: PublishedBallot) {
  return {
    schema: str(BALLOT_SCHEMA),
    pool_chain: u64(BigInt(ballot.chainId)),
    pool: addr(ballot.pool),
    voter: addr(ballot.account),
    pool_kind: str(ballot.kind),
    ballot_mode: str(ballot.isSealed ? "sealed" : "public"),
    revision: u256(BigInt(ballot.revision)),
    projects: u64(BigInt(ballot.projects)),
    payload_hash: bytes32(keccak256(ballot.payload)),
  };
}

/** Typed queries, paged at one Arkiv block. Callers still check every hash and
 * use the contract roster to order and select accepted revisions. */
export async function loadPayloads(
  keys: readonly Hex[],
): Promise<Map<string, Hex>> {
  const out = new Map<string, Hex>();
  for (let start = 0; start < keys.length; start += 100) {
    let page = await arkiv.select({ key: true, payload: true }).where(
      or(...keys.slice(start, start + 100).map((k) => eq("$key", key(k)))),
    ).limit(200).fetch();
    for (;;) {
      for (const e of page.entities) {
        out.set(e.key.toLowerCase(), toHex(e.payload));
      }
      if (!page.hasNextPage()) break;
      page = await page.next();
    }
  }
  return out;
}

export async function verifyPublished(ballot: PublishedBallot) {
  if (!ballot.entityKey) {
    throw new Error(
      "The storage transaction has not returned an entity key yet.",
    );
  }
  const entity = await arkiv.getEntity(ballot.entityKey);
  checkedPayload({
    entityKey: ballot.entityKey,
    payloadHash: keccak256(ballot.payload),
    revision: BigInt(ballot.revision),
    blockNumber: 0n,
  }, toHex(entity.payload));
  if (
    entity.creator.toLowerCase() !== ballot.account.toLowerCase() ||
    !entity.creationFlags.readonly ||
    !entity.creationFlags.permissionlessExtension
  ) {
    throw new Error(
      "The stored ballot has an unexpected creator or storage flags.",
    );
  }
  for (const [name, expected] of Object.entries(attributes(ballot))) {
    const actual = entity.attributes[name];
    if (
      actual?.type !== expected.type ||
      String(actual.value).toLowerCase() !==
        String(expected.value).toLowerCase()
    ) throw new Error(`The stored ballot's ${name} does not match this vote.`);
  }
  // Read-after-write proves this entity can also be found by its typed attributes.
  const page = await arkiv.select({ key: true }).where(
    and(
      eq("$key", key(ballot.entityKey)),
      ...Object.entries(attributes(ballot)).map(([name, value]) =>
        eq(name, value)
      ),
    ),
  ).limit(1).fetch();
  if (
    !page.entities.some((e) =>
      e.key.toLowerCase() === ballot.entityKey!.toLowerCase()
    )
  ) {
    throw new Error(
      "Arkiv has not indexed this ballot yet. Retry confirmation shortly.",
    );
  }
}

export async function publishBallot(
  wallet: WalletClient,
  ballot: PublishedBallot,
  deadline: bigint,
  grace: bigint,
) {
  const assertSigner = async () => {
    const [accounts, chainId, rpcChain] = await Promise.all([
      wallet.getAddresses(),
      wallet.getChainId(),
      arkiv.getChainId(),
    ]);
    if (accounts[0]?.toLowerCase() !== ballot.account.toLowerCase()) {
      throw new Error(
        "The wallet account changed. Reconnect with the ballot's voter.",
      );
    }
    if (chainId !== tiramisu.id || rpcChain !== tiramisu.id) {
      throw new Error(
        "Switch your wallet to Arkiv Tiramisu before storing the ballot.",
      );
    }
  };
  await assertSigner();
  if (ballot.storageTx || ballot.entityKey) {
    throw new Error(
      "This ballot already has a storage transaction. Resume it instead of publishing again.",
    );
  }
  // Save only public ranks or ciphertext. Never journal a sealed ranking or its
  // ephemeral encryption scalar. Save hashes immediately, even if receipt waits fail.
  savePending(ballot);
  const storageWallet = createWalletClient({
    account: ballot.account,
    chain: tiramisu,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === "eth_sendTransaction") {
          await assertSigner();
          const hash = await wallet.request({ method, params } as never) as Hex;
          ballot.storageTx = hash;
          savePending(ballot);
          return hash;
        }
        return arkiv.request({ method, params } as never);
      },
    }, { retryCount: 0 }),
  });
  // Retain through the whole dispute/abandon window plus thirty days. Lifetime is
  // measured in Arkiv blocks; the UI shows the actual expiry returned by the node.
  const days = Math.max(
    30,
    Math.ceil((Number(deadline + grace) - Date.now() / 1000) / 86400) + 30,
  );
  const result = await storageWallet.createEntity({
    payload: hexToBytes(ballot.payload),
    contentType: "application/octet-stream",
    attributes: attributes(ballot),
    flags: { readonly: true, permissionlessExtension: true },
    expires: ExpirationTime.fromDays(days),
  });
  ballot.storageTx = result.txHash;
  ballot.entityKey = result.entityKey;
  ballot.expiresAt = result.expiresAt.toString();
  savePending(ballot);
  await verifyPublished(ballot);
  return ballot;
}

export async function resumePublication(ballot: PublishedBallot) {
  if (!ballot.entityKey) {
    if (!ballot.storageTx) {
      throw new Error(
        "No storage transaction was sent. You can discard this draft and prepare a new ballot.",
      );
    }
    const receipt = await arkiv.waitForTransactionReceipt({
      hash: ballot.storageTx,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      throw new Error(
        "The Arkiv transaction reverted. You can discard this draft and prepare a new ballot.",
      );
    }
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() !==
          "0x4400000000000000000000000000000000000044"
      ) continue;
      try {
        const event = decodeEventLog({
          abi: ENTITY_EVENTS_ABI,
          data: log.data,
          topics: log.topics,
          eventName: "EntityCreated",
        });
        if (event.args.owner.toLowerCase() === ballot.account.toLowerCase()) {
          ballot.entityKey = event.args.entityKey;
          ballot.expiresAt = event.args.expiresAt.toString();
          break;
        }
      } catch { /* Other engine events in the receipt. */ }
    }
    if (!ballot.entityKey) {
      throw new Error(
        "The storage receipt has no ballot entity. Check the transaction before trying another upload.",
      );
    }
    savePending(ballot);
  }
  await verifyPublished(ballot);
  return ballot;
}
