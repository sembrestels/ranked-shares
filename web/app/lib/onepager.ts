/** The worked example behind /onepager: a Round Two in miniature, tallied by the
 * same shared/pbear.ts the pool uses. The frames only replay that transcript so
 * the page can show who paid what at each step. */
import { cumulativeDeductions, pbearTranscript, type Entry } from "../../../shared/pbear";
import { effectiveRanks } from "../../../shared/ranks";

export type Camp = "audit" | "wallet" | "response" | "research";

export interface Proposal {
  title: string;
  short: string;
  cost: number;
  camp: Camp;
}

export interface Bloc {
  id: string;
  name: string;
  seats: number;
  /** Proposal ids, most wanted first. Anything left out ranks below all of them. */
  ranking: number[];
}

/** Dollars each sponsored badge seat carries in the example. */
export const SEAT = 5_000;

export const PROPOSALS: Proposal[] = [
  { title: "Bridge fuzzing harness", short: "Fuzzing", cost: 40_000, camp: "audit" },
  { title: "Vyper static analyzer", short: "Analyzer", cost: 20_000, camp: "audit" },
  { title: "Audit findings database", short: "Findings DB", cost: 15_000, camp: "audit" },
  { title: "Compiler bug bounty", short: "Bounty", cost: 25_000, camp: "audit" },
  { title: "Phishing blocklist API", short: "Blocklist", cost: 20_000, camp: "wallet" },
  { title: "Transaction simulation warnings", short: "Simulation", cost: 10_000, camp: "wallet" },
  { title: "Incident war room", short: "War room", cost: 20_000, camp: "response" },
  { title: "Whitehat legal retainer", short: "Retainer", cost: 10_000, camp: "response" },
  { title: "Formal verification course", short: "Course", cost: 15_000, camp: "research" },
];

export const BLOCS: Bloc[] = [
  { id: "audit-a", name: "Audit firms", seats: 6, ranking: [0, 1, 2, 3] },
  { id: "audit-b", name: "Solo auditors", seats: 5, ranking: [0, 2, 3, 1] },
  { id: "wallet", name: "Wallet teams", seats: 4, ranking: [4, 5, 7] },
  { id: "response", name: "Incident responders", seats: 3, ranking: [6, 7, 5] },
  { id: "research", name: "Researchers", seats: 2, ranking: [8, 7, 2] },
];

export const CAMP_OF_BLOC: Record<string, Camp> = {
  "audit-a": "audit",
  "audit-b": "audit",
  wallet: "wallet",
  response: "response",
  research: "research",
};

export interface Voter {
  id: string;
  name: string;
  weight: number;
  /** One competition rank per proposal, 0 for unranked; null abstains. */
  ballot: number[] | null;
}

export function ranksFromOrder(order: readonly number[], m = PROPOSALS.length): number[] {
  const ranks = new Array<number>(m).fill(0);
  order.forEach((id, position) => (ranks[id] = position + 1));
  return ranks;
}

export const blocVoters = (): Voter[] =>
  BLOCS.map((b) => ({ id: b.id, name: b.name, weight: b.seats * SEAT, ballot: ranksFromOrder(b.ranking) }));

export interface Frame {
  level: number;
  /** Unspent weight behind each proposal at this level, before anything is paid. */
  support: number[];
  /** Proposal funded in this frame; null when nothing was affordable and the level widens. */
  funded: number | null;
  /** Each voter's unspent weight going into this frame. */
  before: number[];
  /** What each voter paid in this frame, by voter index. */
  paid: number[];
  /** Each voter's unspent weight after this frame. */
  left: number[];
  fundedSoFar: number[];
  spent: number;
}

export interface Tally {
  budget: number;
  funded: number[];
  frames: Frame[];
  /** contributions[voter][proposal], in dollars. */
  contributions: number[][];
}

const NONE = (1n << 64n) - 1n;

export function tally(costs: readonly number[], voters: readonly Voter[]): Tally {
  const m = costs.length;
  const bigCosts = costs.map(BigInt);
  const entries: Entry[] = voters.map((v) => ({ weight: BigInt(v.weight), ballot: v.ballot }));
  const budget = voters.reduce((sum, v) => sum + v.weight, 0);
  const { funded, transcript } = pbearTranscript(bigCosts, entries, [], BigInt(budget));

  const ranks = voters.map((v) => (v.ballot ? effectiveRanks(v.ballot, m) : null));
  const weights = entries.map((e) => e.weight);
  const contributions = voters.map(() => new Array<number>(m).fill(0));
  const fundedSoFar: number[] = [];
  let spent = 0;
  const frames = transcript.map((step): Frame => {
    const level = Number(step[0]);
    const support = step.slice(1, m + 1).map(Number);
    const best = step[m + 1];
    const paid = new Array<number>(voters.length).fill(0);
    const before = weights.map(Number);
    if (best !== NONE) {
      const c = Number(best);
      const supporters = voters.map((_, i) => i).filter((i) => ranks[i] !== null && weights[i] !== 0n && ranks[i]![c] <= level);
      const deductions = cumulativeDeductions(supporters.map((i) => weights[i]), bigCosts[c]);
      supporters.forEach((i, j) => {
        weights[i] -= deductions[j];
        paid[i] = Number(deductions[j]);
        contributions[i][c] += paid[i];
      });
      fundedSoFar.push(c);
      spent += costs[c];
    }
    return {
      level,
      support,
      funded: best === NONE ? null : Number(best),
      before,
      paid,
      left: weights.map(Number),
      fundedSoFar: [...fundedSoFar],
      spent,
    };
  });
  return { budget, funded, frames, contributions };
}

/** The baseline the page argues against: order proposals by head-to-head weighted
 * majorities, then fund from the top, skipping whatever no longer fits. */
export function majorityOutcome(costs: readonly number[], voters: readonly Voter[]): number[] {
  const m = costs.length;
  const ranks = voters.map((v) => (v.ballot ? effectiveRanks(v.ballot, m) : null));
  const prefer = (a: number, b: number) =>
    voters.reduce((sum, v, i) => (ranks[i] && ranks[i]![a] < ranks[i]![b] ? sum + v.weight : sum), 0);
  const wins = costs.map((_, a) => costs.filter((_, b) => a !== b && prefer(a, b) > prefer(b, a)).length);
  const order = costs.map((_, id) => id).sort((a, b) => wins[b] - wins[a] || prefer(b, a) - prefer(a, b) || a - b);
  const budget = voters.reduce((sum, v) => sum + v.weight, 0);
  const funded: number[] = [];
  let spent = 0;
  for (const id of order) {
    if (spent + costs[id] > budget) continue;
    funded.push(id);
    spent += costs[id];
  }
  return funded;
}

/** Dollars of the pool that ended up on each camp's proposals. */
export function spendByCamp(funded: readonly number[]): Record<Camp, number> {
  const out: Record<Camp, number> = { audit: 0, wallet: 0, response: 0, research: 0 };
  for (const id of funded) out[PROPOSALS[id].camp] += PROPOSALS[id].cost;
  return out;
}
