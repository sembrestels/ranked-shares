import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { proposalAbi } from "./proposals";

export async function assertWallet(
  publicClient: PublicClient,
  wallet: WalletClient,
  account: Address,
) {
  const [addresses, actualChain, expectedChain] = await Promise.all([
    wallet.getAddresses(),
    wallet.getChainId(),
    publicClient.getChainId(),
  ]);
  if (addresses[0]?.toLowerCase() !== account.toLowerCase()) {
    throw new Error(
      "Your wallet account changed. Reconnect before continuing.",
    );
  }
  if (actualChain !== expectedChain) {
    throw new Error(
      "Switch your wallet to the round's network before continuing.",
    );
  }
}

export async function sendProposalTransaction(
  publicClient: PublicClient,
  wallet: WalletClient,
  account: Address,
  pool: Address,
  action: { functionName: "propose"; args: readonly [Hex, bigint, Address] } | {
    functionName: "acceptProposal" | "rejectProposal";
    args: readonly [bigint, bigint];
  } | {
    functionName: "editProposal";
    args: readonly [bigint, bigint, Hex, bigint, Address];
  },
) {
  await assertWallet(publicClient, wallet, account);
  const base = { address: pool, abi: proposalAbi, account };
  if (action.functionName === "propose") {
    const { request } = await publicClient.simulateContract({
      ...base,
      functionName: action.functionName,
      args: action.args,
    });
    return wallet.writeContract({ ...request, chain: wallet.chain });
  }
  if (action.functionName === "editProposal") {
    const { request } = await publicClient.simulateContract({
      ...base,
      functionName: action.functionName,
      args: action.args,
    });
    return wallet.writeContract({ ...request, chain: wallet.chain });
  }
  const { request } = await publicClient.simulateContract({
    ...base,
    functionName: action.functionName,
    args: action.args,
  });
  return wallet.writeContract({ ...request, chain: wallet.chain });
}
