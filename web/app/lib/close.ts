import { type Address, parseAbi, type PublicClient, type WalletClient } from "viem";
import { assertWallet } from "./transactions";

export const closeAbi = parseAbi(["function close(uint256 maxVoters)"]);
export const CLOSE_CHUNK = BigInt((import.meta.env.VITE_CLOSE_CHUNK as string | undefined) || "100");

/** One close(maxVoters) transaction; anyone may send it after the deadline. */
export async function sendClose(publicClient: PublicClient, wallet: WalletClient, pool: Address, maxVoters = CLOSE_CHUNK) {
  const account = wallet.account;
  if (!account) throw new Error("Connect a wallet to close the roster.");
  await assertWallet(publicClient, wallet, account.address);
  const hash = await wallet.writeContract({ address: pool, abi: closeAbi, functionName: "close", args: [maxVoters], account, chain: wallet.chain });
  return publicClient.waitForTransactionReceipt({ hash });
}
