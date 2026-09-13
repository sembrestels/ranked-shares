// @vitest-environment node
import { expect, test, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { toHex, type PublicClient } from "viem";
import { parseImportPlan, uploadImport } from "../app/lib/proposal-import";
import { mockSwarm } from "./fixtures/swarm";

const key = toHex(secp256k1.getPublicKey(new Uint8Array(32).fill(2), true));
const owner = `0x${"12".repeat(20)}`, pool = `0x${"34".repeat(20)}`, token = `0x${"56".repeat(20)}`;
const plan = () => parseImportPlan(JSON.stringify({ version: 1, chainId: 5042002, rounds: [{ currency: "EURC", pool, token, organizer: owner, organizerSharingPublicKey: key,
  proposals: [{ source: "proposal.md", sha256: "ab".repeat(32), title: "A private proposal", body: "Only reviewers may read this", proposer: owner, recipient: owner, amount: "1.5", amountBaseUnits: "1500000" }],
}] }));
const rpc = (overrides: Record<string, unknown> = {}) => ({
  getChainId: async () => 5042002, getBlock: async () => ({ timestamp: 1n }),
  readContract: async ({ functionName }: { functionName: string }) => ({ owner, token, votingOpen: false, votingDeadline: 1000n, proposalPrivacy: pool, organizerPublicKey: key, ...overrides })[functionName],
} as unknown as PublicClient);

test("rejects changed amounts and duplicate sources before upload", () => {
  const input = plan(); input.rounds[0].proposals[0].amountBaseUnits = "100";
  expect(() => parseImportPlan(JSON.stringify(input))).toThrow("invalid or duplicated");
  const duplicate = plan(); duplicate.rounds[0].proposals.push(duplicate.rounds[0].proposals[0]);
  expect(() => parseImportPlan(JSON.stringify(duplicate))).toThrow("invalid or duplicated");
});
test("checks organizer, review phase and sharing key before any storage write", async () => {
  for (const mismatch of [{ owner: token }, { votingOpen: true }, { organizerPublicKey: "0x" }]) {
    const { storage } = mockSwarm(key.slice(2));
    await expect(uploadImport(plan(), rpc(mismatch), storage, vi.fn(), vi.fn())).rejects.toThrow();
    expect(storage.uploadData).not.toHaveBeenCalled();
  }
});
test("saves encrypted references and resumes after interrupted verification without reuploading", async () => {
  const { storage } = mockSwarm(key.slice(2));
  const input = plan(), checkpoint = vi.fn();
  vi.mocked(storage.downloadData).mockRejectedValueOnce(new Error("Temporary network failure"));
  await expect(uploadImport(input, rpc(), storage, vi.fn(), checkpoint)).rejects.toThrow("Temporary network failure");
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(input.rounds[0].proposals[0].privateReference).toMatch(/^0x[\da-f]{64}$/);
  const before = vi.mocked(storage.uploadData).mock.calls.length;
  await uploadImport(input, rpc(), storage, vi.fn(), checkpoint);
  expect(storage.uploadData).toHaveBeenCalledTimes(before);
  expect(storage.actDownloadData).toHaveBeenCalled();
});
