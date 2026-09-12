import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignCard, PositionCard } from "../app/components/liquidity";
import {
  type LPData,
  poolIdOf,
  sendLPAction,
  sharePercent,
} from "../app/lib/lp";
import { type Address, decodeAbiParameters } from "viem";

const account = "0x1111111111111111111111111111111111111111" as Address;
const manager = "0x2222222222222222222222222222222222222222" as Address;
const module = "0x3333333333333333333333333333333333333333" as Address;

describe("LP participation", () => {
  it("the one registration transaction targets PositionManager and binds the selected sponsorship", async () => {
    const simulateContract = vi.fn(async (args) => ({ request: args }));
    const writeContract = vi.fn(async () => "0x1234");
    const client = { getChainId: async () => 31337, simulateContract };
    const wallet = {
      getChainId: async () => 31337,
      getAddresses: async () => [account],
      writeContract,
    };
    await sendLPAction(client as never, wallet as never, account, manager, {
      type: "claim",
      tokenId: 12n,
      module,
      id: 2n,
    });
    const request = simulateContract.mock.calls[0][0];
    expect(request.address).toBe(manager);
    expect(request.functionName).toBe("subscribe");
    expect(request.args.slice(0, 2)).toEqual([12n, module]);
    expect(decodeAbiParameters([{ type: "uint256" }], request.args[2])).toEqual(
      [2n],
    );
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed wallet network before simulation or signing", async () => {
    const simulateContract = vi.fn();
    const client = { getChainId: async () => 5042002, simulateContract };
    const wallet = {
      getChainId: async () => 1,
      getAddresses: async () => [account],
    };
    await expect(
      sendLPAction(client as never, wallet as never, account, manager, {
        type: "stop",
        tokenId: 12n,
      }),
    ).rejects.toThrow("network");
    expect(simulateContract).not.toHaveBeenCalled();
  });
  it("does not offer claim for an ineligible position", () => {
    render(
      <PositionCard
        position={{
          id: 7n,
          reason: "Subscribed to another application",
          canClaim: false,
          canStop: false,
        } as LPData["positions"][number]}
        busy={false}
        onClaim={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Start earning/ })).toBeNull();
    expect(screen.getByText("Subscribed to another application")).toBeTruthy();
  });
  it("labels projected amounts and shows stale price status", () => {
    const campaign: LPData["campaigns"][number] = {
      id: 0n,
      amount: 5_000_000n,
      stableSymbol: "EURC",
      stableDecimals: 6,
      minimumValue: 10_000n,
      projection: [2n, 3n, 3_333_333n],
      finalized: false,
      updatedAt: 1n,
      sourceBlock: 0n,
      poolId: `0x${"00".repeat(32)}`,
      price: 1n << 96n,
      sponsor: account,
      stable: manager,
      positions: [],
      allocated: 0n,
      totalAccrued: 0n,
      settleCursor: 0n,
      allocationCursor: 0n,
      stable0: false,
    };
    render(
      <CampaignCard
        campaign={campaign}
        data={{
          decimals: 6,
          symbol: "USDC",
          timestamp: 1000n,
          phase: 1,
        } as LPData}
        busy={false}
        onFinalize={vi.fn()}
      />,
    );
    expect(screen.getByText("Your projected voting weight")).toBeTruthy();
    expect(screen.getByText("3.333333 USDC")).toBeTruthy();
    expect(screen.getByText(/has not updated in over five minutes/))
      .toBeTruthy();
  });
  it("handles empty denominators and hashes full pool keys", () => {
    expect(sharePercent(0n, 0n)).toBe("0%");
    expect(sharePercent(1n, 4n)).toBe("25%");
    const key = {
      currency0: account,
      currency1: manager,
      fee: 3000,
      tickSpacing: 60,
      hooks: "0x0000000000000000000000000000000000000000" as Address,
    };
    expect(poolIdOf(key)).not.toBe(poolIdOf({ ...key, fee: 500 }));
  });
});
