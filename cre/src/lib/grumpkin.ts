import { weierstrass } from "@noble/curves/abstract/weierstrass.js";
import { FIELD, Q } from "./field";

export const Grumpkin = weierstrass({
  p: FIELD,
  n: Q,
  h: 1n,
  a: 0n,
  b: FIELD - 17n,
  Gx: 1n,
  Gy: 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272cn,
});

export type Point = { x: bigint; y: bigint };
export const G: Point = { x: 1n, y: 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272cn };

export function isOnCurve(x: bigint, y: bigint): boolean {
  if (x < 0n || y < 0n || x >= FIELD || y >= FIELD) return false;
  return (y * y - (x * x * x + FIELD - 17n)) % FIELD === 0n;
}

export function mul(k: bigint, p: Point): Point {
  const a = Grumpkin.fromAffine({ x: p.x, y: p.y }).multiply(((k % Q) + Q) % Q).toAffine();
  return { x: a.x, y: a.y };
}

export function pubkey(sk: bigint): Point {
  return mul(sk, G);
}
