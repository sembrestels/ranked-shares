import { Runner } from "@chainlink/cre-sdk";
import { initLPWorkflow, type LPConfig } from "./lp-workflow";
export async function main() {
  const runner = await Runner.newRunner<LPConfig>();
  await runner.run(initLPWorkflow);
}
