import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL("../app/lib/artifacts/", import.meta.url);
const names = ["RankedShares", "CreRankedShares", "NoirRankedShares", "ZiskRankedShares", "LPCreRankedShares", "Poseidon2", "IngestVerifier", "TallyVerifier", "ZiskVerifier", "LPVoting"];
const check = process.argv.includes("--check");
if (!check) execFileSync("forge", ["build"], { cwd: root, stdio: "inherit" });
if (!check) mkdirSync(output, { recursive: true });
const cache = !check ? JSON.parse(readFileSync(`${root}cache/solidity-files-cache.json`, "utf8")) : undefined;
for (const name of names) {
  const target = new URL(`${name}.json`, output);
  if (check) {
    const saved = JSON.parse(readFileSync(target, "utf8"));
    if (!Number.isInteger(saved.runtimeBytecodeSize) || saved.runtimeBytecodeSize > 24576) throw new Error(`${name} has no deployable runtime-size record. Run npm run contracts:sync.`);
    for (const [path, expected] of Object.entries(saved.sourceHashes)) {
      const actual = createHash("sha256").update(readFileSync(new URL(path, `file://${root}`))).digest("hex");
      if (actual !== expected) throw new Error(`${name} is stale (${path}). Run npm run contracts:sync in web.`);
    }
    continue;
  }
  let artifactPath = `${name}.sol/${name}.json`;
  if (["NoirRankedShares", "LPCreRankedShares"].includes(name)) {
    const source = Object.values(cache.files).find(f => f.sourceName === (name === "NoirRankedShares" ? "src/noir/NoirRankedShares.sol" : "src/uniswap/LPCreRankedShares.sol"));
    artifactPath = source?.artifacts?.[name]?.["0.8.28"]?.["noir-ir"]?.path;
    if (!artifactPath) throw new Error(`Missing noir-ir deployment artifact for ${name}.`);
  }
  const artifact = JSON.parse(readFileSync(new URL(`out/${artifactPath}`, `file://${root}`), "utf8"));
  const runtimeBytecodeSize = (artifact.deployedBytecode.object.length - 2) / 2;
  if (runtimeBytecodeSize > 24576) throw new Error(`${name} exceeds EIP-170 (${runtimeBytecodeSize} bytes).`);
  const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  const sourceHashes = Object.fromEntries([...Object.keys(metadata.sources), "foundry.toml"].sort().map((path) => [
    path, createHash("sha256").update(readFileSync(new URL(path, `file://${root}`))).digest("hex"),
  ]));
  const dependency = ["Poseidon2", "IngestVerifier", "TallyVerifier", "ZiskVerifier"].includes(name);
  if (dependency && Object.keys(artifact.deployedBytecode.immutableReferences || {}).length) throw new Error(`${name}: runtime contains immutables; cannot compare it directly.`);
  writeFileSync(target, JSON.stringify({ contractName: name, abi: artifact.abi, bytecode: artifact.bytecode.object, runtimeBytecodeSize,
    ...(dependency ? { runtimeBytecode: artifact.deployedBytecode.object } : {}), sourceHashes }) + "\n");
  console.log(`Exported ${name}`);
}
const profileFile = new URL("deployment-profile.json", output);
const sourceFiles = ["noir/Nargo.toml", "noir/VERSIONS", "zisk/Cargo.toml", "zisk/Cargo.lock", "zisk/fixtures/main-calldata.json"];
for (const dir of ["noir/pbear", "noir/sealed", "noir/ingest-default", "noir/tally-default", "zisk/guest", "zisk/crates"]) {
  sourceFiles.push(...readdirSync(`${root}${dir}`, { recursive: true }).filter((file) => /\.(nr|rs|toml)$/.test(file)).map((file) => `${dir}/${file}`));
}
const sourceHashes = Object.fromEntries(sourceFiles.sort().map((path) => [path, createHash("sha256").update(readFileSync(`${root}${path}`)).digest("hex")]));
const ingest = readFileSync(`${root}noir/ingest-default/src/main.nr`, "utf8");
const tally = readFileSync(`${root}noir/tally-default/src/main.nr`, "utf8");
const constant = (source, key) => Number(source.match(new RegExp(`global ${key}: u32 = (\\d+);`))?.[1]);
const noir = { nSealedMax: constant(ingest, "E"), mMax: constant(ingest, "M"), batch: constant(ingest, "B") };
if (!noir.batch || noir.nSealedMax !== constant(tally, "E") || noir.mMax !== constant(tally, "M")) throw new Error("Ingest and tally profiles do not match.");
const profile = { noir, zisk: { programVK: JSON.parse(readFileSync(`${root}zisk/fixtures/main-calldata.json`, "utf8")).programVK }, sourceHashes };
if (check) {
  if (JSON.stringify(JSON.parse(readFileSync(profileFile, "utf8"))) !== JSON.stringify(profile)) throw new Error("Proof profile is stale. Regenerate proofs/verifiers as needed, then run npm run contracts:sync.");
} else writeFileSync(profileFile, JSON.stringify(profile) + "\n");
if (check) console.log("Deployment artifacts match the contract sources.");
