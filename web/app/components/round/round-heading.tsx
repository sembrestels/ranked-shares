import type { RoundSnapshot } from "../../lib/api-types";
import { formatAgo } from "../../lib/format";
import { Money } from "../ui";

export function RoundHeading({ snapshot: s, now, name }: { snapshot: RoundSnapshot; now: number; name: string }) {
  return (
    <header className="py-8">
      <h1 className="font-heading text-display leading-heading tracking-tight">{name}</h1>
      <p className="mt-3 text-secondary"><Money amount={s.totalWeight} decimals={s.token.decimals} symbol={s.token.symbol} /> in the pool</p>
      <p className="mt-1 text-sm text-secondary">Updated {formatAgo(Math.max(0, now - s.at))}</p>
    </header>
  );
}
