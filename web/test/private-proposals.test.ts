// @vitest-environment node
import { expect, test, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Address, type Hex, toHex } from "viem";
import { mockSwarm } from "./fixtures/swarm";
import {
  downloadAttachment,
  parsePrivateDescriptor,
  publicKey,
  readProposalContent,
  reviewKey,
  uploadPrivateProposal,
  ZERO_KEY,
} from "../app/lib/private-proposals";

const pk = (n: number) => toHex(secp256k1.getPublicKey(new Uint8Array(32).fill(n), true)).slice(2);
const proposerKey = pk(1), organizerKey = pk(2), strangerKey = pk(3);
const context = {
  chainId: 31337,
  pool: `0x${"ab".repeat(20)}` as Address,
  proposer: `0x${"cd".repeat(20)}` as Address,
  organizerPublicKey: organizerKey,
};
const draft = { title: "Private title", body: "Confidential proposal body", files: [] as File[] };

test("private upload shares only with both reviewers and exposes no text or attachment keys in public objects", async () => {
  const { storage, objects, setIdentity } = mockSwarm(proposerKey);
  const file = new File([new Uint8Array([0, 255, 8, 123])], "secret-name.custom", {
    type: "application/x-custom",
  });
  const uploaded = await uploadPrivateProposal(
    storage,
    { ...draft, files: [file] },
    context,
    vi.fn(),
  );
  const descriptor = parsePrivateDescriptor(objects.get(uploaded.reference.slice(2))!)!;
  expect(uploaded.reference).toMatch(/^0x[0-9a-f]{64}$/);
  expect(descriptor.access.encryptedReference).toHaveLength(128);
  expect(descriptor.access.historyReference).toHaveLength(128);
  expect(descriptor.proposerPublicKey).toBe(proposerKey);
  expect(storage.actUploadData).toHaveBeenCalledWith(expect.any(Uint8Array), [
    proposerKey,
    organizerKey,
  ], { publisher: "identity" });
  const key = await reviewKey(storage, descriptor);
  expect(storage.actDownloadData).toHaveBeenLastCalledWith(
    descriptor.access.encryptedReference,
    descriptor.access.historyReference,
    descriptor.access.publisherPubKey,
  );
  for (const object of objects.values()) {
    const raw = new TextDecoder().decode(object);
    expect(raw).not.toContain(draft.title);
    expect(raw).not.toContain(draft.body);
    expect(raw).not.toContain(file.name);
    expect(raw).not.toContain(key);
  }
  const mine = await readProposalContent(storage, uploaded.reference, {
    context,
    keyHash: uploaded.keyHash,
  });
  expect(mine.body).toBe(draft.body);
  expect(await downloadAttachment(storage, mine.attachments[0])).toEqual(
    new Uint8Array([0, 255, 8, 123]),
  );
  setIdentity(organizerKey);
  expect((await readProposalContent(storage, uploaded.reference, { context })).title).toBe(
    draft.title,
  );
  setIdentity(strangerKey);
  await expect(readProposalContent(storage, uploaded.reference, { context })).rejects.toThrow(
    "private",
  );
  setIdentity("");
  await expect(
    readProposalContent(storage, uploaded.reference, { publishedKey: ZERO_KEY, publicOnly: true }),
  ).rejects.toThrow("private until voting");
  expect(
    (await readProposalContent(storage, uploaded.reference, {
      publishedKey: key,
      publicOnly: true,
    })).body,
  ).toBe(draft.body);
});

test("ACT metadata accepts full references without allowing encrypted on-chain or payload references", async () => {
  const { storage, objects } = mockSwarm(proposerKey);
  const uploaded = await uploadPrivateProposal(storage, draft, context, vi.fn());
  const descriptor = JSON.parse(
    new TextDecoder().decode(objects.get(uploaded.reference.slice(2))!),
  );
  const parse = (value: unknown) =>
    parsePrivateDescriptor(new TextEncoder().encode(JSON.stringify(value)));
  for (const length of [64, 128]) {
    const ref = "Ab".repeat(length / 2);
    const parsed = parse({
      ...descriptor,
      access: {
        ...descriptor.access,
        encryptedReference: `0x${ref}`,
        historyReference: `0x${ref}`,
      },
    })!;
    expect(parsed.access.encryptedReference).toBe(ref.toLowerCase());
    expect(parsed.access.historyReference).toBe(ref.toLowerCase());
  }
  for (
    const bad of [
      undefined,
      null,
      123,
      "",
      "ab".repeat(33),
      "ab".repeat(63),
      "ab".repeat(65),
      "zz".repeat(64),
    ]
  ) {
    expect(() => parse({ ...descriptor, access: { ...descriptor.access, historyReference: bad } }))
      .toThrow("Invalid ACT history reference");
    expect(() =>
      parse({ ...descriptor, access: { ...descriptor.access, encryptedReference: bad } })
    )
      .toThrow("Invalid ACT encrypted reference");
  }
  expect(() =>
    parse({
      ...descriptor,
      payload: { ...descriptor.payload, reference: "ab".repeat(64) },
    })
  ).toThrow("Expected a public 64-character");
  await expect(readProposalContent(storage, `0x${"ab".repeat(64)}`)).rejects.toThrow(
    "Expected a public 64-character",
  );
});

test("organizer edits preserve the proposer key; publishing the latest key cannot reveal an earlier draft", async () => {
  const { storage, setIdentity } = mockSwarm(proposerKey);
  const first = await uploadPrivateProposal(storage, draft, context, vi.fn());
  const content = await readProposalContent(storage, first.reference, { context });
  setIdentity(organizerKey);
  const second = await uploadPrivateProposal(
    storage,
    { ...draft, body: "Reviewed final text" },
    context,
    vi.fn(),
    content.review,
  );
  const final = await readProposalContent(storage, second.reference, { context });
  const key = await reviewKey(storage, final.review!);
  expect(final.review!.proposerPublicKey).toBe(proposerKey);
  expect(final.review!.access.publisherPubKey).toBe(organizerKey);
  expect(first.keyHash).not.toBe(second.keyHash);
  setIdentity(proposerKey);
  expect((await readProposalContent(storage, second.reference, { context })).body).toBe(
    "Reviewed final text",
  );
  setIdentity(strangerKey);
  expect(
    (await readProposalContent(storage, second.reference, { publishedKey: key, publicOnly: true }))
      .body,
  ).toBe("Reviewed final text");
  await expect(
    readProposalContent(storage, first.reference, { publishedKey: key, publicOnly: true }),
  ).rejects.toThrow("not been published");
});

test("context, key commitments, ciphertext, and reviewer identities are checked", async () => {
  const { storage, objects, setIdentity } = mockSwarm(proposerKey);
  const uploaded = await uploadPrivateProposal(storage, draft, context, vi.fn());
  const content = await readProposalContent(storage, uploaded.reference, { context });
  await expect(
    readProposalContent(storage, uploaded.reference, { context: { ...context, chainId: 1 } }),
  ).rejects.toThrow("does not match");
  await expect(
    readProposalContent(storage, uploaded.reference, { context, keyHash: `0x${"ab".repeat(32)}` }),
  ).rejects.toThrow("does not match");
  setIdentity(strangerKey);
  await expect(uploadPrivateProposal(storage, draft, context, vi.fn(), content.review)).rejects
    .toThrow("Reconnect");
  setIdentity(proposerKey);
  objects.get(content.review!.payload.reference)![0] ^= 1;
  await expect(readProposalContent(storage, uploaded.reference, { context })).rejects.toThrow(
    "verified or decrypted",
  );
});

test("encrypted attachment reuse and removal do not disclose removed files", async () => {
  const { storage } = mockSwarm(proposerKey);
  const first = await uploadPrivateProposal(
    storage,
    {
      ...draft,
      files: [new File(["kept secret"], "a.txt"), new File(["removed secret"], "b.txt")],
    },
    context,
    vi.fn(),
  );
  const old = await readProposalContent(storage, first.reference, { context });
  const revised = await uploadPrivateProposal(
    storage,
    { ...draft, attachments: [old.attachments[0]] },
    context,
    vi.fn(),
    old.review,
  );
  expect(storage.uploadFile).toHaveBeenCalledTimes(2);
  const next = await readProposalContent(storage, revised.reference, { context });
  expect(next.attachments).toEqual([old.attachments[0]]);
  expect(JSON.stringify(next)).not.toContain(old.attachments[1].encryption!.key);
  await expect(
    uploadPrivateProposal(
      storage,
      { ...draft, attachments: [{ ...old.attachments[0], encryption: undefined }] },
      context,
      vi.fn(),
    ),
  ).rejects.toThrow("public attachment");
});

test("invalid sharing keys and plaintext masquerading as a private submission fail closed", async () => {
  expect(() => publicKey("0x" + "01".repeat(33))).toThrow("Invalid");
  expect(() => publicKey("02" + "ff".repeat(32))).toThrow("Invalid");
  const { storage } = mockSwarm(proposerKey);
  const stored = await storage.uploadData(
    new TextEncoder().encode(JSON.stringify({ version: 1, ...draft, attachments: [] })),
    { encrypt: false },
  );
  await expect(
    readProposalContent(storage, `0x${stored.reference}` as Hex, {
      keyHash: `0x${"ab".repeat(32)}`,
    }),
  ).rejects.toThrow("Expected encrypted");
});
