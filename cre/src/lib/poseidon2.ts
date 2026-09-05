import { poseidon2Hash } from "@zkpassport/poseidon2";

/** Barretenberg's Poseidon2 FieldSponge over BN254 (t = 4, rate 3), as reference/noir/poseidon2.py. */
export function sponge(inputs: bigint[]): bigint {
  return poseidon2Hash(inputs);
}

export function spongeVar(inputs: bigint[], len: number): bigint {
  return sponge(inputs.slice(0, len));
}
