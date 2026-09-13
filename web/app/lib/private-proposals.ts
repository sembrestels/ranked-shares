// ADR: 2026-09-13-encrypt-proposals-through-private-review.md.
// ACT shares a fresh AES key with the two reviewers. Publishing that key opens
// exactly this revision, without exposing the keys for earlier drafts.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Address, type Hex, hexToBytes, isAddress, keccak256, toHex } from "viem";
import {
  type Attachment,
  type Draft,
  parseContent,
  PREVIEW_BYTES,
  type ProposalContent,
  publicReference,
  type SwarmStorage,
  validateDraft,
} from "./swarm.ts";

export const ZERO_KEY = `0x${"00".repeat(32)}` as Hex;
const encoder = new TextEncoder();
const bytes = (data: Uint8Array) => new Uint8Array(data).buffer;
export type ReviewContext = {
  chainId: number;
  pool: Address;
  proposer: Address;
  organizerPublicKey: string;
};
export type PrivateDescriptor = ReviewContext & {
  version: 2;
  kind: "ranked-shares/private-proposal";
  proposerPublicKey: string;
  keyHash: Hex;
  payload: { reference: string; iv: Hex };
  access: { encryptedReference: string; historyReference: string; publisherPubKey: string };
};
export type ReviewedContent = ProposalContent & { review?: PrivateDescriptor };
export type PrivateStorage =
  & SwarmStorage
  & Pick<import("@snaha/swarm-id").SwarmIdClient, "actUploadData" | "actDownloadData">;

export function sharingKey(storage: Pick<SwarmStorage, "connectionInfo">): string {
  return publicKey(
    storage.connectionInfo.identity?.sharingPublicKey ?? storage.connectionInfo.appKey?.publicKey,
  );
}

export function publicKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Connect Swarm ID to access your proposal sharing key.");
  }
  const hex = value.replace(/^0x/, "").toLowerCase();
  if (!/^(02|03)[0-9a-f]{64}$/.test(hex)) throw new Error("Invalid proposal sharing public key.");
  try {
    secp256k1.Point.fromHex(hex).assertValidity();
  } catch {
    throw new Error("Invalid proposal sharing public key.");
  }
  return hex;
}

function hexValue(value: unknown, length: number): Hex {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${length * 2}}$`).test(value)) {
    throw new Error("Invalid encrypted proposal metadata.");
  }
  return value.toLowerCase() as Hex;
}

function actReference(value: unknown, field: "encrypted reference" | "history reference"): string {
  const reference = typeof value === "string" ? value.replace(/^0x/, "").toLowerCase() : "";
  if (!/^(?:[0-9a-f]{64}|[0-9a-f]{128})$/.test(reference) || /^0+$/.test(reference)) {
    throw new Error(`Invalid ACT ${field}.`);
  }
  return reference;
}

export function parsePrivateDescriptor(data: Uint8Array): PrivateDescriptor | undefined {
  if (data.byteLength > PREVIEW_BYTES) {
    throw new Error("This proposal is too large to preview. Download its content to review it.");
  }
  const d = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  if (d?.version === 1) return undefined;
  if (
    d?.version !== 2 || d.kind !== "ranked-shares/private-proposal" ||
    !Number.isSafeInteger(d.chainId) || d.chainId <= 0 || !isAddress(d.pool) ||
    !isAddress(d.proposer)
  ) throw new Error("Invalid private proposal descriptor.");
  const encryptedReference = actReference(d.access?.encryptedReference, "encrypted reference");
  const keyHash = hexValue(d.keyHash, 32);
  if (keyHash === ZERO_KEY) throw new Error("Missing proposal key commitment.");
  return {
    version: 2,
    kind: d.kind,
    chainId: d.chainId,
    pool: d.pool,
    proposer: d.proposer,
    organizerPublicKey: publicKey(d.organizerPublicKey),
    proposerPublicKey: publicKey(d.proposerPublicKey),
    keyHash,
    payload: {
      reference: publicReference(d.payload?.reference).slice(2),
      iv: hexValue(d.payload?.iv, 12),
    },
    access: {
      encryptedReference,
      // SDK 0.4.0 encrypts the history manifest by default (128 hex characters).
      // Its key opens ACT metadata, not the proposal key wrapped for the reviewers.
      historyReference: actReference(d.access?.historyReference, "history reference"),
      publisherPubKey: publicKey(d.access?.publisherPubKey),
    },
  };
}

function contextBytes(context: ReviewContext): Uint8Array {
  return encoder.encode(
    `RankedShares/proposal/v2:${context.chainId}:${context.pool.toLowerCase()}:${context.proposer.toLowerCase()}`,
  );
}

export function assertReviewContext(d: PrivateDescriptor, context: ReviewContext, keyHash?: Hex) {
  if (
    d.chainId !== context.chainId || d.pool.toLowerCase() !== context.pool.toLowerCase() ||
    d.proposer.toLowerCase() !== context.proposer.toLowerCase() ||
    d.organizerPublicKey !== publicKey(context.organizerPublicKey) ||
    (keyHash && d.keyHash !== keyHash.toLowerCase())
  ) {
    throw new Error("This encrypted proposal does not match the round or its recorded revision.");
  }
  if (![d.proposerPublicKey, d.organizerPublicKey].includes(d.access.publisherPubKey)) {
    throw new Error("The proposal publisher is not one of its reviewers.");
  }
}

export async function encryptBytes(data: Uint8Array, aad: Uint8Array) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = await crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bytes(iv), additionalData: bytes(aad) },
      secret,
      bytes(data),
    ),
  );
  return { key: toHex(key), iv: toHex(iv), ciphertext };
}

export async function decryptBytes(data: Uint8Array, key: Hex, iv: Hex, aad: Uint8Array) {
  const secret = await crypto.subtle.importKey(
    "raw",
    bytes(hexToBytes(hexValue(key, 32))),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes(hexToBytes(hexValue(iv, 12))), additionalData: bytes(aad) },
        secret,
        bytes(data),
      ),
    );
  } catch {
    throw new Error("The encrypted content could not be verified or decrypted.");
  }
}

const attachmentContext = encoder.encode("RankedShares/proposal-attachment/v1");
export async function downloadAttachment(
  storage: Pick<SwarmStorage, "downloadFile">,
  file: Attachment,
) {
  const result = await storage.downloadFile(file.reference);
  if (!file.encryption) return result.data;
  const data = await decryptBytes(
    result.data,
    file.encryption.key,
    file.encryption.iv,
    attachmentContext,
  );
  if (data.byteLength !== file.size) {
    throw new Error("The attachment size does not match the proposal.");
  }
  return data;
}

export async function uploadPrivateProposal(
  storage: PrivateStorage,
  draft: Draft,
  context: ReviewContext,
  progress: (text: string) => void,
  previous?: PrivateDescriptor,
) {
  validateDraft(draft);
  if (!storage.connectionInfo.identity || !storage.connectionInfo.canUpload) {
    throw new Error("Connect Swarm ID with available storage before uploading.");
  }
  const publisher = sharingKey(storage);
  const organizerPublicKey = publicKey(context.organizerPublicKey);
  if (previous) assertReviewContext(previous, context);
  const proposerPublicKey = previous?.proposerPublicKey ?? publisher;
  if (![proposerPublicKey, organizerPublicKey].includes(publisher)) {
    throw new Error("Reconnect the Swarm ID used by the proposer or organizer for this review.");
  }
  const attachments: Attachment[] = [];
  // Existing private attachments keep their independent keys inside the new
  // encrypted document. Removing one keeps it out of the published revision.
  for (const file of draft.attachments ?? []) {
    if (!file.encryption) {
      throw new Error(
        "A public attachment cannot be made private by reusing its reference. Attach the original file again.",
      );
    }
    attachments.push(file);
  }
  for (const [i, file] of draft.files.entries()) {
    progress(`Encrypting file ${i + 1} of ${draft.files.length}…`);
    const sealed = await encryptBytes(new Uint8Array(await file.arrayBuffer()), attachmentContext);
    const encryptedFile = new File([bytes(sealed.ciphertext)], "attachment.enc", {
      type: "application/octet-stream",
    });
    const result = await storage.uploadFile(encryptedFile, encryptedFile.name, {
      encrypt: false,
      encryptManifest: false,
    });
    attachments.push({
      reference: publicReference(result.reference).slice(2),
      name: file.name,
      type: file.type,
      size: file.size,
      encryption: { key: sealed.key, iv: sealed.iv },
    });
  }
  const content: ProposalContent = {
    version: 1,
    title: draft.title,
    body: draft.body,
    attachments,
  };
  progress("Encrypting proposal for private review…");
  const sealed = await encryptBytes(encoder.encode(JSON.stringify(content)), contextBytes(context));
  const result = await storage.uploadData(sealed.ciphertext, { encrypt: false });
  // The only upload containing the document's key goes through ACT.
  const access = await storage.actUploadData(hexToBytes(sealed.key), [
    ...new Set([proposerPublicKey, organizerPublicKey]),
  ], { publisher: storage.connectionInfo.identity.sharingPublicKey ? "identity" : "app" });
  if (publicKey(access.publisherPubKey) !== publisher) {
    throw new Error("Swarm ID changed during upload. Reconnect and try again.");
  }
  const descriptor: PrivateDescriptor = {
    ...context,
    version: 2,
    kind: "ranked-shares/private-proposal",
    organizerPublicKey,
    proposerPublicKey,
    keyHash: keccak256(sealed.key),
    payload: { reference: publicReference(result.reference).slice(2), iv: sealed.iv },
    access: {
      encryptedReference: access.encryptedReference,
      historyReference: access.historyReference,
      publisherPubKey: access.publisherPubKey,
    },
  };
  // Preserve the complete ACT references, including the history manifest key.
  // They cannot reveal the ACT-protected document key without a reviewer's key.
  const encoded = encoder.encode(JSON.stringify(descriptor));
  parsePrivateDescriptor(encoded);
  const stored = await storage.uploadData(encoded, { encrypt: false });
  return { reference: publicReference(stored.reference), keyHash: descriptor.keyHash };
}

export async function reviewKey(
  storage: Pick<PrivateStorage, "actDownloadData">,
  descriptor: PrivateDescriptor,
): Promise<Hex> {
  const { encryptedReference, historyReference, publisherPubKey } = descriptor.access;
  let raw: Uint8Array;
  try {
    raw = await storage.actDownloadData(encryptedReference, historyReference, publisherPubKey);
  } catch {
    throw new Error(
      "This proposal is private. Connect the proposer’s or organizer’s Swarm ID to read it.",
    );
  }
  if (raw.length !== 32 || keccak256(raw) !== descriptor.keyHash) {
    throw new Error("The review key does not match this proposal revision.");
  }
  return toHex(raw);
}

export async function decryptProposal(
  storage: Pick<SwarmStorage, "downloadData">,
  descriptor: PrivateDescriptor,
  key: Hex,
  preview = true,
) {
  if (key === ZERO_KEY || keccak256(hexValue(key, 32)) !== descriptor.keyHash) {
    throw new Error("This proposal has not been published for voting.");
  }
  const encrypted = await storage.downloadData(descriptor.payload.reference);
  if (preview && encrypted.length > PREVIEW_BYTES + 16) {
    throw new Error("This proposal is too large to preview. Download its content to review it.");
  }
  return decryptBytes(encrypted, key, descriptor.payload.iv, contextBytes(descriptor));
}

export async function readProposal(
  storage: Pick<PrivateStorage, "downloadData" | "actDownloadData">,
  reference: Hex,
  options: {
    context?: ReviewContext;
    keyHash?: Hex;
    publishedKey?: Hex;
    publicOnly?: boolean;
    preview?: boolean;
  } = {},
): Promise<{ data: Uint8Array; descriptor?: PrivateDescriptor }> {
  const data = await storage.downloadData(publicReference(reference).slice(2));
  if (
    options.preview === false && data.byteLength > PREVIEW_BYTES &&
    (!options.keyHash || options.keyHash === ZERO_KEY)
  ) return { data };
  const descriptor = parsePrivateDescriptor(data);
  if (!descriptor) {
    if (options.keyHash && options.keyHash !== ZERO_KEY) {
      throw new Error("Expected encrypted proposal content.");
    }
    return { data };
  }
  if (options.context) assertReviewContext(descriptor, options.context, options.keyHash);
  if (options.keyHash && descriptor.keyHash !== options.keyHash) {
    throw new Error("The proposal key commitment changed.");
  }
  let key = options.publishedKey;
  if (!key || key === ZERO_KEY) {
    if (options.publicOnly) throw new Error("This proposal is private until voting opens.");
    key = await reviewKey(storage, descriptor);
  }
  return { data: await decryptProposal(storage, descriptor, key, options.preview), descriptor };
}

export async function readProposalContent(
  storage: Pick<PrivateStorage, "downloadData" | "actDownloadData">,
  reference: Hex,
  options: Parameters<typeof readProposal>[2] = {},
): Promise<ReviewedContent> {
  const { data, descriptor } = await readProposal(storage, reference, options);
  const content = parseContent(data);
  return descriptor ? { ...content, review: descriptor } : content;
}
