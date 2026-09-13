import { Button, Notice, Status } from "../ui";
import type { BallotReviewData, ReviewRow } from "../../lib/ballot-review";
import type { FundingTier, TierAssignments } from "../../lib/ballot-tiers";
import { TierList } from "./tier-list";
import type { ReactNode } from "react";

export function BallotForm(
  {
    titles,
    assignments,
    sealed,
    canPublic,
    canSealed,
    busy,
    disabledReason,
    contribution,
    submitLabel = "Vote",
    onAssign,
    onMode,
    onSubmit,
  }: {
    titles: string[];
    assignments: TierAssignments;
    sealed: boolean;
    canPublic: boolean;
    canSealed: boolean;
    busy: boolean;
    disabledReason?: string;
    contribution?: ReactNode;
    submitLabel?: string;
    onAssign: (id: number, tier: FundingTier | undefined) => void;
    onMode: (sealed: boolean) => void;
    onSubmit: () => void;
  },
) {
  return (
    <form
      className="proposal-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && (sealed ? canSealed : canPublic)) onSubmit();
      }}
    >
      <fieldset disabled={busy}>
        <legend>Choose which voting weight to use</legend>
        <label>
          <input
            type="radio"
            name="ballot-mode"
            checked={!sealed}
            disabled={!canPublic}
            onChange={() => onMode(false)}
          />{" "}
          Public ballot
        </label>
        <label>
          <input
            type="radio"
            name="ballot-mode"
            checked={sealed}
            disabled={!canSealed}
            onChange={() => onMode(true)}
          />{" "}
          Encrypted ballot · sponsored seats
        </label>
      </fieldset>
      <TierList titles={titles} assignments={assignments} disabled={busy} onAssign={onAssign} />
      {contribution}
      <p className="hint">
        {sealed
          ? "Your ranking is encrypted in this browser. Your wallet address and voting weight remain public."
          : "Your ranking is public and contributes to the live results."}{" "}
        Your vote is recorded on the round's network. Arkiv storage syncs
        automatically without another wallet transaction.
      </p>
      <p className="hint">
        New ballots expire from Arkiv approximately 15 days after voting closes.
        The storage operator can still extend or delete its entity. Transaction history
        and final results remain available.
      </p>
      <Button
        type="submit"
        aria-describedby={disabledReason ? "ballot-disabled-reason" : undefined}
        disabled={busy || (sealed ? !canSealed : !canPublic)}
      >
        {submitLabel}
      </Button>
      {disabledReason && <p id="ballot-disabled-reason" className="hint">{disabledReason}</p>}
    </form>
  );
}

export function BallotReviewRow({ row }: { row: ReviewRow }) {
  const labels = {
    available: "Available",
    "expiry-passed": "Expiry passed",
    unavailable: "Unavailable",
    invalid: "Payload does not match",
  };
  return (
    <li className="ballot-review-row">
      <p>
        <code>{row.voter}</code> · {row.isSealed ? "Encrypted" : "Public"}
        {" "}· revision {row.revision.toString()} · <Status>{labels[row.status]}</Status>
      </p>
      {row.payload && (
        <details>
          <summary>{row.isSealed ? "Inspect encrypted bytes" : "Inspect public ranks"}</summary>
          <code>{row.isSealed ? row.payload : row.payload.slice(2).match(/../g)?.map((v) => parseInt(v, 16)).join(", ")}</code>
        </details>
      )}
      <p className="hint">
        Ballot reference <code>{row.entityKey}</code>
        {row.expiresAt !== undefined && <> · last observed expiry block {row.expiresAt.toString()}</>}
      </p>
    </li>
  );
}

export function BallotReview(
  { data, error, loading, until, final, limit, onMore }: {
    data?: BallotReviewData;
    error?: string;
    loading: boolean;
    until: bigint;
    final: boolean;
    limit: number;
    onMore: () => void;
  },
) {
  const available = data?.rows.filter((r) => r.status === "available").length ?? 0;
  const ended = !!data?.rows.length && data.rows.every((r) => r.status === "expiry-passed");
  return (
    <section className="voting-results" aria-labelledby="ballot-review-title">
      <h2 id="ballot-review-title">Ballot review</h2>
      <p>
        New ballots are scheduled to expire around {new Date(Number(until) * 1000).toLocaleString()}.
        {" "}The cutoff follows the voting deadline, even if tallying takes longer.
      </p>
      {error ? <Notice error>Ballot availability could not be checked: {error} Cached ballot contents are hidden.</Notice>
        : !data ? <Notice>{loading ? "Checking current ballots in Arkiv…" : "Ballot availability has not been checked."}</Notice>
        : (
          <>
            <Notice>
              {ended ? "Ballot review period ended: the last observed expiry blocks have passed and no live payloads remain."
                : !data.rows.length ? "No ballots were accepted by this round."
                : available === 0 ? "No accepted ballot payloads are currently available in Arkiv."
                : `${available} of ${data.rows.length} accepted ballots are available for review.`}
              {final ? " The final on-chain result remains available." : " Tally recovery remains separate from this review."}
            </Notice>
            <ul className="ballot-review-list">
              {data.rows.slice(0, limit).map((row) => <BallotReviewRow key={`${row.voter}-${row.isSealed}`} row={row} />)}
            </ul>
            {data.rows.length > limit && <Button variant="secondary" onClick={onMore}>Show more ballots</Button>}
            {data.arkivBlock !== null && <p className="hint">Arkiv block {data.arkivBlock.toString()} · checked every 15 seconds</p>}
          </>
        )}
      <p className="hint">
        Review reads only live Arkiv entities. Missing data can also mean an owner
        deleted it; older ballots and owner extensions may outlive the default.
        Expiry does not erase transaction history or copies held elsewhere.
      </p>
    </section>
  );
}

export function PublicResults(
  { titles, funded, final, ballots, block, sealedPool }: {
    titles: string[];
    funded: number[];
    final: boolean;
    ballots: number | null;
    block: bigint;
    sealedPool: boolean;
  },
) {
  return (
    <section className="voting-results" aria-labelledby="results-title">
      <h2 id="results-title">
        {final ? "Final funded projects" : "Public results so far"}
      </h2>
      <p>
        {final
          ? "Recorded by the pool."
          : ballots === null
          ? "The pool tally is running. This is the funded order recorded so far."
          : `Calculated in your browser from ${ballots} accepted public ${
            ballots === 1 ? "ballot" : "ballots"
          }. ${
            sealedPool
              ? "Encrypted ballots are included only in the final tally. "
              : ""
          }This projection can change.`}
      </p>
      {funded.length
        ? (
          <ol>
            {funded.map((id) => (
              <li key={id}>{titles[id] ?? `Project ${id + 1}`}</li>
            ))}
          </ol>
        )
        : <p>No projects are funded by this result yet.</p>}
      <p className="hint">
        Pool block {block.toString()} · refreshes every 15 seconds
      </p>
    </section>
  );
}
