export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const TWO_POW_64 = 1n << 64n;
export const NONE = TWO_POW_64 - 1n;
export const DOMAIN = 0x52616e6b65645368617265732f7365616c65642f7632n; // "RankedShares/sealed/v2"

export function hex(n: bigint, bytes = 32): `0x${string}` {
  return `0x${n.toString(16).padStart(bytes * 2, "0")}`;
}

export function toBig(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(v);
}

export function mod(a: bigint, m = FIELD): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}
