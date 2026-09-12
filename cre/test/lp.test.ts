import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, type Hex, toHex } from "viem";
import {
  creInputsHash,
  creResultReport,
  type CreVoter,
  decryptCre,
  deriveCreKey,
  encodePriceReport,
} from "../src/lib/lp";
import { creAction, lpActions, type Read } from "../src/lp-workflow";
import fixture from "../../reference/vectors/zisk/fixture_main.json";
import noDirect from "../../reference/vectors/zisk/fixture_nodirect.json";
import noSealed from "../../reference/vectors/zisk/fixture_nosealed.json";
import { hexToBytes } from "viem";

describe("CRE LP demo", () => {
  for (const fx of [fixture, noDirect, noSealed]) {
    test(`secp256k1 tally matches independent Python/Rust ${fx.scenario} fixture`, () => {
      const voters: CreVoter[] = fx.voters.map((v) => ({
        address: v.addr as Hex,
        directWeight: BigInt(v.directWeight),
        seatWeight: BigInt(v.seatWeight),
        publicBallot: (v.directBallot || "0x") as Hex,
        sealedBallot: (v.ciphertext || "0x") as Hex,
      }));
      const costs = fx.costs.map(BigInt);
      const master = hexToBytes(fx.master as Hex);
      expect(toHex(deriveCreKey(master, fx.keySalt as Hex))).toBe(fx.sk as Hex);
      const root = creInputsHash(
        BigInt(fx.chainId),
        fx.pool as Hex,
        voters,
        costs,
        BigInt(fx.totalWeight),
      );
      expect(root).toBe(fx.inputsHash as Hex);
      const report = creResultReport(
        BigInt(fx.chainId),
        fx.pool as Hex,
        voters,
        costs,
        BigInt(fx.totalWeight),
        root,
        fx.keySalt as Hex,
        fx.pk as Hex,
        master,
      );
      const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, {
        type: "bytes",
      }], report);
      const [, funded] = decodeAbiParameters([{ type: "bytes32" }, {
        type: "uint256[]",
      }], payload);
      expect(kind).toBe(1);
      expect(funded).toEqual(fx.funded.map(BigInt));
      expect(() =>
        creResultReport(
          BigInt(fx.chainId),
          fx.pool as Hex,
          voters,
          costs,
          BigInt(fx.totalWeight),
          root,
          fx.keySalt as Hex,
          fx.pk as Hex,
          new Uint8Array(32),
        )
      ).toThrow("tallier key");
    });
  }
  test("malformed sealed ballot abstains", () => {
    expect(
      decryptCre(
        new Uint8Array(32).fill(1),
        fixture.pool as Hex,
        `0x${"00".repeat(37)}`,
        4,
      ),
    ).toBeNull();
  });
  test("price reports bind pool campaign, source block and timestamp", () => {
    const [kind, payload] = decodeAbiParameters([{ type: "uint8" }, {
      type: "bytes",
    }], encodePriceReport(1n, 1n << 96n, 200n, 1_000n));
    expect(kind).toBe(4);
    expect(
      decodeAbiParameters([{ type: "uint256" }, { type: "uint160" }, {
        type: "uint64",
      }, { type: "uint64" }], payload),
    ).toEqual([1n, 1n << 96n, 200n, 1_000n]);
  });
  const module = "0x1111111111111111111111111111111111111111" as const;
  const pool = "0x2222222222222222222222222222222222222222" as const;
  test("both pools get automated updates; closing finishes LP allocation first", () => {
    let phase = 1;
    const read = ((_: unknown, __: unknown, name: string) => {
      if (name === "pool") return pool;
      if (name === "phase") return phase;
      if (name === "sponsorshipCount") return 2n;
      if (name === "sponsorship") {
        return {
          poolId: `0x${"00".repeat(32)}`,
          updatedAt: 1n,
          sourceBlock: 1n,
          finalized: false,
        };
      }
      if (name === "stateView") return module;
      if (name === "getSlot0") return [1n << 96n, 0, 0, 3000];
      throw new Error(name);
    }) as Read;
    const open = lpActions(read, module, 200n, 100n, {
      closeChunk: 25,
      priceIntervalSeconds: 120,
    });
    expect(open.actions.length).toBe(2);
    phase = 2;
    const closing = lpActions(read, module, 200n, 100n, {
      closeChunk: 25,
      priceIntervalSeconds: 120,
    });
    expect(closing.ready).toBe(false);
    expect(closing.actions.map((a) => a.description)).toEqual([
      "LP finalization 0",
      "LP finalization 1",
    ]);
  });
  test("Arkiv closing verifies witnesses and never needs a tallier secret", () => {
    const read = ((_: unknown, __: unknown, name: string) => {
      if (name === "totalWeight" || name === "balanceOf") return 100n;
      if (name === "token") return module;
      if (name === "arkivBallots") return true;
      if (name === "voterCount" || name === "closeCursor") return 0n;
      if (name === "voterRefsFrom") return [[], [], [], [], []];
      throw new Error(name);
    }) as Read;
    const action = creAction(read, pool, 2, 31337n, 25, () => {
      throw new Error("must not fetch secret");
    }, () => new Map());
    expect(action?.description).toBe("close ballots");
    expect(
      decodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes" }],
        action!.report,
      )[0],
    ).toBe(3);
  });
});
