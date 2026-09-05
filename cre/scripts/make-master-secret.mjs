// cre/scripts/make-master-secret.mjs — print the master secret derived from a wallet
// signature, or (with --print-pk) the pool's tallier public key derived from that master
// and a keySalt, so the deployment (`DeploySealed`'s TALLIER_PK_X/Y) and the CRE workflow
// (which re-derives the same secret key from the same master + keySalt) agree by
// construction.
//
// Usage:
//   PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs
//     prints the master secret hex, to pipe into:
//     (read s; RANKED_SHARES_MASTER=$s cre secrets create workflows/sealed/secrets.yaml --target staging-settings)
//
//   PRIVATE_KEY=0x… bun scripts/make-master-secret.mjs --print-pk --key-salt 0x…
//     prints `pkX=0x…` / `pkY=0x…` (32-byte hex, matching TALLIER_PK_X/TALLIER_PK_Y in
//     script/DeploySealed.s.sol) instead of the master secret.
//
// `node` also works if it resolves `viem` from cre/node_modules; bun imports the `.ts`
// lib modules directly.
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, hexToBytes } from "viem";
import { MASTER_MESSAGE, deriveSk } from "../src/lib/sealed.ts";
import { pubkey } from "../src/lib/grumpkin.ts";
import { hex } from "../src/lib/field.ts";

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY env var is required (the wallet whose signature derives the master secret).");
  process.exit(1);
}

const printPk = process.argv.includes("--print-pk");
const keySaltIdx = process.argv.indexOf("--key-salt");
const keySaltArg = keySaltIdx === -1 ? undefined : process.argv[keySaltIdx + 1];

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const sig = await account.signMessage({ message: MASTER_MESSAGE });
const masterHex = keccak256(sig);

if (printPk) {
  if (!keySaltArg) {
    console.error("--print-pk requires --key-salt 0x… (the pool's keySalt).");
    process.exit(1);
  }
  const sk = deriveSk(hexToBytes(masterHex), hexToBytes(keySaltArg));
  const { x, y } = pubkey(sk);
  process.stdout.write(`pkX=${hex(x)}\npkY=${hex(y)}\n`);
} else {
  process.stdout.write(`${masterHex}\n`);
}
