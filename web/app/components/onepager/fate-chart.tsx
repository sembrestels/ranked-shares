import { useRef } from "react";
import { PROPOSALS } from "../../lib/onepager";

const ROW = 24; // one row of the plot in drawing units; a row is 1.5rem tall on the page
const BEND = 3; // how far before a moment, in percent of the width, a line starts to bend

/** Every proposal's fate over the end of the round. Time runs to the right; a line runs
 * in the upper band while its proposal would be funded and in the lower one while it
 * would not, and bends from one to the other when that changes. Vertical rules mark the
 * first tally, the deadline and the end of each extension. The lines are drawn up to the
 * moment in `at`, and move there when `at` changes.
 *
 * `times` places the moments on the time axis (only their proportions matter) and
 * `funded` lists what would be funded at each. `rules` and `spans` index into `times`. */
export function FateChart({ times, funded, at, rules, spans }: {
  times: readonly number[];
  funded: readonly (readonly number[])[];
  at: number;
  /** `once` holds a label back until that moment is reached, for what is not known before. */
  rules: readonly { at: number; label?: string; strong?: boolean; once?: boolean }[];
  spans: readonly { from: number; to: number; label: string; short?: string; shaded?: boolean }[];
}) {
  const end = times.at(-1)!;
  const xs = times.map((t) => 2 + (t / end) * 95);
  const ids = PROPOSALS.map((_, id) => id);
  const isFunded = (id: number, k: number) => funded[k].includes(id);
  const always = ids.filter((id) => funded.every((list) => list.includes(id)));
  const never = ids.filter((id) => funded.every((list) => !list.includes(id)));
  const moving = ids.filter((id) => !always.includes(id) && !never.includes(id));
  // The proposals that change sides sit next to the border between the two bands, so
  // their lines cross nobody else's.
  const upper = [...always, ...moving];
  const lower = [...moving, ...never];
  // Rows, top to bottom: the span labels, the funded band, two rows around the border
  // between the bands (one for each band's name), and the unfunded band.
  const rows = upper.length + lower.length + 3;
  const border = upper.length + 2;
  const row = (id: number, k: number) =>
    isFunded(id, k) ? 1 + upper.indexOf(id) : border + 1 + lower.indexOf(id);
  const y = (id: number, k: number) => (row(id, k) + 0.5) * ROW;

  const path = (id: number) => {
    let d = `M${xs[0]} ${y(id, 0)}`;
    for (let k = 1; k < xs.length; k++) {
      if (isFunded(id, k) === isFunded(id, k - 1)) {
        d += ` L${xs[k]} ${y(id, k)}`;
        continue;
      }
      const from = Math.max(xs[k - 1], xs[k] - BEND);
      const middle = (from + xs[k]) / 2;
      d += ` L${from} ${y(id, k - 1)} C${middle} ${y(id, k - 1)} ${middle} ${y(id, k)} ${xs[k]} ${y(id, k)}`;
    }
    return d;
  };

  // A dot changes band during the part of the trip in which its line bends: at the end
  // going forward, at the start going back.
  const previous = useRef(at);
  const back = at < previous.current;
  const leg = back ? at + 1 : at;
  const bend = leg > 0 && leg < xs.length ? Math.min(1, BEND / (xs[leg] - xs[leg - 1])) : 1;
  previous.current = at;
  const timing = {
    "--op-fate-bend": `${bend * 600}ms`,
    "--op-fate-wait": `${back ? 0 : (1 - bend) * 600}ms`,
  } as React.CSSProperties;

  const names = (list: number[]) => list.map((id) => PROPOSALS[id].title).join(", ") || "none";
  const now = ids.filter((id) => isFunded(id, at));
  return (
    <figure
      className="op-fate"
      role="img"
      aria-label={`Each proposal over time. At this moment, funded: ${names(now)}. Not funded: ${names(ids.filter((id) => !now.includes(id)))}.`}
      style={{ "--op-fate-rows": rows, ...timing } as React.CSSProperties}
    >
      {/* Each proposal is named once, on the row where it starts. */}
      <div className="op-fate-names" aria-hidden="true">
        {ids.map((id) => (
          <span key={id} data-camp={PROPOSALS[id].camp} style={{ gridRow: row(id, 0) + 1 }}><i />{PROPOSALS[id].short}</span>
        ))}
      </div>
      <div className="op-fate-plot" aria-hidden="true">
        {spans.map((span) => (
          <div key={span.label} className="op-fate-span" data-shaded={span.shaded || undefined} style={{ left: `${xs[span.from]}%`, width: `${xs[span.to] - xs[span.from]}%` }}>
            <span className="op-fate-long">{span.label}</span>
            <span className="op-fate-short">{span.short ?? span.label}</span>
          </div>
        ))}
        <div className="op-fate-border" style={{ top: `${border * 1.5}rem` }} />
        <span className="op-fate-band" style={{ left: `${xs[0]}%`, top: `${(border - 1) * 1.5}rem` }}>↑ Funded</span>
        <span className="op-fate-band" style={{ left: `${xs[0]}%`, top: `${border * 1.5}rem` }}>↓ Not funded</span>
        {rules.map((rule) => (
          <div key={rule.at} className="op-fate-rule" data-strong={rule.strong || undefined} style={{ left: `${xs[rule.at]}%` }} />
        ))}
        <svg viewBox={`0 0 100 ${rows * ROW}`} preserveAspectRatio="none" style={{ clipPath: `inset(-1rem ${100 - xs[at]}% -1rem 0)` }}>
          {ids.map((id) => <path key={id} d={path(id)} data-camp={PROPOSALS[id].camp} />)}
        </svg>
        <div className="op-fate-now" style={{ left: `${xs[at]}%` }} />
        {ids.map((id) => (
          <i key={id} className="op-fate-dot" data-camp={PROPOSALS[id].camp} style={{ left: `${xs[at]}%`, top: `${(row(id, at) + 0.5) * 1.5}rem` }} />
        ))}
      </div>
      <div className="op-fate-axis" aria-hidden="true">
        {rules.filter((rule) => rule.label).map((rule) => (
          <span
            key={rule.at}
            data-edge={rule.at === 0 ? "start" : rule.at === xs.length - 1 ? "end" : undefined}
            data-hidden={rule.once && at < rule.at || undefined}
            style={{ left: `${xs[rule.at]}%` }}
          >
            {rule.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
