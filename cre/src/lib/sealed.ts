import { DOMAIN, FIELD, Q, mod } from "./field";
import { G, isOnCurve, mul, type Point } from "./grumpkin";
import { bytesToBig, concatBytes, keccak } from "./hash";
import { sponge } from "./poseidon2";

export const MASTER_MESSAGE = "RankedShares tallier master secret v1";

export { pack, validate, unpack, effectiveRanks } from "../../../shared/ranks";
import { pack, unpack } from "../../../shared/ranks";

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
