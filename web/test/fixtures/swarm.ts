import { vi } from "vitest";
import { keccak256, toHex } from "viem";
import type { PrivateStorage } from "../../app/lib/private-proposals";

/** In-memory transport and identity-gated ACT test double. Proposal/attachment
 * AES-GCM is the real application code; this does not claim to test Swarm's SDK. */
export function mockSwarm(initialPublicKey: string) {
  let identity = initialPublicKey;
  const objects = new Map<string, Uint8Array>();
  const access = new Map<string, { key: Uint8Array; publisher: string; grantees: string[] }>();
  const storage = {
    get connectionInfo() {
      return {
        identity: identity
          ? { id: identity, name: "Reviewer", sharingPublicKey: identity }
          : undefined,
        appKey: identity ? { publicKey: identity, address: "0x" + "11".repeat(20) } : undefined,
        canUpload: !!identity,
      };
    },
    uploadData: vi.fn(async (data: Uint8Array) => {
      const reference = keccak256(data).slice(2);
      objects.set(reference, new Uint8Array(data));
      return { reference };
    }),
    downloadData: vi.fn(async (reference: string) => {
      const data = objects.get(reference);
      if (!data) throw new Error("Not found");
      return new Uint8Array(data);
    }),
    uploadFile: vi.fn(async (file: File) => {
      const data = new Uint8Array(await file.arrayBuffer());
      const reference = keccak256(data).slice(2);
      objects.set(reference, data);
      return { reference };
    }),
    downloadFile: vi.fn(async (reference: string) => {
      const data = objects.get(reference);
      if (!data) throw new Error("Not found");
      return { name: "attachment.enc", data: new Uint8Array(data) };
    }),
    actUploadData: vi.fn(async (key: Uint8Array, grantees: string[]) => {
      const encryptedReference = keccak256(toHex(`act-${access.size}`)).slice(2);
      access.set(encryptedReference, {
        key: new Uint8Array(key),
        publisher: identity,
        grantees: [...grantees],
      });
      return {
        encryptedReference,
        historyReference: "ab".repeat(32),
        publisherPubKey: identity,
        actReference: "bc".repeat(32),
        granteeListReference: "cd".repeat(32),
      };
    }),
    actDownloadData: vi.fn(async (ref: string, _history: string, publisher: string) => {
      const item = access.get(ref);
      if (
        !item || publisher !== item.publisher ||
        (identity !== item.publisher && !item.grantees.includes(identity))
      ) throw new Error("Access denied");
      return new Uint8Array(item.key);
    }),
  } as unknown as PrivateStorage;
  return {
    storage,
    objects,
    setIdentity: (key: string) => {
      identity = key;
    },
  };
}
