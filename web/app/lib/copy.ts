/** Copy fixed by the spec (section 2, decision 11) and the design principles. */
import type { Finality } from "./api-types";

export const ROUND_NAME = (import.meta.env.VITE_ROUND_NAME as string | undefined) || "RankedShares round";
export const REPO_URL = ((import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/sembrestels/ranked-shares").replace(/\/+$/, "");
export const AUDIT_URL = `${REPO_URL}#sealed-pools`;

export const FINALITY_LABEL: Record<Finality, string> = {
  proven: "Proven",
  attested: "Provisional",
  abandoned: "Abandoned",
  counted: "Counted",
};

export const FINALITY_SENTENCE: Record<Finality, string> = {
  proven: "the sealed ballots were proven against their commitments and the public ballots can be replayed from chain data",
  attested: "the operator's report was accepted after the proof grace period without a proof; the funded set stands",
  abandoned: "no result arrived before the abandonment deadline; no project is funded and the organiser can sweep the pool",
  counted: "the tally ran on-chain and can be replayed from chain data",
};

export const NOT_CAST = "Your ballot: not cast. Money without a ballot funds nothing.";
export const NO_PITCH = "No pitch was published for this project";
export const PITCH_FAILED = "The pitch could not be loaded; try again";
export const AUDIT_LABEL = "check this result yourself";
