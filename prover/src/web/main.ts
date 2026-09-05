// prover/src/web/main.ts — the coordinator page: connect, sign, audit, prove and submit
import { createPublicClient, createWalletClient, custom, http, hexToBytes, type Address, type Hex } from "viem";
import { deriveSk, MASTER_MESSAGE } from "@lib/sealed";
import { pubkey } from "@lib/grumpkin";
import { readPoolSnapshot } from "../core/chain";
import { rebuild } from "../core/state";
import { Prover } from "../core/prove";
import { runChain } from "../core/submit";
import { audit } from "../core/audit";
import { masterFromSignatureHex } from "../core/key";

const $ = (id: string) => document.getElementById(id)!;
const log = (m: string) => {
  const el = $("log") as HTMLPreElement;
  el.textContent += m + "\n";
  el.scrollTop = el.scrollHeight;
};

let account: Address | undefined;
let master: Uint8Array | undefined;

// Prefill from ?rpc=…&pool=… so the page can be checked without a wallet.
{
  const q = new URLSearchParams(location.search);
  const rpc = q.get("rpc");
  const pool = q.get("pool");
  if (rpc) ($("rpc") as HTMLInputElement).value = rpc;
  if (pool) ($("pool") as HTMLInputElement).value = pool;
}

function clients() {
  const rpc = ($("rpc") as HTMLInputElement).value;
  if (!rpc) throw new Error("enter an RPC URL first");
  const pub = createPublicClient({ transport: http(rpc) });
  const eth = (window as any).ethereum;
  const wallet = eth ? createWalletClient({ transport: custom(eth) }) : undefined;
  return { pub, wallet };
}

function poolAddress(): Address {
  const pool = ($("pool") as HTMLInputElement).value;
  if (!pool) throw new Error("enter a pool address first");
  return pool as Address;
}

// Wraps a button handler so a rejected promise lands in the log panel instead of
// failing silently in the console — the wallet-free smoke test relies on this.
function guard(fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((err) => log(`error: ${err instanceof Error ? err.message : String(err)}`));
  };
}

$("connect").onclick = guard(async () => {
  const { wallet } = clients();
  if (!wallet) return log("no injected wallet found (window.ethereum is undefined)");
  [account] = await wallet.requestAddresses();
  log(`connected ${account}`);
  ($("sign") as HTMLButtonElement).disabled = false;
});

$("sign").onclick = guard(async () => {
  if (!account) throw new Error("connect a wallet first");
  const { wallet } = clients();
  const sig = (await wallet!.signMessage({ account, message: MASTER_MESSAGE })) as Hex;
  master = masterFromSignatureHex(sig);
  log("tallier master secret derived from your signature (kept in memory only)");
  ($("prove") as HTMLButtonElement).disabled = false;
});

$("refresh").onclick = guard(async () => {
  const { pub } = clients();
  const s = await readPoolSnapshot(pub, poolAddress());
  ($("status") as HTMLPreElement).textContent = JSON.stringify(
    {
      phase: s.phase,
      resultReported: s.resultReported,
      ingestCursor: s.ingestCursor,
      numBatches: s.numBatches,
      coordinator: s.coordinator,
      youAreCoordinator: account ? account.toLowerCase() === s.coordinator.toLowerCase() : "not connected",
    },
    null,
    2,
  );
});

$("audit").onclick = guard(async () => {
  const { pub } = clients();
  const r = await audit(pub, poolAddress());
  log(r.ok ? "audit ok" : `audit FAILED: ${r.firstProblem}`);
});

$("prove").onclick = guard(async () => {
  if (!master) throw new Error("sign for the tallier key first");
  const { pub, wallet } = clients();
  if (!wallet) throw new Error("no injected wallet found");
  const pool = poolAddress();
  const s = await readPoolSnapshot(pub, pool);
  const sk = deriveSk(master, hexToBytes(s.keySalt));
  const pk = pubkey(sk);
  if (pk.x !== s.pkX || pk.y !== s.pkY) return log("this wallet is not the tallier of this pool");
  if (account && account.toLowerCase() !== s.coordinator.toLowerCase()) log("warning: not the coordinator; a restart would be rejected");
  const plan = rebuild(s, sk);
  log(`${plan.expected.ingest.length} ingest batches, ${plan.tallyGroups.length} tally groups`);
  const prover = await Prover.create(plan.profile.name as "test" | "default", navigator.hardwareConcurrency ?? 4);
  try {
    await runChain(pub, wallet, plan, s, prover, log, { account });
  } finally {
    await prover.destroy();
  }
});
