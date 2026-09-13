import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useRound } from "../context/providers";
import { fetchProject, fetchRound, fetchVoter } from "../lib/api";

export const POLL_MS = 15_000;

/** The API caps itself at two reads per request, so a snapshot can still be behind
 * the block we asked for; poll faster until it catches up. */
export const CATCH_UP_MS = 2_000;
export const behind = (block: number | undefined, after: number | undefined) =>
  after !== undefined && block !== undefined && block < after;

export function useRoundSnapshot() {
  const { pool, after } = useRound();
  return useQuery({
    queryKey: ["round", pool ?? "", after ?? 0],
    queryFn: () => fetchRound(pool, after),
    enabled: !!pool,
    refetchInterval: (query) => (behind(query.state.data?.block, after) ? CATCH_UP_MS : POLL_MS),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === pool ? prev : undefined),
  });
}

export function useProject(id: number) {
  const { pool, after } = useRound();
  return useQuery({
    queryKey: ["project", pool ?? "", id, after ?? 0],
    queryFn: () => fetchProject(id, pool, after),
    enabled: !!pool && Number.isInteger(id) && id >= 0,
    refetchInterval: POLL_MS,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === pool && prevQuery?.queryKey[2] === id ? prev : undefined),
  });
}

export function useVoter() {
  const { pool, after } = useRound();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["voter", pool ?? "", address ?? "", after ?? 0],
    queryFn: () => fetchVoter(address as string, pool, after),
    enabled: !!pool && !!address,
    refetchInterval: POLL_MS,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === pool && prevQuery?.queryKey[2] === address ? prev : undefined),
  });
}
