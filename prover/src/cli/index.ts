// prover/src/cli/index.ts — audit / status / prove against a live pool
import { createPublicClient, createWalletClient, hexToBytes, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readPoolSnapshot } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { audit } from "../core/audit";
import { deriveSk, masterFromSignatureHex, MASTER_MESSAGE } from "../core/key";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) {
    if (def !== undefined) return def;
    throw new Error(`missing --${name}`);
  }
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`--${name} needs a value`);
  return v;
}

async function main() {
  const cmd = process.argv[2];
  const client = createPublicClient({ transport: http(arg("rpc")) });
  const pool = arg("pool") as Address;
  const fromBlock = BigInt(arg("from-block", "0"));

  if (cmd === "audit") {
    const r = await audit(client, pool, fromBlock);
    console.log(r.ok ? "audit ok: the public block reproduces the reported transcript" : `audit FAILED: ${r.firstProblem}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === "status") {
    const s = await readPoolSnapshot(client, pool, fromBlock);
    console.log(
      JSON.stringify(
        { phase: s.phase, resultReported: s.resultReported, ingestCursor: s.ingestCursor, numBatches: s.numBatches, stateCommit: s.stateCommit.toString(16) },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "prove") {
    const account = privateKeyToAccount(arg("private-key") as Hex);
    const wallet = createWalletClient({ account, transport: http(arg("rpc")) });
    const s = await readPoolSnapshot(client, pool, fromBlock);
    if (s.coordinator.toLowerCase() !== account.address.toLowerCase()) console.warn("warning: this key is not the pool's coordinator; restarts would be rejected");
    const master = process.argv.includes("--sign") ? masterFromSignatureHex(await wallet.signMessage({ account, message: MASTER_MESSAGE })) : hexToBytes(arg("master") as Hex);
    const sk = deriveSk(master, hexToBytes(s.keySalt));
    const plan = rebuild(s, sk);
    const prover = await Prover.create(plan.profile.name as "test" | "default", Number(arg("threads", "4")));
    try {
      await runChain(client, wallet, plan, s, prover, (m) => console.log(m));
    } finally {
      await prover.destroy();
    }
    return;
  }

  console.log("usage: prover <audit|status|prove> --rpc <url> --pool <addr> [--from-block n] [--private-key 0x… (--master 0x… | --sign)] [--threads n]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
