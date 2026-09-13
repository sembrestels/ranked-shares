/** Meta tags for prerendered pages so shared links unfurl (S5.11, S5.12). */
import { formatAmount, formatDateTime } from "./format";

export interface ProjectMetaData {
  title: string | null;
  cost: string;
  decimals: number;
  symbol: string;
}
export interface RoundMetaData {
  name: string;
  votingDeadline: number;
}
type Tag = { title: string } | { name: string; content: string } | { property: string; content: string } | { tagName: "link"; rel: string; href: string };

export function projectMetaTags(data: ProjectMetaData | null, id: number, siteUrl: string): Tag[] {
  const name = data?.title ?? `Project ${id + 1}`;
  const description = data
    ? `A project asking for ${formatAmount(data.cost, data.decimals).shown} ${data.symbol} in a RankedShares funding round.`
    : "A project in a RankedShares funding round.";
  return [
    { title: `${name} · RankedShares` },
    { property: "og:title", content: name },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { tagName: "link", rel: "canonical", href: `${siteUrl.replace(/\/+$/, "")}/project/${id}` },
  ];
}

export function roundMetaTags(data: RoundMetaData | null, siteUrl: string, pool?: string): Tag[] {
  const name = data?.name ?? "RankedShares round";
  const description = data
    ? `A live RankedShares funding round. Voting closes on ${formatDateTime(data.votingDeadline)}.`
    : "A RankedShares funding round.";
  return [
    { title: `${name} · RankedShares` },
    { property: "og:title", content: name },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { tagName: "link", rel: "canonical", href: `${siteUrl.replace(/\/+$/, "")}/round${pool ? `?pool=${pool}` : ""}` },
  ];
}
