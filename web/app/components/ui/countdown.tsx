import { formatDateTime, formatDuration, isoDate } from "../../lib/format";

export function Countdown({ to, now }: { to: number; now: number }) {
  return (
    <time dateTime={isoDate(to)} title={formatDateTime(to)}>
      {formatDuration(to - now)}
    </time>
  );
}
