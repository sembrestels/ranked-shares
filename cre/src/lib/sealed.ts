import { DOMAIN, FIELD, Q, mod } from "./field";
import { G, isOnCurve, mul, type Point } from "./grumpkin";
import { bytesToBig, concatBytes, keccak } from "./hash";
import { sponge } from "./poseidon2";

export const MASTER_MESSAGE = "RankedShares tallier master secret v1";

export function pack(ranks: number[]): bigint {
  return ranks.reduce((acc, r, c) => acc + (BigInt(r) << BigInt(8 * c)), 0n);
}

/** Competition-ranking check, identical to PBEAR._setBallot. */
export function validate(ranks: number[], m: number): boolean {
  if (ranks.length !== m || ranks.some((r) => r < 0 || r > m)) return false;
  const counts = new Array<number>(m + 1).fill(0);
  for (const r of ranks) counts[r]++;
  let seen = 0;
  for (let r = 1; r <= m; r++) {
    if (counts[r] !== 0 && r !== seen + 1) return false;
    seen += counts[r];
  }
  return true;
}

export function unpack(packed: bigint, m: number): number[] | null {
  if (packed < 0n || packed >= 1n << BigInt(8 * m)) return null;
  const ranks: number[] = [];
  for (let c = 0; c < m; c++) ranks.push(Number((packed >> BigInt(8 * c)) & 0xffn));
  return validate(ranks, m) ? ranks : null;
}

export function effectiveRanks(ranks: number[], m: number): number[] {
  const def = 1 + ranks.slice(0, m).filter((r) => r !== 0).length;
  return ranks.map((r) => (r === 0 ? def : r));
}

export function masterFromSignature(sig: Uint8Array): Uint8Array {
  return keccak(sig);
}

export function deriveSk(master: Uint8Array, keySalt: Uint8Array): bigint {
  return bytesToBig(keccak(concatBytes(master, keySalt))) % Q;
}

export function mask(shared: Point, voter: bigint): bigint {
  return sponge([DOMAIN, shared.x, shared.y, voter]);
}

export function encrypt(pk: Point, voter: bigint, ranks: number[], k: bigint): [bigint, bigint, bigint] {
  const r = mul(k, G);
  const s = mul(k, pk);
  return [r.x, r.y, mod(pack(ranks) + mask(s, voter))];
}

export function decrypt(sk: bigint, voter: bigint, ct: [bigint, bigint, bigint], m: number): number[] | null {
  const [rx, ry, c] = ct;
  if (rx === 0n || !isOnCurve(rx, ry)) return null;
  const s = mul(sk, { x: rx, y: ry });
  return unpack(mod(c - mask(s, voter)), m);
}

export function randomScalar(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return (bytesToBig(b) % (Q - 1n)) + 1n;
}
