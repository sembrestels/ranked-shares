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

export function publicEntries(voters: Voter[], m: number): Entry[] {
  return voters.filter((v) => v.hasDirect).map((v) => ({ weight: v.directWeight, ballot: unpack(v.directPacked, m) }));
}

export function sealedVoters(voters: Voter[]): Voter[] {
  return voters.filter((v) => v.ciphertext !== null);
}

export function sealedEntries(voters: Voter[], sk: bigint, m: number): Entry[] {
  return sealedVoters(voters).map((v) => ({ weight: v.seatWeight, ballot: decrypt(sk, v.addr, v.ciphertext!, m) }));
}
