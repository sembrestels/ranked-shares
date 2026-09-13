import { useAccount } from "wagmi";
import { useEffect } from "react";
import { replace } from "react-router";
import { isAddress } from "viem";
import type { Route } from "./+types/round";
import { projectName } from "../components/round/board";
import { FundingWall } from "../components/round/funding-wall";
import { Outcome } from "../components/round/outcome";
import { RoundHeading } from "../components/round/round-heading";
import { SealedPanel } from "../components/round/sealed-panel";
import { YourBallot } from "../components/round/your-ballot";
import { Button, Notice, Skeleton } from "../components/ui";
import { PublicResults } from "../components/voting";
import { useRound } from "../context/providers";
import { useArkivPublic } from "../hooks/use-arkiv-public";
import { useNow } from "../hooks/use-now";
import { useProposalTitles } from "../hooks/use-proposal-titles";
import { useRoundSnapshot, useVoter } from "../hooks/use-snapshot";
import { buildPool, roundFacts } from "../lib/build-chain";
import { useRoundDirectory } from "../context/rounds";
import { roundName } from "../lib/round-directory";
import { roundMetaTags } from "../lib/meta";
import { errorMessage } from "../lib/proposals";

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || "http://localhost:5174";

export async function loader() {
  const cfg = buildPool();
  if (!cfg) return null;
  try {
    return await roundFacts(cfg);
  } catch {
    return null;
  }
}
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const requestedPool = new URL(request.url).searchParams.get("pool");
  if (!isAddress(requestedPool ?? import.meta.env.VITE_POOL_ADDRESS ?? "")) {
    return replace("/");
  }
  return null;
}
clientLoader.hydrate = true as const;
export function HydrateFallback() {
  return <Skeleton lines={4} />;
}
export function meta({ data, location }: Route.MetaArgs) {
  const pool = new URLSearchParams(location.search).get("pool") ?? import.meta.env.VITE_POOL_ADDRESS;
  const valid = pool && isAddress(pool) ? pool : undefined;
  // Build-time facts belong only to the configured round.
  const facts = valid?.toLowerCase() === import.meta.env.VITE_POOL_ADDRESS?.toLowerCase() ? data : null;
  return roundMetaTags(facts ?? null, SITE_URL, valid);
}

export default function RoundPage() {
  const { pool } = useRound();
  const { rounds } = useRoundDirectory();
  const name = pool ? roundName(rounds.find((entry) => entry.pool.toLowerCase() === pool.toLowerCase()) ?? { pool }) : "Funding round";
  useEffect(() => { document.title = `${name} · RankedShares`; }, [name]);
  const { address } = useAccount();
  const round = useRoundSnapshot();
  const titles = useProposalTitles(round.data);
  const voter = useVoter();
  const live = useArkivPublic(round.data);
  const now = useNow(10_000);
  if (!pool) return <Notice>Open a round link to view its board.</Notice>;
  if (!round.data) {
    return round.isError ? <Notice error>Could not load the round: {errorMessage(round.error)}</Notice> : <Skeleton lines={6} />;
  }
  const s = titles.snapshot!;
  return (
    <>
      {round.isError && <Notice error>Showing the last snapshot; the refresh failed: {errorMessage(round.error)}</Notice>}
      <RoundHeading snapshot={s} now={now} name={name} />
      {address && <YourBallot snapshot={s} voter={voter.data} loading={voter.isPending} />}
      {titles.loading && <p className="mt-4 text-sm text-secondary" role="status">Loading proposal titles from Swarm…</p>}
      {titles.failed && <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-secondary" role="status">Some proposal titles could not be loaded from Swarm.</p>
        <Button variant="secondary" onClick={() => void titles.retry()}>Retry titles</Button>
      </div>}
      <FundingWall snapshot={s} live={live.data} liveError={live.isError} />
      <div className={`mt-6 grid gap-6 ${s.finality || s.ballots === "arkiv" ? "lg:grid-cols-[2fr_1fr]" : ""}`}>
        {(s.finality || s.ballots === "arkiv") && <div className="flex flex-col gap-6">
          <Outcome snapshot={s} />
          {s.ballots === "arkiv" && live.data && !s.finality && (
            <PublicResults
              titles={s.projects.map(projectName)}
              funded={live.data.funded}
              final={false}
              ballots={live.data.ballots}
              block={BigInt(live.data.block)}
              sealedPool={s.kind !== "plain"}
            />
          )}
          {s.ballots === "arkiv" && live.isError && <Notice error>Could not compute public results from Arkiv: {errorMessage(live.error)}</Notice>}
        </div>}
        <SealedPanel snapshot={s} />
      </div>
    </>
  );
}
