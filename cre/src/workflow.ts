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
import { type Address, decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex, hexToBytes, isAddress, zeroAddress } from "viem";
import abi from "./abi/NoirRankedShares.json";
import * as cm from "./lib/commitments";
import { isSealed, publicEntries, sealedEntries, sealedVoters, type Voter } from "./lib/entries";
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

/**
 * Splits `config.pools` into real, non-zero addresses and everything else — chiefly the
 * `0x0…0` placeholder `config.staging.json` ships with, which must never reach
 * `readPool`/`processPool`. Pure so the zero-address case can be unit-tested without a
 * runtime.
 */
export function validPools(config: Pick<Config, "pools">): { valid: Address[]; skipped: string[] } {
  const valid: Address[] = [];
  const skipped: string[] = [];
  for (const pool of config.pools) {
    if (isAddress(pool) && pool.toLowerCase() !== zeroAddress) valid.push(pool);
    else skipped.push(pool);
  }
  return { valid, skipped };
}

const PHASE_CLOSING = 2 as const;
const PHASE_TALLY = 3 as const;
const SECRET_ID = "RANKED_SHARES_MASTER";
const VOTER_PAGE = 50;

/** Setup, Open or Done: nothing for the workflow to do. */
type IdleReads = { phase: 0 | 1 | 4; closeChunk: number };

/**
 * `_close` (NoirRankedShares.sol:378) only checks `token.balanceOf(pool) >=
 * totalWeight` once, at `closeCursor == 0`; a pool whose balance has since dropped below
 * `totalWeight` would otherwise get a `close` report every tick that reverts forever.
 */
type ClosingReads = { phase: typeof PHASE_CLOSING; closeChunk: number; closeCursor: number; totalWeight: bigint; balance: bigint };

type TallyReads = {
  phase: typeof PHASE_TALLY;
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

export type PoolReads = IdleReads | ClosingReads | TallyReads;

export type PoolAction = { kind: 1 | 2; report: `0x${string}` } | null;

/**
 * The tally itself, free of any runtime so it can be unit-tested. Everything that
 * touches plaintext happens here and only (inputsRoot, fundedOrder, transcript) leaves.
 */
export function processPool(r: PoolReads, master: Uint8Array): PoolAction {
  if (r.phase === PHASE_CLOSING) {
    // Mirrors `_close`'s own check: once past the first chunk the balance requirement has
    // already been enforced on chain, so only `closeCursor === 0` needs it here.
    if (r.closeCursor === 0 && r.balance < r.totalWeight) return null;
    return { kind: 2, report: encodeCloseReport(r.closeChunk) };
  }
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

function callWith<T>(
  runtime: Runtime<Config>,
  evm: EVMClient,
  to: Address,
  abiDef: unknown,
  functionName: string,
  args: unknown[] = [],
): T {
  const data = encodeFunctionData({ abi: abiDef, functionName, args } as never);
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to, data }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi: abiDef, functionName, data: bytesToHex(reply.data) } as never) as T;
}

function call<T>(runtime: Runtime<Config>, evm: EVMClient, pool: Address, functionName: string, args: unknown[] = []): T {
  return callWith<T>(runtime, evm, pool, abi, functionName, args);
}

export function readPool(runtime: Runtime<Config>, evm: EVMClient, pool: Address, closeChunk: number): PoolReads {
  const phase = Number(call<bigint | number>(runtime, evm, pool, "phase"));
  if (phase === PHASE_CLOSING) {
    const closeCursor = Number(call<bigint>(runtime, evm, pool, "closeCursor"));
    const totalWeight = call<bigint>(runtime, evm, pool, "totalWeight");
    const token = call<Address>(runtime, evm, pool, "token");
    const balance = callWith<bigint>(runtime, evm, token, erc20Abi, "balanceOf", [pool]);
    return { phase: PHASE_CLOSING, closeChunk, closeCursor, totalWeight, balance };
  }
  if (phase !== PHASE_TALLY) return { phase: phase as 0 | 1 | 4, closeChunk };
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
        ciphertext: isSealed(ct) ? [ct[0], ct[1], ct[2]] : null,
      });
    });
  }
  return { phase: PHASE_TALLY, resultReported, m: costs.length, costs, totalWeight, keySalt, inputsRoot, batch, voters, closeChunk };
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
  const { valid: pools, skipped } = validPools(runtime.config);
  for (const pool of skipped) summary.push(`${pool}: skipped, not a pool address (edit config.staging.json)`);
  for (const pool of pools) {
    // One unreadable or unreportable pool must not strand the others in the same run.
    // Only the error's message is summarised, and no message here carries plaintext.
    try {
      const reads = readPool(don, evm, pool, runtime.config.closeChunk);
      const action = processPool(reads, master);
      if (!action) {
        // The only way Closing yields no action is `_close`'s balance check failing.
        summary.push(reads.phase === PHASE_CLOSING ? `${pool}: closing blocked, balance below totalWeight` : `${pool}: nothing to do (phase ${reads.phase})`);
        continue;
      }
      const report = runtime.reportFromDon(prepareReportRequest(action.report)).result();
      const reply = evm
        .writeReport(don, { receiver: pool, report, gasConfig: { gasLimit: runtime.config.gasLimit } })
        .result();
      summary.push(`${pool}: kind ${action.kind} report written, tx status ${reply.txStatus}`);
    } catch (e) {
      summary.push(`${pool}: error: ${e instanceof Error ? e.message : String(e)}`);
    }
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
