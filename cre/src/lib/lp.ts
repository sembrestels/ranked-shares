import {
  type Address,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hexToBytes,
  keccak256,
  toBytes,
  toHex,
  zeroHash,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { validate } from "../../../shared/ranks";
import { pbearTranscript } from "../../../shared/pbear";
import { bytesToBig, concatBytes, keccak, wordBE } from "./hash";

export type CreVoter = {
  address: Address;
  directWeight: bigint;
  seatWeight: bigint;
  publicBallot: Hex;
  sealedBallot: Hex;
};

export function encodePriceReport(
  id: bigint,
  price: bigint,
  sourceBlock: bigint,
  observedAt: bigint,
): Hex {
  if (price < 1n << 64n || price >= 1n << 128n) {
    throw new Error("Pool price is outside the demo's supported range.");
  }
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [
    4,
    encodeAbiParameters([{ type: "uint256" }, { type: "uint160" }, {
      type: "uint64",
    }, { type: "uint64" }], [id, price, sourceBlock, observedAt]),
  ]);
}
export function encodeLPFinalizeReport(id: bigint, chunk: number): Hex {
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > 128) {
    throw new Error("LP chunk must be 1–128.");
  }
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [
    5,
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [
      id,
      BigInt(chunk),
    ]),
  ]);
}
export function deriveCreKey(master: Uint8Array, salt: Hex): Uint8Array {
  const n = bytesToBig(keccak(concatBytes(master, hexToBytes(salt)))) %
    secp256k1.Point.Fn.ORDER;
  if (n === 0n) throw new Error("Invalid derived tallier key.");
  return wordBE(n);
}
export function decryptCre(
  sk: Uint8Array,
  who: Address,
  ciphertext: Hex,
  m: number,
): number[] | null {
  try {
    const ct = hexToBytes(ciphertext);
    if (ct.length !== 33 + m) return null;
    const shared = secp256k1.getSharedSecret(sk, ct.slice(0, 33), true);
    const key = keccak(
      concatBytes(
        toBytes("RankedShares/sealed/secp256k1"),
        shared.slice(1),
        hexToBytes(who),
      ),
    );
    const pad = keccak(concatBytes(key, new Uint8Array([0])));
    const ranks = Array.from(ct.slice(33), (b, i) => b ^ pad[i]);
    return validate(ranks, m) ? ranks : null;
  } catch {
    return null;
  }
}
export function creInputsHash(
  chainId: bigint,
  pool: Address,
  voters: CreVoter[],
  costs: bigint[],
  budget: bigint,
): Hex {
  let h: Hex = zeroHash;
  for (const v of voters) {
    h = keccak256(
      encodePacked([
        "bytes32",
        "address",
        "uint256",
        "uint256",
        "bytes32",
        "bytes32",
      ], [
        h,
        v.address,
        v.directWeight,
        v.seatWeight,
        keccak256(v.publicBallot),
        keccak256(v.sealedBallot),
      ]),
    );
  }
  const costHash = keccak256(concatBytes(...costs.map((c) => wordBE(c))));
  return keccak256(
    encodePacked([
      "uint256",
      "address",
      "bytes32",
      "uint256",
      "bytes32",
      "uint256",
    ], [chainId, pool, h, BigInt(voters.length), costHash, budget]),
  );
}
export function creResultReport(
  chainId: bigint,
  pool: Address,
  voters: CreVoter[],
  costs: bigint[],
  budget: bigint,
  expectedHash: Hex,
  salt: Hex,
  tallierPk: Hex,
  master: Uint8Array,
): Hex {
  const actual = creInputsHash(chainId, pool, voters, costs, budget);
  if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("CRE input commitment mismatch.");
  }
  const sk = deriveCreKey(master, salt);
  if (
    toHex(secp256k1.getPublicKey(sk, true)).toLowerCase() !==
      tallierPk.toLowerCase()
  ) throw new Error("Master secret does not match the round's tallier key.");
  // Same order as reference/zisk/make_fixture.py and the Rust guest: public
  // block, then sealed block, registration order within each block.
  const pub = voters.filter((v) => v.publicBallot !== "0x").map((v) => {
    const ranks = Array.from(hexToBytes(v.publicBallot));
    if (!validate(ranks, costs.length)) {
      throw new Error("Invalid public ballot.");
    }
    return { weight: v.directWeight, ballot: ranks };
  });
  const sealed = voters.filter((v) => v.sealedBallot !== "0x").map((v) => ({
    weight: v.seatWeight,
    ballot: decryptCre(sk, v.address, v.sealedBallot, costs.length),
  }));
  const { funded } = pbearTranscript(costs, pub, sealed, budget);
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [
    1,
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint256[]" }], [
      expectedHash,
      funded.map(BigInt),
    ]),
  ]);
}
