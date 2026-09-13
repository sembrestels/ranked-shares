import { expect, test } from "vitest";
import { commitmentsFromEntries } from "../app/lib/live";

test("commitmentsFromEntries sums first-ranked direct weight, ties included, unranked ignored", () => {
  expect(commitmentsFromEntries([
    { weight: 1000n, ballot: [1, 2] },
    { weight: 300n, ballot: [2, 1] },
    { weight: 50n, ballot: [1, 1] },
    { weight: 7n, ballot: [0, 3] },
  ], 2)).toEqual([1050n, 350n]);
  expect(commitmentsFromEntries([{ weight: 5n, ballot: [1] }], 3)).toEqual([5n, 0n, 0n]);
  expect(commitmentsFromEntries([], 0)).toEqual([]);
});
