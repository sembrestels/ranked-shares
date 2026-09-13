import type { RoundSnapshot } from "../../lib/api-types";
import { Money } from "../ui";

/** One number for the whole pool: sealed weight is never shown per project. */
export function SealedPanel({ snapshot: s }: { snapshot: RoundSnapshot }) {
  return (
    <aside aria-labelledby="sealed-heading" className="border border-edge bg-sunken p-6">
      <h2 id="sealed-heading" className="font-heading text-xl">Sealed side</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <dt className="text-secondary">Sealed weight</dt>
        <dd><Money amount={s.sealed.total} decimals={s.token.decimals} symbol={s.token.symbol} /></dd>
        <dt className="text-secondary">Sealed ballots</dt>
        <dd>{s.sealed.count}</dd>
      </dl>
      <p className="mt-3 text-sm text-secondary">Sealed ballots are counted after the deadline; nobody sees how they rank until then, and the result never reveals them.</p>
      {!s.sealed.commitmentsAvailable && s.ballots === "chain" && <p className="mt-2 text-sm text-secondary">Public commitments are not available for this pool variant yet.</p>}
      {s.ballots === "arkiv" && <p className="mt-2 text-sm text-secondary">Ballots are stored in Arkiv; public commitments and the provisional result are computed in your browser from every accepted public ballot.</p>}
    </aside>
  );
}
