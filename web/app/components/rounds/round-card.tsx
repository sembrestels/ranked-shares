import { Link } from "react-router";
import type { RoundSnapshot } from "../../lib/api-types";
import { roundHref, roundName, roundStatus, type RoundEntry } from "../../lib/round-directory";
import { formatDateTime } from "../../lib/format";
import { Badge, Button, Money } from "../ui";

export function RoundCard({ entry, snapshot, failed, now, onRetry }: {
  entry: RoundEntry; snapshot?: RoundSnapshot; failed: boolean; now: number; onRetry: () => void;
}) {
  return <li className="round-card">
    <div className="round-card-heading">
      <div>
        <h2><Link to={roundHref(entry.pool)}>{roundName(entry)}</Link></h2>
        <code className="hint">{entry.pool}</code>
      </div>
      <Badge tone={failed ? "error" : snapshot?.phase === "open" && now < snapshot.votingDeadline ? "success" : "neutral"}>
        {failed ? "Refresh unavailable" : snapshot ? roundStatus(snapshot, now) : "Loading…"}
      </Badge>
    </div>
    {snapshot && <dl className="round-card-facts">
      <div><dt>In the pool</dt><dd><Money amount={snapshot.totalWeight} decimals={snapshot.token.decimals} symbol={snapshot.token.symbol} /></dd></div>
      <div><dt>Proposals</dt><dd>{snapshot.proposalCount}</dd></div>
      <div><dt>Voting deadline</dt><dd>{formatDateTime(snapshot.votingDeadline)}</dd></div>
    </dl>}
    <div className="round-card-bottom">
      {failed ? <div className="actions"><span className="hint">{snapshot ? "Showing the last snapshot." : "Round details could not load."}</span><Button variant="secondary" onClick={onRetry}>Retry</Button></div> : <span className="hint">{snapshot ? `${snapshot.voterCount} voters` : "Reading round status…"}</span>}
      <Link className="round-open" to={roundHref(entry.pool)} aria-label={`Open ${roundName(entry)}`}>Open round <span aria-hidden="true">↗</span></Link>
    </div>
  </li>;
}
