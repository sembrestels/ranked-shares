import {
  bigintToProtoBigInt,
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  protoBigIntToBigint,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToBytes,
  isAddress,
  zeroAddress,
} from "viem";
import { lpAbi, lpPoolAbi, stateViewAbi } from "./lib/lp-abi";
import { arkivPayloads, type Config } from "./workflow";
import {
  ballotAbi,
  checkedPayload,
  type RefPage,
  rosterPage,
} from "./lib/arkiv";
import { encodeArkivCloseReport, encodeCloseReport } from "./lib/report";
import {
  creResultReport,
  type CreVoter,
  encodeLPFinalizeReport,
  encodePriceReport,
} from "./lib/lp";

export type LPConfig = Config & {
  lpModules: Address[];
  priceIntervalSeconds: number;
};
export type Read = <T>(
  to: Address,
  abi: unknown,
  fn: string,
  args?: unknown[],
) => T;
type Campaign = {
  poolId: Hex;
  price: bigint;
  updatedAt: bigint;
  sourceBlock: bigint;
  finalized: boolean;
};
export type Action = { target: Address; report: Hex; description: string };

/** Planning is deterministic over one finalized block. Sending happens afterwards. */
export function lpActions(
  read: Read,
  module: Address,
  timestamp: bigint,
  sourceBlock: bigint,
  config: Pick<LPConfig, "closeChunk" | "priceIntervalSeconds">,
): { pool: Address; phase: number; actions: Action[]; ready: boolean } {
  const pool = read<Address>(module, lpAbi, "pool");
  const phase = Number(read<number>(pool, lpPoolAbi, "phase"));
  const n = Number(read<bigint>(module, lpAbi, "sponsorshipCount"));
  if (!Number.isSafeInteger(n) || n < 0 || n > 8) {
    throw new Error("Invalid LP sponsorship count.");
  }
  const actions: Action[] = [];
  let ready = true;
  for (let i = 0; i < n; i++) {
    const id = BigInt(i);
    const s = read<Campaign>(module, lpAbi, "sponsorship", [id]);
    if (!s.finalized) ready = false;
    if (
      phase === 1 &&
      timestamp >= s.updatedAt + BigInt(config.priceIntervalSeconds) &&
      sourceBlock > s.sourceBlock
    ) {
      const view = read<Address>(module, lpAbi, "stateView");
      const [price] = read<[bigint, number, number, number]>(
        view,
        stateViewAbi,
        "getSlot0",
        [s.poolId],
      );
      actions.push({
        target: module,
        report: encodePriceReport(id, price, sourceBlock, timestamp),
        description: `reference price ${i}`,
      });
    } else if (phase === 2 && !s.finalized) {
      actions.push({
        target: module,
        report: encodeLPFinalizeReport(id, config.closeChunk),
        description: `LP finalization ${i}`,
      });
    }
  }
  return { pool, phase, actions, ready };
}

export function creAction(
  read: Read,
  pool: Address,
  phase: number,
  chainId: bigint,
  chunk: number,
  master: () => Uint8Array,
  load: (keys: Hex[]) => Map<string, Hex>,
): Action | null {
  if (phase !== 2 && phase !== 3) return null;
  const budget = read<bigint>(pool, lpPoolAbi, "totalWeight");
  const token = read<Address>(pool, lpPoolAbi, "token");
  if (read<bigint>(token, erc20Abi, "balanceOf", [pool]) < budget) {
    throw new Error("Round balance is below its budget.");
  }
  const arkiv = read<boolean>(pool, ballotAbi, "arkivBallots");
  const count = Number(read<bigint>(pool, ballotAbi, "voterCount"));
  if (!Number.isSafeInteger(count) || count < 0 || count > 4096) {
    throw new Error("Demo voter limit exceeded.");
  }
  function page(start: number, length: number): CreVoter[] {
    if (!arkiv) {
      const [who, direct, seats, pub, sealed] = read<
        [Address[], bigint[], bigint[], Hex[], Hex[]]
      >(pool, lpPoolAbi, "votersFrom", [BigInt(start), BigInt(length)]);
      if ([who, direct, seats, pub, sealed].some((v) => v.length !== length)) {
        throw new Error("Incomplete CRE roster.");
      }
      return who.map((address, i) => ({
        address,
        directWeight: direct[i],
        seatWeight: seats[i],
        publicBallot: pub[i],
        sealedBallot: sealed[i],
      }));
    }
    const rows = rosterPage(
      read<RefPage>(pool, ballotAbi, "voterRefsFrom", [
        BigInt(start),
        BigInt(length),
      ]),
      length,
    );
    const keys = [
      ...new Set(
        rows.flatMap((v) => [v.publicRef, v.sealedRef]).filter((r) =>
          r.revision !== 0n
        ).map((r) => r.entityKey),
      ),
    ];
    const payloads = load(keys);
    return rows.map((v) => ({
      ...v,
      publicBallot: checkedPayload(
        v.publicRef,
        payloads.get(v.publicRef.entityKey.toLowerCase()),
      ),
      sealedBallot: checkedPayload(
        v.sealedRef,
        payloads.get(v.sealedRef.entityKey.toLowerCase()),
      ),
    }));
  }
  if (phase === 2) {
    const cursor = Number(read<bigint>(pool, ballotAbi, "closeCursor"));
    if (cursor > count) throw new Error("Invalid close cursor.");
    const report = arkiv
      ? encodeArkivCloseReport(
        cursor,
        page(cursor, Math.min(chunk, count - cursor)),
      )
      : encodeCloseReport(chunk);
    return { target: pool, report, description: "close ballots" };
  }
  const voters: CreVoter[] = [];
  for (let start = 0; start < count; start += 50) {
    voters.push(...page(start, Math.min(50, count - start)));
  }
  return {
    target: pool,
    description: "attested tally",
    report: creResultReport(
      chainId,
      pool,
      voters,
      read<bigint[]>(pool, lpPoolAbi, "costs"),
      budget,
      read<Hex>(pool, lpPoolAbi, "inputsHash"),
      read<Hex>(pool, lpPoolAbi, "keySalt"),
      read<Hex>(pool, lpPoolAbi, "tallierPk"),
      master(),
    ),
  };
}

export function validateLPConfig(config: LPConfig) {
  if (
    !Number.isInteger(config.closeChunk) || config.closeChunk < 1 ||
    config.closeChunk > 50
  ) throw new Error("closeChunk must be 1–50.");
  if (
    !Number.isInteger(config.priceIntervalSeconds) ||
    config.priceIntervalSeconds < 60
  ) throw new Error("Price interval must be at least 60 seconds.");
  if (
    !config.lpModules.length || config.lpModules.length > 8 ||
    config.lpModules.some((a) => !isAddress(a) || a === zeroAddress)
  ) throw new Error("Configure 1–8 deployed LP module addresses.");
}

export const onLPCron = (runtime: TeeRuntime<LPConfig>) => {
  const config = runtime.config;
  validateLPConfig(config);
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error("Unknown demo network.");
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const don = runtime.usingTheDons();
  const header =
    evm.headerByNumber(don, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
      .result().header;
  if (!header?.blockNumber) throw new Error("Missing finalized block header.");
  const sourceBlock = protoBigIntToBigint(header.blockNumber);
  const read: Read = <T>(
    to: Address,
    abi: unknown,
    functionName: string,
    args: unknown[] = [],
  ): T => {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const reply = evm.callContract(don, {
      call: encodeCallMsg({ from: zeroAddress, to, data }),
      blockNumber: bigintToProtoBigInt(sourceBlock),
    }).result();
    return decodeFunctionResult(
      { abi, functionName, data: bytesToHex(reply.data) } as never,
    ) as T;
  };
  const summary: string[] = [];
  for (const module of config.lpModules) {
    try {
      const plan = lpActions(
        read,
        module,
        header.timestamp,
        sourceBlock,
        config,
      );
      if ((plan.phase === 2 && plan.ready) || plan.phase === 3) {
        const action = creAction(
          read,
          plan.pool,
          plan.phase,
          BigInt(network.chainId),
          config.closeChunk,
          () => {
            const secret =
              runtime.getSecret({ id: "RANKED_SHARES_MASTER" }).result().value;
            return hexToBytes(
              (secret.startsWith("0x") ? secret : `0x${secret}`) as Hex,
            );
          },
          (keys) => arkivPayloads(don as Runtime<Config>, keys),
        );
        if (action) plan.actions.push(action);
      }
      for (const action of plan.actions) {
        const report = runtime.reportFromDon(
          prepareReportRequest(action.report),
        ).result();
        const reply = evm.writeReport(don, {
          receiver: action.target,
          report,
          gasConfig: { gasLimit: config.gasLimit },
        }).result();
        summary.push(
          `${module}: ${action.description}, tx status ${reply.txStatus}`,
        );
      }
      if (!plan.actions.length) {
        summary.push(`${module}: no action (phase ${plan.phase})`);
      }
    } catch (error) {
      summary.push(
        `${module}: ${
          error instanceof Error ? error.message : "demo workflow failed"
        }`,
      );
    }
  }
  const result = summary.join("; ");
  runtime.log(result);
  return result;
};

export const initLPWorkflow = (config: LPConfig) => {
  validateLPConfig(config);
  return [
    cre.handlerInTee(
      new cre.capabilities.CronCapability().trigger({
        schedule: config.schedule,
      }),
      onLPCron,
      [{ tee: "nitro" }],
    ),
  ];
};
