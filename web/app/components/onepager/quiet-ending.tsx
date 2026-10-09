import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCS, blocVoters, PROPOSALS, ranksFromTiers, tally, TIER_LABELS, tierAt, type Tally, type Voter } from "../../lib/onepager";
import { FateChart } from "./fate-chart";
import { usd } from "./pool-bar";

const costs = PROPOSALS.map((p) => p.cost);
const POOL = 100_000;
const BALLOTS = BLOCS.reduce((sum, b) => sum + b.seats, 0);
const BLOCKLIST = 4;
const SIMULATION = 5;
const WAR_ROOM = 6;
const WALLET = BLOCS.findIndex((b) => b.id === "wallet");
const RESPONDERS = BLOCS.findIndex((b) => b.id === "response");
const DONATION = 1_000;
/** The ballot that arrives on the last day: the war room first, then the legal retainer. */
const LATE_TIERS = [[6], [7]];
/** The same ballot once its voter adds the simulation warnings to their last tier. */
const ANSWER_TIERS = [...LATE_TIERS, [SIMULATION]];
// The time axis, in hours from the first tally, to scale. Every tier has a slot of two
// days: a quiet window of one day, then every further quiet window the tier could need,
// each half as long as the one before. The slot ends with the tier's winners presented.
const DAY = 24;
const SLOT = 2 * DAY;
/** The day of December on which each tier's slot starts; it ends two days later, with the presentation. */
const SLOT_STARTS = [1, 5, 8];
const STARTS = SLOT_STARTS.map((day) => (day - SLOT_STARTS[0]) * DAY);
const END = STARTS.at(-1)! + SLOT;
/** The quiet windows that are tall enough to name; the ones after them share one stretch. */
const WINDOWS = ["24h", "12h", "6h", "3h", "1.5h"];
const windowStart = (k: number) => SLOT - SLOT / 2 ** k;
/** How many quiet windows each tier needs before one ends as it began. */
const NEEDED = [3, 1, 2];
/** How far above the text the chart is drawn to, in pixels: room for the names under its last line. */
export const LEAD = 104;
/** How far past the last moment, in hours, the result as a whole is shown. */
const AFTER = 4;
// Where the moments fall. In the first slot: the first tally, the late ballot nine hours
// before the deadline, the deadline, the donation halfway through the second quiet
// window, the end of that window, and the end of the third, which settles the tier. In
// the second: the first tally, and the end of the first quiet window, which settles it.
// In the third: the first tally, a ballot changed that afternoon, the end of the first
// quiet window and the end of the second, which settles it. Every slot ends with its
// presentation.
const TIMES = [
  0, 15, windowStart(1), 30, windowStart(2), windowStart(NEEDED[0]), SLOT,
  STARTS[1], STARTS[1] + windowStart(NEEDED[1]), STARTS[1] + SLOT,
  STARTS[2], STARTS[2] + 15, STARTS[2] + windowStart(1), STARTS[2] + windowStart(NEEDED[2]), END,
];
const TICKS = Array.from({ length: END / DAY + 1 }, (_, k) => ({
  at: k * DAY,
  label: `Dec ${SLOT_STARTS[0] + k}`,
  strong: STARTS.includes(k * DAY - SLOT),
}));
const GROUPS = STARTS.map((start, t) => ({ from: start, to: start + SLOT, label: TIER_LABELS[t] }));
// The quiet window that settles a tier is shaded, and says so when pointed at: the one
// that ends as it began.
const SPANS = STARTS.flatMap((start, t) => [
  ...WINDOWS.map((length, k) => ({ from: start + windowStart(k), to: start + windowStart(k + 1), label: length, ...(k === NEEDED[t] - 1 && { shaded: true, note: `Nothing moved in the ${length} quiet window. The ${TIER_LABELS[t]} is settled after this window.` }) })),
  { from: start + windowStart(WINDOWS.length), to: start + SLOT },
]);
const RULES = STARTS.flatMap((start) => [
  ...WINDOWS.map((_, k) => ({ at: start + windowStart(k) })),
  { at: start + windowStart(WINDOWS.length) },
  { at: start + SLOT, strong: true },
]);
const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
/** What a tally funds from one tier, and from that tier and the ones above it. */
const fundedFrom = (result: Tally, t: number) =>
  result.frames.flatMap((f) => (f.funded !== null && tierAt(f.level) === t ? [f.funded] : []));
const fundedThrough = (result: Tally, t: number) =>
  result.frames.flatMap((f) => (f.funded !== null && tierAt(f.level) <= t ? [f.funded] : []));

/** One late move followed through a slow quiet ending, which settles one tier at a time,
 * each in a two-day slot of its own that starts with a first tally and ends with its
 * winners presented. The S-Tier takes most of it: a first tally, a late ballot that
 * shrinks every share and leaves two proposals just short, the deadline that does not
 * settle the tier, a donation in the next quiet window that rescues one of them, and the
 * two more windows it takes to settle. The A-Tier stands still. In the B-Tier's first
 * quiet window a voter adds a proposal that was just short, which takes one more window
 * to settle. Every figure comes from the tally. The reader scrolls through it: the chart is drawn down to the hour they have
 * reached, and the text for that moment stays at the bottom. */
export function QuietEnding() {
  const [now, setNow] = useState(0);
  // Whether the chart has reached the place where its lines start to be drawn.
  const [started, setStarted] = useState(false);
  // Whether the reader has scrolled a little past the last moment, to the result as a whole.
  const [finished, setFinished] = useState(false);
  const { steps, result } = useMemo(() => {
    // The pool is split among the submitted ballots, so one more ballot shrinks every share.
    const share = Math.floor(POOL / (BALLOTS + 1));
    const withLate = (tiers: number[][]): Voter[] => [
      ...BLOCS.map((b) => ({ id: b.id, name: b.name, weight: b.seats * share, ballot: ranksFromTiers(b.tiers) })),
      { id: "late", name: "The late ballot", weight: share, ballot: ranksFromTiers(tiers) },
    ];
    const late = withLate(LATE_TIERS);
    const donatedAsks = costs.map((cost, id) => (id === BLOCKLIST ? cost - DONATION : cost));
    const first = { funded: fundedThrough(tally(costs, blocVoters()), 0) };
    const moved = { funded: fundedThrough(tally(costs, late), 0) };
    // Before the last voter answers, and after.
    const quiet = tally(donatedAsks, late);
    const final = tally(donatedAsks, withLate(ANSWER_TIERS));
    const through = (t: number) => ({ funded: fundedThrough(final, t) });
    const titles = (ids: number[]) => list(ids.map((id) => PROPOSALS[id].title));
    const blocklist = PROPOSALS[BLOCKLIST];
    const warRoom = PROPOSALS[WAR_ROOM];
    const simulation = PROPOSALS[SIMULATION];
    const held = BLOCS[WALLET].seats * share;
    const behindWarRoom = (BLOCS[RESPONDERS].seats + 1) * share;
    // What is left once the A-Tier is paid for, and how much of it is behind the simulation warnings.
    const left = quiet.frames.at(-1)!.left;
    const behindSimulation = late.reduce((sum, v, i) => (v.ballot![SIMULATION] ? sum + left[i] : sum), 0);
    const spent = final.funded.reduce((sum, id) => sum + donatedAsks[id], 0);
    const are = (ids: number[]) => (ids.length > 1 ? "are" : "is");
    const [s, a, b] = TIER_LABELS;
    const won = TIER_LABELS.map((_, t) => fundedFrom(final, t));
    const steps = [
      {
        when: "December 1",
        what: `First ${s} tally`,
        why: "The fuzzing harness and the blocklist would be funded.",
        verdict: "The result to compare with",
        ...first,
        text: `The round settles one tier at a time, starting with everyone's ${s}. It takes a first tally of that tier and publishes it: ${titles(first.funded)} would be funded from it. A quiet window of 24 hours starts. If the result is the same when it ends, the tier is settled.`,
      },
      {
        when: "December 1, the afternoon",
        what: "A late ballot",
        why: "Every share shrinks, and the blocklist drops out.",
        verdict: "The result moved",
        ...moved,
        text: `A badge holder who had not voted submits a ballot with the war room first. The pool is now split among ${BALLOTS + 1} ballots instead of ${BALLOTS}, so every share shrinks from ${usd(POOL / BALLOTS)} to ${usd(share)}. The wallet teams could exactly afford their ${usd(blocklist.cost)} blocklist. Now they hold ${usd(held)} and it drops out, ${usd(blocklist.cost - held)} short. The war room is as close: its backers hold ${usd(behindWarRoom)} for a ${usd(warRoom.cost)} ask.`,
      },
      {
        when: "December 2, the deadline",
        what: "Not the same result",
        why: "The blocklist is gone, so a 12h quiet window starts.",
        verdict: "Changed: a new quiet window, half as long",
        ...moved,
        text: `The 24-hour quiet window ends, and the result is not the one it started with: the blocklist is gone. With a hard deadline the wallet teams would have lost it with only hours to answer. Here the ${s} is not settled. A new quiet window starts, half as long as the first. No new ballots come in after the deadline, so every share stays at ${usd(share)}.`,
      },
      {
        when: "December 2, the morning",
        what: "A donation",
        why: "The blocklist asks for less, and is back in.",
        verdict: "The result moved",
        ...through(0),
        text: `Everyone can see what is missing and by how much. A donor gives ${usd(DONATION)} to the blocklist, which now asks the pool for ${usd(blocklist.cost - DONATION)}. The wallet teams can afford it again, and it is back in. Nobody does the same for the war room, so it stays out.`,
      },
      {
        when: "December 2, midday",
        what: "Changed again",
        why: "The blocklist is back, so a 6h quiet window starts.",
        verdict: "Changed: a new quiet window, half as long",
        ...through(0),
        text: `The 12-hour quiet window ends, and the result changed again: the blocklist is back. So another quiet window starts, half as long again. Each one is half the one before, so together they always take less than two days. That is why the presentation can have a fixed date.`,
      },
      {
        when: "December 2, the evening",
        what: `${s} settled`,
        why: "Nothing moved in the 6h quiet window: the fuzzing harness and the blocklist are final.",
        verdict: `Unchanged: the ${s} is settled`,
        settled: true,
        ...through(0),
        text: `Nothing moved in the 6-hour quiet window. The result at its end is the one at its start, so the ${s} is settled: ${titles(won[0])} ${are(won[0])} funded. This is final, and everyone can see it. The shorter quiet windows that could have followed are not needed. Nobody can change their ${s} any more, but the tiers below it stay open.`,
      },
      {
        when: "December 3",
        what: `${s} winners presented`,
        why: `The day fixed in advance for the ${s}.`,
        verdict: `The ${s} is settled`,
        settled: true,
        ...through(0),
        text: `The ${s}'s two days are over, and its winners are presented in public on the day fixed in advance: ${titles(won[0])}. However its quiet windows had gone, the tier would have been settled by now. From here everyone rearranges their lower tiers knowing what the ${s} paid for.`,
      },
      {
        when: "December 5",
        what: `First ${a} tally`,
        shows: true,
        why: `The money the ${s} left pays for the retainer and the findings database.`,
        verdict: "The result to compare with",
        ...through(1),
        text: `The ${a} gets two days of its own, and they start with a first tally on top of the final ${s}: ${titles(won[1])} would be funded from it. Nobody changed anything: this is the first time the ${a} is counted. The war room stayed out, so its backers still hold their money, and it helps pay for the retainer. The auditors and the researchers pay for the findings database with what they have left.`,
      },
      {
        when: "December 6",
        what: `${a} settled`,
        why: "Nothing moved in the 24h quiet window: the retainer and the findings database are final.",
        verdict: `Unchanged: the ${a} is settled`,
        settled: true,
        ...through(1),
        text: `The 24-hour quiet window ends and nobody moved. The result is the one of the first tally, so the ${a} is settled with no further quiet window: ${titles(won[1])} ${are(won[1])} funded. Only the ${b} is still open.`,
      },
      {
        when: "December 7",
        what: `${a} winners presented`,
        why: `The day fixed in advance for the ${a}.`,
        verdict: `The ${a} is settled`,
        settled: true,
        ...through(1),
        text: `The ${a}'s winners are presented in public on their day: ${titles(won[1])}. They have been settled since the day before.`,
      },
      {
        when: "December 8",
        what: `First ${b} tally`,
        why: `Nothing would be funded: the simulation warnings are ${usd(simulation.cost - behindSimulation)} short.`,
        verdict: "The result to compare with",
        ...through(1),
        text: `The ${b} gets its two days too, and they start with its first tally. Nothing would be funded from it: ${simulation.title} comes closest, ${usd(simulation.cost - behindSimulation)} short. A quiet window of 24 hours starts.`,
      },
      {
        when: "December 8, the afternoon",
        what: "A ballot is changed",
        why: `The late voter adds the simulation warnings to their ${b}.`,
        verdict: "The result moved",
        ...through(2),
        text: `With two tiers final, everyone can see what is left and what is missing. The late voter still holds ${usd(left.at(-1)!)}, more than the ${usd(simulation.cost - behindSimulation)} missing, and adds ${simulation.title} to their ${b}. It would now be funded.`,
      },
      {
        when: "December 9",
        what: "Not the same result",
        why: "The simulation warnings are in, so a 12h quiet window starts.",
        verdict: "Changed: a new quiet window, half as long",
        ...through(2),
        text: `The 24-hour quiet window ends, and the result is not the one it started with: ${simulation.title} is in. So the ${b} is not settled yet. A new quiet window starts, half as long, in case anyone wants to answer.`,
      },
      {
        when: "December 9, midday",
        what: `${b} settled`,
        why: "Nothing moved in the 12h quiet window: the simulation warnings are final.",
        verdict: `Unchanged: the ${b} is settled`,
        settled: true,
        ...through(2),
        text: `Nothing moved in the 12-hour quiet window, so the ${b} is settled: ${titles(won[2])} ${are(won[2])} funded. Every tier is final now.`,
      },
      {
        when: "December 10",
        what: `${b} winners presented`,
        why: `The day fixed in advance for the ${b}.`,
        verdict: "The round is settled",
        settled: true,
        ...through(2),
        text: `The last presentation, on its day: the ${b}'s winners, ${titles(won[2])}. The round is over.`,
      },
    ];
    // What each tier funded, and what goes back.
    const result = { tiers: won, left: POOL - spent };
    return { steps, result };
  }, []);

  // The moment the reader has scrolled to: the hour of the chart that sits just above
  // the text at the bottom, or above the bottom of the screen while the text is below it.
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const plot = root.current?.querySelector(".op-fate-plot")?.getBoundingClientRect();
      if (!plot?.height) return;
      const edge = Math.min(panel.current?.getBoundingClientRect().top ?? Infinity, window.innerHeight) - LEAD;
      const hour = ((edge - plot.top) / plot.height) * END;
      setNow(Math.round(Math.min(END, Math.max(0, hour)) * 10) / 10);
      setStarted(hour >= 0);
      setFinished(hour >= END + AFTER);
    };
    const onScroll = () => { frame ||= requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // The page above can still change height after this is first read.
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    resized?.observe(document.documentElement);
    return () => {
      resized?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const at = TIMES.filter((t) => t <= now).length - 1;

  return (
    <div className="op-stepper op-quiet" ref={root}>
      <FateChart
        times={TIMES}
        funded={steps.map((s) => s.funded)}
        now={now}
        events={steps}
        ticks={TICKS}
        rules={RULES}
        spans={SPANS}
        groups={GROUPS}
      />
      {/* Every moment's text sits in the same cell and only the current one shows, so the
          box is always as tall as the tallest and one fades into the next. The box itself
          only shows once the lines start to be drawn. */}
      <div className="op-quiet-panel" ref={panel} aria-live="polite" data-waiting={!started || undefined}>
        {steps.map((s, k) => (
          <div key={k} className="op-quiet-step" data-current={(k === at && !finished) || undefined} aria-hidden={k !== at || finished || undefined}>
            <p className="op-quiet-when">
              {s.when}
              <span>{s.what}</span>
            </p>
            <p className="op-quiet-text">{s.text}</p>
            <p className="op-quiet-verdict" data-settled={"settled" in s || undefined}>{s.verdict}</p>
          </div>
        ))}
        <div className="op-quiet-step" data-current={finished || undefined} aria-hidden={!finished || undefined}>
          <p className="op-quiet-when">
            The final result
            <span>Presented in three parts</span>
          </p>
          <dl className="op-quiet-result">
            {TIER_LABELS.map((label, t) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {result.tiers[t].map((id) => (
                    <span key={id} data-camp={PROPOSALS[id].camp}><i />{PROPOSALS[id].title}</span>
                  ))}
                  {result.tiers[t].length === 0 && "Nothing funded"}
                </dd>
              </div>
            ))}
            <div>
              <dt>Back to TheDAO</dt>
              <dd>{usd(result.left)}</dd>
            </div>
          </dl>
          <p className="op-quiet-verdict" data-settled>The round is settled</p>
        </div>
      </div>
    </div>
  );
}
