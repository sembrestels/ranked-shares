// User-approved public import and acceptance for the existing EURC demo pool.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createPublicClient, http, parseEventLogs, zeroHash } from "viem";
import { artifact, loadState, operator, root, save } from "./demo";

const target = "0x35a7915dc29c67805b7323e5a0384f919c9cf210";
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error: any) {
      if (attempt >= 4 || !/limit|too many|429|timeout|timed out|HTTP request failed/i.test(String(error.shortMessage || error.message))) throw error;
      await Bun.sleep(Math.min(2000 * 2 ** attempt, 8000));
    }
  }
}
async function run(state: any, rpc: string, rehearsal: boolean) {
  const path = resolve(root, rehearsal ? "demo/.local/urbehub-rehearsal-state.json" : "demo/.local/state.json");
  const receiptsPath = resolve(root, rehearsal ? "demo/.local/urbehub-rehearsal-receipts.json" : "demo/urbehub-proposal-receipts.json");
  const uploaded = JSON.parse(readFileSync(resolve(root, "demo/urbehub-public-uploads.json"), "utf8"));
  const round = JSON.parse(readFileSync(resolve(root, "demo/import-plan.json"), "utf8")).rounds.find((r: any) => r.currency === "EURC");
  if (state.rounds.EURC.pool.toLowerCase() !== target || uploaded.pool !== target || round.pool.toLowerCase() !== target || uploaded.chainId !== 5042002 || uploaded.encryption !== false || uploaded.proposals.length !== 15 || round.proposals.length !== 15) throw Error("Unexpected import target.");
  const op = operator(state, rpc, path), abi = artifact("NoirRankedShares").abi;
  await op.guard();
  const read = (functionName: string, args: any[] = []) => retry(() => op.pub.readContract({ address: target, abi, functionName, args }));
  // operator.write journals the signed transaction, so retrying always reuses it.
  const write = (label: string, functionName: string, args: any[]) => retry(() => op.write(label, target, abi, functionName, args));
  const [owner, token, open, deadline, count, max] = await Promise.all([read("owner"), read("token"), read("votingOpen"), read("votingDeadline"), read("projectCount"), read("mMax")]);
  if (String(owner).toLowerCase() !== state.deployer.toLowerCase() || String(token).toLowerCase() !== round.token.toLowerCase() || open || BigInt(deadline as bigint) <= (await op.pub.getBlock()).timestamp) throw Error("Pool is not available for the approved review.");
  const privacy = await read("proposalPrivacy");
  const key = await op.pub.readContract({ address: privacy as `0x${string}`, abi: artifact("ProposalPrivacy").abi, functionName: "organizerPublicKey" });
  if (key !== "0x") throw Error("This pool requires private proposals; public import is disabled.");
  const queue: any[] = [];
  for (const row of round.proposals) {
    const matches = uploaded.proposals.filter((p: any) => p.source === row.source);
    if (matches.length !== 1) throw Error("Missing or duplicate document.");
    const p = matches[0];
    for (const field of ["sha256", "title", "body", "amountBaseUnits", "recipient", "proposer"]) if (p[field] !== row[field]) throw Error("Changed proposal terms: " + row.source);
    if (p.proposer.toLowerCase() !== state.deployer.toLowerCase() || p.recipient.toLowerCase() !== state.recipient.toLowerCase() || sha(readFileSync(resolve(root, p.source))) !== p.sha256 || p.keyHash !== zeroHash || !/^0x[0-9a-f]{64}$/.test(p.contentRef) || !p.verifiedAt) throw Error("Invalid public upload receipt.");
    const response = await fetch(`https://api.gateway.ethswarm.org/bytes/${p.contentRef.slice(2)}`, { signal: AbortSignal.timeout(30000) });
    const expected = JSON.stringify({ version: 1, title: p.title, body: p.body, attachments: [] });
    if (!response.ok || await response.text() !== expected || sha(expected) !== p.contentSha256) throw Error("Swarm document verification failed: " + p.title);
    queue.push(p);
  }
  const all = await Promise.all(Array.from({ length: Number(await read("proposalCount")) }, (_, i) => read("proposals", [BigInt(i)])));
  for (const existing of all as any[]) {
    const match = queue.find(p => existing[0].toLowerCase() === p.proposer.toLowerCase() && existing[1] === p.contentRef && String(existing[2]) === p.amountBaseUnits && existing[3].toLowerCase() === p.recipient.toLowerCase());
    if (!match || !state.transactions[`public-urbehub:propose:${match.sha256}`]) throw Error("Unexpected proposal in the target pool; inspect before proceeding.");
  }
  const accepted = (all as any[]).filter(p => p[4] === 1).length;
  if (BigInt(count as bigint) - BigInt(accepted) + 15n > BigInt(max as bigint)) throw Error("Insufficient project capacity.");
  const receipts = { version: 1, chainId: 5042002, pool: target, encryption: false, votingOpen: false, proposals: queue };
  // Only these 15 exact documents are submitted and accepted. No voting-open call.
  for (const p of queue) {
    const tx = await write(`public-urbehub:propose:${p.sha256}`, "propose", [p.contentRef, zeroHash, BigInt(p.amountBaseUnits), p.recipient]);
    const event = parseEventLogs({ abi, logs: tx.logs, eventName: "Proposed" }).find((e: any) => e.address.toLowerCase() === target) as any;
    if (!event) throw Error("Missing proposal event.");
    const id = event.args.proposalId;
    const current = await read("proposals", [id]) as any[];
    const revision = await read("proposalRevision", [id]);
    if (current[1] !== p.contentRef || String(current[2]) !== p.amountBaseUnits || current[3].toLowerCase() !== p.recipient.toLowerCase() || revision !== 1n || current[4] === 2) throw Error("Proposal changed during import.");
    p.proposalId = String(id); p.transactionHash = tx.transactionHash;
    save(receiptsPath, receipts);
    const acceptedTx = await write(`public-urbehub:accept:${p.sha256}`, "acceptProposal", [id, 1n]);
    const result = await read("proposals", [id]) as any[];
    if (result[4] !== 1 || await read("contentRefOf", [result[5]]) !== p.contentRef || await read("cost", [result[5]]) !== BigInt(p.amountBaseUnits)) throw Error("Acceptance verification failed.");
    p.status = "Accepted"; p.projectId = String(result[5]); p.acceptanceTransactionHash = acceptedTx.transactionHash;
    save(receiptsPath, receipts);
    console.log(`Accepted ${Number(id) + 1}/15: ${p.title}`);
    if (!rehearsal) await Bun.sleep(1200);
  }
  if (await read("proposalCount") !== 15n || await read("projectCount") !== 15n || await read("votingOpen")) throw Error("Unexpected final pool state.");
  Object.assign(receipts, { verifiedAt: new Date().toISOString(), requestedTotalBaseUnits: queue.reduce((sum, p) => sum + BigInt(p.amountBaseUnits), 0n).toString() });
  save(receiptsPath, receipts);
  console.log(`${rehearsal ? "REHEARSAL" : "ARC IMPORT"} PASSED: 15 proposals accepted; voting remains closed.`);
}
async function main() {
  const rehearsal = process.argv.includes("--rehearse");
  if (!rehearsal && !process.argv.includes("--broadcast")) throw Error("Pass --rehearse or --broadcast for the approved public demo.");
  const state = structuredClone(loadState());
  if (!rehearsal) {
    const option = process.argv.indexOf("--rpc");
    const rpc = option >= 0 ? process.argv[option + 1] : state.rpc ?? "https://rpc.testnet.arc.io";
    // Verify a documented live endpoint against the known deployment before
    // rebinding the journal. Keep every signed transaction and nonce intact.
    if (rpc !== state.rpc) {
      const allowed = ["https://rpc.testnet.arc.io", "https://rpc.testnet.arc.network", "https://rpc.quicknode.testnet.arc.network", "https://rpc.blockdaemon.testnet.arc.network", "https://rpc.drpc.testnet.arc.network"];
      if (!allowed.includes(rpc)) throw Error("RPC migration must use an official Arc Testnet endpoint.");
      const check = createPublicClient({ transport: http(rpc) });
      const deployment = state.transactions.eurcPool;
      const receipt = await check.getTransactionReceipt({ hash: deployment.hash });
      if (await check.getChainId() !== 5042002 || receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== target || String(receipt.blockNumber) !== deployment.blockNumber) throw Error("Alternate endpoint does not match the deployed Arc pool.");
      (state.rpcHistory ??= []).push({ previous: state.rpc, next: rpc, verifiedAt: new Date().toISOString() });
      state.rpc = rpc;
      save(resolve(root, "demo/.local/state.json"), state);
    }
    return run(state, rpc, false);
  }
  const rpc = "http://127.0.0.1:8554";
  const node = spawn("anvil", ["--host", "127.0.0.1", "--port", "8554", "--chain-id", "5042002", "--fork-url", "https://rpc.testnet.arc.io", "--silent"], { stdio: "ignore" });
  try {
    delete state.rpc;
    state.transactions = {};
    for (let i = 0; ; i++) {
      try { const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); if (response.ok) break; } catch {}
      if (i === 100) throw Error("Local fork did not start.");
      await Bun.sleep(100);
    }
    await run(state, rpc, true);
  } finally { node.kill(); }
}
if (import.meta.main) main().catch(error => { console.error("Import stopped: " + String(error.shortMessage || error.message).replace(/0x[0-9a-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 240)); process.exitCode = 1; });
