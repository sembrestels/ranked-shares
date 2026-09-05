// prover/src/core/key.ts — key derivation helpers for the prover
import { hexToBytes, type Hex } from "viem";
import { deriveSk, masterFromSignature, MASTER_MESSAGE } from "@lib/sealed";

export { deriveSk, masterFromSignature, MASTER_MESSAGE };

export function masterFromSignatureHex(sig: Hex): Uint8Array {
  return masterFromSignature(hexToBytes(sig));
}

export function skLimbs(sk: bigint): { lo: string; hi: string } {
  return { lo: (sk & ((1n << 128n) - 1n)).toString(), hi: (sk >> 128n).toString() };
}
