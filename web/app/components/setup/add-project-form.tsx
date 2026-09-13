import { type FormEvent, useState } from "react";
import type { Address } from "viem";
import { proposalTerms } from "../../lib/proposals";
import { Button, Field, Input, Notice } from "../ui";

export function AddProjectForm(
  { symbol, decimals, disabled, busy, onSubmit, error }: {
    symbol: string;
    decimals: number;
    disabled: boolean;
    busy: boolean;
    onSubmit: (cost: bigint, recipient: Address) => void;
    error?: string;
  },
) {
  const [cost, setCost] = useState("");
  const [recipient, setRecipient] = useState("");
  const [problem, setProblem] = useState<string>();
  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(undefined);
    try {
      const { cost: parsed, recipient: to } = proposalTerms(cost, recipient, decimals);
      onSubmit(parsed, to);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Enter a valid amount and recipient.");
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border border-edge bg-surface p-6" aria-label="Add a project">
      <h2 className="font-heading text-xl">Add a project directly</h2>
      <Field id="add-cost" label={`Cost (${symbol})`}>
        <Input id="add-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={disabled} />
      </Field>
      <Field id="add-recipient" label="Recipient address">
        <Input id="add-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={disabled} />
      </Field>
      {(problem || error) && <Notice error>{problem ?? error}</Notice>}
      <Button type="submit" disabled={disabled || busy}>{busy ? "Adding…" : "Add project"}</Button>
    </form>
  );
}
