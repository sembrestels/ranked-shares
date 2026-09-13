// @vitest-environment node
import { expect, test, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { toHex, type Address } from "viem";
import { publicSwarmStorage } from "../app/lib/public-swarm";
import { downloadAttachment, readProposalContent, uploadPrivateProposal, parsePrivateDescriptor, reviewKey, ZERO_KEY } from "../app/lib/private-proposals";
import { mockSwarm } from "./fixtures/swarm";

test("public text and file downloads work without Swarm ID and only accept public references", async () => {
  const reference = "ab".repeat(32);
  const content = { version: 1, title: "Community proposal", body: "Our plan", attachments: [] };
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(content))
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 3])));
  const reader = publicSwarmStorage("https://gateway.test/", fetchFn);
  expect(await readProposalContent(reader, `0x${reference}`)).toEqual(content);
  expect(await downloadAttachment(reader, { reference, name: "data.bin", type: "application/octet-stream", size: 3 }))
    .toEqual(new Uint8Array([0, 255, 3]));
  expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
    `https://gateway.test/bytes/${reference}`, `https://gateway.test/bzz/${reference}/`,
  ]);
  await expect(reader.downloadData(reference + reference)).rejects.toThrow("64-character");
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("public readers cannot open private reviews but can read their published revisions and attachments", async () => {
  const key = toHex(secp256k1.getPublicKey(new Uint8Array(32).fill(1), true)).slice(2);
  const { storage, objects } = mockSwarm(key);
  const context = { chainId: 31337, pool: `0x${"ab".repeat(20)}` as Address,
    proposer: `0x${"cd".repeat(20)}` as Address, organizerPublicKey: key };
  const draft = { title: "Review privately", body: "Publish when ready", files: [new File(["private attachment"], "file.txt")] };
  const uploaded = await uploadPrivateProposal(storage, draft, context, vi.fn());
  const descriptor = parsePrivateDescriptor(objects.get(uploaded.reference.slice(2))!)!;
  const publishedKey = await reviewKey(storage, descriptor);
  const reader = publicSwarmStorage("https://gateway.test", vi.fn(async (url) => {
    const reference = new URL(String(url)).pathname.split("/")[2];
    return new Response(new Uint8Array(objects.get(reference)!));
  }));
  await expect(readProposalContent(reader, uploaded.reference, { context, keyHash: uploaded.keyHash, publishedKey: ZERO_KEY }))
    .rejects.toThrow("Connect the proposer’s or organizer’s Swarm ID");
  const published = await readProposalContent(reader, uploaded.reference, { context, keyHash: uploaded.keyHash, publishedKey });
  expect(published.body).toBe(draft.body);
  expect(new TextDecoder().decode(await downloadAttachment(reader, published.attachments[0]))).toBe("private attachment");
});

test("gateway failures leave a retryable content error", async () => {
  const reader = publicSwarmStorage("https://gateway.test", vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 })));
  await expect(reader.downloadData("ab".repeat(32))).rejects.toThrow("Swarm could not load this content (503)");
});
