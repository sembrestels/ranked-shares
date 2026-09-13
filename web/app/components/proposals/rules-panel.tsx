import { formatDateTime, isoDate } from "../../lib/format";
import { RuleLine } from "../ui";

/** The rule before the cost field (S1.1, H9). */
export function RulesPanel({ symbol, deadline }: { symbol: string; deadline: number }) {
  return (
    <section aria-label="How funding works" className="mb-6 flex flex-col gap-3">
      <RuleLine>Funded at exactly the amount you ask for, or not at all.</RuleLine>
      <p className="text-sm text-secondary">Amounts are in {symbol}. Voters rank projects; a project is funded when the weight behind it reaches its cost.</p>
      <p className="text-sm text-secondary">Submissions close on <time dateTime={isoDate(deadline)}>{formatDateTime(deadline)}</time>.</p>
    </section>
  );
}
