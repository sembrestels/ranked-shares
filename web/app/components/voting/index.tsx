import { Button, Field, Input, Notice, Status } from "../ui";
import type { BallotReviewData, ReviewRow } from "../../lib/ballot-review";

export function RankField(
  { id, title, value, count, disabled, onChange }: {
    id: number;
    title: string;
    value: string;
    count: number;
    disabled: boolean;
    onChange: (value: string) => void;
  },
) {
  return (
    <Field
      id={`rank-${id}`}
      label={title}
      hint={`Project ${id + 1} · 0 means last tier`}
    >
      <Input
        id={`rank-${id}`}
        type="number"
        min={0}
        max={count}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`rank-${id}-hint`}
        required
      />
    </Field>
  );
}

export function BallotForm(
  {
    titles,
    ranks,
    sealed,
    canPublic,
    canSealed,
    busy,
    onRank,
    onMode,
    onSubmit,
  }: {
    titles: string[];
    ranks: string[];
    sealed: boolean;
    canPublic: boolean;
    canSealed: boolean;
    busy: boolean;
    onRank: (id: number, value: string) => void;
    onMode: (sealed: boolean) => void;
    onSubmit: () => void;
  },
) {
  return (
    <form
      className="proposal-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
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
      <p>
        Rank your preferred projects starting at 1. Ties share a rank: 1, 1, 3.
        Leave a project at 0 to place it in the last tier.
      </p>
      {titles.map((title, id) => (
        <RankField
          key={id}
          id={id}
          title={title}
          value={ranks[id] ?? "0"}
          count={titles.length}
          disabled={busy}
          onChange={(value) => onRank(id, value)}
        />
      ))}
      <p className="hint">
        {sealed
          ? "Your ranking is encrypted in this browser. Your wallet address and voting weight remain public."
          : "Your ranking is public and contributes to the live results."}{" "}
        Storing the ballot and accepting it in the round require two wallet
        transactions. Arkiv Tiramisu uses testGLM.
      </p>
      <p className="hint">
        New ballots expire from Arkiv approximately 15 days after voting closes.
        The owner can still extend or delete their entity. Transaction history
        and final results remain available.
      </p>
      <Button
        type="submit"
        disabled={busy || (sealed ? !canSealed : !canPublic)}
      >
        1. Store {sealed ? "encrypted " : ""}ballot in Arkiv
      </Button>
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
        Entity <code>{row.entityKey}</code>
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
