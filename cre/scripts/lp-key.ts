// Prints only the public tallier key. Keep the master in your secret manager/env.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Hex, hexToBytes, toHex } from "viem";
import { deriveCreKey } from "../src/lib/lp";
const master = process.env.CRE_RANKED_SHARES_MASTER;
const salt = process.env.KEY_SALT;
if (
  !master || !salt || !/^(0x)?[0-9a-fA-F]{64}$/.test(master) ||
  !/^0x[0-9a-fA-F]{64}$/.test(salt)
) {
  throw new Error(
    "Set a 32-byte CRE_RANKED_SHARES_MASTER and a 0x-prefixed 32-byte KEY_SALT in your local environment.",
  );
}
const sk = deriveCreKey(
  hexToBytes((master.startsWith("0x") ? master : `0x${master}`) as Hex),
  salt as Hex,
);
console.log(`TALLIER_PK=${toHex(secp256k1.getPublicKey(sk, true))}`);
