import { formatAmount } from "../../lib/format";

/** Public commitment relative to cost. The sealed total is never drawn here:
 * sealed weight is one number for the whole pool. */
export function SupportBar(
  { commitment, cost, decimals, symbol }: {
    commitment: string;
    cost: string;
    decimals: number;
    symbol: string;
  },
) {
  const c = BigInt(commitment);
  const k = BigInt(cost);
  const pct = k === 0n ? 0 : Number((c * 1000n) / k) / 10;
  const width = Math.min(100, pct);
  const label = `Public commitment ${formatAmount(c, decimals).shown} of ${formatAmount(k, decimals).shown} ${symbol}`;
  return (
    <div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-label={label}
        className="h-2 w-full bg-sunken"
      >
        <div className="h-full bg-success" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-sm text-secondary tabular-nums">
        {pct >= 100 ? "Cost covered by public commitments" : `${pct}% of cost`}
      </p>
    </div>
  );
}
