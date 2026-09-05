// prover/scripts/dev-pool.ts — spin up anvil, deploy the fixture pool, replay its
// transcript and report it, then stay up so the coordinator page (`npm run preview`)
// or the prove service (`prover serve`) can drive it live. Ctrl-C stops anvil.
import { readFileSync } from "node:fs";
import { startFixtureChain, COORDINATOR_KEY } from "../test/helpers/anvil";

function fixtureMaster(): string {
  const here = import.meta.url;
  const fx = JSON.parse(readFileSync(new URL("../../reference/vectors/fixture_test_main.json", here), "utf8"));
  return fx.master as string;
}

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
  console.log(`MASTER       ${fixtureMaster()}  (the fixture's fixed tallier master secret: paste it into the page's "Master secret" field; "Sign for tallier key" cannot reproduce it)`);
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
