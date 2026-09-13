import { formatAmount } from "../../lib/format";

export function Money(
  { amount, decimals, symbol, maxFraction = 2 }: {
    amount: string | bigint;
    decimals: number;
    symbol: string;
    maxFraction?: number;
  },
) {
  const { shown, full } = formatAmount(amount, decimals, maxFraction);
  return (
    <span className="tabular-nums whitespace-nowrap" title={`${full} ${symbol}`}>
      {shown} {symbol}
    </span>
  );
}
