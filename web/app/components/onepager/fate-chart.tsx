import { useRef, useState, type PointerEvent } from "react";
import { PROPOSALS } from "../../lib/onepager";

const HOUR = 0.84; // the height of an hour, in rem
const COL = 10; // one column of the plot in drawing units
const BEND = 3; // how long a line takes to bend, in hours
const GAP = 3.5; // the least distance between two event labels, in rem

/** How far along a bend a line is when `part` of the bend's time has passed: the bend is
 * a curve whose time runs as 1.5u - 1.5u² + u³, solved for u. */
function along(part: number) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const u = (low + high) / 2;
    if (1.5 * u - 1.5 * u * u + u * u * u < part) low = u;
    else high = u;
  }
  return (low + high) / 2;
}

/** Every proposal's fate over the end of the round. Time runs down, to scale; a line
 * runs in the left band while its proposal would be funded and in the right one while
 * it would not, and bends from one to the other around the moment that changes it. To the left of the
 * plot are the days, the groups and the spans they are made of; to the right, what
 * happens at each moment. The lines are drawn down to the hour in `now`, and everything
 * else on the time axis appears when they reach it.
 *
 * `times` places the moments on the time axis, in hours, and `funded` lists what would
 * be funded at each; `events` names them and says why the lines move. `ticks`, `rules`, `spans` and `groups` are
 * placed on the same axis. */
export function FateChart({ times, funded, now, events, ticks, rules, spans, groups }: {
  times: readonly number[];
  funded: readonly (readonly number[])[];
  now: number;
  /** `shows` marks a moment that changes nothing itself and only shows what was already so. */
  events: readonly { what: string; why: string; shows?: boolean }[];
  ticks: readonly { at: number; label: string; strong?: boolean }[];
  rules: readonly { at: number; strong?: boolean }[];
  /** A shaded span gets its shade, and shows its `note` under the pointer, once the lines have passed it. */
  spans: readonly { from: number; to: number; label?: string; shaded?: boolean; note?: string }[];
  groups: readonly { from: number; to: number; label: string }[];
}) {
  // What is under the pointer, a line or a span with a note, and where the pointer is in the plot.
  const [hover, setHover] = useState<{ id?: number; text: string; left: number; top: number } | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const end = times.at(-1)!;
  const y = (t: number) => `${t * HOUR}rem`;
  const ahead = (t: number) => now < t || undefined;
  const ids = PROPOSALS.map((_, id) => id);
  const isFunded = (id: number, k: number) => funded[k].includes(id);
  const always = ids.filter((id) => funded.every((list) => list.includes(id)));
  const never = ids.filter((id) => funded.every((list) => !list.includes(id)));
  const moving = ids.filter((id) => !always.includes(id) && !never.includes(id));
  // The proposals that change sides sit next to the border between the two bands, so
  // their lines cross nobody else's.
  const left = [...always, ...moving];
  const right = [...moving, ...never];
  // Columns, left to right: the funded band, an empty one for the border, the unfunded band.
  const cols = left.length + 1 + right.length;
  const col = (id: number, k: number) => (isFunded(id, k) ? left.indexOf(id) : left.length + 1 + right.indexOf(id));
  const x = (id: number, k: number) => (col(id, k) + 0.5) * COL;
  const percent = (drawn: number) => `${(drawn / (cols * COL)) * 100}%`;
  // A line bends right after the moment that moves it. Where a moment only shows what was
  // already so, the lines bend just before it, and are straight when it comes.
  const bend = (k: number) =>
    events[k].shows
      ? [Math.max(times[k - 1], times[k] - BEND), times[k]]
      : [times[k], Math.min(times[k] + BEND, times[k + 1] ?? times[k])];
  const moves = (id: number) => times.map((_, k) => k).filter((k) => k > 0 && isFunded(id, k) !== isFunded(id, k - 1));

  const path = (id: number) => {
    let d = `M${x(id, 0)} ${times[0]}`;
    for (const k of moves(id)) {
      const [from, to] = bend(k);
      const middle = (from + to) / 2;
      d += ` L${x(id, k - 1)} ${from} C${x(id, k - 1)} ${middle} ${x(id, k)} ${middle} ${x(id, k)} ${to}`;
    }
    return `${d} L${x(id, times.length - 1)} ${end}`;
  };
  // Where a proposal's line is at the hour `t`.
  const xAt = (id: number, t: number) => {
    for (const k of moves(id)) {
      const [from, to] = bend(k);
      if (t <= from) return x(id, k - 1);
      if (t >= to) continue;
      const u = along((t - from) / (to - from));
      return x(id, k - 1) + (x(id, k) - x(id, k - 1)) * (3 * u * u - 2 * u * u * u);
    }
    return x(id, times.length - 1);
  };

  // An event's label sits beside its moment, or just below the label before it when two
  // moments are too close; a link ties each label to its moment.
  const labels: number[] = [];
  for (const t of times) labels.push(Math.max(t * HOUR, (labels.at(-1) ?? -GAP) + GAP));

  // The note of the span the pointer is over, if the lines have passed that span.
  const overSpan = (event: PointerEvent) => {
    const box = plot.current!.getBoundingClientRect();
    const hour = ((event.clientY - box.top) / box.height) * end;
    const span = spans.find((one) => one.note && hour >= one.from && hour < one.to && now >= one.to);
    setHover(span ? { text: span.note!, left: event.clientX - box.left, top: event.clientY - box.top } : null);
  };
  const at = times.filter((t) => t <= now).length - 1;
  const names = (list: number[]) => list.map((id) => PROPOSALS[id].title).join(", ") || "none";
  const fundedNow = ids.filter((id) => isFunded(id, at));
  const column = (k: number) => ids.map((id) => (
    <span key={id} style={{ left: percent(x(id, k)) }}>{PROPOSALS[id].short}</span>
  ));
  return (
    <div className="op-fate" style={{ "--op-fate-height": y(end) } as React.CSSProperties}>
      {/* Each proposal is named above the column where it starts and below the one where it ends. */}
      <div className="op-fate-head" aria-hidden="true">
        <b style={{ left: 0, width: `${(left.length / cols) * 100}%` }}>Funded</b>
        <b style={{ left: `${((left.length + 1) / cols) * 100}%`, right: 0 }}>Not funded</b>
        {column(0)}
      </div>
      <div className="op-fate-days" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.at} data-strong={tick.strong || undefined} data-ahead={ahead(tick.at)} style={{ top: y(tick.at) }}>{tick.label}</span>
        ))}
      </div>
      <div className="op-fate-groups" aria-hidden="true">
        {groups.map((group) => (
          <span key={group.from} data-ahead={ahead(group.from)} style={{ top: y(group.from), height: y(group.to - group.from) }}>{group.label}</span>
        ))}
      </div>
      <div className="op-fate-spans" aria-hidden="true" onPointerMove={overSpan} onPointerLeave={() => setHover(null)}>
        {spans.map((span) => (
          <span key={span.from} data-shaded={(span.shaded && now >= span.to) || undefined} data-ahead={ahead(span.from)} style={{ top: y(span.from), height: y(span.to - span.from) }}>
            {span.label}
          </span>
        ))}
        {/* The other rules continue the top edge of a span; the strong ones start no span. */}
        {rules.filter((rule) => rule.strong).map((rule) => (
          <div key={rule.at} className="op-fate-rule" data-strong data-ahead={ahead(rule.at)} style={{ top: y(rule.at) }} />
        ))}
        <div className="op-fate-now" style={{ top: y(now) }} />
      </div>
      <div
        ref={plot}
        className="op-fate-plot"
        role="img"
        onPointerMove={overSpan}
        onPointerLeave={() => setHover(null)}
        aria-label={`Each proposal over time. At this moment, funded: ${names(fundedNow)}. Not funded: ${names(ids.filter((id) => !fundedNow.includes(id)))}.`}
      >
        {spans.filter((span) => span.shaded).map((span) => (
          <div key={span.from} className="op-fate-shade" data-ahead={ahead(span.to)} style={{ top: y(span.from), height: y(span.to - span.from) }} />
        ))}
        <div className="op-fate-border" style={{ left: `${((left.length + 0.5) / cols) * 100}%`, height: y(now) }} />
        {rules.map((rule) => (
          <div key={rule.at} className="op-fate-rule" data-strong={rule.strong || undefined} data-ahead={ahead(rule.at)} style={{ top: y(rule.at) }} />
        ))}
        <svg viewBox={`0 0 ${cols * COL} ${end}`} preserveAspectRatio="none" style={{ clipPath: `inset(-1rem -1rem ${100 - (now / end) * 100}% -1rem)` }}>
          {ids.map((id) => <path key={id} d={path(id)} data-camp={PROPOSALS[id].camp} data-hover={hover?.id === id || undefined} />)}
          {/* A wider line over each one, to point at. */}
          {ids.map((id) => (
            <path
              key={id}
              className="op-fate-hit"
              d={path(id)}
              onPointerMove={(event) => {
                event.stopPropagation();
                const box = plot.current!.getBoundingClientRect();
                setHover({ id, text: PROPOSALS[id].title, left: event.clientX - box.left, top: event.clientY - box.top });
              }}
            />
          ))}
        </svg>
        {hover && (
          <span className="op-fate-tip" data-camp={hover.id === undefined ? undefined : PROPOSALS[hover.id].camp} style={{ left: hover.left, top: hover.top }}>{hover.text}</span>
        )}
        <div className="op-fate-now" style={{ top: y(now) }} />
        {ids.map((id) => (
          <i key={id} className="op-fate-dot" data-camp={PROPOSALS[id].camp} style={{ left: percent(xAt(id, now)), top: y(now) }} />
        ))}
      </div>
      {/* A link that has to slant is drawn; a level one is a rule like the ones in the
          plot, so that it falls on the same pixels. */}
      <svg className="op-fate-links" viewBox={`0 0 10 ${end * HOUR}`} preserveAspectRatio="none" aria-hidden="true">
        {times.map((t, k) => labels[k] !== t * HOUR && <path key={k} d={`M0 ${t * HOUR} L10 ${labels[k]}`} data-ahead={ahead(t)} />)}
      </svg>
      {/* The line of the current hour runs on over the links, and covers the one it reaches. */}
      <div className="op-fate-reach" aria-hidden="true">
        {times.map((t, k) => labels[k] === t * HOUR && <div key={k} className="op-fate-rule" data-ahead={ahead(t)} style={{ top: y(t) }} />)}
        <div className="op-fate-now" style={{ top: y(now) }} />
      </div>
      <ol className="op-fate-events" aria-hidden="true">
        {events.map((event, k) => (
          <li key={k} data-ahead={ahead(times[k])} data-current={k === at || undefined} style={{ top: `${labels[k]}rem` }}>
            <b>{event.what}</b>
            <span>{event.why}</span>
          </li>
        ))}
      </ol>
      <div className="op-fate-foot" aria-hidden="true" data-ahead={ahead(end)}>{column(times.length - 1)}</div>
    </div>
  );
}
