import type { Address, Hex, PublicClient } from "viem";
import { privacyAbi, proposalAbi } from "./proposals";
import {
  assertReviewContext,
  decryptProposal,
  parsePrivateDescriptor,
  type PrivateStorage,
  publicKey,
  reviewKey,
  sharingKey,
} from "./private-proposals";

/** Read and decrypt locally. No decryption keys are sent to an RPC here. */
export async function prepareProposalPublication(
  client: PublicClient,
  storage: PrivateStorage,
  pool: Address,
  progress: (message: string) => void,
) {
  const block = await client.getBlock();
  const at = { address: pool, abi: proposalAbi, blockNumber: block.number } as const;
  const [privacy, votingOpen, deadline, chainId] = await Promise.all([
    client.readContract({ ...at, functionName: "proposalPrivacy" }),
    client.readContract({ ...at, functionName: "votingOpen" }),
    client.readContract({ ...at, functionName: "votingDeadline" }),
    client.getChainId(),
  ]);
  if (votingOpen || block.timestamp >= deadline) {
    throw new Error("Voting can no longer be opened for this round.");
  }
  const meta = { address: privacy, abi: privacyAbi, blockNumber: block.number } as const;
  const [organizerPublicKey, ids] = await Promise.all([
    client.readContract({ ...meta, functionName: "organizerPublicKey" }),
    client.readContract({ ...meta, functionName: "acceptedProposals" }),
  ]);
  if (ids.length > 255) throw new Error("Invalid accepted proposal count.");
  if (ids.length && sharingKey(storage) !== publicKey(organizerPublicKey)) {
    throw new Error("Connect the organizer’s registered Swarm ID before opening voting.");
  }
  const keys: Hex[] = [];
  for (const [index, id] of ids.entries()) {
    progress(`Checking accepted proposal ${index + 1} of ${ids.length}…`);
    const [proposal, keyHash] = await Promise.all([
      client.readContract({ ...at, functionName: "proposals", args: [id] }),
      client.readContract({ ...meta, functionName: "keyCommitment", args: [id] }),
    ]);
    if (proposal[4] !== 1) {
      throw new Error("The accepted proposal list changed. Prepare voting again.");
    }
    const descriptor = parsePrivateDescriptor(await storage.downloadData(proposal[1].slice(2)));
    if (!descriptor) throw new Error("An accepted proposal is missing its encrypted descriptor.");
    assertReviewContext(
      descriptor,
      { chainId, pool, proposer: proposal[0], organizerPublicKey },
      keyHash,
    );
    const key = await reviewKey(storage, descriptor);
    await decryptProposal(storage, descriptor, key, false);
    keys.push(key);
  }
  return { ids: [...ids], keys };
}
