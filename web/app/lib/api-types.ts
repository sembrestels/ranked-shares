/** Shapes served by web/api (plan A). Bigints travel as decimal strings. */
export type Kind = "plain" | "cre" | "zisk" | "noir";
export type PhaseName = "setup" | "open" | "closing" | "tally" | "done";
export type Finality = "proven" | "attested" | "abandoned" | "counted";
export type StepKey = "proposals" | "setup" | "open" | "closing" | "proving" | "proven" | "paid";
export type StepState = "done" | "current" | "next";

export interface SnapshotProject {
  id: number;
  cost: string;
  recipient: `0x${string}`;
  contentRef: `0x${string}`;
  commitment: string;
  funded: boolean;
  claimed: boolean;
  title: string | null;
}
export interface Stage {
  current: StepKey;
  steps: { key: StepKey; state: StepState; label: string }[];
}
export interface RoundSnapshot {
  pool: `0x${string}`;
  kind: Kind;
  chainId: number;
  block: number;
  at: number;
  token: { address: `0x${string}`; symbol: string; decimals: number };
  phase: PhaseName;
  votingDeadline: number;
  totalWeight: string;
  spent: string;
  claimedTotal: string;
  projects: SnapshotProject[];
  fundedOrder: number[];
  proposalCount: number;
  voterCount: number;
  sealed: { total: string; count: number; commitmentsAvailable: boolean };
  /** Where ballots live. "arkiv": the browser computes public results from Arkiv. */
  ballots: "chain" | "arkiv";
  closing: { closed: boolean; cursor: number } | null;
  proving: { accepted: number; total: number | null } | null;
  finality: Finality | null;
  graces: { abandonFrom: number | null; provisionalFrom: number | null };
  stage: Stage;
}
export interface Attachment {
  reference: string;
  name: string;
  type: string;
  size: number;
}
export interface ProposalContent {
  version: number;
  title: string;
  body: string;
  attachments: Attachment[];
}
export interface ProjectResponse {
  project: SnapshotProject;
  round: Pick<RoundSnapshot, "pool" | "kind" | "block" | "at" | "token" | "phase" | "finality" | "stage">;
  contentStatus: "ok" | "none" | "unavailable";
  content: ProposalContent | null;
  reason: string | null;
}
export interface VoterResponse {
  address: `0x${string}`;
  block: number;
  weight: { direct: string; seats: string; total: string };
  ballot: { public: { ranks: number[] } | null; sealed: boolean };
  inRoster: boolean;
}
