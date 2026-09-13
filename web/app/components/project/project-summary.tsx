import type { ProjectResponse } from "../../lib/api-types";
import { FINALITY_LABEL } from "../../lib/copy";
import { Address, Badge, Money, SupportBar } from "../ui";

export function ProjectSummary({ response: r }: { response: ProjectResponse }) {
  const p = r.project;
  const { symbol, decimals } = r.round.token;
  const title = p.title ?? r.content?.title ?? `Project ${p.id + 1}`;
  return (
    <header className="py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-xl leading-heading">{title}</h1>
        {r.round.finality && (
          <>
            <Badge tone={p.funded ? "success" : "neutral"}>{p.funded ? "Funded" : "Not funded"}</Badge>
            <Badge tone="info">{FINALITY_LABEL[r.round.finality]}</Badge>
          </>
        )}
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-secondary">Cost</dt>
        <dd><Money amount={p.cost} decimals={decimals} symbol={symbol} /></dd>
        <dt className="text-secondary">Public commitment</dt>
        <dd><Money amount={p.commitment} decimals={decimals} symbol={symbol} /></dd>
        <dt className="text-secondary">Recipient</dt>
        <dd><Address address={p.recipient} full copy /></dd>
      </dl>
      <div className="mt-4 max-w-[var(--width-reading)]">
        <SupportBar commitment={p.commitment} cost={p.cost} decimals={decimals} symbol={symbol} />
      </div>
    </header>
  );
}
