// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import {
  initializeSwarm,
  parseContent,
  PREVIEW_BYTES,
  publicReference,
  type SwarmStorage,
  uploadProposal,
} from "../app/lib/swarm";
import { proposalTerms } from "../app/lib/proposals";

const ref = "ab".repeat(32);
function storage() {
  return {
    connectionInfo: { identity: { name: "Pau" }, canUpload: true },
    uploadFile: vi.fn().mockResolvedValue({ reference: "cd".repeat(32) }),
    uploadData: vi.fn().mockResolvedValue({ reference: ref }),
  } as unknown as SwarmStorage;
}

describe("Swarm proposal content", () => {
  test("an iframe that never loads times out so the user can retry", async () => {
    await expect(
      initializeSwarm({ initialize: () => new Promise(() => {}) }, 5),
    ).rejects.toThrow("did not respond");
    await expect(initializeSwarm({ initialize: async () => {} }, 5)).resolves
      .toBeUndefined();
  });
  test("preserves unrestricted text and arbitrary file bytes, and uploads a public manifest last", async () => {
    const client = storage();
    const file = new File([new Uint8Array([0, 255, 1])], "payload.custom", {
      type: "application/x-custom",
    });
    const body = '  <script>alert("hello")</script>\n# markdown\n你好  ';
    const progress = vi.fn();
    const result = await uploadProposal(client, {
      title: " Any idea ",
      body,
      files: [file as globalThis.File],
    }, progress);
    expect(result).toBe(`0x${ref}`);
    expect(client.uploadFile).toHaveBeenCalledWith(
      file,
      file.name,
      expect.objectContaining({ encrypt: false, encryptManifest: false }),
    );
    expect(vi.mocked(client.uploadFile).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(client.uploadData).mock.invocationCallOrder[0]);
    const content = parseContent(vi.mocked(client.uploadData).mock.calls[0][0]);
    expect(content).toEqual({
      version: 1,
      title: " Any idea ",
      body,
      attachments: [{
        reference: "cd".repeat(32),
        name: "payload.custom",
        type: file.type,
        size: 3,
      }],
    });
    expect(client.uploadData).toHaveBeenCalledWith(expect.any(Uint8Array), {
      encrypt: false,
    });
    expect(progress).toHaveBeenCalled();
  });

  test("accepts attachment-only proposals", async () => {
    await expect(
      uploadProposal(storage(), {
        title: "Pitch",
        body: "",
        files: [new File([""], "empty.bin") as globalThis.File],
      }, vi.fn()),
    ).resolves.toBe(`0x${ref}`);
  });

  test("revisions retain existing attachments and upload only newly added files", async () => {
    const client = storage();
    const kept = {
      reference: "12".repeat(32),
      name: "keep.pdf",
      type: "application/pdf",
      size: 7,
    };
    const file = new File(["new content"], "new.custom");
    await uploadProposal(client, {
      title: "Revised",
      body: "",
      files: [file],
      attachments: [kept],
    }, vi.fn());
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).toHaveBeenCalledWith(
      file,
      file.name,
      expect.anything(),
    );
    const content = parseContent(vi.mocked(client.uploadData).mock.calls[0][0]);
    expect(content.attachments).toEqual([
      kept,
      expect.objectContaining({ name: "new.custom" }),
    ]);
    expect(kept.reference).toBe("12".repeat(32));
    // An attachment-only revision can keep old files without uploading them again.
    await uploadProposal(client, {
      title: "Keep only",
      body: "",
      files: [],
      attachments: [kept],
    }, vi.fn());
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(
      parseContent(vi.mocked(client.uploadData).mock.calls[1][0]).attachments,
    ).toEqual([kept]);
  });

  test.each([{}, { identity: { name: "Pau" }, canUpload: false }, {
    canUpload: true,
  }])("requires identity AND upload capability: %j", async (info) => {
    const client = storage();
    Object.defineProperty(client, "connectionInfo", { value: info });
    await expect(
      uploadProposal(
        client,
        { title: "Pitch", body: "body", files: [] },
        vi.fn(),
      ),
    ).rejects.toThrow("Connect Swarm ID");
    expect(client.uploadData).not.toHaveBeenCalled();
  });

  test("file upload failure does not publish a partial proposal manifest", async () => {
    const client = storage();
    vi.mocked(client.uploadFile).mockRejectedValue(
      new Error("Storage unavailable"),
    );
    await expect(
      uploadProposal(client, {
        title: "Pitch",
        body: "",
        files: [new File(["content"], "file") as globalThis.File],
      }, vi.fn()),
    ).rejects.toThrow("Storage unavailable");
    expect(client.uploadData).not.toHaveBeenCalled();
  });

  test("validates reference length without truncating encrypted addresses", () => {
    expect(publicReference(ref.toUpperCase())).toBe(`0x${ref}`);
    for (
      const bad of [
        "",
        "00".repeat(32),
        "ab".repeat(64),
        "http://example.test",
        "ab".repeat(31),
      ]
    ) expect(() => publicReference(bad)).toThrow();
  });

  test("handles unavailable, malformed and large previews without trusting attachment URLs", () => {
    for (
      const value of [null, { version: 2 }, {
        version: 1,
        title: "x",
        body: "x",
        attachments: [null],
      }, {
        version: 1,
        title: "x",
        body: "x",
        attachments: [{
          name: "x",
          reference: "javascript:alert(1)",
          type: "text/html",
          size: 1,
        }],
      }]
    ) {
      expect(() =>
        parseContent(new TextEncoder().encode(JSON.stringify(value)))
      ).toThrow();
    }
    expect(() => parseContent(new Uint8Array(PREVIEW_BYTES + 1))).toThrow(
      "too large",
    );
  });
});

test("amount validation is exact and never rounds the requested token amount", () => {
  const recipient = `0x${"12".repeat(20)}`;
  expect(proposalTerms("1.234567", recipient, 6).cost).toBe(1234567n);
  for (const value of ["0", "-1", "1e4", "1.2345678", "NaN"]) {
    expect(() => proposalTerms(value, recipient, 6)).toThrow();
  }
  expect(() => proposalTerms("1", `0x${"00".repeat(20)}`, 6)).toThrow(
    "recipient",
  );
});
