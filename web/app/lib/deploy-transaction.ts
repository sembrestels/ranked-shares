import type { Address, Chain, Hex, PublicClient, WalletClient } from "viem";
import { assertWallet } from "./transactions";

/** Validate against the intended chain before estimation and again before signing. */
export async function sendDeployment(client: PublicClient, wallet: WalletClient, account: Address, chain: Chain,
  data: Hex, value: bigint, onSigning: () => void, to?: Address) {
  if (await client.getChainId() !== chain.id) throw new Error("The RPC is on a different network. Check the app’s RPC configuration.");
  await assertWallet(client, wallet, account);
  const gas = await client.estimateGas({ account, data, value, to });
  await assertWallet(client, wallet, account);
  onSigning();
  return wallet.sendTransaction({ account, chain, data, value, to, gas: gas + gas / 5n });
}
