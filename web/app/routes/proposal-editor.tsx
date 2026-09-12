import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, formatUnits, type Hex } from "viem";
import { chain, useRound, useSwarm } from "../context/providers";
import {
  errorMessage,
  type Proposal,
  proposalAbi,
  proposalTerms,
} from "../lib/proposals";
import { type ProposalContent, uploadProposal } from "../lib/swarm";
import { assertWallet, sendProposalTransaction } from "../lib/transactions";
import {
  type FormValues,
  SubmitForm,
} from "../components/proposals/submit-form";
import { Button, Fact, Notice } from "../components/ui";

export function ProposalEditor(
  {
    base,
    current,
    content,
    symbol,
    decimals,
    canEdit,
    onClose,
    onSaved,
    onReload,
  }: {
    base: Proposal;
    current: Proposal;
    content: ProposalContent;
    symbol: string;
    decimals: number;
    canEdit: boolean;
    onClose: () => void;
    onSaved: () => void;
    onReload: () => void;
  },
) {
  const { pool } = useRound();
  const { address, chainId } = useAccount();
  const { client, info } = useSwarm();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { data: wallet } = useWalletClient();
  const query = useQueryClient();
  const [value, setValue] = useState<FormValues>({
    title: content.title,
    body: content.body,
    attachments: content.attachments,
    files: [],
    amount: formatUnits(base.cost, decimals),
    recipient: base.recipient,
  });
  const [prepared, setPrepared] = useState<{
    reference: Hex;
    title: string;
    cost: bigint;
    recipient: `0x${string}`;
  }>();
  const [pending, setPending] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const stale = base.revision !== current.revision;
  const unavailable = !canEdit || current.status !== 0;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setMessage("");
      await query.invalidateQueries({ queryKey: ["pool"] });
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!client || !publicClient || !wallet || !address) {
      throw new Error(
        "Connect your wallet and Swarm ID before uploading an edit.",
      );
    }
    if (stale || unavailable) {
      throw new Error(
        "This revision can no longer be edited. Read the latest proposal first.",
      );
    }
    const terms = proposalTerms(value.amount, value.recipient, decimals);
    await assertWallet(publicClient, wallet, address);
    const reference = await uploadProposal(client, value, setMessage);
    setPrepared({ reference, title: value.title, ...terms });
    setMessage(
      "Revision uploaded. Review the details, then save it to the proposal.",
    );
  }

  async function save() {
    if (!prepared || !publicClient || !wallet || !address || !pool) return;
    let hash = pending;
    if (!hash) {
      if (stale || unavailable) {
        throw new Error(
          "This revision can no longer be edited. Read the latest proposal first.",
        );
      }
      setMessage("Confirm the revision in your wallet…");
      hash = await sendProposalTransaction(
        publicClient,
        wallet,
        address,
        pool,
        {
          functionName: "editProposal",
          args: [
            base.id,
            base.revision,
            prepared.reference,
            prepared.cost,
            prepared.recipient,
          ],
        },
      );
      setPending(hash);
    }
    setMessage("Waiting for the revision to confirm…");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      onReplaced: ({ transaction }) => setPending(transaction.hash),
    });
    setPending(undefined);
    if (receipt.status !== "success") {
      throw new Error(
        "The revision transaction reverted. Your upload is still available to retry.",
      );
    }
    const saved = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== pool.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: proposalAbi, ...log });
        return event.eventName === "ProposalEdited" &&
          event.args.proposalId === base.id &&
          event.args.revision === base.revision + 1n &&
          event.args.editor.toLowerCase() === address.toLowerCase() &&
          event.args.contentRef === prepared.reference &&
          event.args.cost === prepared.cost &&
          event.args.recipient.toLowerCase() ===
            prepared.recipient.toLowerCase();
      } catch {
        return false;
      }
    });
    if (!saved) {
      throw new Error(
        "The transaction was replaced or cancelled without saving this revision. You can retry.",
      );
    }
    await query.invalidateQueries({ queryKey: ["pool"] });
    onSaved();
  }

  return (
    <section
      className="surface stack"
      aria-label={`Edit proposal ${base.id + 1n}`}
    >
      <div className="section-heading">
        <h2>Edit proposal #{base.id + 1n}</h2>
        <span className="hint">Based on revision {String(base.revision)}</span>
      </div>
      <p className="hint">
        You and the organizer can update the text, attachments, amount, and
        recipient while review is pending. Acceptance locks the reviewed
        revision. Earlier uploads remain on Swarm.
      </p>
      {stale && (
        <Notice error>
          Someone saved a newer revision. Your draft is kept here; compare it
          with the latest proposal before saving again.
        </Notice>
      )}
      {unavailable && (
        <Notice>
          This proposal can no longer be edited. You can still copy your draft.
        </Notice>
      )}
      {!info?.canUpload && (
        <Notice>
          Connect Swarm ID with available storage to upload your changes.
        </Notice>
      )}
      {prepared
        ? (
          <div className="stack">
            <h3>{prepared.title}</h3>
            <dl className="facts">
              <Fact label="Requested">
                {formatUnits(prepared.cost, decimals)} {symbol}
              </Fact>
              <Fact label="Recipient">
                <code>{prepared.recipient}</code>
              </Fact>
              <Fact label="New Swarm reference">
                <code>{prepared.reference.slice(2)}</code>
              </Fact>
            </dl>
            <Button
              disabled={busy || !wallet || chainId !== chain.id ||
                (!pending && (stale || unavailable))}
              onClick={() => act(save)}
            >
              {busy
                ? "Saving…"
                : pending
                ? "Check revision transaction"
                : "Save revision"}
            </Button>
            {!pending && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPrepared(undefined);
                  setMessage("");
                }}
              >
                Continue editing
              </Button>
            )}
          </div>
        )
        : (
          <SubmitForm
            value={value}
            onChange={setValue}
            onUpload={() => act(upload)}
            busy={busy}
            disabled={stale || unavailable || chainId !== chain.id || !wallet ||
              !client || !info?.identity || !info.canUpload}
            symbol={symbol}
            submitLabel="Upload revised proposal"
          />
        )}
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {pending && <code>{pending}</code>}
      <div className="actions">
        {stale && !unavailable && (
          <Button
            variant="secondary"
            disabled={busy || !!pending}
            onClick={onReload}
          >
            Discard edits and load latest revision
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy || !!pending}
          onClick={onClose}
        >
          Cancel editing
        </Button>
      </div>
    </section>
  );
}
