import { useMemo, useState } from "react";
import { BLOCS, blocVoters, openingLevels, PROPOSALS, TIER_LABELS, tally, type Frame, type Tally } from "../../lib/onepager";
import { StepControls } from "./step-controls";
import { PoolBar, usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const SCALE = 60_000;
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
// The level at which each tier has been counted for every voter: the last level at which
// any ballot opens it. Once nothing more can be funded there, the tier is settled.
const TIER_ENDS = TIER_LABELS
  .map((_, t) => Math.max(...BLOCS.map((b) => openingLevels(b.tiers)[t] ?? 0)))
  .map((_, t, ends) => Math.max(...ends.slice(0, t + 1)));
const tierAt = (level: number) => {
  const t = TIER_ENDS.findIndex((end) => level <= end);
  return t === -1 ? TIER_ENDS.length - 1 : t;
};
const fundedFrom = (frames: Frame[], t: number) =>
  frames.flatMap((f) => (f.funded !== null && tierAt(f.level) === t ? [f.funded] : []));
const outcome = (frames: Frame[], t: number) => {
  const won = fundedFrom(frames, t).map((id) => PROPOSALS[id].title);
  return won.length ? `${list(won)} ${won.length > 1 ? "are" : "is"} funded from it` : "nothing is funded from it";
};

function narrate(frame: Frame | undefined, previous: Frame | undefined, position: "start" | "step" | "end", result: Tally) {
  const { budget } = result;
  const ballots = BLOCS.reduce((sum, b) => sum + b.seats, 0);
  if (position === "start") {
    return `The ${usd(budget)} pool is split equally among the ${ballots} badge holders who submitted a ballot, ${usd(budget / ballots)} each. The tally starts with every voter's ${TIER_LABELS[0]}.`;
  }
  if (position === "end" || !frame) {
    const left = budget - (previous?.spent ?? 0);
    const last = TIER_LABELS.length - 1;
    return `That settles the ${TIER_LABELS[last]}: ${outcome(result.frames, last)}. Nothing more can be funded from the tiers the voters filled in, so the tally stops. The ${usd(left)} they still hold goes back to TheDAO.`;
  }
  if (frame.funded === null) {
    const next = frame.level + 1;
    const levels = BLOCS.map((b) => openingLevels(b.tiers));
    const opening = TIER_LABELS.flatMap((label, t) => {
      const names = BLOCS.filter((_, i) => levels[i][t] === next).map((b) => b.name);
      return names.length ? [`${list(names)} open their ${label}.`] : [];
    });
    const widening = opening.length ? opening.join(" ") : "No tier opens at this step.";
    const settled = TIER_ENDS.indexOf(frame.level);
    if (settled !== -1) {
      const label = TIER_LABELS[settled];
      return `Every voter's ${label} has been counted and nothing more can be funded from it, so the ${label} is settled: ${outcome(result.frames, settled)}. A round that announces its results tier by tier makes an announcement here. Next, the tally widens a step. ${widening}`;
    }
    return `No unfunded proposal has enough unspent money behind it in the tiers open so far, so the tally widens a step. ${widening}`;
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
  const narrations = useMemo(
    () => Array.from({ length: last + 1 }, (_, k) =>
      narrate(
        k >= 1 && k < last ? result.frames[k - 1] : undefined,
        k >= 2 ? result.frames[k - 2] : undefined,
        k === 0 ? "start" : k === last ? "end" : "step",
        result,
      )),
    [result, last],
  );

  const position = at === 0 ? "start" : at === last ? "end" : "step";
  const frame = position === "step" ? result.frames[at - 1] : undefined;
  // The frame already settled before the one on screen; at the end, the last frame.
  const previous = at >= 2 ? result.frames[at - 2] : undefined;
  const level = frame?.level ?? previous?.level ?? 1;
  const holding = frame ? frame.before : previous ? previous.left : voters.map((v) => v.weight);
  const after = frame ? frame.left : holding;
  const fundedBefore = previous?.fundedSoFar ?? [];
  const fundedNow = frame?.fundedSoFar ?? fundedBefore;
  // A tier is settled from the step that closes it; the last one closes when the tally stops.
  const shown = result.frames.slice(0, at);
  const isSettled = (t: number) =>
    position === "end" || shown.some((f) => f.funded === null && f.level === TIER_ENDS[t]);
  const tierState = (t: number) =>
    isSettled(t) ? "settled" : position !== "start" && (t === 0 || isSettled(t - 1)) ? "counting" : "waiting";
  const tierOfFunded = useMemo(
    () => new Map(result.frames.flatMap((f) => (f.funded === null ? [] : [[f.funded, tierAt(f.level)] as const]))),
    [result],
  );
  const spentNow = frame?.spent ?? previous?.spent ?? 0;
  const settledTiers = TIER_LABELS.filter((_, t) => isSettled(t));
  const countingTier = TIER_LABELS.find((_, t) => tierState(t) === "counting");
  const tierStatus = [
    settledTiers.length ? `${list(settledTiers)} settled.` : "",
    countingTier ? `Counting the ${countingTier}.` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="op-stepper">
      {/* The step counter and its buttons sit beside the step's text, so the text uses the
          width the buttons leave free. */}
      <div className="op-stepper-top">
      <div className="op-stepper-head">
        <p className="op-stepper-count" aria-live="polite">
          Step {at + 1} of {last + 1}
          <span>{position === "start" ? "Every voter holds an equal share of the pool" : position === "end" ? "Every tier is settled" : `Counting the ${TIER_LABELS[tierAt(level)]}`}</span>
        </p>
        <StepControls at={at} last={last} onChange={setAt} />
      </div>

      {/* Every step's text sits in the same cell and only the current one shows, so the
          box is always as tall as the longest and nothing below it moves. */}
      <div className="op-narration">
        {narrations.map((text, k) => (
          <p key={k} data-current={k === at || undefined} aria-hidden={k !== at || undefined}>{text}</p>
        ))}
      </div>
      </div>

      <div className="op-stepper-pool">
        <p className="op-pool-caption">
          <span>{usd(spentNow)} of {usd(result.budget)} spent</span>
          <span className="op-pool-tier-status">{tierStatus || "No tier counted yet."}</span>
        </p>
        <PoolBar funded={fundedNow} budget={result.budget} label="Pool so far" />
        {/* Under the bar, one bracket per tier over the proposals funded from it. Same boxes
            as the bar's segments, so the brackets line up with them. */}
        <div className="op-pool-tiers" aria-hidden="true">
          {fundedNow.map((id, k) => {
            const t = tierOfFunded.get(id)!;
            return (
              <span
                key={id}
                style={{ flexGrow: PROPOSALS[id].cost }}
                data-state={tierState(t)}
                data-last={tierOfFunded.get(fundedNow[k + 1]) !== t || undefined}
              >
                {tierOfFunded.get(fundedNow[k - 1]) !== t && <b>{TIER_LABELS[t]}</b>}
              </span>
            );
          })}
          {result.budget > spentNow && <span style={{ flexGrow: result.budget - spentNow }} />}
        </div>
      </div>

      <div className="op-stepper-grid">
        <section aria-label="Voters">
          <h3>Voters and what they still hold</h3>
          <ul className="op-blocs">
            {BLOCS.map((bloc, i) => {
              const opens = openingLevels(bloc.tiers);
              return (
              <li key={bloc.id} data-bloc={bloc.id} data-paying={frame && frame.paid[i] > 0 || undefined}>
                <p className="op-bloc-name">
                  <i className="op-seat" data-bloc={bloc.id} />
                  {bloc.name}
                  <span>{bloc.seats} ballots</span>
                </p>
                <ol className="op-ranking">
                  {bloc.tiers.map((tier, t) => (
                    <li key={t} className="op-tier" data-open={position !== "start" && opens[t] <= level || undefined}>
                      <b>{TIER_LABELS[t]}</b>
                      {tier.map((id) => (
                        <span key={id} data-funded={fundedNow.includes(id) || undefined}>{PROPOSALS[id].short}</span>
                      ))}
                    </li>
                  ))}
                  <li className="op-tier op-ranking-rest" data-open={position === "end" || undefined}>Return to TheDAO</li>
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
          <h3>Proposals and the unspent money behind them</h3>
          <ul className="op-proposals">
            {PROPOSALS.map((proposal, id) => {
              const done = fundedBefore.includes(id);
              const winning = frame?.funded === id;
              const support = frame ? frame.support[id] : 0;
              return (
                <li key={id} data-camp={proposal.camp} data-state={done ? "funded" : winning ? "winning" : undefined}>
                  <p>
                    <span>{proposal.title}</span>
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
                    {position === "start" ? `Asks ${usd(proposal.cost)}` : done ? "Funded" : position === "end" ? "Not funded" : winning ? `${usd(support)} behind it, funded now` : `${usd(support)} behind it`}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="op-legend"><i className="op-legend-tick" />The marker is the ask; the unspent money behind a proposal must reach it to fund it.</p>
        </section>
      </div>

    </div>
  );
}
