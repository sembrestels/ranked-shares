import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { erc20Abi } from "viem";
import { chain, useRound } from "../context/providers";
import { type Proposal, proposalAbi } from "../lib/proposals";

export const PAGE_SIZE = 12n;
export function usePool(page = 0) {
  const { pool } = useRound();
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({
    queryKey: ["pool", client?.chain?.id, pool, page],
    enabled: !!pool && !!client,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client || !pool) throw new Error("Choose a pool first.");
      const block = await client.getBlock();
      const at = {
        address: pool,
        abi: proposalAbi,
        blockNumber: block.number,
      } as const;
      const [owner, token, votingOpen, deadline, count] = await Promise.all([
        client.readContract({ ...at, functionName: "owner" }),
        client.readContract({ ...at, functionName: "token" }),
        client.readContract({ ...at, functionName: "votingOpen" }),
        client.readContract({ ...at, functionName: "votingDeadline" }),
        client.readContract({ ...at, functionName: "proposalCount" }),
      ]);
      const [decimals, symbol] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "symbol",
        }).catch(() => "tokens"),
      ]);
      const start = BigInt(page) * PAGE_SIZE;
      const length = count > start
        ? Number(count - start > PAGE_SIZE ? PAGE_SIZE : count - start)
        : 0;
      const proposals = await Promise.all(
        Array.from({ length }, async (_, i): Promise<Proposal> => {
          const id = start + BigInt(i);
          const [proposer, contentRef, cost, recipient, status, projectId] =
            await client.readContract({
              ...at,
              functionName: "proposals",
              args: [id],
            });
          const [revision, editor] = await Promise.all([
            client.readContract({
              ...at,
              functionName: "proposalRevision",
              args: [id],
            }),
            client.readContract({
              ...at,
              functionName: "proposalEditor",
              args: [id],
            }),
          ]);
          return {
            id,
            proposer,
            contentRef,
            cost,
            recipient,
            status,
            projectId,
            revision,
            editor,
          };
        }),
      );
      return {
        owner,
        token,
        votingOpen,
        deadline,
        count,
        decimals,
        symbol,
        proposals,
        canSubmit: !votingOpen && block.timestamp < deadline,
      };
    },
  });
}
