import type { SwarmIdClient } from "@snaha/swarm-id";
import type { Hex } from "viem";

// See docs/decisions/2026-09-12-store-proposal-content-in-swarm-through-the-api-and-bind-its-reference-on-chain.md,
// the 2026-09-12 implementation update: Swarm ID replaces API-managed postage.
export type SwarmStorage = Pick<
  SwarmIdClient,
  | "connectionInfo"
  | "uploadData"
  | "uploadFile"
  | "downloadData"
  | "downloadFile"
>;
export type Attachment = {
  reference: string;
  name: string;
  type: string;
  size: number;
  /** Kept inside the encrypted proposal until the accepted revision is published. */
  encryption?: { key: Hex; iv: Hex };
};
export type ProposalContent = {
  version: 1;
  title: string;
  body: string;
  attachments: Attachment[];
};
export type Draft = {
  title: string;
  body: string;
  files: File[];
  /** Previously uploaded files kept in this revision, without uploading again. */
  attachments?: Attachment[];
};
// These bound automatic previews, not what a proposer can store on Swarm.
export const PREVIEW_BYTES = 1_000_000;
const PREVIEW_ATTACHMENTS = 100;

/** The SDK's iframe load can stall before its internal handshake timeouts are
 * awaited. Bound the entire initialization so users always get a retry action. */
export async function initializeSwarm(
  client: Pick<SwarmIdClient, "initialize">,
  timeoutMs = 30_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.initialize(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The Swarm ID service did not respond. Check your connection and retry.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function publicReference(value: string): Hex {
  const ref = value.replace(/^0x/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(ref) || /^0+$/.test(ref)) {
    throw new Error(
      "Expected a public 64-character Swarm reference. Encrypted references cannot be stored as bytes32.",
    );
  }
  return `0x${ref.toLowerCase()}`;
}

export function validateDraft(draft: Draft) {
  if (!draft.title.trim()) throw new Error("Give your proposal a title.");
  if (!draft.body.trim() && !draft.files.length && !draft.attachments?.length) {
    throw new Error("Add proposal text or at least one file.");
  }
}

/** No MIME or content allowlist: arbitrary bytes are uploaded unchanged. */
export async function uploadProposal(
  storage: SwarmStorage,
  draft: Draft,
  progress: (text: string) => void,
): Promise<Hex> {
  validateDraft(draft);
  if (!storage.connectionInfo.identity || !storage.connectionInfo.canUpload) {
    throw new Error(
      "Connect Swarm ID with available storage before uploading.",
    );
  }
  const attachments: Attachment[] = (draft.attachments || []).map(
    parseAttachment,
  );
  if (attachments.some((file) => file.encryption)) {
    throw new Error("Use the private proposal uploader to keep attachment keys encrypted.");
  }
  for (const [i, file] of draft.files.entries()) {
    progress(`Uploading file ${i + 1} of ${draft.files.length}: ${file.name}`);
    const result = await storage.uploadFile(file, file.name, {
      encrypt: false,
      encryptManifest: false,
      onProgress: ({ processed, total }) =>
        progress(
          `Uploading ${file.name}: ${
            total ? Math.floor(processed / total * 100) : 0
          }%`,
        ),
    });
    attachments.push({
      reference: publicReference(result.reference).slice(2),
      name: file.name,
      type: file.type,
      size: file.size,
    });
  }
  progress("Saving proposal text to Swarm…");
  const content: ProposalContent = {
    version: 1,
    title: draft.title,
    body: draft.body,
    attachments,
  };
  const result = await storage.uploadData(
    new TextEncoder().encode(JSON.stringify(content)),
    { encrypt: false },
  );
  return publicReference(result.reference);
}

export function parseContent(data: Uint8Array): ProposalContent {
  if (data.byteLength > PREVIEW_BYTES) {
    throw new Error(
      "This proposal is too large to preview. Download its content to review it.",
    );
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(data),
  );
  if (
    !value || value.version !== 1 || typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > PREVIEW_ATTACHMENTS
  ) {
    throw new Error(
      "This content cannot be previewed as a proposal. You can still download it.",
    );
  }
  const attachments: Attachment[] = value.attachments.map(parseAttachment);
  return { version: 1, title: value.title, body: value.body, attachments };
}

function parseAttachment(file: Record<string, unknown>): Attachment {
  if (
    !file || typeof file.reference !== "string" ||
    typeof file.name !== "string" || typeof file.type !== "string" ||
    !Number.isSafeInteger(file.size) || Number(file.size) < 0
  ) throw new Error("Invalid attachment metadata.");
  const encryption = file.encryption as { key?: unknown; iv?: unknown } | undefined;
  if (
    encryption !== undefined &&
    (!encryption || typeof encryption.key !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(encryption.key) || typeof encryption.iv !== "string" ||
      !/^0x[0-9a-f]{24}$/i.test(encryption.iv))
  ) throw new Error("Invalid encrypted attachment metadata.");
  return {
    reference: publicReference(file.reference).slice(2),
    name: file.name,
    type: file.type,
    size: Number(file.size),
    ...(encryption ? { encryption: encryption as Attachment["encryption"] } : {}),
  };
}

export async function readContent(storage: SwarmStorage, reference: Hex) {
  return parseContent(
    await storage.downloadData(publicReference(reference).slice(2)),
  );
}

/** Force a download; never navigate to or embed untrusted HTML/SVG in our origin. */
export function saveDownload(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/[\/\\\u0000-\u001f]/g, "_") || "proposal";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
