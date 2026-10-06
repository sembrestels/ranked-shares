import { expect, test } from "vitest";
import { pbearTranscript } from "../../shared/pbear";
import { WITHHELD } from "../../shared/ranks";
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

test("a majority ranking spends on the audit camp alone and leaves the rest unspent", () => {
  const funded = majorityOutcome(costs, blocVoters());
  // The four audit proposals cost $99,000 and no other proposal fits in the $1,000 left.
  expect(spendByCamp(funded)).toEqual({ audit: 99_000, wallet: 0, response: 0, research: 0 });
});

test("the proportional tally gives the audit camp 57 percent for its 55 percent of the ballots", () => {
  const result = tally(costs, blocVoters());
  expect(titles(result.funded)).toEqual(["Fuzzing", "Blocklist", "Retainer", "Findings DB", "Simulation"]);
  expect(spendByCamp(result.funded)).toEqual({ audit: 57_000, wallet: 30_000, response: 10_000, research: 0 });
});

test("simulation passes only because the researchers placed it in their B-Tier, or with a $1,000 donation", () => {
  const SIMULATION = 5;
  const base = tally(costs, blocVoters());
  expect(titles(base.funded).at(-1)).toBe("Simulation");
  expect(base.contributions.map((paid) => paid[SIMULATION])).toEqual([0, 0, 0, 8_873, 1_127]);
  expect(base.budget - base.frames.at(-1)!.spent).toBe(3_000);

  // Without it on the researchers' ballot, only the responders' $9,000 is behind the $10,000 ask.
  const omitted = blocVoters();
  omitted[4] = { ...omitted[4], ballot: ranksFromTiers([[8], [7, 2]]) };
  const without = tally(costs, omitted);
  expect(titles(without.funded)).toEqual(titles(base.funded).slice(0, -1));
  expect(without.frames.at(-1)!.left).toEqual([1_559, 1_299, 0, 9_000, 1_142]);
  expect(without.budget - without.frames.at(-1)!.spent).toBe(13_000);

  const donated = tally(costs.map((cost, id) => (id === SIMULATION ? cost - 1_000 : cost)), omitted);
  expect([...titles(donated.funded)].sort()).toEqual([...titles(base.funded)].sort());
});

test("frames replay unchanged PB-EAR on ballots that withhold what they left unplaced", () => {
  const voters = blocVoters();
  const result = tally(costs, voters);
  // Tied tiers share a competition rank. Every ballot returns its leftover to TheDAO, so
  // what it left unplaced is withheld (W).
  const W = WITHHELD;
  const ballots = [
    [1, 2, 2, 4, W, W, W, W, W],
    [1, 4, 2, 2, W, W, W, W, W],
    [W, W, W, W, 1, 2, W, 2, W],
    [W, W, W, W, W, 2, 1, 2, W],
    [W, W, 2, W, W, 4, W, 2, 1],
  ];
  const { funded, transcript } = pbearTranscript(
    costs.map(BigInt),
    voters.map((v, i) => ({ weight: BigInt(v.weight), ballot: ballots[i] })),
    [],
    BigInt(result.budget),
  );
  expect(result.funded).toEqual(funded);
  expect(result.frames.filter((f) => f.funded !== null).map((f) => f.funded)).toEqual(result.funded);
  result.frames.forEach((frame, i) => {
    expect(frame.support).toEqual(transcript[i].slice(1, costs.length + 1).map(Number));
  });
  for (const frame of result.frames) {
    const paid = frame.paid.reduce((a, b) => a + b, 0);
    expect(paid).toBe(frame.funded === null ? 0 : costs[frame.funded]);
  }
  const last = result.frames.at(-1)!;
  expect(last.funded).not.toBeNull();
  expect(last.left.reduce((a, b) => a + b, 0) + last.spent).toBe(result.budget);
  // The level widens at least once and the first purchase is split in proportion to weight.
  expect(result.frames.some((f) => f.funded === null)).toBe(true);
  expect(result.frames[0].paid.slice(0, 2)).toEqual([21_818, 18_182]);
});

test("a proposal is funded only when the voters who placed it can cover its ask", () => {
  const result = tally([40, 50, 60, 10], [
    { id: "a", name: "A", weight: 50, ballot: [1, 2, 3, 0] },
    { id: "b", name: "B", weight: 50, ballot: null },
  ]);
  // The first proposal takes 40 of A's 50; nothing else A placed fits in the 10 left, and
  // the last one, which nobody placed, gets nothing although the pool could pay for it.
  expect(result.funded).toEqual([0]);
  expect(result.contributions).toEqual([[40, 0, 0, 0], [0, 0, 0, 0]]);
});

test("money left after a voter's tiers goes back instead of paying for what they left unplaced", () => {
  const result = tally([40, 40, 20], [
    { id: "alice", name: "Alice", weight: 50, ballot: [1, 2, 0] },
    { id: "bob", name: "Bob", weight: 50, ballot: [0, 0, 1] },
  ]);
  // Bob's remaining 30 would cover the second project with Alice's 10,
  // but Bob did not place it, so it is not funded and his 30 is returned.
  expect(result.funded).toEqual([2, 0]);
  expect(result.contributions).toEqual([[40, 0, 0], [0, 0, 20]]);
  expect(result.frames.at(-1)!.left).toEqual([10, 30]);
});

test("a ballot whose only pick cannot be afforded keeps its weight and pays nothing", () => {
  const result = tally([60, 40], [
    { id: "a", name: "A", weight: 50, ballot: [1, 0] },
    { id: "b", name: "B", weight: 50, ballot: [0, 1] },
    { id: "c", name: "C", weight: 20, ballot: null },
  ]);
  expect(result.budget).toBe(120);
  expect(result.funded).toEqual([1]);
  expect(result.frames[0].before).toEqual([50, 50, 20]);
  expect(result.contributions).toEqual([[0, 0], [0, 40], [0, 0]]);
});

test("a round in which nothing can be afforded spends nothing", () => {
  const result = tally([60, 10], [
    { id: "a", name: "A", weight: 50, ballot: [1, 0] },
    { id: "b", name: "B", weight: 50, ballot: null },
  ]);
  expect(result.budget).toBe(100);
  expect(result.funded).toEqual([]);
  expect(result.frames).toEqual([]);
  expect(result.contributions).toEqual([[0, 0], [0, 0]]);
});

test("a tier opens one step later for each proposal in the tiers above it", () => {
  expect(openingLevels(BLOCS[0].tiers)).toEqual([1, 2, 4]);
  expect(openingLevels(BLOCS[3].tiers)).toEqual([1, 2]);
  expect(openingLevels(BLOCS[4].tiers)).toEqual([1, 2, 4]);
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
  expect(sweep((position) => m - position)).toBe(99_000);
  expect(sweep(() => 1)).toBe(99_000);
});
