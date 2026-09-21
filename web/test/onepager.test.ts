import { expect, test } from "vitest";
import { pbearTranscript } from "../../shared/pbear";
import {
  BLOCS,
  blocVoters,
  majorityOutcome,
  PROPOSALS,
  ranksFromOrder,
  SEAT,
  spendByCamp,
  tally,
  type Voter,
} from "../app/lib/onepager";

const costs = PROPOSALS.map((p) => p.cost);
const titles = (ids: number[]) => ids.map((id) => PROPOSALS[id].short);
const seat = (order: number[] | null): Voter => ({
  id: "you",
  name: "Your seat",
  weight: SEAT,
  ballot: order && ranksFromOrder(order),
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
  expect(titles(result.funded)).toEqual(["Fuzzing", "Blocklist", "Retainer", "Findings DB", "Simulation"]);
  expect(spendByCamp(result.funded)).toEqual({ audit: 55_000, wallet: 30_000, response: 10_000, research: 0 });
});

test("frames replay the production transcript exactly", () => {
  const voters = blocVoters();
  const result = tally(costs, voters);
  const { funded } = pbearTranscript(
    costs.map(BigInt),
    voters.map((v) => ({ weight: BigInt(v.weight), ballot: v.ballot })),
    [],
    BigInt(result.budget),
  );
  expect(result.funded).toEqual(funded);
  expect(result.frames.filter((f) => f.funded !== null).map((f) => f.funded)).toEqual(funded);
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

test("one more seat decides between the war room and the course", () => {
  const warRoom = tally(costs, [...blocVoters(), seat([6])]);
  expect(titles(warRoom.funded)).toContain("War room");
  expect(titles(warRoom.funded)).not.toContain("Course");
  expect(warRoom.contributions.at(-1)![6]).toBe(SEAT);

  const course = tally(costs, [...blocVoters(), seat([8])]);
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
    BLOCS.forEach((bloc, i) => bloc.ranking.forEach((id, position) => (total[id] += voters[i].weight * score(position))));
    const order = costs.map((_, id) => id).sort((a, b) => total[b] - total[a] || a - b);
    const funded: number[] = [];
    let spent = 0;
    for (const id of order) if (spent + costs[id] <= 20 * SEAT) { funded.push(id); spent += costs[id]; }
    return spendByCamp(funded).audit;
  };
  expect(sweep((position) => m - position)).toBe(100_000);
  expect(sweep(() => 1)).toBe(100_000);
});
