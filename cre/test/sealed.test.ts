import { describe, expect, test } from "bun:test";
import v from "../../reference/vectors/noir/sealed.json";
import { decrypt, deriveSk, encrypt, pack, unpack, validate, effectiveRanks } from "../src/lib/sealed";
import { pubkey } from "../src/lib/grumpkin";
import { toBig } from "../src/lib/field";

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

describe("packing", () => {
  test("round trip and validation", () => {
    expect(pack([2, 1, 0, 3])).toBe(0x03000102n);
    expect(unpack(0x03000102n, 4)).toEqual([2, 1, 0, 3]);
    expect(unpack(0n, 3)).toEqual([0, 0, 0]);
    expect(unpack(1n << 32n, 4)).toBeNull();
    expect(unpack(pack([5, 0, 0, 0]), 4)).toBeNull();
    expect(unpack(pack([1, 3, 3, 0]), 4)).toBeNull();
    expect(validate([1, 2, 2, 4], 4)).toBe(true);
    expect(effectiveRanks([2, 1, 0, 3], 4)).toEqual([2, 1, 4, 3]);
  });
});

describe("sealed vectors", () => {
  const sk = deriveSk(hexBytes(v.master), hexBytes(v.keySalt));
  test("key derivation", () => {
    expect(sk).toBe(toBig(v.sk));
    const pk = pubkey(sk);
    expect(pk.x).toBe(toBig(v.pk[0]));
  });
  for (const c of v.cases) {
    test(`case voter ${c.voter} m ${c.m}${c.note ? ` (${c.note})` : ""}`, () => {
      const ct = c.ciphertext.map(toBig) as [bigint, bigint, bigint];
      if (!c.note) {
        expect(encrypt(pubkey(sk), toBig(c.voter), c.ranks!, toBig(c.k!))).toEqual(ct);
      }
      expect(decrypt(sk, toBig(c.voter), ct, c.m)).toEqual(c.plaintext);
    });
  }
});
