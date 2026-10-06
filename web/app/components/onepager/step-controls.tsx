import { Button } from "../ui";

const StepIcon = ({ path }: { path: string }) => (
  <svg className="op-step-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d={path} />
  </svg>
);

/** Previous, next and start over for a walkthrough of `last + 1` steps. */
export function StepControls({ at, last, onChange }: { at: number; last: number; onChange: (at: number) => void }) {
  return (
    <div className="op-stepper-controls">
      <Button variant="secondary" disabled={at === 0} onClick={() => onChange(at - 1)}>
        <StepIcon path="M11.5 4.5 6 10l5.5 5.5M6.5 10H15" />Previous
      </Button>
      <Button disabled={at === last} onClick={() => onChange(at + 1)}>
        Next step<StepIcon path="M8.5 4.5 14 10l-5.5 5.5M13.5 10H5" />
      </Button>
      <Button variant="secondary" disabled={at === 0} onClick={() => onChange(0)}>
        <StepIcon path="M4.5 10a5.5 5.5 0 1 0 1.7-4M4.5 3.5v3h3" />Start over
      </Button>
    </div>
  );
}
