import { useQueries } from "@tanstack/react-query";
import type { RoundSnapshot } from "../lib/api-types";
import { readProposalContent, ZERO_KEY } from "../lib/private-proposals";
import { publicSwarmStorage } from "../lib/public-swarm";

const storage = publicSwarmStorage();

/** The API can have funding facts even when its Swarm gateway cannot read titles.
 * Resolve missing public titles independently, caching by round and exact revision.
 * Public reads never need a wallet or access to private review keys. */
export function useProposalTitles(snapshot: RoundSnapshot | undefined) {
  const projects = snapshot?.projects ?? [];
  const missing = projects.map((p) => !p.title?.trim() && p.contentRef !== ZERO_KEY);
  const queries = useQueries({
    queries: projects.map((p, index) => ({
      queryKey: ["public-proposal-title", snapshot!.chainId, snapshot!.pool, p.contentRef, p.contentKey ?? ZERO_KEY],
      enabled: missing[index],
      queryFn: async () => {
        const content = await readProposalContent(storage, p.contentRef, {
          publishedKey: p.contentKey,
          publicOnly: true,
        });
        const title = content.title.trim();
        if (!title) throw new Error("The proposal has no title in Swarm.");
        return title;
      },
      staleTime: Infinity,
      retry: 1,
    })),
  });
  return {
    snapshot: snapshot && {
      ...snapshot,
      projects: projects.map((p, index) => ({
        ...p,
        title: p.title?.trim() || queries[index].data || (missing[index]
          ? queries[index].isPending ? "Loading proposal title…" : `Proposal ${p.id + 1} · Title unavailable`
          : `Proposal ${p.id + 1}`),
      })),
    },
    loading: queries.some((q, index) => missing[index] && q.isPending),
    failed: queries.some((q, index) => missing[index] && q.isError),
    retry: () => Promise.all(queries.filter((q, index) => missing[index] && q.isError).map((q) => q.refetch())),
  };
}
