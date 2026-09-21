import { useMemo, useState } from "react";
import { FUNDING_TIERS, tierRanks, type FundingTier, type TierAssignments } from "../../lib/ballot-tiers";
import { BLOCS, blocVoters, PROPOSALS, SEAT, tally, type Voter } from "../../lib/onepager";
import { TierList } from "../voting/tier-list";
import { Button, Select } from "../ui";
import { PoolBar, Seats, usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const ids = PROPOSALS.map((_, id) => id);
const DONATION = 5_000;
const BALLOTS = BLOCS.reduce((sum, b) => sum + b.seats, 0);
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
    // The pool is split among submitted ballots, so an empty ballot is not a voter at all.
    const mine: Voter[] = placed ? [{ id: "you", name: "Your ballot", weight: SEAT, ballot: tierRanks(ids, assignments) }] : [];
    return {
      result: tally(asks, [...others, ...mine]),
      undonated: tally(costs, [...others, ...mine]),
      baseline: tally(asks, others),
      you: others.length,
    };
  }, [assignments, asks, placed]);

  const mine = result.contributions[you] ?? costs.map(() => 0);
  const spent = mine.reduce((a, b) => a + b, 0);
  const added = result.funded.filter((id) => !baseline.funded.includes(id));
  const dropped = baseline.funded.filter((id) => !result.funded.includes(id));
  const excluded = ids.filter((id) => !result.eligible.includes(id));
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
          <Select
            id="op-donation"
            value={donatedTo ?? ""}
            onChange={(event) => setDonatedTo(event.target.value === "" ? undefined : Number(event.target.value))}
          >
            <option value="">no initiative</option>
            {PROPOSALS.map((p, id) => <option key={id} value={id}>{p.title}</option>)}
          </Select>
          <p>
            {donatedTo === undefined
              ? "The public does not vote. A donation goes straight to an initiative and lowers what it asks from the pool, so it needs less badge-holder weight to pass."
              : `${PROPOSALS[donatedTo].title} now asks the pool for ${usd(asks[donatedTo])} instead of ${usd(costs[donatedTo])}.`}
          </p>
        </div>
      </div>

      <div className="op-playground-result" aria-live="polite">
        <h3>The round with your ballot in it</h3>
        <Seats you={placed} />
        <p className="op-result-pool">{usd(result.budget)} pool, {placed ? `${BALLOTS} ballots plus yours` : `${BALLOTS} ballots`}, {usd(SEAT)} each</p>
        <div className="op-eligibility">
          <h3>Initial backing check</h3>
          <p>{result.eligible.length} of {ids.length} proposals qualify. Backing counts each voter's full initial weight when they place a proposal in any tier.</p>
          {excluded.length > 0
            ? <ul aria-label="Excluded proposals">{excluded.map((id) => (
              <li key={id}>{PROPOSALS[id].title}: {usd(result.backing[id])} backing / {usd(asks[id])} ask</li>
            ))}</ul>
            : <p>Every proposal has enough initial backing.</p>}
        </div>
        <PoolBar funded={result.funded} budget={result.budget} asks={asks} label="Funded with your ballot" />
        <ul className="op-funded-list" aria-label="Funded proposals">
          {result.funded.map((id) => <li key={id}><i data-camp={PROPOSALS[id].camp} />{PROPOSALS[id].title}</li>)}
        </ul>

        <p className="op-result-change">
          {!placed
            ? `You have not placed anything yet, so you change nothing. This is the outcome the other ${BALLOTS} voters reach on their own.`
            : added.length || dropped.length
            ? `Your ballot changed the outcome. ${added.length ? `Funded because of you: ${list(added.map((id) => PROPOSALS[id].title))}.` : ""} ${dropped.length ? `No longer funded: ${list(dropped.map((id) => PROPOSALS[id].title))}.` : ""}`
            : "Your ballot did not change which proposals are funded this time. See below how the tally spent your share."}
        </p>

        {donatedTo !== undefined && (
          <p className="op-result-change">
            {result.funded.includes(donatedTo) && !undonated.funded.includes(donatedTo)
              ? `The ${usd(DONATION)} donation is what got ${PROPOSALS[donatedTo].title} funded: at its full price the voters behind it fell short.`
              : result.funded.includes(donatedTo)
              ? `${PROPOSALS[donatedTo].title} was going to be funded anyway. The ${usd(DONATION)} donation frees that much of the pool for other initiatives.`
              : !result.eligible.includes(donatedTo)
              ? `Even ${usd(DONATION)} cheaper, ${PROPOSALS[donatedTo].title} still falls short of the initial backing threshold.`
              : `${PROPOSALS[donatedTo].title} passes the initial backing check, but the tally does not fund it with the available money and ballots.`}
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
                    <em>{tierOf(id) ? `you placed it in “${tierOf(id)}”` : "unplaced, paid as a last tier"}</em>
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
          : <p className="op-mine-empty">Nowhere yet. A badge holder who submits no ballot steers no money.</p>}
      </div>
    </div>
  );
}
