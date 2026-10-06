/** The worked example behind /onepager: the unchanged shared/pbear.ts on ballots that
 * return what they have left to TheDAO. The proposals a voter left unplaced are
 * withheld, so that voter's money never reaches them. Frames replay the transcript so
 * the page can show who paid what at each step. */
import { cumulativeDeductions, pbearTranscript, type Entry } from "../../../shared/pbear";
import { effectiveRanks, validate, WITHHELD } from "../../../shared/ranks";
import { FUNDING_TIERS } from "./ballot-tiers";

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
  /** Proposal ids by tier, S-Tier first. Proposals in one tier are tied; anything left out gets none of the voter's money. */
  tiers: number[][];
}

/** Dollars of the pool each submitted ballot steers in the example. */
export const SEAT = 5_000;

export const TIER_LABELS = FUNDING_TIERS.map((tier) => `${tier.grade}-Tier`);

export const PROPOSALS: Proposal[] = [
  { title: "Bridge fuzzing harness", short: "Fuzzing", cost: 40_000, camp: "audit" },
  { title: "Vyper static analyzer", short: "Analyzer", cost: 17_000, camp: "audit" },
  { title: "Audit findings database", short: "Findings DB", cost: 17_000, camp: "audit" },
  { title: "Compiler bug bounty", short: "Bounty", cost: 25_000, camp: "audit" },
  { title: "Phishing blocklist API", short: "Blocklist", cost: 20_000, camp: "wallet" },
  { title: "Transaction simulation warnings", short: "Simulation", cost: 10_000, camp: "wallet" },
  { title: "Incident war room", short: "War room", cost: 20_000, camp: "response" },
  { title: "Whitehat legal retainer", short: "Retainer", cost: 10_000, camp: "response" },
  { title: "Formal verification course", short: "Course", cost: 15_000, camp: "research" },
];

export const BLOCS: Bloc[] = [
  { id: "audit-a", name: "Audit firms", seats: 6, tiers: [[0], [1, 2], [3]] },
  { id: "audit-b", name: "Solo auditors", seats: 5, tiers: [[0], [2, 3], [1]] },
  { id: "wallet", name: "Wallet teams", seats: 4, tiers: [[4], [5, 7]] },
  { id: "response", name: "Incident responders", seats: 3, tiers: [[6], [7, 5]] },
  { id: "research", name: "Researchers", seats: 2, tiers: [[8], [7, 2], [5]] },
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

/** Competition ranks for tied tiers: a tier's rank is one more than the proposals placed above it. */
export function ranksFromTiers(tiers: readonly (readonly number[])[], m = PROPOSALS.length): number[] {
  const ranks = new Array<number>(m).fill(0);
  let next = 1;
  for (const tier of tiers) {
    for (const id of tier) ranks[id] = next;
    next += tier.length;
  }
  return ranks;
}

/** The tally level at which each tier opens: one step for each proposal in the tiers
 * above it. What the ballot left unplaced never opens. */
export function openingLevels(tiers: readonly (readonly number[])[]): number[] {
  let next = 1;
  return tiers.map((tier) => {
    const level = next;
    next += tier.length;
    return level;
  });
}

export const blocVoters = (): Voter[] =>
  BLOCS.map((b) => ({ id: b.id, name: b.name, weight: b.seats * SEAT, ballot: ranksFromTiers(b.tiers) }));

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
  for (const voter of voters) {
    if (voter.ballot !== null && !validate(voter.ballot, m)) throw new Error("invalid ballot");
  }
  const bigCosts = costs.map(BigInt);
  // What a voter left unplaced is withheld: their leftover goes back to TheDAO instead
  // of paying for it. Only a null ballot abstains.
  const entries: Entry[] = voters.map((v) => ({
    weight: BigInt(v.weight),
    ballot: v.ballot?.map((rank) => (rank === 0 ? WITHHELD : rank)) ?? null,
  }));
  const budget = voters.reduce((sum, v) => sum + v.weight, 0);
  const { funded, transcript } = pbearTranscript(bigCosts, entries, [], BigInt(budget));

  const ranks = entries.map((v) => (v.ballot ? effectiveRanks(v.ballot, m) : null));
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
      const id = Number(best);
      const supporters = voters.map((_, i) => i).filter((i) => ranks[i] !== null && weights[i] !== 0n && ranks[i]![id] <= level);
      const deductions = cumulativeDeductions(supporters.map((i) => weights[i]), bigCosts[id]);
      supporters.forEach((i, j) => {
        weights[i] -= deductions[j];
        paid[i] = Number(deductions[j]);
        contributions[i][id] += paid[i];
      });
      fundedSoFar.push(id);
      spent += costs[id];
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
  // Once the last proposal is funded the tally only widens with nothing left to open.
  while (frames.length && frames.at(-1)!.funded === null) frames.pop();
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
