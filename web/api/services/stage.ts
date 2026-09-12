/** The seven-step stage bar from chain facts. Spec decision 3. */
import type { Kind } from "../chain/kind.ts";

export type PhaseName = "setup" | "open" | "closing" | "tally" | "done";
export type Finality = "proven" | "attested" | "abandoned" | "counted";
export type StepKey = "proposals" | "setup" | "open" | "closing" | "proving" | "proven" | "paid";
export type StepState = "done" | "current" | "next";

export interface StageFacts {
  kind: Kind;
  phase: PhaseName;
  votingDeadline: number;
  finality: Finality | null;
  spent: string;
  claimedTotal: string;
}

export interface Stage {
  current: StepKey;
  steps: { key: StepKey; state: StepState; label: string }[];
}

const ORDER: StepKey[] = ["proposals", "setup", "open", "closing", "proving", "proven", "paid"];

function provenLabel(f: StageFacts): string {
  switch (f.finality) {
    case "proven":
      return "Proven";
    case "attested":
      return "Provisional";
    case "abandoned":
      return "Abandoned";
    case "counted":
      return "Counted";
    default:
      return f.kind === "plain" ? "Counted" : "Proven";
  }
}

export function stageOf(f: StageFacts, now: number): Stage {
  const labels: Record<StepKey, string> = {
    proposals: "Proposals",
    setup: "Setup",
    open: "Open",
    closing: "Closing",
    proving: f.kind === "plain" ? "Counting" : "Proving",
    proven: provenLabel(f),
    paid: "Paid",
  };
  let index: number;
  const alsoCurrent = new Set<StepKey>();
  switch (f.phase) {
    case "setup":
      index = 1;
      alsoCurrent.add("proposals");
      break;
    case "open":
      index = now >= f.votingDeadline ? 3 : 2;
      break;
    case "closing":
      index = 3;
      break;
    case "tally":
      index = 4;
      break;
    case "done":
      index = f.finality === "abandoned" || BigInt(f.claimedTotal) < BigInt(f.spent) ? 5 : 6;
      break;
  }
  const steps = ORDER.map((key, i) => ({
    key,
    label: labels[key],
    state:
      (i === index || alsoCurrent.has(key) ? "current" : i < index ? "done" : "next") as StepState,
  }));
  return { current: ORDER[index], steps };
}
