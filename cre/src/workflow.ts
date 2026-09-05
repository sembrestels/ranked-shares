import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, hexToBytes, zeroAddress } from "viem";
import abi from "./abi/SealedRankedShares.json";
import * as cm from "./lib/commitments";
import { publicEntries, sealedEntries, sealedVoters, type Voter } from "./lib/entries";
import { pbearTranscript } from "./lib/pbear";
import { encodeCloseReport, encodeResultReport } from "./lib/report";
import { deriveSk } from "./lib/sealed";

export type Config = {
  schedule: string;
  chainSelectorName: string;
  pools: string[];
  closeChunk: number;
  gasLimit: string;
};

export type PoolReads = {
  phase: number;
  resultReported: boolean;
  m: number;
  costs: bigint[];
  totalWeight: bigint;
  keySalt: Uint8Array;
  inputsRoot: `0x${string}`;
  batch: number;
  voters: Voter[];
  closeChunk: number;
};

export type PoolAction = { kind: 1 | 2; report: `0x${string}` } | null;

const PHASE_CLOSING = 2;
const PHASE_TALLY = 3;
const SECRET_ID = "RANKED_SHARES_MASTER";
const VOTER_PAGE = 50;

/**
 * The tally itself, free of any runtime so it can be unit-tested. Everything that
 * touches plaintext happens here and only (inputsRoot, fundedOrder, transcript) leaves.
 */
export function processPool(r: PoolReads, master: Uint8Array): PoolAction {
  if (r.phase === PHASE_CLOSING) return { kind: 2, report: encodeCloseReport(r.closeChunk) };
  if (r.phase !== PHASE_TALLY || r.resultReported) return null;
  const sk = deriveSk(master, r.keySalt);
  const hPub = cm.publicChain(r.voters);
  const { h } = cm.sealedChain(r.voters, r.batch);
  const root = cm.inputsRoot(hPub, h, sealedVoters(r.voters).length, cm.costsHash(r.costs), r.totalWeight);
  if (bytesToHex(root) !== r.inputsRoot.toLowerCase()) {
    throw new Error("inputsRoot mismatch: chain reads disagree with the commitment");
  }
  const { funded, transcript } = pbearTranscript(
    r.costs,
    publicEntries(r.voters, r.m),
    sealedEntries(r.voters, sk, r.m),
    r.totalWeight,
  );
  return { kind: 1, report: encodeResultReport(r.inputsRoot, funded, transcript) };
}

// ---- chain reads through the DON ----

type EVMClient = InstanceType<typeof cre.capabilities.EVMClient>;

function call<T>(
  runtime: Runtime<Config>,
  evm: EVMClient,
  pool: Address,
  functionName: string,
  args: unknown[] = [],
): T {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: pool, data }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) } as never) as T;
}

export function readPool(runtime: Runtime<Config>, evm: EVMClient, pool: Address, closeChunk: number): PoolReads {
  const phase = Number(call<bigint | number>(runtime, evm, pool, "phase"));
  if (phase !== PHASE_TALLY) return { phase, closeChunk } as PoolReads;
  const resultReported = call<boolean>(runtime, evm, pool, "resultReported");
  const costs = call<readonly bigint[]>(runtime, evm, pool, "costs").slice();
  const totalWeight = call<bigint>(runtime, evm, pool, "totalWeight");
  const keySalt = hexToBytes(call<Hex>(runtime, evm, pool, "keySalt"));
  const inputsRoot = call<Hex>(runtime, evm, pool, "inputsRoot");
  const batch = Number(call<bigint>(runtime, evm, pool, "batch"));
  const n = Number(call<bigint>(runtime, evm, pool, "voterCount"));
  const voters: Voter[] = [];
  for (let start = 0; start < n; start += VOTER_PAGE) {
    const [who, direct, ballots, seats, cts, hasDirectFlags] = call<
      [
        readonly Address[],
        readonly bigint[],
        readonly bigint[],
        readonly bigint[],
        readonly (readonly [bigint, bigint, bigint])[],
        readonly boolean[],
      ]
    >(runtime, evm, pool, "votersFrom", [BigInt(start), BigInt(VOTER_PAGE)]);
    who.forEach((a, i) => {
      const ct = cts[i];
      voters.push({
        addr: BigInt(a),
        directWeight: direct[i],
        seatWeight: seats[i],
        hasDirect: hasDirectFlags[i],
        directPacked: ballots[i],
        ciphertext: ct[0] === 0n && ct[1] === 0n && ct[2] === 0n ? null : [ct[0], ct[1], ct[2]],
      });
    });
  }
  return { phase, resultReported, m: costs.length, costs, totalWeight, keySalt, inputsRoot, batch, voters, closeChunk };
}

// ---- the handler ----

const onCronInTee = (runtime: TeeRuntime<Config>) => {
  const don = runtime.usingTheDons();
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`network not found: ${runtime.config.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const secret = runtime.getSecret({ id: SECRET_ID }).result().value;
  const master = hexToBytes(secret.startsWith("0x") ? (secret as Hex) : `0x${secret}`);
  const summary: string[] = [];
  for (const pool of runtime.config.pools as Address[]) {
    const reads = readPool(don, evm, pool, runtime.config.closeChunk);
    const action = processPool(reads, master);
    if (!action) {
      summary.push(`${pool}: nothing to do (phase ${reads.phase})`);
      continue;
    }
    const report = runtime.reportFromDon(prepareReportRequest(action.report)).result();
    const reply = evm
      .writeReport(don, { receiver: pool, report, gasConfig: { gasLimit: runtime.config.gasLimit } })
      .result();
    summary.push(`${pool}: kind ${action.kind} report written, tx status ${reply.txStatus}`);
  }
  const line = summary.join("; ");
  runtime.log(line);
  return line;
};

export const initWorkflow = (config: Config) => [
  cre.handlerInTee(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCronInTee, [
    { tee: "nitro" },
  ]),
];
