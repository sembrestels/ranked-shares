import { useMemo, useState } from "react";
import { BLOCS, blocVoters, PROPOSALS, ranksFromTiers, tally, type Voter } from "../../lib/onepager";
import { FateChart } from "./fate-chart";
import { Seats, usd } from "./pool-bar";
import { StepControls } from "./step-controls";

const costs = PROPOSALS.map((p) => p.cost);
const POOL = 100_000;
const BALLOTS = BLOCS.reduce((sum, b) => sum + b.seats, 0);
const BLOCKLIST = 4;
const WAR_ROOM = 6;
const WALLET = BLOCS.findIndex((b) => b.id === "wallet");
const RESPONDERS = BLOCS.findIndex((b) => b.id === "response");
const DONATION = 1_000;
/** The ballot that arrives in the last hour: the war room first, then the simulation warnings. */
const LATE_TIERS = [[6], [5]];
// Where the six moments fall in time, in hours after the first tally. Only the
// proportions are drawn: a day's quiet window, an extension half as long, and one half
// as long again, with the late ballot an hour before the deadline.
const TIMES = [0, 23, 24, 30, 36, 42];
const RULES = [
  { at: 0, label: "First tally" },
  { at: 2, label: "Deadline", strong: true },
  { at: 4 },
  // Until the last check nobody knows whether this is the end.
  { at: 5, label: "Finally settled", once: true },
];
const SPANS = [
  { from: 0, to: 2, label: "Quiet window" },
  { from: 2, to: 4, label: "Extension", short: "Ext.", shaded: true },
  { from: 4, to: 5, label: "Half as long", short: "\u00bd", shaded: true },
];
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** One late move followed through a quiet ending: a first tally, a last-hour ballot that
 * shrinks every share and leaves two proposals just short, the deadline that does not
 * close the round, a donation during the extension that rescues one of them, and the two
 * checks it takes to settle. Every figure comes from the tally. */
export function QuietEnding() {
  const [at, setAt] = useState(0);
  const { steps, share } = useMemo(() => {
    // The pool is split among the submitted ballots, so one more ballot shrinks every share.
    const share = Math.floor(POOL / (BALLOTS + 1));
    const late: Voter[] = [
      ...BLOCS.map((b) => ({ id: b.id, name: b.name, weight: b.seats * share, ballot: ranksFromTiers(b.tiers) })),
      { id: "late", name: "The late ballot", weight: share, ballot: ranksFromTiers(LATE_TIERS) },
    ];
    const donatedAsks = costs.map((cost, id) => (id === WAR_ROOM ? cost - DONATION : cost));
    const first = { funded: tally(costs, blocVoters()).funded, asks: costs, ballots: BALLOTS };
    const moved = { funded: tally(costs, late).funded, asks: costs, ballots: BALLOTS + 1 };
    const answered = { funded: tally(donatedAsks, late).funded, asks: donatedAsks, ballots: BALLOTS + 1 };
    const titles = (ids: number[]) => list(ids.map((id) => PROPOSALS[id].title));
    const blocklist = PROPOSALS[BLOCKLIST];
    const warRoom = PROPOSALS[WAR_ROOM];
    const held = BLOCS[WALLET].seats * share;
    const behindWarRoom = (BLOCS[RESPONDERS].seats + 1) * share;
    const spent = answered.funded.reduce((sum, id) => sum + donatedAsks[id], 0);
    const steps = [
      {
        when: "A day before the deadline",
        what: "First tally",
        verdict: "The result to compare with",
        ...first,
        text: `The round is about to close. A day before the deadline it takes a first tally and publishes it: ${titles(first.funded)} would be funded. This is the result the deadline will be compared with.`,
      },
      {
        when: "The last hour",
        what: "A late ballot",
        verdict: "The result moved",
        ...moved,
        text: `A badge holder who had not voted submits a ballot with the war room first. The pool is now split among ${BALLOTS + 1} ballots instead of ${BALLOTS}, so every share shrinks from ${usd(POOL / BALLOTS)} to ${usd(share)}. The wallet teams could exactly afford their ${usd(blocklist.cost)} blocklist. Now they hold ${usd(held)} and it drops out, ${usd(blocklist.cost - held)} short. The war room is as close: its backers hold ${usd(behindWarRoom)} for a ${usd(warRoom.cost)} ask.`,
      },
      {
        when: "The deadline",
        what: "Not the same result",
        verdict: "Changed: voting is extended",
        ...moved,
        text: `The result is not the one that stood a day earlier: the blocklist is gone. With a hard deadline the wallet teams would have lost it with no time to answer. Here the round does not close. Voting stays open for an extension. No new ballots come in after the deadline, so every share stays at ${usd(share)}.`,
      },
      {
        when: "During the extension",
        what: "A donation",
        verdict: "The result moved",
        ...answered,
        text: `Everyone can see what is missing and by how much. A donor gives ${usd(DONATION)} to the war room, which now asks the pool for ${usd(warRoom.cost - DONATION)}. Its backers can afford it, and it is funded. Nobody does the same for the blocklist, so it stays out.`,
      },
      {
        when: "End of the extension",
        what: "Changed again",
        verdict: "Changed: extended again, half as long",
        ...answered,
        text: `The result is compared with the one at the deadline. It changed again, because the war room is in. So there is a second extension, half as long as the first. Each one is shorter than the last, which is why the round always ends.`,
      },
      {
        when: "End of the second extension",
        what: "The same result",
        verdict: "Unchanged: the round is settled",
        ...answered,
        text: `Nothing moved this time. Two results in a row are the same, so the round is settled: ${titles(answered.funded)} are funded, and the ${usd(POOL - spent)} left goes back to TheDAO. The extension gave everyone time to answer. It did not promise the first result back.`,
      },
    ];
    return { steps, share };
  }, []);

  const last = steps.length - 1;
  const step = steps[at];
  const settled = at === last;

  return (
    <div className="op-stepper op-quiet">
      <div className="op-stepper-top">
        <div className="op-stepper-head">
          <p className="op-stepper-count" aria-live="polite">
            Step {at + 1} of {last + 1}
            <span>{step.when}</span>
          </p>
          <StepControls at={at} last={last} onChange={setAt} />
        </div>
        <div className="op-narration">
          {steps.map((s, k) => (
            <p key={k} data-current={k === at || undefined} aria-hidden={k !== at || undefined}>{s.text}</p>
          ))}
        </div>
      </div>

      <ol className="op-timeline" aria-label="The end of the round">
        {steps.map((s, k) => (
          <li key={s.when} data-state={k === at ? "current" : k < at ? "past" : "ahead"}>
            <button type="button" aria-current={k === at ? "step" : undefined} onClick={() => setAt(k)}>
              <b>{s.when}</b>
              <span>{s.what}</span>
            </button>
          </li>
        ))}
      </ol>

      <FateChart times={TIMES} funded={steps.map((s) => s.funded)} at={at} rules={RULES} spans={SPANS} />

      {/* A div, not a paragraph: the ballots are drawn with block elements. */}
      <div className="op-quiet-facts">
        <span className="op-quiet-ballots">
          <Seats you={step.ballots > BALLOTS} />
          {step.ballots} ballots, {usd(step.ballots > BALLOTS ? share : POOL / BALLOTS)} each
        </span>
        <span className="op-pool-tier-status" data-settled={settled || undefined}>{step.verdict}</span>
      </div>
    </div>
  );
}
