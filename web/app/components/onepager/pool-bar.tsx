import { BLOCS, CAMP_OF_BLOC, PROPOSALS } from "../../lib/onepager";

export const usd = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
export const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** The pool drawn as one bar: a segment per funded proposal, as wide as its cost
 * and coloured by the camp whose list it came from. Unspent money stays hatched. */
export function PoolBar({ funded, budget, label, asks }: {
  funded: readonly number[];
  budget: number;
  label: string;
  /** What each proposal asks from the pool, when donations have lowered it below its cost. */
  asks?: readonly number[];
}) {
  const ask = (id: number) => asks?.[id] ?? PROPOSALS[id].cost;
  const spent = funded.reduce((sum, id) => sum + ask(id), 0);
  return (
    <div className="op-pool" role="img" aria-label={`${label}: ${funded.map((id) => `${PROPOSALS[id].title} ${usd(ask(id))}`).join(", ") || "nothing funded"}${budget > spent ? `, ${usd(budget - spent)} unspent` : ""}`}>
      {funded.map((id) => (
        <span key={id} className="op-pool-seg" data-camp={PROPOSALS[id].camp} style={{ flexGrow: ask(id) }}>
          <span className="op-pool-name">{PROPOSALS[id].short}</span>
          <span className="op-pool-cost">{usd(ask(id) / 1000)}k</span>
        </span>
      ))}
      {budget > spent && <span className="op-pool-seg op-pool-unspent" style={{ flexGrow: budget - spent }} />}
    </div>
  );
}

/** One dot per badge seat, grouped by the bloc that holds it. */
export function Seats({ you = false }: { you?: boolean }) {
  return (
    <div className="op-seats" aria-hidden="true">
      {BLOCS.map((bloc) => (
        <span key={bloc.id} className="op-seat-group">
          {Array.from({ length: bloc.seats }, (_, i) => <i key={i} className="op-seat" data-bloc={bloc.id} />)}
        </span>
      ))}
      {you && <span className="op-seat-group"><i className="op-seat" data-bloc="you" /></span>}
    </div>
  );
}

export function CampKey() {
  const camps = [
    ["audit", "Auditing tools"],
    ["wallet", "Wallet safety"],
    ["response", "Incident response"],
    ["research", "Research and education"],
  ] as const;
  return (
    <ul className="op-key">
      {camps.map(([camp, label]) => <li key={camp}><i data-camp={camp} />{label}</li>)}
      <li><i className="op-key-unspent" />Unspent</li>
    </ul>
  );
}

export const blocCamp = (id: string) => CAMP_OF_BLOC[id] ?? "you";
