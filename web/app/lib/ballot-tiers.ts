export const FUNDING_TIERS = [
  { id: "must", label: "Must fund" },
  { id: "should", label: "Should fund" },
  { id: "nice", label: "Nice to have" },
] as const;

export type FundingTier = (typeof FUNDING_TIERS)[number]["id"];
export type TierAssignments = Readonly<Partial<Record<number, FundingTier>>>;

/** Encode tied tiers in project order using the existing competition ranks. */
export function tierRanks(
  projectIds: readonly number[],
  assignments: TierAssignments,
): number[] {
  const ranks = new Map<FundingTier, number>();
  let nextRank = 1;
  for (const { id } of FUNDING_TIERS) {
    ranks.set(id, nextRank);
    nextRank += projectIds.filter((projectId) => assignments[projectId] === id).length;
  }
  return projectIds.map((id) => {
    const tier = assignments[id];
    return tier === undefined ? 0 : ranks.get(tier)!;
  });
}
