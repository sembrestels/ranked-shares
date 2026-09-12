import {
  type Address,
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  type Hex,
  keccak256,
  parseUnits,
  type PublicClient,
  type WalletClient,
  zeroAddress,
} from "viem";
import {
  lpAbi,
  lpPoolAbi,
  poolKeyStruct,
  positionManagerAbi,
} from "../../../cre/src/lib/lp-abi";
import { parseAbiParameters } from "viem";
import { assertWallet } from "./transactions";

export { lpAbi, lpPoolAbi, positionManagerAbi };
export const poolIdOf = (
  key: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  },
) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters([poolKeyStruct, "PoolKey key"]), [
      key,
    ]),
  );
export const sharePercent = (own: bigint, total: bigint) =>
  total === 0n ? "0%" : `${Number(own * 10_000n / total) / 100}%`;
export const money = (value: bigint, decimals: number) =>
  formatUnits(value, decimals);

export async function readLP(
  client: PublicClient,
  pool: Address,
  account?: Address,
  fromBlock = 0n,
  manualId?: bigint,
) {
  const block = await client.getBlock();
  const at = { blockNumber: block.number };
  const module = await client.readContract({
    ...at,
    address: pool,
    abi: lpPoolAbi,
    functionName: "lpVoting",
  });
  if (module === zeroAddress) {
    throw new Error("This round has no LP sponsorship module.");
  }
  const [manager, deadline, count, phase, token] = await Promise.all([
    client.readContract({
      ...at,
      address: module,
      abi: lpAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      ...at,
      address: module,
      abi: lpAbi,
      functionName: "deadline",
    }),
    client.readContract({
      ...at,
      address: module,
      abi: lpAbi,
      functionName: "sponsorshipCount",
    }),
    client.readContract({
      ...at,
      address: pool,
      abi: lpPoolAbi,
      functionName: "phase",
    }),
    client.readContract({
      ...at,
      address: pool,
      abi: lpPoolAbi,
      functionName: "token",
    }),
  ]);
  if (count > 8n) throw new Error("Unsupported number of LP sponsorships.");
  const [symbol, decimals] = await Promise.all([
    client.readContract({
      ...at,
      address: token,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    client.readContract({
      ...at,
      address: token,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  const campaigns = await Promise.all(
    Array.from({ length: Number(count) }, async (_, i) => {
      const id = BigInt(i);
      const [terms, positions, projection, allocated] = await Promise.all([
        client.readContract({
          ...at,
          address: module,
          abi: lpAbi,
          functionName: "sponsorship",
          args: [id],
        }),
        client.readContract({
          ...at,
          address: module,
          abi: lpAbi,
          functionName: "positions",
          args: [id],
        }),
        client.readContract({
          ...at,
          address: module,
          abi: lpAbi,
          functionName: "projection",
          args: [id, account ?? zeroAddress],
        }),
        client.readContract({
          ...at,
          address: module,
          abi: lpAbi,
          functionName: "allocatedWeight",
          args: [id, account ?? zeroAddress],
        }),
      ]);
      const [stableSymbol, stableDecimals] = await Promise.all([
        client.readContract({
          ...at,
          address: terms.stable,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        client.readContract({
          ...at,
          address: terms.stable,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      return {
        id,
        ...terms,
        positions,
        projection,
        allocated,
        stableSymbol,
        stableDecimals,
      };
    }),
  );
  const ids = new Set<bigint>(manualId === undefined ? [] : [manualId]);
  let discoveryNote: string | undefined;
  if (account) {
    if (fromBlock > block.number || block.number - fromBlock > 100_000n) {
      discoveryNote =
        "Automatic discovery needs the demo deployment block. Enter your position NFT ID below to load it directly.";
    } else {
      // Receive logs suffice to find candidates; ownerOf at the same block filters
      // transfers away and burns. Chunking works with Arc RPC log-range limits.
      for (let start = fromBlock; start <= block.number; start += 2_000n) {
        const end = start + 1_999n > block.number
          ? block.number
          : start + 1_999n;
        const logs = await client.getLogs({
          address: manager,
          events: positionManagerAbi.filter((a) => a.type === "event"),
          fromBlock: start,
          toBlock: end,
          strict: true,
        });
        for (const log of logs) {
          if (log.args.to?.toLowerCase() === account.toLowerCase()) {
            ids.add(log.args.tokenId);
          }
        }
      }
    }
    for (const c of campaigns) {
      for (
        const p of c.positions
      ) {
        if (p.owner.toLowerCase() === account.toLowerCase()) {
          ids.add(p.tokenId);
        }
      }
    }
  }
  if (ids.size > 256) {
    throw new Error("Too many position candidates. Load one NFT ID directly.");
  }
  const positions = account
    ? (await Promise.all([...ids].map(async (id) => {
      let owner: Address;
      try {
        owner = await client.readContract({
          ...at,
          address: manager,
          abi: positionManagerAbi,
          functionName: "ownerOf",
          args: [id],
        });
      } catch (error) {
        // Burned NFTs revert ownerOf. Connectivity failures must remain visible.
        if (
          error instanceof Error && error.message.includes("revert")
        ) return null;
        throw error;
      }
      if (owner.toLowerCase() !== account.toLowerCase()) return null;
      const [[key, info], liquidity, subscriber] = await Promise.all([
        client.readContract({
          ...at,
          address: manager,
          abi: positionManagerAbi,
          functionName: "getPoolAndPositionInfo",
          args: [id],
        }),
        client.readContract({
          ...at,
          address: manager,
          abi: positionManagerAbi,
          functionName: "getPositionLiquidity",
          args: [id],
        }),
        client.readContract({
          ...at,
          address: manager,
          abi: positionManagerAbi,
          functionName: "subscriber",
          args: [id],
        }),
      ]);
      const campaign = campaigns.find((c) => c.poolId === poolIdOf(key));
      const value = campaign
        ? await client.readContract({
          ...at,
          address: module,
          abi: lpAbi,
          functionName: "positionValue",
          args: [campaign.id, id],
        })
        : 0n;
      const belowMinimum = !!campaign && value < campaign.minimumValue;
      const reason = phase !== 1
        ? "Voting has closed"
        : !campaign
        ? "No sponsorship for this pool"
        : liquidity === 0n
        ? "No liquidity in this position"
        : subscriber === module
        ? "Accruing voting weight"
        : subscriber !== zeroAddress
        ? "Subscribed to another application"
        : belowMinimum
        ? `Below the ${
          money(campaign.minimumValue, campaign.stableDecimals)
        } ${campaign.stableSymbol} registration minimum`
        : "Ready to register";
      return {
        id,
        key,
        info,
        liquidity,
        subscriber,
        campaignId: campaign?.id,
        reason,
        canClaim: phase === 1 && !!campaign && !belowMinimum &&
          liquidity > 0n && subscriber === zeroAddress,
        canStop: phase === 1 && subscriber === module,
      };
    }))).filter((p) => p !== null)
    : [];
  return {
    module,
    manager,
    deadline,
    phase,
    campaigns,
    positions,
    token,
    symbol,
    decimals,
    timestamp: block.timestamp,
    discoveryNote,
  };
}
export type LPData = Awaited<ReturnType<typeof readLP>>;

export async function sendLPAction(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  target: Address,
  action: { type: "claim"; tokenId: bigint; module: Address; id: bigint } | {
    type: "stop";
    tokenId: bigint;
  } | { type: "finalize"; id: bigint },
) {
  await assertWallet(client, wallet, account);
  const call = action.type === "claim"
    ? {
      abi: positionManagerAbi,
      functionName: "subscribe",
      args: [
        action.tokenId,
        action.module,
        encodeAbiParameters([{ type: "uint256" }], [action.id]),
      ],
    }
    : action.type === "stop"
    ? {
      abi: positionManagerAbi,
      functionName: "unsubscribe",
      args: [action.tokenId],
    }
    : { abi: lpAbi, functionName: "finalizeLP", args: [action.id, 25n] };
  const { request } = await client.simulateContract(
    { address: target, account, ...call } as never,
  );
  return wallet.writeContract({ ...request, chain: wallet.chain } as never);
}

export async function sponsorshipArgs(
  client: PublicClient,
  data: LPData,
  tokenId: bigint,
  stable: Address,
  budgetText: string,
  minimumText: string,
) {
  const [key] = await client.readContract({
    address: data.manager,
    abi: positionManagerAbi,
    functionName: "getPoolAndPositionInfo",
    args: [tokenId],
  });
  if (
    stable.toLowerCase() !== key.currency0.toLowerCase() &&
    stable.toLowerCase() !== key.currency1.toLowerCase()
  ) {
    throw new Error(
      "The valuation token must be one of this position's two currencies.",
    );
  }
  if (data.campaigns.some((c) => c.poolId === poolIdOf(key))) {
    throw new Error(
      "This Uniswap pool already has a sponsorship in the round.",
    );
  }
  const decimals = await client.readContract({
    address: stable,
    abi: erc20Abi,
    functionName: "decimals",
  });
  const amount = parseUnits(budgetText, data.decimals);
  const minimum = parseUnits(minimumText, decimals);
  if (amount <= 0n || minimum <= 0n) {
    throw new Error("Budget and minimum position value must be positive.");
  }
  return [amount, key, stable, minimum] as const;
}
