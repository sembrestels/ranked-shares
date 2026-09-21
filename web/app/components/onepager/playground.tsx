import { useMemo, useState } from "react";
import { FUNDING_TIERS, tierRanks, type FundingTier, type TierAssignments } from "../../lib/ballot-tiers";
import { blocVoters, PROPOSALS, SEAT, tally, type Voter } from "../../lib/onepager";
import { TierList } from "../voting/tier-list";
import { Button } from "../ui";
import { PoolBar, Seats, usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const ids = PROPOSALS.map((_, id) => id);
const DONATION = 5_000;
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const PRESETS: { label: string; assignments: TierAssignments }[] = [
  { label: "Back the war room", assignments: { 6: "must", 7: "should" } },
  { label: "Back the course", assignments: { 8: "must", 2: "should" } },
  { label: "Vote with the auditors", assignments: { 0: "must", 1: "should", 2: "should", 3: "nice" } },
];

export function Playground() {
  const [assignments, setAssignments] = useState<TierAssignments>({});
  const [donatedTo, setDonatedTo] = useState<number>();
  // A direct donation is money the pool no longer has to find: it lowers that proposal's ask.
  const asks = useMemo(() => costs.map((cost, id) => (id === donatedTo ? cost - DONATION : cost)), [donatedTo]);
  const titles = useMemo(() => PROPOSALS.map((p, id) => `${p.title} (${usd(asks[id] / 1000)}k)`), [asks]);

  const placed = ids.some((id) => assignments[id] !== undefined);
  const { result, baseline, undonated, you } = useMemo(() => {
    const others = blocVoters();
    const seat = (ballot: number[] | null): Voter => ({ id: "you", name: "Your seat", weight: SEAT, ballot });
    const mine = seat(placed ? tierRanks(ids, assignments) : null);
    return {
      result: tally(asks, [...others, mine]),
      undonated: tally(costs, [...others, mine]),
      baseline: tally(asks, [...others, seat(null)]),
      you: others.length,
    };
  }, [assignments, asks, placed]);

  const mine = result.contributions[you];
  const spent = mine.reduce((a, b) => a + b, 0);
  const added = result.funded.filter((id) => !baseline.funded.includes(id));
  const dropped = baseline.funded.filter((id) => !result.funded.includes(id));
  const tierOf = (id: number) => FUNDING_TIERS.find((t) => t.id === assignments[id])?.label;

  return (
    <div className="op-playground">
      <div className="op-playground-ballot">
        <div className="op-presets">
          <span>Or start from a ballot:</span>
          {PRESETS.map((preset) => (
            <Button key={preset.label} variant="secondary" onClick={() => setAssignments(preset.assignments)}>{preset.label}</Button>
          ))}
          <Button variant="secondary" disabled={!placed} onClick={() => setAssignments({})}>Clear</Button>
        </div>
        <TierList
          titles={titles}
          assignments={assignments}
          disabled={false}
          onAssign={(id: number, tier: FundingTier | undefined) => setAssignments((previous) => ({ ...previous, [id]: tier }))}
        />
        <div className="op-donor">
          <label htmlFor="op-donation">Add a public donation of {usd(DONATION)}, sent directly to</label>
          <select
            id="op-donation"
            className="input"
            value={donatedTo ?? ""}
            onChange={(event) => setDonatedTo(event.target.value === "" ? undefined : Number(event.target.value))}
          >
            <option value="">no initiative</option>
            {PROPOSALS.map((p, id) => <option key={id} value={id}>{p.title}</option>)}
          </select>
          <p>
            {donatedTo === undefined
              ? "The public does not vote. A donation goes straight to an initiative and lowers what it asks from the pool, so it needs less badge-holder weight to pass."
              : `${PROPOSALS[donatedTo].title} now asks the pool for ${usd(asks[donatedTo])} instead of ${usd(costs[donatedTo])}.`}
          </p>
        </div>
      </div>

      <div className="op-playground-result" aria-live="polite">
        <h3>The round with your ballot in it</h3>
        <Seats you />
        <p className="op-result-pool">{usd(result.budget)} pool, 20 sponsored seats plus yours</p>
        <PoolBar funded={result.funded} budget={result.budget} asks={asks} label="Funded with your ballot" />
        <ul className="op-funded-list" aria-label="Funded proposals">
          {result.funded.map((id) => <li key={id}><i data-camp={PROPOSALS[id].camp} />{PROPOSALS[id].title}</li>)}
        </ul>

        <p className="op-result-change">
          {!placed
            ? "You have not ranked anything yet, so your seat changes nothing. This is the outcome the other 20 seats reach on their own."
            : added.length || dropped.length
            ? `Your ballot changed the outcome. ${added.length ? `Funded because of you: ${list(added.map((id) => PROPOSALS[id].title))}.` : ""} ${dropped.length ? `No longer funded: ${list(dropped.map((id) => PROPOSALS[id].title))}.` : ""}`
            : "Your ballot did not change which proposals are funded this time. Your money still went where your ranking sent it."}
        </p>

        {donatedTo !== undefined && (
          <p className="op-result-change">
            {result.funded.includes(donatedTo) && !undonated.funded.includes(donatedTo)
              ? `The ${usd(DONATION)} donation is what got ${PROPOSALS[donatedTo].title} funded: at its full price the seats behind it fell short.`
              : result.funded.includes(donatedTo)
              ? `${PROPOSALS[donatedTo].title} was going to be funded anyway. The ${usd(DONATION)} donation frees that much of the pool for other initiatives.`
              : `Even ${usd(DONATION)} cheaper, ${PROPOSALS[donatedTo].title} does not have enough seat money behind it.`}
          </p>
        )}

        <h3>Where your {usd(SEAT)} went</h3>
        {placed
          ? (
            <ul className="op-mine">
              {ids.filter((id) => mine[id] > 0).map((id) => (
                <li key={id} data-camp={PROPOSALS[id].camp}>
                  <span className="op-mine-bar" style={{ width: `${(mine[id] / SEAT) * 100}%` }} />
                  <span className="op-mine-label">
                    {usd(mine[id])} to {PROPOSALS[id].title}
                    <em>{tierOf(id) ? `you ranked it “${tierOf(id)}”` : "unranked, paid as a last choice"}</em>
                  </span>
                </li>
              ))}
              {spent < SEAT && (
                <li className="op-mine-unspent">
                  <span className="op-mine-bar" style={{ width: `${((SEAT - spent) / SEAT) * 100}%` }} />
                  <span className="op-mine-label">{usd(SEAT - spent)} unspent, returned to the funder</span>
                </li>
              )}
            </ul>
          )
          : <p className="op-mine-empty">Nowhere yet. A seat that does not vote is swept back to the funder.</p>}
      </div>
    </div>
  );
}
