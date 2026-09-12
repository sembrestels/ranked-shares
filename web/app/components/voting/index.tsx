import { Button, Field, Input } from "../ui";

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
      <Button
        type="submit"
        disabled={busy || (sealed ? !canSealed : !canPublic)}
      >
        1. Store {sealed ? "encrypted " : ""}ballot in Arkiv
      </Button>
    </form>
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
