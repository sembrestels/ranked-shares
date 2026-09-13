import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { hexToBytes } from "viem";
import { readArkivVoters } from "../../../prover/src/core/arkiv";
import { pbearTranscript } from "../../../shared/pbear";
import { chain } from "../context/providers";
import type { RoundSnapshot } from "../lib/api-types";
import { loadPayloads } from "../lib/arkiv";
import { commitmentsFromEntries } from "../lib/live";

export interface ArkivPublic {
  commitments: string[];
  funded: number[];
  ballots: number;
  block: number;
}

/** For Arkiv-mode pools: public commitments and the provisional funded set,
 * computed in the browser from every accepted public ballot at the snapshot's
 * block (decision of 2026-09-13). Disabled for chain-mode pools and once the
 * pool is done, where the outcome comes from the chain. */
export function useArkivPublic(snapshot: RoundSnapshot | undefined) {
  const client = usePublicClient({ chainId: chain.id });
  const pool = snapshot?.pool;
  const enabled = !!client && !!pool && !!snapshot && snapshot.ballots === "arkiv" && snapshot.phase !== "done";
  return useQuery({
    queryKey: ["arkiv-public", pool ?? "", snapshot?.block ?? 0],
    enabled,
    // keepPreviousData ignores the key: on a pool switch it would carry the old
    // pool's commitments onto the new one's board until its own read resolves.
    // Keep the previous data only when the previous query was for this pool.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === pool ? prev : undefined),
    queryFn: async (): Promise<ArkivPublic> => {
      const s = snapshot!;
      const voters = await readArkivVoters(client!, pool!, {
        blockNumber: BigInt(s.block),
        publicOnly: true,
        load: loadPayloads,
      });
      const pub = voters
        .filter((v) => v.publicRef.revision > 0n)
        .map((v) => ({ weight: v.directWeight, ballot: [...hexToBytes(v.publicBallot)] }));
      const m = s.projects.length;
      const commitments = commitmentsFromEntries(pub, m).map(String);
      const { funded } = pbearTranscript(s.projects.map((p) => BigInt(p.cost)), pub, [], BigInt(s.totalWeight));
      return { commitments, funded, ballots: pub.length, block: s.block };
    },
  });
}
