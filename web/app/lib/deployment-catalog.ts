import { parseArtifact, type ContractArtifact } from "./deployment";

export const roundContracts = [
  { id: "RankedShares", name: "Public voting", description: "Public ranked ballots. The round calculates its result on-chain.", note: "Ready for setup after deployment. Your organizer wallet manages proposals and opens voting." },
  { id: "CreRankedShares", name: "Sealed · CRE", description: "Private ballots, with a result attested by a Chainlink CRE workflow.", note: "The tally service prepares the round’s encryption and result delivery." },
  { id: "NoirRankedShares", name: "Sealed · Noir", description: "Private ballots, verified with Noir zero-knowledge proofs.", note: "Supports up to 256 sealed voters and 16 projects." },
  { id: "ZiskRankedShares", name: "Sealed · ZisK", description: "Private ballots, with a ZisK proof of the final result.", note: "The tally service prepares encryption and submits the verified result." },
  { id: "LPCreRankedShares", name: "Liquidity · CRE", description: "Sealed CRE voting with voting weight from Uniswap liquidity.", note: "Liquidity voting is connected automatically during deployment." },
] as const;

const artifacts = import.meta.glob("./artifacts/*.json", { import: "default" });
export async function loadRoundArtifact(id: string): Promise<ContractArtifact> {
  const loader = artifacts[`./artifacts/${id}.json`];
  if (!loader) throw new Error("This contract build is unavailable. Refresh the page and try again.");
  return parseArtifact(await loader());
}
