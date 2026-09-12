import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { type BallotReviewData, readBallotReview } from "../lib/ballot-review";

export function useBallotReview(
  client: PublicClient | undefined,
  chainId: number,
  pool: Address | undefined,
  enabled: boolean,
) {
  const cache = useQueryClient();
  const queryKey = ["arkiv-ballot-review", chainId, pool];
  return useQuery({
    queryKey,
    enabled: enabled && !!client && !!pool,
    queryFn: () => readBallotReview(
      client!, pool!, cache.getQueryData<BallotReviewData>(queryKey)?.rows,
    ),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
    staleTime: 0,
    // No persisted ballot archive. Expired rows are replaced without payloads;
    // leaving the page also drops its cached review payloads.
    gcTime: 0,
  });
}
