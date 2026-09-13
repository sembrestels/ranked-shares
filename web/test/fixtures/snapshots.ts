import type { Finality, PhaseName, RoundSnapshot, StepKey, StepState } from "../../app/lib/api-types";

const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const DEADLINE = 1_700_003_600;
export const NOW = 1_700_000_000;
const ORDER: StepKey[] = ["proposals", "setup", "open", "closing", "proving", "proven", "paid"];

function stage(current: StepKey, opts: { alsoCurrent?: StepKey[]; plain?: boolean; finality?: Finality | null; paidNext?: boolean } = {}) {
  const index = ORDER.indexOf(current);
  const provenLabel = { proven: "Proven", attested: "Provisional", abandoned: "Abandoned", counted: "Counted" } as const;
  const labels: Record<StepKey, string> = {
    proposals: "Proposals", setup: "Setup", open: "Open", closing: "Closing",
    proving: opts.plain ? "Counting" : "Proving",
    proven: opts.finality ? provenLabel[opts.finality] : opts.plain ? "Counted" : "Proven",
    paid: "Paid",
  };
  return {
    current,
    steps: ORDER.map((key, i) => ({
      key,
      label: labels[key],
      state: (i === index || opts.alsoCurrent?.includes(key) ? "current" : i < index ? "done" : "next") as StepState,
    })),
  };
}

const base: RoundSnapshot = {
  pool: POOL, kind: "zisk", chainId: 31337, block: 123, at: NOW - 12,
  token: { address: TOKEN, symbol: "USDC", decimals: 6 },
  phase: "open", votingDeadline: DEADLINE,
  totalWeight: "1300000000", spent: "0", claimedTotal: "0",
  projects: [
    { id: 0, cost: "4000000000", recipient: B, contentRef: ("0x" + "ab".repeat(32)) as `0x${string}`, commitment: "300000000", funded: false, claimed: false, title: "Formal audit of the tally" },
    { id: 1, cost: "2500000000", recipient: A, contentRef: ("0x" + "00".repeat(32)) as `0x${string}`, commitment: "1000000000", funded: false, claimed: false, title: null },
  ],
  fundedOrder: [], proposalCount: 3, voterCount: 2,
  sealed: { total: "500000000", count: 1, commitmentsAvailable: true },
  ballots: "chain",
  closing: { closed: false, cursor: 0 }, proving: null, finality: null,
  graces: { abandonFrom: null, provisionalFrom: null },
  stage: stage("open"),
};
export const arkivSnapshot: RoundSnapshot = {
  ...base,
  ballots: "arkiv",
  sealed: { total: "500000000", count: 1, commitmentsAvailable: false },
  projects: base.projects.map((p) => ({ ...p, commitment: "0" })),
};

const withPhase = (phase: PhaseName, extra: Partial<RoundSnapshot>): RoundSnapshot => ({ ...base, phase, ...extra });

export const openSnapshot = base;
export const setupSnapshot = withPhase("setup", { stage: stage("setup", { alsoCurrent: ["proposals"] }) });
export const closingSnapshot = withPhase("closing", { closing: { closed: false, cursor: 1 }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: null }, stage: stage("closing") });
export const provingZiskSnapshot = withPhase("tally", { closing: { closed: true, cursor: 2 }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: null }, stage: stage("proving") });
export const provingNoirSnapshot = withPhase("tally", { kind: "noir", closing: { closed: true, cursor: 2 }, proving: { accepted: 1, total: 4 }, sealed: { total: "500000000", count: 1, commitmentsAvailable: false }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: DEADLINE + 90_000 }, stage: stage("proving") });
export const plainTallySnapshot = withPhase("tally", { kind: "plain", closing: null, proving: { accepted: 2, total: null }, sealed: { total: "0", count: 0, commitmentsAvailable: true }, stage: stage("proving", { plain: true }) });
export const provenSnapshot = withPhase("done", { finality: "proven", spent: "4000000000", fundedOrder: [0], projects: [{ ...base.projects[0], funded: true }, base.projects[1]], closing: { closed: true, cursor: 2 }, stage: stage("proven", { finality: "proven" }) });
export const paidSnapshot = { ...provenSnapshot, claimedTotal: "4000000000", projects: [{ ...provenSnapshot.projects[0], claimed: true }, provenSnapshot.projects[1]], stage: stage("paid", { finality: "proven" }) };
export const attestedSnapshot = { ...provenSnapshot, finality: "attested" as const, stage: stage("proven", { finality: "attested" }) };
export const abandonedSnapshot = withPhase("done", { finality: "abandoned", closing: { closed: true, cursor: 2 }, stage: stage("proven", { finality: "abandoned" }) });
