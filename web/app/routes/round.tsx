import { useAccount } from "wagmi";
import type { Route } from "./+types/round";
import { Board, projectName } from "../components/round/board";
import { Outcome } from "../components/round/outcome";
import { RoundHeading } from "../components/round/round-heading";
import { SealedPanel } from "../components/round/sealed-panel";
import { YourBallot } from "../components/round/your-ballot";
import { Notice, Skeleton } from "../components/ui";
import { PublicResults } from "../components/voting";
import { useRound } from "../context/providers";
import { useArkivPublic } from "../hooks/use-arkiv-public";
import { useNow } from "../hooks/use-now";
import { useRoundSnapshot, useVoter } from "../hooks/use-snapshot";
import { buildPool, roundFacts } from "../lib/build-chain";
import { ROUND_NAME } from "../lib/copy";
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
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = false as const;
export function meta({ data }: Route.MetaArgs) {
  return roundMetaTags(data ?? null, SITE_URL);
}

export default function RoundPage() {
  const { pool } = useRound();
  const { address } = useAccount();
  const round = useRoundSnapshot();
  const voter = useVoter();
  const live = useArkivPublic(round.data);
  const now = useNow(10_000);
  if (!pool) return <Notice>Open a round link to view its board.</Notice>;
  if (!round.data) {
    return round.isError ? <Notice error>Could not load the round: {errorMessage(round.error)}</Notice> : <Skeleton lines={6} />;
  }
  const s = round.data;
  return (
    <>
      {round.isError && <Notice error>Showing the last snapshot; the refresh failed: {errorMessage(round.error)}</Notice>}
      <RoundHeading snapshot={s} now={now} name={ROUND_NAME} />
      {address && <YourBallot snapshot={s} voter={voter.data} loading={voter.isPending} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
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
          <Board snapshot={s} commitments={s.ballots === "arkiv" ? live.data?.commitments : undefined} />
        </div>
        <SealedPanel snapshot={s} />
      </div>
    </>
  );
}
