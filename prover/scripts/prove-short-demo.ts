// Prove the short Arc demo using the existing encrypted organizer account.
// No private key or tallier secret is placed in argv or printed to the terminal.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { hexToBytes, toHex } from "viem";
import { artifact, local, master, operator, save } from "../../cre/scripts/demo";
import { loadShort, publishShort, runName, shortStatePath } from "../../cre/scripts/short-round-demo";
import { deriveSk } from "../src/core/key";
import { read, readPoolSnapshot } from "../src/core/chain";
import { rebuild } from "../src/core/state";
import { Prover, type ProofOut } from "../src/core/prove";
import { ingestInputs, tallyInputs } from "../src/core/witness";
import { planTally } from "../src/core/submit";
import { audit } from "../src/core/audit";

async function main() {
  const state = loadShort(), pool = state.rounds.EURC.pool;
  const op = operator(state, state.rpc, shortStatePath);
  await op.guard();
  const fromBlock = BigInt(state.transactions.eurcPool.blockNumber);
  const abi = artifact("NoirRankedShares").abi;
  if (Number(await read(op.pub, pool, "finality")) === 0) {
    const snapshot = await readPoolSnapshot(op.pub, pool, fromBlock);
    if (!snapshot.resultReported || /^0x0+$/.test(snapshot.inputsRoot)) throw Error("Close the pool and report its transcript before proving.");
    const plan = rebuild(snapshot, deriveSk(master(), hexToBytes(snapshot.keySalt)));
    if (plan.tallyError) throw Error(plan.tallyError);
    const jobId = `${snapshot.inputsRoot}:${snapshot.transcriptHash}:${plan.profile.name}`;
    const cachePath = resolve(local, `${runName}-proofs.json`);
    const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { jobId, proofs: {} };
    if (cache.jobId !== jobId) throw Error("Saved proofs belong to different committed inputs.");
    const prover = await Prover.create(plan.profile.name as "default", 4);
    const outputs: ProofOut[] = [];
    let restart = false;
    try {
      const prove = async (kind: "ingest" | "tally", index: number) => {
        const expected = (kind === "ingest" ? plan.expected.ingest[index] : plan.expected.tally[index]).map(x => toHex(x, { size: 32 }));
        const key = `${kind}:${index}:${createHash("sha256").update(JSON.stringify(expected)).digest("hex")}`;
        const saved = cache.proofs[key];
        let out: ProofOut;
        if (saved) {
          out = { proof: hexToBytes(saved.proof), publicInputs: saved.publicInputs };
        } else {
          console.log(`Proving ${kind} ${index} (${plan.profile.name} circuit profile)`);
          out = await prover.prove(kind, kind === "ingest" ? ingestInputs(plan, index) : tallyInputs(plan, index));
          cache.proofs[key] = { proof: toHex(out.proof), publicInputs: out.publicInputs };
          save(cachePath, cache);
        }
        if (JSON.stringify(out.publicInputs.map(x => x.toLowerCase())) !== JSON.stringify(expected) || !await prover.verify(kind, out)) throw Error(`Invalid ${kind} proof ${index}.`);
        outputs.push(out);
        console.log(`Verified ${kind} proof ${index}`);
      };
      for (let k = snapshot.ingestCursor; k < plan.expected.ingest.length; k++) await prove("ingest", k);
      const decision = snapshot.ingestCursor < plan.expected.ingest.length ? { g: 0, restart: false } : planTally(snapshot.stateCommit, plan);
      if (decision !== "proven") {
        restart = decision.restart;
        for (let g = decision.g; g < plan.tallyGroups.length; g++) await prove("tally", g);
      }
      if (outputs.length && Number(await read(op.pub, pool, "finality")) === 0) {
        const receipt = await op.write(`proofs:${snapshot.ingestCursor}:${snapshot.stateCommit}`, pool, abi, "advanceMany", [outputs.map(p => toHex(p.proof)), outputs.map(p => p.publicInputs), restart]);
        state.proofTransactions = [...(state.proofTransactions ?? []), receipt.transactionHash];
        op.remember(); publishShort(state);
        console.log(`Accepted ${outputs.length} proofs in ${receipt.transactionHash}`);
      }
    } finally { await prover.destroy(); }
  }
  const [finality, funded, spent] = await Promise.all([
    read<number>(op.pub, pool, "finality"), read<bigint[]>(op.pub, pool, "fundedProjects"), read<bigint>(op.pub, pool, "spent"),
  ]);
  if (Number(finality) !== 1) throw Error(`Expected Proven finality, found ${finality}.`);
  if (funded.map(Number).join(",") !== state.expectedFunded.join(",") || String(spent) !== state.expectedSpent) throw Error("Final result differs from the demo's verified vote plan.");
  const result = await audit(op.pub, pool, fromBlock);
  if (!result.ok) throw Error(result.firstProblem ?? "Public audit failed.");
  Object.assign(state, { finality: "Proven", fundedProjects: funded.map(Number), spentBaseUnits: String(spent), auditedAt: new Date().toISOString() });
  op.remember(); publishShort(state);
  console.log(`Proven and publicly audited: ${funded.length} projects funded, ${Number(spent) / 1e6} EURC allocated.`);
}
main().catch(error => { console.error(`Proof run stopped: ${String(error.shortMessage ?? error.message).replace(/0x[\da-fA-F]{64,}/g, "[hex data]").split("\n")[0].slice(0, 250)}`); process.exitCode = 1; });
