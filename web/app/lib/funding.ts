import type { RoundSnapshot, SnapshotProject } from "./api-types";

export interface PublicFunding {
  commitments: string[];
  funded: number[];
  block: number;
}

export interface ProposalFunding {
  project: SnapshotProject;
  asking: bigint;
  support: bigint | null;
  receiving: bigint | null;
  status: string;
  fill: "allocated" | "support" | "empty";
  coverage: number;
}

/** Convert only a bounded ratio to a number, preserving bigint token amounts. */
export function fundingCoverage(amount: bigint, cost: bigint): number {
  if (cost <= 0n || amount <= 0n) return 0;
  if (amount >= cost) return 100;
  return Number(amount * 10_000n / cost) / 100;
}

export function proposalFunding(snapshot: RoundSnapshot, live?: PublicFunding): ProposalFunding[] {
  const final = snapshot.finality !== null;
  const projected = snapshot.ballots === "arkiv" && !!live && !final;
  return snapshot.projects.map((project, index) => {
    const asking = BigInt(project.cost);
    const support = final ? null : snapshot.ballots === "arkiv"
      ? live?.commitments[index] === undefined ? null : BigInt(live.commitments[index])
      : snapshot.sealed.commitmentsAvailable ? BigInt(project.commitment) : null;
    const funded = final
      ? snapshot.finality !== "abandoned" && project.funded
      : projected && live.funded.includes(project.id);
    const receiving = final || projected ? funded ? asking : 0n : null;
    const status = final
      ? snapshot.finality === "abandoned" ? "Round abandoned"
        : funded ? project.claimed ? "Paid" : "Awaiting payment" : "Not funded"
      : projected ? funded ? "Projected funding" : "Not currently funded" : "Outcome pending";
    return {
      project, asking, support, receiving, status,
      fill: funded ? "allocated" : support !== null && support > 0n ? "support" : "empty",
      coverage: funded ? 100 : fundingCoverage(support ?? 0n, asking),
    };
  });
}

export interface FundingTile {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Balanced binary treemap. Areas encode cost, independently of live support.
 * Zero-cost proposals remain in the amount list and take no space on the map. */
export function fundingTreemap(projects: readonly { id: number; cost: string }[]): FundingTile[] {
  const entries = projects.map((p) => ({ id: p.id, cost: BigInt(p.cost) }))
    .filter((p) => p.cost > 0n)
    .sort((a, b) => a.cost > b.cost ? -1 : a.cost < b.cost ? 1 : a.id - b.id);
  const tiles: FundingTile[] = [];
  const split = (items: typeof entries, x: number, y: number, width: number, height: number) => {
    if (items.length === 0) return;
    if (items.length === 1) {
      tiles.push({ id: items[0].id, x, y, width, height });
      return;
    }
    const total = items.reduce((sum, p) => sum + p.cost, 0n);
    let left = items[0].cost;
    let at = 1;
    const distance = (n: bigint) => n < 0n ? -n : n;
    while (at < items.length - 1 && distance(2n * (left + items[at].cost) - total) < distance(2n * left - total)) {
      left += items[at++].cost;
    }
    const ratio = Number(left * 1_000_000_000_000n / total) / 1_000_000_000_000;
    // The display is roughly twice as wide as it is tall.
    if (width * 2 >= height) {
      split(items.slice(0, at), x, y, width * ratio, height);
      split(items.slice(at), x + width * ratio, y, width * (1 - ratio), height);
    } else {
      split(items.slice(0, at), x, y, width, height * ratio);
      split(items.slice(at), x, y + height * ratio, width, height * (1 - ratio));
    }
  };
  split(entries, 0, 0, 100, 100);
  return tiles;
}
