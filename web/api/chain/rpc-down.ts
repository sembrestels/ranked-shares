/** viem wraps transport failures in ContractFunctionExecutionError; walk the causes. */
import { HttpRequestError, TimeoutError } from "viem";

export function isRpcDown(err: unknown): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e instanceof HttpRequestError || e instanceof TimeoutError) return true;
  }
  return false;
}
