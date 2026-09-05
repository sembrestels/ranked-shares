import { describe, expect, test } from "bun:test";
import vectors from "../../reference/vectors/poseidon2.json";
import sealedVectors from "../../reference/vectors/sealed.json";
import { sponge, spongeVar } from "../src/lib/poseidon2";
import { G, isOnCurve, mul, pubkey } from "../src/lib/grumpkin";
import { keccak, wordBE } from "../src/lib/hash";
import { FIELD, Q, toBig } from "../src/lib/field";

describe("poseidon2", () => {
  test("hash vectors from bb.js", () => {
    for (const c of vectors.hash) {
      expect(sponge(c.input.map(toBig))).toBe(toBig(c.output));
    }
  });
  test("variable length equals fixed length", () => {
    expect(spongeVar([1n, 2n, 3n, 0n, 0n], 3)).toBe(sponge([1n, 2n, 3n]));
  });
});

describe("grumpkin", () => {
  test("generator and order", () => {
    expect(isOnCurve(G.x, G.y)).toBe(true);
    expect(mul(2n, G)).toEqual(mul(1n, mul(2n, G)));
    const pk = pubkey(toBig(sealedVectors.sk));
    expect(pk.x).toBe(toBig(sealedVectors.pk[0]));
    expect(pk.y).toBe(toBig(sealedVectors.pk[1]));
  });
  test("rejects off-curve and out-of-field", () => {
    expect(isOnCurve(1n, 1n)).toBe(false);
    expect(isOnCurve(FIELD, G.y)).toBe(false);
    expect(Q).toBe(21888242871839275222246405745257275088696311157297823662689037894645226208583n);
  });
});

describe("keccak", () => {
  test("known digests", () => {
    expect(Buffer.from(keccak(new Uint8Array())).toString("hex")).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(Buffer.from(keccak(new TextEncoder().encode("abc"))).toString("hex")).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    expect(wordBE(5n).length).toBe(32);
  });
});
