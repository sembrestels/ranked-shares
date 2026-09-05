// prover/scripts/dev-pool.ts — spin up anvil, deploy the fixture pool, replay its
// transcript and report it, then stay up so the coordinator page (`npm run preview`)
// or the prove service (`prover serve`) can drive it live. Ctrl-C stops anvil.
import { startFixtureChain, COORDINATOR_KEY } from "../test/helpers/anvil";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

async function main() {
  const port = Number(arg("port", "8548"));
  const chain = await startFixtureChain({ port });

  console.log("");
  console.log(`RPC          ${chain.rpc}`);
  console.log(`POOL         ${chain.pool}`);
  console.log(`COORDINATOR  ${COORDINATOR_KEY}  (anvil account 2)`);
  console.log(`PAGE         http://localhost:4173/?rpc=${chain.rpc}&pool=${chain.pool}`);
  console.log("");
  console.log("pool replayed and reported; ready to prove. Ctrl-C to stop anvil and exit.");

  const shutdown = async () => {
    console.log("\nstopping anvil...");
    await chain.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
