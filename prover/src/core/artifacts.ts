// prover/src/core/artifacts.ts — loads the compiled Noir circuits
import type { CompiledCircuit } from "@noir-lang/noir_js";
import ingestTest from "../../../noir/artifacts/test/ingest.json";
import tallyTest from "../../../noir/artifacts/test/tally.json";
import ingestDefault from "../../../noir/artifacts/default/ingest.json";
import tallyDefault from "../../../noir/artifacts/default/tally.json";

const table = { test: { ingest: ingestTest, tally: tallyTest }, default: { ingest: ingestDefault, tally: tallyDefault } } as const;

export function circuit(kind: "ingest" | "tally", profile: "test" | "default"): CompiledCircuit {
  return table[profile][kind] as unknown as CompiledCircuit;
}
