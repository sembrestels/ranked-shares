import type { RoundSnapshot } from "../../lib/api-types";
import { AUDIT_LABEL, AUDIT_URL, FINALITY_LABEL, FINALITY_SENTENCE } from "../../lib/copy";
import { formatAmount } from "../../lib/format";
import { Badge } from "../ui";
import { projectName } from "./board";

export function Outcome({ snapshot: s }: { snapshot: RoundSnapshot }) {
  if (!s.finality) return null;
  const { symbol, decimals } = s.token;
  const byId = new Map(s.projects.map((p) => [p.id, p]));
  const funded = s.fundedOrder.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const rest = s.projects.filter((p) => !s.fundedOrder.includes(p.id));
  const tone = s.finality === "abandoned" ? "error" : s.finality === "attested" ? "info" : "success";
  return (
    <section aria-labelledby="outcome-heading" className="border border-edge bg-surface p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="outcome-heading" className="font-heading text-xl">Outcome</h2>
        <Badge tone={tone}>{FINALITY_LABEL[s.finality]}</Badge>
      </div>
      <p className="mt-2 text-sm">{FINALITY_SENTENCE[s.finality]}.</p>
      {funded.length > 0 && (
        <ol aria-label="Funded projects" className="mt-4 list-decimal pl-6">
          {funded.map((p) => <li key={p.id}>{projectName(p)}, {formatAmount(p.cost, decimals).shown} {symbol}</li>)}
        </ol>
      )}
      {rest.length > 0 && (
        <ul aria-label="Not funded" className="mt-3 text-sm text-secondary">
          {rest.map((p) => <li key={p.id}>{projectName(p)}, not funded</li>)}
        </ul>
      )}
      {s.finality !== "abandoned" && (
        <p className="mt-4 text-sm"><a href={AUDIT_URL} className="underline underline-offset-4">{AUDIT_LABEL}</a></p>
      )}
    </section>
  );
}
