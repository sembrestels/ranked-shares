import { Link } from "react-router";
import type { RoundSnapshot, VoterResponse } from "../../lib/api-types";
import { NOT_CAST } from "../../lib/copy";
import { formatDateTime, isoDate } from "../../lib/format";
import { Skeleton } from "../ui";

export function YourBallot({ snapshot: s, voter, loading }: { snapshot: RoundSnapshot; voter: VoterResponse | undefined; loading: boolean }) {
  if (loading && !voter) return <Skeleton lines={1} />;
  if (!voter) return null;
  const weight = BigInt(voter.weight.total);
  if (weight === 0n && !voter.ballot.public && !voter.ballot.sealed) return null;
  const deadline = <time dateTime={isoDate(s.votingDeadline)}>{formatDateTime(s.votingDeadline)}</time>;
  return (
    <section aria-label="Your ballot" className="border-l-[length:var(--rule-width-accent)] border-signal bg-surface p-4 text-sm">
      {voter.ballot.sealed
        ? <p>Your ballot: sealed, {voter.inRoster ? "in the roster" : "not in the roster yet"}, replaceable until {deadline}. <Link to="/vote" className="underline underline-offset-4">See your ballot</Link></p>
        : voter.ballot.public
        ? <p>Your ballot: public and final. <Link to="/vote" className="underline underline-offset-4">See your ballot</Link></p>
        : <p>{NOT_CAST} <Link to="/vote" className="underline underline-offset-4">Rank the projects</Link></p>}
    </section>
  );
}
