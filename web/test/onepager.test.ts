import { expect, test } from "vitest";
import { pbearTranscript } from "../../shared/pbear";
import {
  BLOCS,
  blocVoters,
  majorityOutcome,
  openingLevels,
  PROPOSALS,
  ranksFromTiers,
  SEAT,
  spendByCamp,
  tally,
  type Voter,
} from "../app/lib/onepager";

const costs = PROPOSALS.map((p) => p.cost);
const titles = (ids: number[]) => ids.map((id) => PROPOSALS[id].short);
const seat = (tiers: number[][] | null): Voter => ({
  id: "you",
  name: "Your ballot",
  weight: SEAT,
  ballot: tiers && ranksFromTiers(tiers),
});

test("the example is twenty seats and a pool smaller than the asks", () => {
  expect(BLOCS.reduce((sum, b) => sum + b.seats, 0)).toBe(20);
  expect(costs.reduce((a, b) => a + b, 0)).toBeGreaterThan(20 * SEAT);
});

test("a majority ranking hands the whole pool to the audit camp", () => {
  const funded = majorityOutcome(costs, blocVoters());
  expect(spendByCamp(funded)).toEqual({ audit: 100_000, wallet: 0, response: 0, research: 0 });
});

test("the proportional tally gives the audit camp its 55 percent", () => {
  const result = tally(costs, blocVoters());
  expect(titles(result.funded)).toEqual(["Fuzzing", "Retainer", "Blocklist", "Findings DB", "Simulation"]);
  expect(spendByCamp(result.funded)).toEqual({ audit: 55_000, wallet: 30_000, response: 10_000, research: 0 });
});

test("frames replay unchanged PB-EAR on the filtered election with original proposal ids", () => {
  const voters = blocVoters();
  const result = tally(costs, voters);
  const eligible = [0, 1, 2, 3, 4, 5, 7];
  // Tied tiers share a competition rank; the responders' and researchers' A-Tier moves up once their S-Tier pick is removed.
  const filteredBallots = [
    [1, 2, 2, 4, 0, 0, 0],
    [1, 4, 2, 2, 0, 0, 0],
    [0, 0, 0, 0, 1, 2, 2],
    [0, 0, 0, 0, 0, 1, 1],
    [0, 0, 1, 0, 0, 0, 1],
  ];
  const { funded, transcript } = pbearTranscript(
    eligible.map((id) => BigInt(costs[id])),
    voters.map((v, i) => ({ weight: BigInt(v.weight), ballot: filteredBallots[i] })),
    [],
    BigInt(result.budget),
  );
  expect(result.eligible).toEqual(eligible);
  expect(result.funded).toEqual(funded.map((id) => eligible[id]));
  expect(result.frames.filter((f) => f.funded !== null).map((f) => f.funded)).toEqual(result.funded);
  result.frames.forEach((frame, i) => {
    expect(eligible.map((id) => frame.support[id])).toEqual(transcript[i].slice(1, eligible.length + 1).map(Number));
    expect(frame.support[6]).toBe(0);
    expect(frame.support[8]).toBe(0);
  });
  for (const frame of result.frames) {
    const paid = frame.paid.reduce((a, b) => a + b, 0);
    expect(paid).toBe(frame.funded === null ? 0 : costs[frame.funded]);
  }
  const last = result.frames.at(-1)!;
  expect(last.left.reduce((a, b) => a + b, 0) + last.spent).toBe(result.budget);
  // The level widens at least once and the first purchase is split in proportion to weight.
  expect(result.frames.some((f) => f.funded === null)).toBe(true);
  expect(result.frames[0].paid.slice(0, 2)).toEqual([21_818, 18_182]);
});

test("eligibility counts initial explicit backing at any rank, including the exact ask", () => {
  const result = tally([40, 50, 60, 10], [
    { id: "a", name: "A", weight: 50, ballot: [1, 2, 3, 0] },
    { id: "b", name: "B", weight: 50, ballot: null },
  ]);
  expect(result.backing).toEqual([50, 50, 50, 0]);
  expect(result.eligible).toEqual([0, 1]);
  expect(result.funded).toEqual([0]);
  expect(result.contributions.every((payments) => payments[2] === 0 && payments[3] === 0)).toBe(true);
});

test("the initial filter does not become a spending veto or a repeated eligibility check", () => {
  const result = tally([40, 40, 20], [
    { id: "alice", name: "Alice", weight: 50, ballot: [1, 2, 0] },
    { id: "bob", name: "Bob", weight: 50, ballot: [0, 0, 1] },
  ]);
  expect(result.eligible).toEqual([0, 1, 2]);
  expect(result.funded).toEqual([2, 0, 1]);
  // Bob's remaining 30 can pay for an omitted but initially eligible project.
  expect(result.contributions).toEqual([[40, 10, 0], [0, 30, 20]]);
});

test("removing proposals closes rank gaps while preserving surviving ties", () => {
  const result = tally([100, 10, 10, 100, 10], [
    { id: "a", name: "A", weight: 30, ballot: [1, 2, 2, 4, 5] },
  ]);
  expect(result.eligible).toEqual([1, 2, 4]);
  expect(result.funded).toEqual([1, 2, 4]);
  expect(result.frames[0].support).toEqual([0, 30, 30, 0, 0]);
  expect(result.frames.filter((frame) => frame.funded !== null).map((frame) => frame.level)).toEqual([1, 1, 3]);
});

test("an emptied submitted ballot keeps its weight and is distinct from abstention", () => {
  const result = tally([60, 40], [
    { id: "a", name: "A", weight: 50, ballot: [1, 0] },
    { id: "b", name: "B", weight: 50, ballot: [0, 1] },
    { id: "c", name: "C", weight: 20, ballot: null },
  ]);
  expect(result.budget).toBe(120);
  expect(result.eligible).toEqual([1]);
  expect(result.frames[0].before).toEqual([50, 50, 20]);
  expect(result.contributions).toEqual([[0, 20], [0, 20], [0, 0]]);
});

test("a round with no eligible proposals retains the pool and spends nothing", () => {
  const result = tally([60, 10], [
    { id: "a", name: "A", weight: 50, ballot: [1, 0] },
    { id: "b", name: "B", weight: 50, ballot: null },
  ]);
  expect(result.budget).toBe(100);
  expect(result.eligible).toEqual([]);
  expect(result.funded).toEqual([]);
  expect(result.frames).toEqual([]);
  expect(result.contributions).toEqual([[0, 0], [0, 0]]);
});

test("tier opening levels follow the surviving proposals above each tier", () => {
  const eligible = tally(costs, blocVoters()).eligible;
  expect(openingLevels(BLOCS[0].tiers, eligible)).toEqual({ tiers: [1, 2, 4], rest: 5 });
  expect(openingLevels(BLOCS[3].tiers, eligible)).toEqual({ tiers: [null, 1], rest: 3 });
});

test("one more ballot decides between the war room and the course", () => {
  const warRoom = tally(costs, [...blocVoters(), seat([[6]])]);
  expect(titles(warRoom.funded)).toContain("War room");
  expect(titles(warRoom.funded)).not.toContain("Course");
  expect(warRoom.contributions.at(-1)![6]).toBe(SEAT);

  const course = tally(costs, [...blocVoters(), seat([[8]])]);
  expect(titles(course.funded)).toContain("Course");
  expect(titles(course.funded)).not.toContain("War room");
});

test("an abstaining seat enlarges the pool but never pays", () => {
  const result = tally(costs, [...blocVoters(), seat(null)]);
  expect(result.budget).toBe(21 * SEAT);
  expect(result.contributions.at(-1)!.every((amount) => amount === 0)).toBe(true);
});

test("Borda and most-votes-first sweep the pool the same way", () => {
  const voters = blocVoters();
  const m = costs.length;
  const sweep = (score: (position: number) => number) => {
    const total = new Array<number>(m).fill(0);
    BLOCS.forEach((bloc, i) => ranksFromTiers(bloc.tiers).forEach((rank, id) => {
      if (rank > 0) total[id] += voters[i].weight * score(rank - 1);
    }));
    const order = costs.map((_, id) => id).sort((a, b) => total[b] - total[a] || a - b);
    const funded: number[] = [];
    let spent = 0;
    for (const id of order) if (spent + costs[id] <= 20 * SEAT) { funded.push(id); spent += costs[id]; }
    return spendByCamp(funded).audit;
  };
  expect(sweep((position) => m - position)).toBe(100_000);
  expect(sweep(() => 1)).toBe(100_000);
});
