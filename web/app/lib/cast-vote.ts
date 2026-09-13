import { type Address, erc20Abi, hashDomain, type Hex, parseAbi, parseSignature, type PublicClient, recoverTypedDataAddress, type WalletClient, zeroHash } from "viem";
import { ballotAbi, ballotId } from "../../../cre/src/lib/arkiv";
import { ballotPayload, readVoting, votingBlockReason } from "./ballots";
import { readContribution } from "./contribution";
import { assertWallet } from "./transactions";

const KEY = "ranked-shares.cast.pending.v2";
export type PendingCast = { chainId: number; pool: Address; account: Address; amount: string; isSealed: boolean; payload: Hex; revision: string; id: Hex; approvalTx?: Hex; voteTx?: Hex };
export function readPendingCast(): PendingCast | undefined { const value = localStorage.getItem(KEY); return value ? JSON.parse(value) : undefined; }
export function savePendingCast(value?: PendingCast) { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); }
const permitAbi = parseAbi(["function nonces(address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)", "function version() view returns (string)"]);
const permitTypes = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] } as const;

/** Only request a permit if its domain exactly matches the token's on-chain domain. */
async function permitDomain(client: PublicClient, token: Address, account: Address, chainId: number) {
  try {
    const [name, separator, nonce, version] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address: token, abi: permitAbi, functionName: "DOMAIN_SEPARATOR" }),
      client.readContract({ address: token, abi: permitAbi, functionName: "nonces", args: [account] }),
      client.readContract({ address: token, abi: permitAbi, functionName: "version" }).catch(() => undefined),
    ]);
    for (const v of [...new Set([version, "1", "2"].filter((v): v is string => !!v))]) {
      const domain = { name, version: v, chainId: BigInt(chainId), verifyingContract: token };
      if (hashDomain({ domain, types: { EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ] } }) === separator) return { domain, nonce };
    }
  } catch { /* A plain ERC20 needs an approval transaction. */ }
}

export async function prepareVote(client: PublicClient, pool: Address, account: Address, amount: bigint, sealed: boolean, ranks: number[]): Promise<PendingCast> {
  const [round, version, chainId] = await Promise.all([
    readVoting(client, pool, account),
    client.readContract({ address: pool, abi: ballotAbi, functionName: "ballotFlowVersion" }), client.getChainId(),
  ]);
  if (version !== 2n) throw new Error("Deploy a new pool to use contribution and voting in one transaction.");
  if (amount < 0n || (sealed && amount !== 0n)) throw new Error("Encrypted seats do not require a contribution.");
  const reason = votingBlockReason({ ...round, direct: round.direct + amount }, account, sealed);
  if (reason) throw new Error(reason);
  const payload = await ballotPayload(client, pool, account, round.kind, sealed, ranks);
  const revision = ((sealed ? round.sealedRef : round.publicRef)!.revision + 1n).toString();
  return { chainId, pool, account, amount: amount.toString(), isSealed: sealed, payload, revision, id: ballotId(BigInt(chainId), pool, account, sealed, BigInt(revision), payload) };
}

export async function castVote(client: PublicClient, wallet: WalletClient, draft: PendingCast, progress: (message: string) => void = () => {}) {
  await assertWallet(client, wallet, draft.account);
  if (await client.getChainId() !== draft.chainId) throw new Error("This vote belongs to a different network.");
  const wait = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return receipt.status === "success";
  };
  if (!draft.voteTx) {
    const amount = BigInt(draft.amount);
    const fresh = await readVoting(client, draft.pool, draft.account);
    const reason = votingBlockReason({ ...fresh, direct: fresh.direct + amount }, draft.account, draft.isSealed);
    if (reason) throw new Error(reason);
    if (((draft.isSealed ? fresh.sealedRef : fresh.publicRef)!.revision + 1n).toString() !== draft.revision) throw new Error("Your ballot changed. Discard this unsent draft and rank again.");
    savePendingCast(draft);
    let permit: { deadline: bigint; v: number; r: Hex; s: Hex } = { deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
    if (draft.approvalTx) {
      progress("Checking token approval…");
      const approved = await wait(draft.approvalTx);
      delete draft.approvalTx; savePendingCast(draft);
      if (!approved) throw new Error("Token approval reverted. Your contribution was not sent.");
    }
    if (amount > 0n) {
      const funds = await readContribution(client, draft.pool, draft.account);
      if (amount > funds.balance) throw new Error(`Not enough ${funds.symbol} for this contribution.`);
      if (funds.allowance < amount) {
        const supported = await permitDomain(client, funds.token, draft.account, draft.chainId);
        if (supported) {
          progress(`Sign permission to use ${funds.symbol}. This signature does not send a transaction.`);
          const deadline = fresh.deadline < fresh.timestamp + 1200n ? fresh.deadline : fresh.timestamp + 1200n;
          const typed = { domain: supported.domain, types: permitTypes, primaryType: "Permit" as const,
            message: { owner: draft.account, spender: draft.pool, value: amount, nonce: supported.nonce, deadline } };
          await assertWallet(client, wallet, draft.account);
          const signature = await wallet.signTypedData({ ...typed, account: draft.account });
          if ((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase() !== draft.account.toLowerCase()) throw new Error("The token permit was not signed by the connected account.");
          const { r, s, v, yParity } = parseSignature(signature);
          permit = { deadline, r, s, v: Number(v ?? BigInt(yParity! + 27)) };
        } else {
          progress(`Approve ${funds.symbol} in your wallet. The contribution and vote follow together.`);
          await assertWallet(client, wallet, draft.account);
          const { request } = await client.simulateContract({ address: funds.token, abi: erc20Abi, functionName: "approve", args: [draft.pool, amount], account: draft.account });
          await assertWallet(client, wallet, draft.account);
          draft.approvalTx = await wallet.writeContract({ ...request, chain: wallet.chain }); savePendingCast(draft);
          const approved = await wait(draft.approvalTx);
          delete draft.approvalTx; savePendingCast(draft);
          if (!approved) throw new Error("Token approval reverted. Your contribution was not sent.");
        }
      }
    }
    progress(amount ? "Confirm your contribution and vote in one transaction." : "Confirm your vote in your wallet.");
    await assertWallet(client, wallet, draft.account);
    const { request } = await client.simulateContract({ address: draft.pool, abi: ballotAbi, functionName: "castBallot",
      args: [amount, draft.isSealed, draft.payload, BigInt(draft.revision) - 1n, permit], account: draft.account });
    await assertWallet(client, wallet, draft.account);
    draft.voteTx = await wallet.writeContract({ ...request, chain: wallet.chain }); savePendingCast(draft);
  }
  progress("Waiting for your vote to be confirmed…");
  if (!await wait(draft.voteTx)) {
    delete draft.voteTx; savePendingCast(draft);
    throw new Error("The vote reverted. The contribution was rolled back too. You can retry this draft.");
  }
  const receipt = await client.getTransactionReceipt({ hash: draft.voteTx });
  const { decodeEventLog } = await import("viem");
  const accepted = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== draft.pool.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: ballotAbi, eventName: "BallotPublished", data: log.data, topics: log.topics });
      return event.args.ballotId === draft.id && event.args.voter.toLowerCase() === draft.account.toLowerCase();
    } catch { return false; }
  });
  if (!accepted) throw new Error("The transaction did not record this ballot. Check your wallet activity before retrying.");
  savePendingCast();
  return draft;
}
