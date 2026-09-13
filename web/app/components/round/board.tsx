import { Link } from "react-router";
import type { RoundSnapshot } from "../../lib/api-types";
import { roundHref } from "../../lib/round-directory";
import { Badge, Money, SupportBar } from "../ui";

export const projectName = (p: { id: number; title: string | null }) => p.title ?? `Project ${p.id + 1}`;

/** Public commitments per project, most backed first. For an Arkiv pool the
 * commitments come from the browser (useArkivPublic) and override the snapshot's. */
export function Board({ snapshot: s, commitments }: { snapshot: RoundSnapshot; commitments?: string[] }) {
  const withCommitments = s.projects.map((p, i) => ({ ...p, commitment: commitments?.[i] ?? p.commitment }));
  const rows = [...withCommitments].sort((a, b) => (BigInt(b.commitment) > BigInt(a.commitment) ? 1 : BigInt(b.commitment) < BigInt(a.commitment) ? -1 : a.id - b.id));
  const { symbol, decimals } = s.token;
  const computing = s.ballots === "arkiv" && !commitments && !s.finality;
  return (
    <section aria-labelledby="board-heading">
      <h2 id="board-heading" className="font-heading text-xl">Public commitments</h2>
      {computing && <p className="mt-2 text-sm text-secondary">Public commitments are being computed from Arkiv in your browser.</p>}
      <ul aria-labelledby="board-heading" className="mt-4 flex flex-col gap-4">
        {rows.map((p) => (
          <li key={p.id} className="border border-edge bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <Link to={roundHref(s.pool, `/project/${p.id}`)} className="font-heading text-lg">{projectName(p)}</Link>
              {s.finality && <Badge tone={p.funded ? "success" : "neutral"}>{p.funded ? "Funded" : "Not funded"}</Badge>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <dt className="text-secondary">Cost</dt>
              <dd><Money amount={p.cost} decimals={decimals} symbol={symbol} /></dd>
              <dt className="text-secondary">Public commitment</dt>
              <dd><Money amount={p.commitment} decimals={decimals} symbol={symbol} /></dd>
            </dl>
            <div className="mt-3">
              <SupportBar commitment={p.commitment} cost={p.cost} decimals={decimals} symbol={symbol} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
