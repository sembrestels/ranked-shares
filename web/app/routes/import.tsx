import { useState } from "react";
import { usePublicClient } from "wagmi";
import { chain, useSwarm } from "../context/providers";
import { ImportPanel } from "../components/proposals/import-panel";
import { parseImportPlan, uploadImport, type ImportPlan } from "../lib/proposal-import";
import { sharingKey } from "../lib/private-proposals";
import { errorMessage } from "../lib/proposals";

const journalKey = (plan: ImportPlan) => `ranked-shares:import:${plan.chainId}:${plan.rounds.map(r => r.pool.toLowerCase()).join(":")}`;
export function meta() { return [{ title: "Import proposals · RankedShares" }]; }
export default function ImportPage() {
  const { client, info } = useSwarm();
  const rpc = usePublicClient({ chainId: chain.id });
  const [plan, setPlan] = useState<ImportPlan>();
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  let key: string | undefined;
  try { if (client && info?.identity) key = `0x${sharingKey(client)}`; } catch { /* connection UI explains missing identity */ }
  async function load(file: File) {
    setError(undefined); setStatus("");
    try {
      if (file.size > 2_000_000) throw new Error("Choose an import plan smaller than 2 MB.");
      const next = parseImportPlan(await file.text());
      if (next.chainId !== chain.id) throw new Error("The plan targets a different network.");
      const journal = JSON.parse(localStorage.getItem(journalKey(next)) || "{}");
      for (const round of next.rounds) for (const row of round.proposals) {
        const saved = journal[`${round.pool}:${row.sha256}:${row.proposer}:${round.organizerSharingPublicKey}`];
        if (saved && !row.privateReference) Object.assign(row, saved);
      }
      setPlan(parseImportPlan(JSON.stringify(next)));
    } catch (err) { setError(errorMessage(err)); }
  }
  function checkpoint(next: ImportPlan) {
    setPlan(structuredClone(next));
    // Store only public references/context, never private plaintext or AES keys.
    const journal = Object.fromEntries(next.rounds.flatMap(round => round.proposals.filter(row => row.privateReference).map(row => [
      `${round.pool}:${row.sha256}:${row.proposer}:${round.organizerSharingPublicKey}`, { privateReference: row.privateReference, keyHash: row.keyHash },
    ])));
    localStorage.setItem(journalKey(next), JSON.stringify(journal));
  }
  async function upload() {
    if (!plan || !rpc || !client || busy) return;
    setBusy(true); setError(undefined);
    try { await uploadImport(structuredClone(plan), rpc, client, setStatus, checkpoint); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  function download() {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "encrypted-proposal-uploads.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <div className="page-heading"><p className="eyebrow">Private review</p><h1>Bring your<br /><em>proposals together.</em></h1><p>Upload a prepared collection to Swarm, then submit it with your organizer wallet.</p></div>
    <ImportPanel plan={plan} sharingKey={key} busy={busy} status={status} error={error} onFile={load} onUpload={upload} onDownload={download} />
  </>;
}
