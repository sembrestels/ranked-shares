import { Link } from "react-router";
import type { RoundSnapshot } from "../../lib/api-types";
import { fundingTreemap, proposalFunding, type FundingTile, type ProposalFunding, type PublicFunding } from "../../lib/funding";
import { roundHref } from "../../lib/round-directory";
import { Badge, Money } from "../ui";
import { projectName } from "./board";

type Token = RoundSnapshot["token"];

function FundingMapTile({ tile, row, token }: { tile: FundingTile; row: ProposalFunding; token: Token }) {
  return (
    <div className="funding-map-cell" style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%` }}>
      <div className={`funding-map-tile funding-fill-${row.fill}`}>
        <div className="funding-map-fill" style={{ height: `${row.coverage}%` }} />
        <div className="funding-map-label">
          <span className="funding-number">{row.project.id + 1}</span>
          <span className="funding-map-name">{projectName(row.project)}</span>
        </div>
        <div className="funding-map-amount">
          <span className="funding-map-caption">Asking</span>
          <Money amount={row.asking} {...token} maxFraction={token.decimals} />
          <span className="funding-map-caption">
            {row.receiving !== null
              ? <><Money amount={row.receiving} {...token} maxFraction={token.decimals} /> receiving</>
              : row.support !== null ? <><Money amount={row.support} {...token} maxFraction={token.decimals} /> public support</> : row.status}
          </span>
          {row.receiving !== null && <span className="funding-map-caption">{row.status}</span>}
        </div>
      </div>
    </div>
  );
}

function FundingAmountRow({ row, token, pool }: { row: ProposalFunding; token: Token; pool: RoundSnapshot["pool"] }) {
  return (
    <li className="funding-amount-row">
      <div className="funding-proposal-name">
        <span className="funding-number" aria-hidden="true">{row.project.id + 1}</span>
        <div>
          <Link to={roundHref(pool, `/project/${row.project.id}`)}>{projectName(row.project)}</Link>
          {row.support !== null && (
            <p className="funding-support-amount">Public support: <Money amount={row.support} {...token} maxFraction={token.decimals} /></p>
          )}
        </div>
      </div>
      <dl className="funding-amounts">
        <div>
          <dt>Asking</dt>
          <dd><Money amount={row.asking} {...token} maxFraction={token.decimals} /></dd>
        </div>
        <div>
          <dt>Receiving</dt>
          <dd>{row.receiving === null ? "Not decided" : <Money amount={row.receiving} {...token} maxFraction={token.decimals} />}</dd>
          <dd className="funding-payment-status">{row.status}</dd>
        </div>
      </dl>
    </li>
  );
}

/** Cost-scaled visual plus a complete, accessible list of the exact amounts. */
export function FundingWall({ snapshot: s, live, liveError = false }: {
  snapshot: RoundSnapshot;
  live?: PublicFunding;
  liveError?: boolean;
}) {
  const rows = proposalFunding(s, live);
  const byId = new Map(rows.map((row) => [row.project.id, row]));
  const tiles = fundingTreemap(s.projects);
  const requested = rows.reduce((sum, row) => sum + row.asking, 0n);
  const allocationKnown = !!s.finality || (s.ballots === "arkiv" && !!live);
  const allocated = rows.reduce((sum, row) => sum + (row.receiving ?? 0n), 0n);
  const projected = !s.finality && s.ballots === "arkiv" && !!live;
  const hasSupport = rows.some((row) => row.support !== null);
  const view = s.finality === "abandoned" ? "Abandoned"
    : s.finality === "attested" ? "Provisional allocation"
    : s.finality ? "Final allocation" : "Live public view";
  return (
    <section className="funding-wall" aria-labelledby="funding-heading">
      <div className="funding-heading">
        <div>
          <h2 id="funding-heading">Proposal funding</h2>
          <p>What each proposal asks for, and how much it is receiving.</p>
        </div>
        <Badge tone={s.finality === "abandoned" ? "error" : s.finality && s.finality !== "attested" ? "success" : "info"}>{view}</Badge>
      </div>
      {rows.length === 0 ? <p className="funding-empty">Accepted proposals will appear here with their requested budgets.</p> : (
        <>
          <dl className="funding-totals">
            <div><dt>Total requested</dt><dd><Money amount={requested} {...s.token} maxFraction={s.token.decimals} /></dd></div>
            <div><dt>{projected ? "Projected allocation" : "Allocated"}</dt><dd>{allocationKnown ? <Money amount={allocated} {...s.token} maxFraction={s.token.decimals} /> : "Not decided"}</dd></div>
            <div><dt>{s.projects.length === 1 ? "Proposal" : "Proposals"}</dt><dd>{s.projects.length}</dd></div>
          </dl>
          {tiles.length > 0 && (
            <div className="funding-map" aria-hidden="true">
              {tiles.map((tile) => <FundingMapTile key={tile.id} tile={tile} row={byId.get(tile.id)!} token={s.token} />)}
            </div>
          )}
          <div className="funding-legend">
            <span>Tile area = amount requested</span>
            {allocationKnown && <span><i className="funding-key funding-key-allocated" />{projected ? "Projected funding" : "Allocated funding"}</span>}
            {hasSupport && <span><i className="funding-key funding-key-support" />Public support</span>}
          </div>
          {!s.finality && (
            <p className="funding-note">
              {projected ? "Receiving amounts are projections from public ballots, not payments." : "Receiving amounts are decided when the round is tallied."}
              {hasSupport && " Public support counts first-choice commitments; tied choices can share the same support."}
              {s.kind !== "plain" && " Sealed ballots are not included in this public view."}
            </p>
          )}
          {!s.finality && s.ballots === "arkiv" && !live && (
            <p className="funding-note" role="status">{liveError ? "Public funding is unavailable. Requested amounts are still shown." : "Computing public funding from ballots…"}</p>
          )}
          {!s.finality && s.ballots !== "arkiv" && !s.sealed.commitmentsAvailable && (
            <p className="funding-note">Public support is unavailable for this pool variant. Allocations appear after the tally.</p>
          )}
          {projected && live && (live.block !== s.block || liveError) && (
            <p className="funding-note" role="status">Showing the last public projection from block {live.block}.{liveError ? " The refresh failed." : " Updating…"}</p>
          )}
          {s.finality && s.finality !== "abandoned" && <p className="funding-note">Receiving is the allocated amount. Paid means the recipient has claimed it.</p>}
          <ul className="funding-amount-list" aria-label="Proposal funding amounts">
            {rows.map((row) => <FundingAmountRow key={row.project.id} row={row} token={s.token} pool={s.pool} />)}
          </ul>
        </>
      )}
    </section>
  );
}
