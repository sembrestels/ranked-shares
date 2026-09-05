// prover/test/e2e.test.ts — replay the test_main fixture on anvil against the real
// Honk verifiers, report as the forwarder, prove the whole chain and audit it.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createWalletClient, http } from "viem";
import { foundry } from "viem/chains";
import { toBig } from "@lib/field";
import { readPoolSnapshot } from "../src/core/chain";
import { rebuild } from "../src/core/state";
import { Prover } from "../src/core/prove";
import { runChain } from "../src/core/submit";
import { audit } from "../src/core/audit";
import { replayFixturePool, startFixtureChain, type FixtureChain } from "./helpers/anvil";

const PORT = 8547;
const poolAbi = JSON.parse(readFileSync(new URL("../../cre/src/abi/NoirRankedShares.json", import.meta.url), "utf8"));

let chain: FixtureChain;
/** `gasUsed` of each `advance` receipt of the unbatched run, for the `advanceMany` comparison. */
const advanceGas: bigint[] = [];

describe("end to end on anvil with real verifiers", () => {
  beforeAll(async () => {
    chain = await startFixtureChain({ port: PORT });
  }, 60_000);

  afterAll(async () => {
    await chain?.stop();
  });

  test(
    "replay test_main, report, prove, Proven, audit",
    async () => {
      const { pool, pub, fx } = chain;
      console.log(`onReport gas: ${chain.reportGas}, report bytes: ${chain.reportBytes}`);

      // audit before proving
      expect((await audit(pub, pool, 0n)).ok).toBe(true);

      // prove and submit as the coordinator
      const wallet = createWalletClient({ account: chain.coordinator, chain: foundry, transport: http(chain.rpc) });
      const snapshot = await readPoolSnapshot(pub, pool, 0n);
      const plan = rebuild(snapshot, toBig(fx.sk));
      const prover = await Prover.create("test", 4);
      const started = Date.now();
      try {
        await runChain(pub, wallet, plan, snapshot, prover, (m) => {
          const g = /accepted, gas (\d+)/.exec(m);
          if (g) advanceGas.push(BigInt(g[1]!));
          console.log(`[runChain] ${m}`);
        });
      } finally {
        await prover.destroy();
      }
      console.log(`e2e proof chain: ${((Date.now() - started) / 1000).toFixed(1)}s`);
      expect(Number(await pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(1); // Proven
      const funded = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "fundedProjects" })) as bigint[];
      expect(funded.map(Number)).toEqual(fx.funded);

      // audit still holds once Proven
      expect((await audit(pub, pool, 0n)).ok).toBe(true);
    },
    600_000,
  );

  test(
    "a second pool proved with batch: one advanceMany transaction for the whole chain",
    async () => {
      const { pub, fx, rpc, coordinator } = chain;
      // A second, independent pool on the same anvil: the first one is Proven by now.
      const { pool } = await replayFixturePool(rpc, fx);
      const wallet = createWalletClient({ account: coordinator, chain: foundry, transport: http(rpc) });
      const snapshot = await readPoolSnapshot(pub, pool, 0n);
      const plan = rebuild(snapshot, toBig(fx.sk));
      const prover = await Prover.create("test", 4);
      const before = await pub.getTransactionCount({ address: coordinator.address });
      const lines: string[] = [];
      try {
        await runChain(pub, wallet, plan, snapshot, prover, (m) => (lines.push(m), console.log(`[runChain batch] ${m}`)), { batch: true });
      } finally {
        await prover.destroy();
      }
      const after = await pub.getTransactionCount({ address: coordinator.address });
      expect(after - before).toBe(1); // one transaction for six proofs

      expect(Number(await pub.readContract({ address: pool, abi: poolAbi, functionName: "finality" }))).toBe(1); // Proven
      const funded = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "fundedProjects" })) as bigint[];
      expect(funded.map(Number)).toEqual(fx.funded);
      expect((await audit(pub, pool, 0n)).ok).toBe(true);

      const m = /advanceMany accepted, (\d+) proofs, gas (\d+)/.exec(lines.join("\n"));
      expect(m).not.toBeNull();
      const [count, gas] = [Number(m![1]), BigInt(m![2]!)];
      expect(count).toBe(plan.expected.ingest.length + plan.tallyGroups.length);
      const sum = advanceGas.reduce((a, b) => a + b, 0n);
      expect(advanceGas.length).toBe(count); // the unbatched run above sent one tx per proof
      console.log(`advanceMany: 1 tx, ${count} proofs, gas ${gas}; ${advanceGas.length}x advance: gas ${sum} (${advanceGas.join(" + ")}); saved ${sum - gas}`);
      expect(gas).toBeLessThan(sum);
    },
    600_000,
  );
});
