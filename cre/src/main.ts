import { Runner } from "@chainlink/cre-sdk";
import { type Config, initWorkflow } from "./workflow";

/**
 * Entry point. Javy rejects exported functions that take parameters, so this
 * module exports nothing but the zero-argument `main`; the workflow itself
 * (and the pure `processPool`) lives in `./workflow`. `cre-compile` appends the
 * `main().catch(sendErrorResponse)` call, so there is none here.
 */
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
