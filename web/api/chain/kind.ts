/** Which pool is this? SealedPool variants answer kind(); the Noir pool has
 * profileId(); the plain pool has neither. Probed once per snapshot. */
import type { Address, PublicClient } from "viem";
import { noirAbi, sealedAbi } from "./abi.ts";
import { isRpcDown } from "./rpc-down.ts";

export type Kind = "plain" | "cre" | "zisk" | "noir";

export async function detectKind(
  client: PublicClient,
  pool: Address,
  blockNumber: bigint,
): Promise<Kind> {
  try {
    const k = await client.readContract({
      address: pool,
      abi: sealedAbi,
      functionName: "kind",
      blockNumber,
    });
    if (k === "public") return "plain";
    if (k === "cre" || k === "zisk" || k === "noir") return k;
  } catch (e) {
    if (isRpcDown(e)) throw e;
    // not a SealedPool
  }
  try {
    await client.readContract({
      address: pool,
      abi: noirAbi,
      functionName: "profileId",
      blockNumber,
    });
    return "noir";
  } catch (e) {
    if (isRpcDown(e)) throw e;
    // not a Noir pool
  }
  return "plain";
}
