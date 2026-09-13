/** viem wraps transport failures in ContractFunctionExecutionError; walk the causes. */
import { HttpRequestError, LimitExceededRpcError, TimeoutError } from "viem";

export function isRpcDown(err: unknown): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof LimitExceededRpcError || e.code === -32005) return true;
  }
  return false;
}
