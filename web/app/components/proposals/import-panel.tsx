import { Button, Field, Input, Notice } from "../ui";
import type { ImportPlan } from "../../lib/proposal-import";

export function ImportPanel({ plan, sharingKey, busy, status, error, onFile, onUpload, onDownload }: {
  plan?: ImportPlan; sharingKey?: string; busy: boolean; status: string; error?: string;
  onFile: (file: File) => void; onUpload: () => void; onDownload: () => void;
}) {
  return <section className="panel stack" aria-label="Proposal import">
    <Field id="import-plan" label="Prepared import plan" hint="Choose the JSON plan created for your deployed pools. Completed uploads can be resumed.">
      <Input id="import-plan" type="file" accept="application/json,.json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
    </Field>
    {sharingKey && <Field id="sharing-key" label="Your Swarm ID sharing public key" hint="Register this public key for both organizers before uploading.">
      <Input id="sharing-key" readOnly value={sharingKey} onFocus={e => e.target.select()} />
    </Field>}
    {plan && <ul className="files">{plan.rounds.map(round => <li key={round.pool}>
      <strong>{round.currency}</strong> · {round.proposals.length} proposals · {round.proposals.filter(p => p.privateReference).length} uploaded
    </li>)}</ul>}
    <p className="hint">Connect the organizer’s Swarm ID above. Each proposal is encrypted, downloaded again, and verified. The receipt file lets the Foundry operator submit the proposals for review.</p>
    <div className="actions">
      <Button disabled={busy || !plan || !sharingKey} onClick={onUpload}>{busy ? "Uploading…" : "Upload and verify proposals"}</Button>
      <Button variant="secondary" disabled={!plan} onClick={onDownload}>Download receipts</Button>
    </div>
    {status && <Notice>{status}</Notice>}
    {error && <Notice error>{error}</Notice>}
  </section>;
}
