import { assertEquals } from "@std/assert";
import { commitmentsFrom } from "../services/commitments.ts";

Deno.test("commitmentsFrom: first-ranked project gets the voter's direct weight", () => {
  const out = commitmentsFrom([
    { weight: 1000n, ballot: "0x0102" },
    { weight: 300n, ballot: "0x0201" },
  ], 2);
  assertEquals(out, [1000n, 300n]);
});

Deno.test("commitmentsFrom: ties at rank 1 count for every tied project", () => {
  assertEquals(commitmentsFrom([{ weight: 500n, ballot: "0x0101" }], 2), [500n, 500n]);
});

Deno.test("commitmentsFrom: unranked (0) and lower ranks add nothing", () => {
  assertEquals(commitmentsFrom([{ weight: 500n, ballot: "0x000201" }], 3), [0n, 0n, 500n]);
});

Deno.test("commitmentsFrom: no ballot, zero weight, and short ballots are safe", () => {
  assertEquals(
    commitmentsFrom([
      { weight: 900n, ballot: "0x" },
      { weight: 0n, ballot: "0x01" },
      { weight: 7n, ballot: "0x01" },
    ], 3),
    [7n, 0n, 0n],
  );
});

Deno.test("commitmentsFrom: zero projects gives an empty vector", () => {
  assertEquals(commitmentsFrom([{ weight: 1n, ballot: "0x01" }], 0), []);
});
