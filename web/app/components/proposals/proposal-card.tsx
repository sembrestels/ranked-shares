import { formatUnits } from "viem";
import { Badge, Button, Fact, Notice } from "../ui";
import { type Proposal, statuses } from "../../lib/proposals";
import type { Attachment, ProposalContent } from "../../lib/swarm";

export function ProposalCard(
  {
    proposal,
    content,
    symbol,
    decimals,
    canReview,
    busy,
    error,
    onRead,
    onDownload,
    onAttachment,
    onReview,
    canEdit = false,
    onEdit,
    privateReview = false,
  }: {
    proposal: Proposal;
    content?: ProposalContent;
    symbol: string;
    decimals: number;
    canReview: boolean;
    busy: boolean;
    error?: string;
    onRead: () => void;
    onDownload: () => void;
    onAttachment: (file: Attachment) => void;
    onReview: (accept: boolean) => void;
    canEdit?: boolean;
    onEdit?: () => void;
    privateReview?: boolean;
  },
) {
  return (
    <article className="proposal-card">
      <div className="card-top">
        <span className="eyebrow">
          Proposal {proposal.id + 1n}
        </span>
        <Badge tone={(["info", "success", "error"] as const)[proposal.status] ?? "neutral"}>
          {statuses[proposal.status] ?? "Unknown status"}
        </Badge>
      </div>
      <h2>{content?.title || `Proposal #${proposal.id + 1n}`}</h2>
      {privateReview && (
        <p className="hint">
          Private review · only the proposer and organizer can read this revision. Acceptance keeps
          it private until voting opens.
        </p>
      )}
      <dl className="facts">
        <Fact label="Requested">
          {formatUnits(proposal.cost, decimals)} {symbol}
        </Fact>
        <Fact label="Proposer">
          <code>{proposal.proposer}</code>
        </Fact>
        <Fact label="Revision">{String(proposal.revision)}</Fact>
        <Fact label="Last saved by">
          <code>{proposal.editor}</code>
        </Fact>
        <Fact label="Recipient">
          <code>{proposal.recipient}</code>
        </Fact>
        <Fact label="Swarm reference">
          <code>{proposal.contentRef.slice(2)}</code>
        </Fact>
        {proposal.status === 1 && <Fact label="Voting project">#{proposal.projectId + 1n}</Fact>}
      </dl>
      {content && <div className="proposal-body">{content.body}</div>}
      {content && content.attachments.length > 0 && (
        <ul className="files">
          {content.attachments.map((file, i) => (
            <li key={i}>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onAttachment(file)}
              >
                Download {file.name}
              </Button>
              <span className="hint">{file.size.toLocaleString()} bytes</span>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="actions">
        {!content && (
          <Button variant="secondary" disabled={busy} onClick={onRead}>
            {busy ? "Working…" : "Read proposal"}
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onDownload}>
          Download content
        </Button>
        {canEdit && proposal.status === 0 && (
          <Button variant="secondary" disabled={busy} onClick={onEdit}>
            Edit proposal
          </Button>
        )}
        {canReview && proposal.status === 0 && (
          <>
            <Button disabled={busy} onClick={() => onReview(true)}>
              Accept proposal
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => onReview(false)}
            >
              Reject proposal
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
