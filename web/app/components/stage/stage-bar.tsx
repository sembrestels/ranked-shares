import type { ReactNode } from "react";
import type { RoundSnapshot, StepKey } from "../../lib/api-types";
import { formatDateTime, isoDate } from "../../lib/format";
import { Button, Countdown, Notice, StageStep } from "../ui";

export interface StageBarProps {
  snapshot: RoundSnapshot;
  now: number;
  canClose: boolean;
  closing: boolean;
  onCloseBatch?: () => void;
  closeError?: string;
}

const When = ({ at }: { at: number }) => <time dateTime={isoDate(at)}>{formatDateTime(at)}</time>;

function provingText(s: RoundSnapshot): string {
  if (!s.proving) return "Waiting for the first proof";
  if (s.kind === "plain") return `${s.proving.accepted} tally ${s.proving.accepted === 1 ? "step" : "steps"} accepted`;
  if (s.proving.total !== null) return `${s.proving.accepted} of ${s.proving.total} proof batches accepted`;
  return `${s.proving.accepted} proofs accepted`;
}

export function StageBar({ snapshot: s, now, canClose, closing, onCloseBatch, closeError }: StageBarProps) {
  const detail = (key: StepKey): ReactNode => {
    switch (key) {
      case "proposals":
      case "setup":
        return <>Submissions close on <When at={s.votingDeadline} /></>;
      case "open":
        return (
          <>
            Voting closes in <Countdown to={s.votingDeadline} now={now} />, voting closes on <When at={s.votingDeadline} />
          </>
        );
      case "closing":
        if (s.kind === "plain") return "Waiting for the tally to start";
        return (
          <>
            <div>{`${s.closing?.cursor ?? 0} of ${s.voterCount} voters closed`}</div>
            {!s.closing?.closed && canClose && (
              <Button variant="secondary" className="mt-2" disabled={closing} onClick={onCloseBatch}>
                {closing ? "Closing…" : "Close next batch"}
              </Button>
            )}
            {closeError && <Notice error>{closeError}</Notice>}
          </>
        );
      case "proving":
        return (
          <>
            <div>{provingText(s)}</div>
            {s.graces.provisionalFrom !== null && <div>Provisional result possible from <When at={s.graces.provisionalFrom} /></div>}
            {s.graces.abandonFrom !== null && <div>Abandonment possible from <When at={s.graces.abandonFrom} /></div>}
          </>
        );
      case "proven":
        return `${s.fundedOrder.length} of ${s.projects.length} projects funded`;
      case "paid":
        return "All funded projects have been paid";
    }
  };
  return (
    <nav aria-label="Round stage" className="border-b border-edge py-4">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {s.stage.steps.map((step) => (
          <StageStep key={step.key} label={step.label} state={step.state} showDetail={step.key === s.stage.current}>
            {detail(step.key)}
          </StageStep>
        ))}
      </ol>
    </nav>
  );
}
