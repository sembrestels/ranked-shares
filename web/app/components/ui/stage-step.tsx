import type { ReactNode } from "react";
import type { StepState } from "../../lib/api-types";

export function StageStep(
  { label, state, showDetail = false, children }: {
    label: string;
    state: StepState;
    /** When two steps are current at once, only one shows the detail. */
    showDetail?: boolean;
    children?: ReactNode;
  },
) {
  const tone = state === "current"
    ? "border-signal text-primary"
    : state === "done"
    ? "border-edge-strong text-secondary"
    : "border-edge text-secondary";
  return (
    <li aria-current={state === "current" ? "step" : undefined} className={`border-t-[3px] pt-2 ${tone}`}>
      <span className={`text-sm ${state === "current" ? "font-semibold" : ""}`}>{label}</span>
      {state === "current" && showDetail && children && <div className="mt-1 text-sm">{children}</div>}
    </li>
  );
}
