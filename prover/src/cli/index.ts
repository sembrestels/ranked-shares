// prover/src/cli/index.ts — audit / status / prove / serve against a live pool
import * as os from "node:os";
import { createPublicClient, createWalletClient, hexToBytes, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readPoolSnapshot } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { audit } from "../core/audit";
import { deriveSk, masterFromSignatureHex, MASTER_MESSAGE } from "../core/key";
import { createServer } from "../service";

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

/**
 * The tallier master secret, from (in order) `--master`, `--sign` (signs
 * `MASTER_MESSAGE` with `account`), or `RANKED_SHARES_MASTER` — shared by `prove` and
 * `serve`. Never logged.
 */
async function resolveMaster(rpc: string, account?: ReturnType<typeof privateKeyToAccount>): Promise<Uint8Array> {
  if (process.argv.includes("--master")) return hexToBytes(arg("master") as Hex);
  if (process.argv.includes("--sign")) {
    if (!account) throw new Error("--sign needs --private-key");
    const wallet = createWalletClient({ account, transport: http(rpc) });
    return masterFromSignatureHex(await wallet.signMessage({ account, message: MASTER_MESSAGE }));
  }
  if (process.env.RANKED_SHARES_MASTER) return hexToBytes(process.env.RANKED_SHARES_MASTER as Hex);
  throw new Error("need a master secret: --master 0x…, --sign (with --private-key), or RANKED_SHARES_MASTER");
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "serve") {
    const rpc = arg("rpc");
    const port = Number(arg("port", "8787"));
    const doSubmit = process.argv.includes("--submit");
    const account = process.argv.includes("--private-key") ? privateKeyToAccount(arg("private-key") as Hex) : undefined;
    if (doSubmit && !account) throw new Error("--submit needs --private-key (the pool's coordinator key)");

    const master = await resolveMaster(rpc, account);
    const threads = Number(arg("threads", String(Math.max(1, os.availableParallelism() - 1))));
    const server = createServer({ rpc, master, submit: doSubmit, account, threads });
    server.listen(port, () => console.log(`prove service listening on :${port}${doSubmit ? " (submitting as coordinator)" : " (proofs only)"}`));
    return;
  }

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
    const master = await resolveMaster(arg("rpc"), account);
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

  console.log(
    [
      "usage: prover <audit|status|prove|serve> --rpc <url>",
      "  audit|status|prove: --pool <addr> [--from-block n]",
      "  prove: --private-key 0x… (--master 0x… | --sign | $RANKED_SHARES_MASTER) [--threads n]",
      "  serve: [--port 8787] [--private-key 0x…] (--master 0x… | --sign | $RANKED_SHARES_MASTER) [--submit] [--threads n]",
    ].join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
