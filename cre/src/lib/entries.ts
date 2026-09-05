import { decrypt, unpack } from "./sealed";
import type { Entry } from "./pbear";

export type Voter = {
  addr: bigint;
  directWeight: bigint;
  seatWeight: bigint;
  hasDirect: boolean;
  directPacked: bigint;
  ciphertext: [bigint, bigint, bigint] | null;
};

/**
 * Whether a `votersFrom` ciphertext is a real sealed ballot. `rx = 0` is the contract's
 * "no sealed ballot" sentinel (`voteSealed` rejects a zero `rx`, and `decrypt` refuses
 * it too), so one predicate decides it for every caller.
 */
export function isSealed(ct: readonly [bigint, bigint, bigint]): boolean {
  return ct[0] !== 0n;
}

export function publicEntries(voters: Voter[], m: number): Entry[] {
  return voters.filter((v) => v.hasDirect).map((v) => ({ weight: v.directWeight, ballot: unpack(v.directPacked, m) }));
}

export function sealedVoters(voters: Voter[]): Voter[] {
  return voters.filter((v) => v.ciphertext !== null);
}

export function sealedEntries(voters: Voter[], sk: bigint, m: number): Entry[] {
  return sealedVoters(voters).map((v) => ({ weight: v.seatWeight, ballot: decrypt(sk, v.addr, v.ciphertext!, m) }));
}
