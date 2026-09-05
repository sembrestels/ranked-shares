import { keccak_256 } from "@noble/hashes/sha3.js";

export function keccak(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function wordBE(n: bigint, size = 32): Uint8Array {
  const out = new Uint8Array(size);
  let v = n;
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function addressBytes(addr: bigint): Uint8Array {
  return wordBE(addr, 20);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesToBig(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}
