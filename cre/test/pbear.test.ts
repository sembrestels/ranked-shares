import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { NONE } from "../src/lib/field";
import { cumulativeDeductions, pbearTranscript, replayPublic } from "../src/lib/pbear";

describe("pbear transcript", () => {
  test("the [30, 70] example", () => {
    const { funded, transcript } = pbearTranscript([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], [{ weight: 60n, ballot: [2, 1] }], 100n);
    expect(funded).toEqual([0, 1]);
    expect(transcript).toEqual([[1n, 40n, 0n, 0n, 40n], [1n, 0n, 0n, NONE, 0n], [2n, 0n, 10n, 1n, 70n]]);
    expect(replayPublic([30n, 70n], [{ weight: 40n, ballot: [1, 2] }], transcript, 100n)).toBe(true);
  });
  test("deductions sum to the threshold", () => {
    const d = cumulativeDeductions([7n, 5n, 9n], 10n);
    expect(d.reduce((a, b) => a + b, 0n)).toBe(10n);
  });
  test("matches reference/pbear.py --transcript on random instances", () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 60; i++) {
      const m = 1 + rnd(4);
      const costs = Array.from({ length: m }, () => BigInt(1 + rnd(10)));
      const entry = () => {
        const weight = BigInt(rnd(11));
        if (rnd(5) === 0) return { weight, ballot: null };
        const order = Array.from({ length: m }, (_, c) => c).sort(() => rnd(3) - 1);
        const kept = rnd(m + 1);
        const ranks = new Array<number>(m).fill(0);
        let rank = 1;
        for (let p = 0; p < kept; p++) {
          if (p === 0 || rnd(10) < 6) rank = p + 1;
          ranks[order[p]] = rank;
        }
        return { weight, ballot: ranks };
      };
      const pub = Array.from({ length: rnd(4) }, entry);
      const sealed = Array.from({ length: rnd(4) }, entry);
      const budget = [...pub, ...sealed].reduce((a, e) => a + e.weight, 0n) + BigInt(rnd(10));
      const payload = JSON.stringify({ costs: costs.map(Number), public: pub.map((e) => [Number(e.weight), e.ballot]), sealed: sealed.map((e) => [Number(e.weight), e.ballot]), budget: Number(budget) });
      const out = spawnSync(["python3", "../reference/pbear.py", "--transcript", payload]);
      const ref = JSON.parse(out.stdout.toString());
      const got = pbearTranscript(costs, pub, sealed, budget);
      expect(got.funded).toEqual(ref.funded);
      expect(got.transcript.map((s) => s.map(Number))).toEqual(ref.transcript);
    }
  });
});
