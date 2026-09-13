import { isAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { privacyAbi, proposalAbi } from "./proposals";
import { readProposalContent, sharingKey, uploadPrivateProposal, type PrivateStorage } from "./private-proposals";

export type ImportRow = {
  source: string; sha256: string; title: string; body: string; amount: string;
  amountBaseUnits: string; proposer: Address; recipient: Address;
  privateReference?: Hex; keyHash?: Hex;
};
export type ImportRound = { currency: string; token: Address; pool: Address; organizer: Address; organizerSharingPublicKey: string; proposals: ImportRow[] };
export type ImportPlan = { version: 1; chainId: number; rounds: ImportRound[] };
export function parseImportPlan(text: string): ImportPlan {
  const plan = JSON.parse(text);
  if (plan?.version !== 1 || !Number.isSafeInteger(plan.chainId) || plan.chainId <= 0 || !Array.isArray(plan.rounds) || !plan.rounds.length || plan.rounds.length > 8) throw new Error("Choose a valid proposal import plan.");
  const sources = new Set<string>(), pools = new Set<string>();
  let count = 0;
  for (const round of plan.rounds) {
    if (!isAddress(round.pool ?? "") || !isAddress(round.token ?? "") || !isAddress(round.organizer ?? "") || !Array.isArray(round.proposals) || !round.proposals.length || typeof round.currency !== "string") throw new Error("The import plan needs deployed pools and their organizers.");
    if (pools.has(round.pool.toLowerCase())) throw new Error("A pool appears twice in the import plan.");
    pools.add(round.pool.toLowerCase());
    for (const row of round.proposals) {
      if (++count > 100 || typeof row.source !== "string" || sources.has(row.source) || !/^[\da-f]{64}$/.test(row.sha256 ?? "") || !isAddress(row.proposer ?? "") || !isAddress(row.recipient ?? "") || typeof row.title !== "string" || !row.title.trim() || typeof row.body !== "string" || !row.body.trim() || !/^\d+(\.\d{1,6})?$/.test(row.amount ?? "") || !/^\d+$/.test(row.amountBaseUnits ?? "") || parseUnits(row.amount, 6) !== BigInt(row.amountBaseUnits) || BigInt(row.amountBaseUnits) <= 0n) throw new Error("An import row has invalid or duplicated proposal data.");
      if (!!row.privateReference !== !!row.keyHash || (row.privateReference && (!/^0x[\da-f]{64}$/i.test(row.privateReference) || !/^0x[\da-f]{64}$/i.test(row.keyHash) || /^0x0+$/.test(row.keyHash)))) throw new Error("An uploaded proposal has invalid references.");
      sources.add(row.source);
    }
  }
  return plan;
}

export async function uploadImport(plan: ImportPlan, client: PublicClient, storage: PrivateStorage,
  progress: (message: string) => void, checkpoint: (plan: ImportPlan) => void) {
  if (await client.getChainId() !== plan.chainId) throw new Error("The import plan targets a different network.");
  const reviewer = sharingKey(storage);
  // Check all targets before uploading any content.
  for (const round of plan.rounds) {
    const read = (functionName: "owner" | "token" | "votingOpen" | "votingDeadline" | "proposalPrivacy") => client.readContract({ address: round.pool, abi: proposalAbi, functionName });
    const [owner, token, open, deadline, privacy, block] = await Promise.all([read("owner"), read("token"), read("votingOpen"), read("votingDeadline"), read("proposalPrivacy"), client.getBlock()]);
    if (String(owner).toLowerCase() !== round.organizer.toLowerCase() || String(token).toLowerCase() !== round.token.toLowerCase() || open || BigInt(deadline) <= block.timestamp) throw new Error(`${round.currency} pool is not ready for proposal review.`);
    const key = await client.readContract({ address: privacy as Address, abi: privacyAbi, functionName: "organizerPublicKey" });
    if (key.slice(2).toLowerCase() !== reviewer || (round.organizerSharingPublicKey && round.organizerSharingPublicKey.toLowerCase() !== key.toLowerCase())) throw new Error(`Register this Swarm ID sharing key in the ${round.currency} pool before importing.`);
    round.organizerSharingPublicKey = key;
  }
  let done = 0;
  const total = plan.rounds.reduce((n, r) => n + r.proposals.length, 0);
  for (const round of plan.rounds) for (const row of round.proposals) {
    const context = { chainId: plan.chainId, pool: round.pool, proposer: row.proposer, organizerPublicKey: round.organizerSharingPublicKey };
    progress(`${done + 1}/${total} · ${row.title}`);
    if (!row.privateReference) {
      const saved = await uploadPrivateProposal(storage, { title: row.title, body: row.body, files: [] }, context,
        message => progress(`${done + 1}/${total} · ${row.title}: ${message}`));
      row.privateReference = saved.reference; row.keyHash = saved.keyHash;
      checkpoint(plan); // Retain the upload before trying a download or the next file.
    }
    const downloaded = await readProposalContent(storage, row.privateReference, { context, keyHash: row.keyHash });
    if (downloaded.title !== row.title || downloaded.body !== row.body || downloaded.attachments.length !== 0) throw new Error(`Downloaded content does not match ${row.title}.`);
    checkpoint(plan);
    done++;
  }
  progress(`${total} encrypted proposals uploaded and verified. Download the receipts for submission.`);
}
