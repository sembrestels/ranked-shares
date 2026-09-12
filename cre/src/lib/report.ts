import { encodeAbiParameters } from "viem";
import type { BallotData } from "./arkiv";

/** kind 3: close a specific range with hash-checked Arkiv payload witnesses. */
export function encodeArkivCloseReport(cursor: number, ballots: BallotData[]): `0x${string}` {
  const payload = encodeAbiParameters([
    { type: "uint256" },
    { type: "tuple[]", components: [{ name: "publicBallot", type: "bytes" }, { name: "sealedBallot", type: "bytes" }] },
  ], [BigInt(cursor), ballots]);
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [3, payload]);
}

/** kind 1: the provisional result (funded order) with the PB-EAR transcript. */
export function encodeResultReport(inputsRoot: `0x${string}`, funded: number[], transcript: bigint[][]): `0x${string}` {
  const payload = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256[]" }, { type: "uint256[]" }],
    [inputsRoot, funded.map(BigInt), transcript.flat()],
  );
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, payload]);
}

/** kind 2: drive `close(maxVoters)` from the workflow. */
export function encodeCloseReport(maxVoters: number): `0x${string}` {
  const payload = encodeAbiParameters([{ type: "uint256" }], [BigInt(maxVoters)]);
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [2, payload]);
}
