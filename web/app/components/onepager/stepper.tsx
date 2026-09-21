import { useEffect, useMemo, useState } from "react";
import { BLOCS, blocVoters, PROPOSALS, tally, type Frame } from "../../lib/onepager";
import { Button } from "../ui";
import { PoolBar, usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const SCALE = 60_000;
const ordinal = (n: number) => `top ${n === 1 ? "choice" : `${n} choices`}`;
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

function narrate(frame: Frame | undefined, previous: Frame | undefined, position: "start" | "step" | "end", budget: number) {
  if (position === "start") {
    return `The fund sponsors 20 badge seats with ${usd(budget / 20)} each, so the pool is ${usd(budget)}. The nine proposals ask for ${usd(costs.reduce((a, b) => a + b, 0))}. The tally starts by looking only at each voter's first choice.`;
  }
  if (position === "end" || !frame) {
    const left = budget - (previous?.spent ?? 0);
    return `${usd(left)} is left and no open proposal costs that little, so the tally stops. Unspent seat money goes back to the funder. It is never spent on a voter's behalf.`;
  }
  if (frame.funded === null) {
    const next = frame.level + 1;
    const short = BLOCS.filter((b) => b.ranking.length + 1 === next).map((b) => b.name);
    return `No open proposal has enough unspent money behind it among everyone's ${ordinal(frame.level)}. The tally widens to each voter's ${ordinal(next)}.${short.length ? ` ${list(short)} ranked only ${next - 1}, so from here everything they left unranked counts as a tied last choice.` : ""}`;
  }
  const proposal = PROPOSALS[frame.funded];
  const payers = frame.paid.map((amount, i) => ({ amount, name: BLOCS[i].name })).filter((p) => p.amount > 0);
  const split = payers.length === 1
    ? `${payers[0].name} pay all of it.`
    : `They pay in proportion to what they hold: ${list(payers.map((p) => `${p.name} ${usd(p.amount)}`))}.`;
  return `${proposal.title} costs ${usd(proposal.cost)}. The voters who rank it in their ${ordinal(frame.level)} hold ${usd(frame.support[frame.funded])} unspent, more than any other affordable proposal, so it is funded. ${split}`;
}

export function Stepper() {
  const voters = useMemo(blocVoters, []);
  const result = useMemo(() => tally(costs, voters), [voters]);
  const last = result.frames.length + 1;
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (at >= last) { setPlaying(false); return; }
    const timer = setTimeout(() => setAt((value) => value + 1), 2600);
    return () => clearTimeout(timer);
  }, [playing, at, last]);

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
          Step {at} of {last}
          <span> Looking at each voter's {ordinal(level)}</span>
        </p>
        <div className="op-stepper-controls">
          <Button variant="secondary" disabled={at === 0} onClick={() => { setPlaying(false); setAt(at - 1); }}>Back</Button>
          <Button disabled={at === last} onClick={() => { setPlaying(false); setAt(at + 1); }}>Next step</Button>
          <Button variant="secondary" onClick={() => { if (at === last) setAt(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</Button>
        </div>
      </div>

      <p className="op-narration">{narrate(frame, previous, position, result.budget)}</p>

      <div className="op-stepper-grid">
        <section aria-label="Voters">
          <h3>Voters and what they still hold</h3>
          <ul className="op-blocs">
            {BLOCS.map((bloc, i) => (
              <li key={bloc.id} data-bloc={bloc.id} data-paying={frame && frame.paid[i] > 0 || undefined}>
                <p className="op-bloc-name">
                  <i className="op-seat" data-bloc={bloc.id} />
                  {bloc.name}
                  <span>{bloc.seats} seats</span>
                </p>
                <ol className="op-ranking">
                  {bloc.ranking.map((id, position) => (
                    <li key={id} data-open={position < level || undefined} data-funded={fundedNow.includes(id) || undefined}>
                      {PROPOSALS[id].short}
                    </li>
                  ))}
                  <li className="op-ranking-rest" data-open={level > bloc.ranking.length || undefined}>everything else</li>
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
            ))}
          </ul>
        </section>

        <section aria-label="Proposals">
          <h3>Proposals and the money behind them</h3>
          <ul className="op-proposals">
            {PROPOSALS.map((proposal, id) => {
              const done = fundedBefore.includes(id);
              const winning = frame?.funded === id;
              const support = position === "start"
                ? voters.reduce((sum, v) => (v.ballot![id] === 1 ? sum + v.weight : sum), 0)
                : frame ? frame.support[id] : 0;
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
                    {done ? "Funded" : position === "end" ? "Not funded" : winning ? `${usd(support)} behind it, funded now` : `${usd(support)} behind it`}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="op-legend"><i className="op-legend-tick" /> the marker is the proposal's cost; a bar that reaches it is affordable</p>
        </section>
      </div>

      <div className="op-stepper-pool">
        <p className="op-pool-caption">{usd(frame?.spent ?? previous?.spent ?? 0)} of {usd(result.budget)} spent</p>
        <PoolBar funded={fundedNow} budget={result.budget} label="Pool so far" />
      </div>
    </div>
  );
}
