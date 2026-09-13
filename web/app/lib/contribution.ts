import { type Address, erc20Abi, maxUint256, parseAbi, parseUnits, type PublicClient, type WalletClient } from "viem";
import { readVoting, votingBlockReason } from "./ballots";
import { assertWallet } from "./transactions";

export const contributionAbi = parseAbi([
  "function token() view returns (address)",
  "function contribute(uint256 amount)",
]);

export async function readContribution(client: PublicClient, pool: Address, account: Address) {
  const blockNumber = await client.getBlockNumber();
  const token = await client.readContract({ address: pool, abi: contributionAbi, functionName: "token", blockNumber });
  const at = { address: token, abi: erc20Abi, blockNumber } as const;
  const [decimals, symbol, balance, allowance] = await Promise.all([
    client.readContract({ ...at, functionName: "decimals" }),
    client.readContract({ ...at, functionName: "symbol" }),
    client.readContract({ ...at, functionName: "balanceOf", args: [account] }),
    client.readContract({ ...at, functionName: "allowance", args: [account, pool] }),
  ]);
  return { token, decimals, symbol, balance, allowance };
}

export function contributionAmount(text: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  }
  const amount = parseUnits(text, decimals);
  if (amount <= 0n || amount > maxUint256) throw new Error("Enter a positive token amount.");
  return amount;
}

/** Recheck eligibility and funds immediately before asking the wallet to sign. */
export async function sendContribution(
  client: PublicClient, wallet: WalletClient, pool: Address, account: Address,
  amount: bigint, action: "approve" | "contribute",
) {
  await assertWallet(client, wallet, account);
  const [round, token] = await Promise.all([readVoting(client, pool, account), readContribution(client, pool, account)]);
  const reason = votingBlockReason({ ...round, direct: round.direct + amount }, account, false);
  if (reason) throw new Error(reason);
  if (amount <= 0n || amount > token.balance) throw new Error(`Your wallet does not have enough ${token.symbol} for this contribution.`);
  if (action === "approve") {
    const { request } = await client.simulateContract({
      address: token.token, abi: erc20Abi, functionName: "approve", args: [pool, amount], account,
    });
    await assertWallet(client, wallet, account);
    return wallet.writeContract({ ...request, chain: wallet.chain });
  }
  if (token.allowance < amount) throw new Error("Approve this token amount before contributing.");
  const { request } = await client.simulateContract({
    address: pool, abi: contributionAbi, functionName: "contribute", args: [amount], account,
  });
  await assertWallet(client, wallet, account);
  return wallet.writeContract({ ...request, chain: wallet.chain });
}
