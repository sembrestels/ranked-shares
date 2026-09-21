import { useMemo, useState } from "react";
import { BLOCS, blocVoters, openingLevels, PROPOSALS, TIER_LABELS, tally, type Frame, type Tally } from "../../lib/onepager";
import { Button } from "../ui";
import { PoolBar, usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const SCALE = 60_000;
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const backers = (id: number) => BLOCS.filter((b) => b.tiers.some((tier) => tier.includes(id))).map((b) => b.name);

function narrate(frame: Frame | undefined, previous: Frame | undefined, position: "start" | "step" | "end", result: Tally) {
  const { budget, backing, eligible } = result;
  const ballots = BLOCS.reduce((sum, b) => sum + b.seats, 0);
  if (position === "start") {
    const excluded = PROPOSALS.flatMap((p, id) => eligible.includes(id) ? [] : [`${p.title} (${usd(backing[id])} backing for a ${usd(p.cost)} ask)`]);
    const promoted = BLOCS.filter((b) => openingLevels(b.tiers, eligible).tiers[0] === null).map((b) => b.name);
    return `The ${usd(budget)} pool is split equally among the ${ballots} badge holders who submitted a ballot, ${usd(budget / ballots)} each. First, add up the full share of everyone who placed each proposal in any tier. ${list(excluded)} fall short of their ask and are removed from every ballot.${promoted.length ? ` ${list(promoted)} lose their S-Tier pick, so their A-Tier becomes their top tier.` : ""} The ${eligible.length} eligible proposals enter the tally with every voter's share unchanged.`;
  }
  if (position === "end" || !frame) {
    const left = budget - (previous?.spent ?? 0);
    return `${usd(left)} is left and no unfunded eligible proposal costs that little, so the tally stops. Unspent money goes back to the funder.`;
  }
  if (frame.funded === null) {
    const next = frame.level + 1;
    const levels = BLOCS.map((b) => openingLevels(b.tiers, eligible));
    const opening = TIER_LABELS.flatMap((label, t) => {
      const names = BLOCS.filter((_, i) => levels[i].tiers[t] === next).map((b) => b.name);
      return names.length ? [`${list(names)} open their ${label}.`] : [];
    });
    const rest = BLOCS.filter((_, i) => levels[i].rest === next).map((b) => b.name);
    if (rest.length) opening.push(`${list(rest)} have no tiers left, so eligible proposals they left unplaced now count as a tied last tier.`);
    return `No unfunded eligible proposal has enough unspent money behind it in the tiers open so far, so the tally widens a step. ${opening.join(" ")}`;
  }
  const proposal = PROPOSALS[frame.funded];
  const payers = frame.paid.map((amount, i) => ({ amount, name: BLOCS[i].name })).filter((p) => p.amount > 0);
  const split = payers.length === 1
    ? `${payers[0].name} pay all of it.`
    : `They pay in proportion to what they hold: ${list(payers.map((p) => `${p.name} ${usd(p.amount)}`))}.`;
  return `${proposal.title} costs ${usd(proposal.cost)}. The voters with it in an open tier hold ${usd(frame.support[frame.funded])} unspent, more than any other affordable proposal, so it is funded. ${split}`;
}

export function Stepper() {
  const voters = useMemo(blocVoters, []);
  const result = useMemo(() => tally(costs, voters), [voters]);
  const last = result.frames.length + 1;
  const [at, setAt] = useState(0);

  const position = at === 0 ? "start" : at === last ? "end" : "step";
  const frame = position === "step" ? result.frames[at - 1] : undefined;
  // The frame already settled before the one on screen; at the end, the last frame.
  const previous = at >= 2 ? result.frames[at - 2] : undefined;
  const level = frame?.level ?? previous?.level ?? 1;
  const holding = frame ? frame.before : previous ? previous.left : voters.map((v) => v.weight);
  const after = frame ? frame.left : holding;
  const fundedBefore = previous?.fundedSoFar ?? [];
  const fundedNow = frame?.fundedSoFar ?? fundedBefore;

  return (
    <div className="op-stepper">
      <div className="op-stepper-head">
        <p className="op-stepper-count" aria-live="polite">
          Step {at + 1} of {last + 1}
          <span>{position === "start" ? "Checking initial backing against each ask" : level === 1 ? "Counting each voter's top tier of eligible proposals" : `Counting every tier opened so far, widened ${level - 1} time${level === 2 ? "" : "s"}`}</span>
        </p>
        <div className="op-stepper-controls">
          <Button variant="secondary" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</Button>
          <Button disabled={at === last} onClick={() => setAt(at + 1)}>Next step</Button>
          <Button variant="secondary" disabled={at === 0} onClick={() => setAt(0)}>Reset</Button>
        </div>
      </div>

      <p className="op-narration">{narrate(frame, previous, position, result)}</p>

      <div className="op-stepper-grid">
        <section aria-label="Voters">
          <h3>Voters and what they still hold</h3>
          <ul className="op-blocs">
            {BLOCS.map((bloc, i) => {
              const opens = openingLevels(bloc.tiers, result.eligible);
              return (
              <li key={bloc.id} data-bloc={bloc.id} data-paying={frame && frame.paid[i] > 0 || undefined}>
                <p className="op-bloc-name">
                  <i className="op-seat" data-bloc={bloc.id} />
                  {bloc.name}
                  <span>{bloc.seats} ballots</span>
                </p>
                <ol className="op-ranking">
                  {bloc.tiers.map((tier, t) => (
                    <li key={t} className="op-tier" data-open={opens.tiers[t] !== null && opens.tiers[t]! <= level || undefined} data-removed={opens.tiers[t] === null || undefined}>
                      <b>{TIER_LABELS[t]}</b>
                      {tier.map((id) => (
                        <span key={id} data-funded={fundedNow.includes(id) || undefined} data-excluded={!result.eligible.includes(id) || undefined}>
                          {PROPOSALS[id].short}{!result.eligible.includes(id) && <small>excluded</small>}
                        </span>
                      ))}
                    </li>
                  ))}
                  <li className="op-tier op-ranking-rest" data-open={level >= opens.rest || undefined}>other eligible proposals</li>
                </ol>
                <div className="op-wallet">
                  <span className="op-wallet-track">
                    <span className="op-wallet-left" style={{ width: `${(after[i] / voters[i].weight) * 100}%` }} />
                    <span className="op-wallet-paid" style={{ width: `${((holding[i] - after[i]) / voters[i].weight) * 100}%` }} />
                  </span>
                  <span className="op-wallet-amount">
                    {usd(after[i])}
                    {holding[i] > after[i] && <b> paid {usd(holding[i] - after[i])}</b>}
                  </span>
                </div>
              </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Proposals">
          <h3>{position === "start" ? "Initial backing in any tier" : "Eligible proposals and remaining support"}</h3>
          <ul className="op-proposals">
            {PROPOSALS.map((proposal, id) => {
              const done = fundedBefore.includes(id);
              const winning = frame?.funded === id;
              const eligible = result.eligible.includes(id);
              const support = position === "start" || !eligible
                ? result.backing[id]
                : frame ? frame.support[id] : 0;
              return (
                <li key={id} data-camp={proposal.camp} data-state={!eligible ? "excluded" : done ? "funded" : winning ? "winning" : undefined}>
                  <p>
                    <span>{proposal.title}{!eligible && <b className="op-excluded-tag">Excluded</b>}</span>
                    <span className="op-proposal-cost">{usd(proposal.cost)}</span>
                  </p>
                  <div className="op-support">
                    {done
                      ? <span className="op-support-fill" data-done style={{ width: `${(proposal.cost / SCALE) * 100}%` }} />
                      : <span className="op-support-fill" style={{ width: `${Math.min(100, (support / SCALE) * 100)}%` }} />}
                    <span className="op-support-cost" style={{ left: `${(proposal.cost / SCALE) * 100}%` }} />
                  </div>
                  <p className="op-support-note">
                    {(done || winning) && (
                      <svg className="op-funded-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <circle cx="10" cy="10" r="8.5" />
                        <path d="m6.4 10.3 2.5 2.5 4.8-5.3" />
                      </svg>
                    )}
                    {!eligible && (
                      <svg className="op-excluded-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <circle cx="10" cy="10" r="8.5" />
                        <path d="m6.8 6.8 6.4 6.4m0-6.4-6.4 6.4" />
                      </svg>
                    )}
                    {!eligible ? `Only ${list(backers(id))} back it: ${usd(result.backing[id])} is ${usd(proposal.cost - result.backing[id])} short of the ${usd(proposal.cost)} ask` : position === "start" ? `Eligible: ${usd(support)} initial backing covers the ask` : done ? "Funded" : position === "end" ? "Not funded" : winning ? `${usd(support)} behind it, funded now` : `${usd(support)} behind it`}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="op-legend"><i className="op-legend-tick" />{position === "start" ? "The marker is the ask; initial backing must reach it to qualify. The excluded proposals stop short of theirs and leave the round." : "The marker is the ask; remaining support must reach it to fund an eligible proposal. Excluded proposals keep their initial backing shown."}</p>
        </section>
      </div>

      <div className="op-stepper-pool">
        <p className="op-pool-caption">{usd(frame?.spent ?? previous?.spent ?? 0)} of {usd(result.budget)} spent</p>
        <PoolBar funded={fundedNow} budget={result.budget} label="Pool so far" />
      </div>
    </div>
  );
}
