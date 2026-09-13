import { expect, test } from "vitest";
import { fundingCoverage, fundingTreemap, proposalFunding } from "../app/lib/funding";
import { abandonedSnapshot, arkivSnapshot, openSnapshot, paidSnapshot, provenSnapshot, provingNoirSnapshot } from "./fixtures/snapshots";

test("public commitments are support, never an allocation, even when the request is covered", () => {
  const rows = proposalFunding({ ...openSnapshot, projects: [{ ...openSnapshot.projects[0], commitment: "9000000000" }] });
  expect(rows[0]).toMatchObject({ asking: 4_000_000_000n, support: 9_000_000_000n, receiving: null, fill: "support", coverage: 100 });
});

test("Arkiv uses browser results by project ID and ignores chain commitment placeholders", () => {
  const snapshot = { ...arkivSnapshot, projects: [{ ...arkivSnapshot.projects[0], id: 7 }, { ...arkivSnapshot.projects[1], id: 12 }] };
  const rows = proposalFunding(snapshot, { commitments: ["100000000", "200000000"], funded: [12], block: 123 });
  expect(rows[0]).toMatchObject({ support: 100_000_000n, receiving: 0n, status: "Not currently funded" });
  expect(rows[1]).toMatchObject({ support: 200_000_000n, receiving: 2_500_000_000n, coverage: 100, status: "Projected funding" });
});

test("missing public results and unavailable Noir commitments are unknown, not zero", () => {
  for (const snapshot of [arkivSnapshot, provingNoirSnapshot]) {
    expect(proposalFunding(snapshot)[0]).toMatchObject({ support: null, receiving: null, fill: "empty" });
  }
});

test("final allocation overrides old public projections and only claimed awards are paid", () => {
  const oldProjection = { commitments: ["0", "9000000000"], funded: [1], block: 100 };
  expect(proposalFunding(provenSnapshot, oldProjection).map((r) => [r.receiving, r.status])).toEqual([
    [4_000_000_000n, "Awaiting payment"], [0n, "Not funded"],
  ]);
  expect(proposalFunding(paidSnapshot)[0].status).toBe("Paid");
  expect(proposalFunding({ ...abandonedSnapshot, projects: provenSnapshot.projects }, oldProjection)
    .every((r) => r.receiving === 0n && r.coverage === 0 && r.status === "Round abandoned")).toBe(true);
});

test("coverage is bounded and precise for token amounts beyond safe numeric integers", () => {
  expect(fundingCoverage(10n ** 50n, 4n * 10n ** 50n)).toBe(25);
  expect(fundingCoverage(0n, 0n)).toBe(0);
  expect(fundingCoverage(99n, 0n)).toBe(0);
  expect(fundingCoverage(20n, 10n)).toBe(100);
});

test("treemap conserves cost proportions, fills the wall, and has no overlapping cells", () => {
  const costs = [30n, 25n, 20n, 15n, 12n, 8n].map((cost) => cost * 10n ** 30n);
  const total = costs.reduce((a, b) => a + b, 0n);
  const tiles = fundingTreemap(costs.map((cost, id) => ({ id, cost: String(cost) })));
  expect(tiles).toHaveLength(6);
  for (const tile of tiles) {
    expect(tile.width * tile.height / 10_000).toBeCloseTo(Number(costs[tile.id] * 1_000_000n / total) / 1_000_000, 5);
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
    expect(tile.x + tile.width).toBeLessThanOrEqual(100.000001);
    expect(tile.y + tile.height).toBeLessThanOrEqual(100.000001);
    for (const other of tiles.filter((t) => t.id !== tile.id)) {
      const overlapWidth = Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
      const overlapHeight = Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
      expect(overlapWidth <= 0.000001 || overlapHeight <= 0.000001).toBe(true);
    }
  }
  expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBeCloseTo(10_000);
});

test("empty and zero-cost maps are safe and equal costs have a stable ID order", () => {
  expect(fundingTreemap([])).toEqual([]);
  expect(fundingTreemap([{ id: 0, cost: "0" }])).toEqual([]);
  expect(fundingTreemap([{ id: 9, cost: "8" }, { id: 0, cost: "0" }])).toEqual([{ id: 9, x: 0, y: 0, width: 100, height: 100 }]);
  expect(fundingTreemap([{ id: 7, cost: "2" }, { id: 1, cost: "2" }]).map((t) => t.id)).toEqual([1, 7]);
});
