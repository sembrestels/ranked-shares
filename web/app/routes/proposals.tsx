import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { chain, useRound, useSwarm } from "../context/providers";
import { PAGE_SIZE, usePool } from "../hooks/use-pool";
import { errorMessage, type Proposal } from "../lib/proposals";
import { type Attachment, saveDownload } from "../lib/swarm";
import {
  downloadAttachment,
  readProposal,
  readProposalContent,
  type ReviewedContent,
  ZERO_KEY,
} from "../lib/private-proposals";
import { sendProposalTransaction } from "../lib/transactions";
import { ProposalCard } from "../components/proposals/proposal-card";
import { Button, Notice } from "../components/ui";
import { ProposalEditor } from "./proposal-editor";

export default function BoardPage() {
  return <ProposalBoard />;
}
export function ProposalBoard({ review = false }: { review?: boolean }) {
  const { pool } = useRound();
  return <Board key={pool} review={review} />;
}

function Board({ review }: { review: boolean }) {
  const [page, setPage] = useState(0);
  const round = usePool(page);
  const { pool } = useRound();
  const { address } = useAccount();
  const { info } = useSwarm();
  const owner = !!address &&
    address.toLowerCase() === round.data?.owner.toLowerCase();
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">
          {review ? "The organizer's desk" : "The proposal board"}
        </p>
        <h1>
          {review
            ? (
              <>
                Good ideas.<br />
                <em>Your call.</em>
              </>
            )
            : (
              <>
                Ideas from<br />
                <em>the community.</em>
              </>
            )}
        </h1>
        <p>
          {review
            ? "Review submissions and choose the projects that will go to a vote."
            : "Follow submissions and the organizer's decisions. Private pitches become readable when voting opens."}
        </p>
      </div>
      <div className="section-heading">
        <span className="eyebrow">
          {round.data ? `${round.data.count} submissions` : "Submissions"}
        </span>
        <Button
          variant="secondary"
          disabled={!pool || round.isFetching}
          onClick={() => round.refetch()}
        >
          {round.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {!pool && <Notice>Choose a round above to see its proposals.</Notice>}
      {pool && round.isPending && <Notice>Loading proposals…</Notice>}
      {round.isError && (
        <Notice error>
          Could not load proposals. Check the round address and network, and
          that this pool supports submissions. {errorMessage(round.error)}
        </Notice>
      )}
      {review && round.data && !owner && (
        <Notice>
          Connect the organizer wallet to accept or reject proposals. Organizer: {round.data.owner}
        </Notice>
      )}
      {round.data && !round.data.canSubmit && (
        <Notice>
          Submissions and review are closed. Existing decisions remain visible.
        </Notice>
      )}
      {round.data?.count === 0n && (
        <div className="empty">
          <h2>The first idea could be yours.</h2>
          <p>Proposals submitted to this round will appear here.</p>
        </div>
      )}
      <div className="stack">
        {round.data?.proposals.map((proposal) => (
          <ProposalEntry
            key={`${proposal.id}-${address}-${info?.identity?.id}-${info?.appKey?.publicKey}`}
            proposal={proposal}
            symbol={round.data.symbol}
            decimals={round.data.decimals}
            organizerPublicKey={round.data.organizerPublicKey}
            canReview={review && owner && round.data.canSubmit}
            canEdit={round.data.canSubmit && !!proposal.keyHash && proposal.keyHash !== ZERO_KEY &&
              (owner ||
                proposal.proposer.toLowerCase() === address?.toLowerCase())}
          />
        ))}
      </div>
      {round.data && round.data.count > PAGE_SIZE && (
        <nav className="pagination" aria-label="Proposal pages">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() =>
              setPage((p) =>
                p - 1
              )}
          >
            Previous
          </Button>
          <span>Page {page + 1}</span>
          <Button
            variant="secondary"
            disabled={BigInt(page + 1) * PAGE_SIZE >= round.data.count}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </>
  );
}

function ProposalEntry(
  { proposal, symbol, decimals, canReview, canEdit, organizerPublicKey }: {
    proposal: Proposal;
    symbol: string;
    decimals: number;
    canReview: boolean;
    canEdit: boolean;
    organizerPublicKey?: string;
  },
) {
  const { pool } = useRound();
  const { client } = useSwarm();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { data: wallet } = useWalletClient();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<
    { revision: bigint; content: ReviewedContent }
  >();
  const content = loaded?.revision === proposal.revision
    ? loaded.content
    : undefined;
  const [editing, setEditing] = useState<
    { base: Proposal; content: ReviewedContent }
  >();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<`0x${string}`>();
  const privateReview = !!proposal.keyHash && proposal.keyHash !== ZERO_KEY;
  const readOptions = {
    keyHash: proposal.keyHash,
    publishedKey: proposal.publishedKey,
    ...(privateReview && pool && organizerPublicKey
      ? { context: { chainId: chain.id, pool, proposer: proposal.proposer, organizerPublicKey } }
      : {}),
  };

  async function act(action: () => Promise<void>) {
    setError(undefined);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  function storage() {
    if (!client) {
      throw new Error(
        "Swarm ID is not ready. Wait for it to load, or retry its connection above.",
      );
    }
    return client;
  }
  async function attachment(file: Attachment) {
    saveDownload(await downloadAttachment(storage(), file), file.name);
  }
  async function confirm(hash: `0x${string}`) {
    if (!publicClient) throw new Error("Connect to the round network first.");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      onReplaced: ({ transaction }) => setPending(transaction.hash),
    });
    setPending(undefined);
    await queryClient.invalidateQueries({ queryKey: ["pool"] });
    if (receipt.status !== "success") {
      throw new Error(
        "The review transaction reverted. Refresh the proposal and try again.",
      );
    }
    setMessage(
      "Transaction confirmed. The proposal status has been refreshed.",
    );
  }
  async function review(accept: boolean) {
    if (!wallet || !publicClient || !address || !pool) {
      throw new Error("Connect the organizer wallet first.");
    }
    if (accept && privateReview) {
      setMessage("Checking access to the exact revision being accepted…");
      await readProposal(storage(), proposal.contentRef, { ...readOptions, preview: false });
    }
    setMessage(
      `Confirm ${accept ? "acceptance" : "rejection"} in your wallet…`,
    );
    const hash = await sendProposalTransaction(
      publicClient,
      wallet,
      address,
      pool,
      {
        functionName: accept ? "acceptProposal" : "rejectProposal",
        args: [proposal.id, proposal.revision],
      },
    );
    setPending(hash);
    setMessage("Waiting for the organizer's decision to confirm…");
    await confirm(hash);
  }
  async function edit() {
    const data = content || await readProposalContent(storage(), proposal.contentRef, readOptions);
    setLoaded({ revision: proposal.revision, content: data });
    setEditing({ base: proposal, content: data });
    setMessage("");
  }
  return (
    <div>
      <ProposalCard
        proposal={proposal}
        content={content}
        privateReview={privateReview &&
          (!proposal.publishedKey || proposal.publishedKey === ZERO_KEY)}
        symbol={symbol}
        decimals={decimals}
        canReview={canReview && chainId === chain.id && !pending && !editing}
        canEdit={canEdit && chainId === chain.id && !pending && !editing}
        onEdit={() => act(edit)}
        busy={busy}
        error={error}
        onRead={() =>
          act(async () =>
            setLoaded({
              revision: proposal.revision,
              content: await readProposalContent(storage(), proposal.contentRef, readOptions),
            })
          )}
        onDownload={() =>
          act(async () =>
            saveDownload(
              (await readProposal(storage(), proposal.contentRef, {
                ...readOptions,
                preview: false,
              })).data,
              `proposal-${proposal.id + 1n}.json`,
            )
          )}
        onAttachment={(file) => act(() => attachment(file))}
        onReview={(accept) => act(() => review(accept))}
      />
      {editing && (
        <ProposalEditor
          key={String(editing.base.revision)}
          base={editing.base}
          current={proposal}
          content={editing.content}
          symbol={symbol}
          decimals={decimals}
          canEdit={canEdit}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setMessage(
              "Revision saved. The proposal is still pending organizer review.",
            );
          }}
          onReload={() => act(edit)}
        />
      )}
      {message && <Notice>{message}</Notice>}
      {pending && (
        <div className="actions">
          <code>{pending}</code>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => confirm(pending))}
          >
            Check transaction
          </Button>
        </div>
      )}
    </div>
  );
}
