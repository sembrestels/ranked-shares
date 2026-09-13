import { secp256k1 } from "@noble/curves/secp256k1.js";
import { type Address, type Hex, type PublicClient, getAddress, isAddress, keccak256, parseAbi, sha256, stringToHex, zeroAddress } from "viem";
import { constructorFields, parameterName, parseArtifact, type ContractArtifact, type FieldValues } from "./deployment";
import profile from "./artifacts/deployment-profile.json";

export const recoveryPolicy = { proofGrace: "86400", abandonGrace: "604800" };
export const proofProfile = profile;
export type SealedKind = "CreRankedShares" | "NoirRankedShares" | "ZiskRankedShares" | "LPCreRankedShares";
export const isSealedKind = (kind: string): kind is SealedKind => ["CreRankedShares", "NoirRankedShares", "ZiskRankedShares", "LPCreRankedShares"].includes(kind);
export const organizerFields = new Set(["token", "owner", "deadline", "votingDeadline", "minDirectVote", "minSealedVote"]);
const artifacts = import.meta.glob("./artifacts/*.json", { import: "default" });
export type DependencyName = "Poseidon2" | "IngestVerifier" | "TallyVerifier" | "ZiskVerifier";
export const dependencyNames = (kind: string): DependencyName[] => kind === "NoirRankedShares" ? ["Poseidon2", "IngestVerifier", "TallyVerifier"] : kind === "ZiskRankedShares" ? ["ZiskVerifier"] : [];
export async function loadDependency(name: DependencyName): Promise<ContractArtifact & { runtimeBytecode: Hex }> {
  const source = await artifacts[`./artifacts/${name}.json`]() as { runtimeBytecode: Hex };
  return { ...parseArtifact(source), runtimeBytecode: source.runtimeBytecode };
}
export async function loadLPArtifact() { return parseArtifact(await artifacts["./artifacts/LPVoting.json"]()); }

export type BuildIdentity = { chainId: number; contract: SealedKind; buildId: Hex; profileId: Hex };
export async function buildIdentity(chainId: number, kind: SealedKind, artifact: ContractArtifact): Promise<BuildIdentity> {
  const dependencies = await Promise.all(dependencyNames(kind).map(async (name) => [name, keccak256((await loadDependency(name)).runtimeBytecode)]));
  const proof = kind === "NoirRankedShares" ? { noir: profile.noir, sources: Object.fromEntries(Object.entries(profile.sourceHashes).filter(([path]) => path.startsWith("noir/"))) }
    : kind === "ZiskRankedShares" ? { zisk: profile.zisk, sources: Object.fromEntries(Object.entries(profile.sourceHashes).filter(([path]) => path.startsWith("zisk/"))) } : null;
  const lp = kind === "LPCreRankedShares" ? keccak256((await loadLPArtifact()).bytecode) : null;
  return { chainId, contract: kind, buildId: keccak256(artifact.bytecode), profileId: keccak256(stringToHex(JSON.stringify({ dependencies, proof, lp, recoveryPolicy }))) };
}

/** This URL exposes public provisioning data only; secrets stay at the tally service. */
export function tallyServiceUrl(): string | undefined {
  const configured = import.meta.env.VITE_TALLY_SERVICE_URL?.trim();
  if (!configured) return undefined;
  const url = new URL(configured, globalThis.location?.origin || "http://localhost");
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("The tally service URL must use HTTPS (or localhost for development), without credentials or query parameters.");
  }
  return url.href.replace(/\/$/, "");
}
async function serviceRequest(base: string, path: string, body?: unknown, method = "POST") {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : method, credentials: "omit", cache: "no-store",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("The tally service is unavailable. Try again when it is ready.");
  return await response.json() as unknown;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The tally service returned an invalid configuration.");
  return value as Record<string, unknown>;
};
function matchIdentity(value: Record<string, unknown>, identity: BuildIdentity) {
  if (Object.entries(identity).some(([key, expected]) => value[key] !== expected)) throw new Error("The tally service does not support this network and contract build yet.");
}
export async function checkTallyService(base: string, identity: BuildIdentity) {
  const result = record(await serviceRequest(base, `/capabilities?${new URLSearchParams(Object.entries(identity).map(([key, value]) => [key, String(value)]))}`));
  matchIdentity(result, identity);
  if (result.ready !== true) throw new Error("Tally service setup is still needed for this round type on this network.");
}
const nonzeroAddress = (value: unknown): Address => {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error("The tally service is missing a required deployment identity.");
  return getAddress(value);
};
const bytes32 = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{64}$/.test(value) || /^0x0+$/.test(value)) throw new Error("The tally service returned invalid key material.");
  return value as Hex;
};
export function workflowNameHash(name: string): Hex {
  // CreMetadata.sol truncates the *hex string*, then encodes its ASCII bytes.
  return stringToHex(sha256(stringToHex(name)).slice(2, 12));
}
export type Provision = {
  id: string; identity: BuildIdentity; fields: Record<string, string>;
  dependencies: Partial<Record<DependencyName, Address>>;
  liquidity?: { manager: Address; stateView: Address };
};

export function parseProvision(input: unknown, id: string, identity: BuildIdentity): Provision {
  const data = record(input);
  matchIdentity(data, identity);
  if (data.id !== id || data.monitoring !== "reserved") throw new Error("The tally service has not reserved monitoring for this round.");
  const key = record(data.key);
  const fields: Record<string, string> = { keySalt: bytes32(key.salt) };
  if (identity.contract === "NoirRankedShares") {
    if (typeof key.x !== "string" || typeof key.y !== "string" || !/^\d+$/.test(key.x) || !/^\d+$/.test(key.y)) throw new Error("The tally service returned an invalid Noir public key.");
    const x = BigInt(key.x), y = BigInt(key.y);
    const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    if (x >= field || y >= field || (y * y - x * x * x + 17n) % field !== 0n) throw new Error("The tally service returned an invalid Noir public key.");
    fields.tallierPkX = key.x; fields.tallierPkY = key.y;
    fields.coordinator = nonzeroAddress(data.coordinator);
  } else {
    if (typeof key.publicKey !== "string" || !/^0x0[23][\da-fA-F]{64}$/.test(key.publicKey)) throw new Error("The tally service returned an invalid public key.");
    secp256k1.Point.fromHex(key.publicKey.slice(2)).assertValidity();
    fields.tallierPk = key.publicKey;
  }
  if (identity.contract !== "ZiskRankedShares") {
    const workflow = record(data.workflow);
    fields.forwarder = nonzeroAddress(workflow.forwarder);
    fields.workflowOwner = nonzeroAddress(workflow.owner);
    if (typeof workflow.name !== "string" || !workflow.name.trim()) throw new Error("The tally service is missing its registered workflow name.");
    fields.workflowName = workflowNameHash(workflow.name);
  } else {
    const guest = record(data.guest);
    if (guest.programVK !== profile.zisk.programVK) throw new Error("The tally service guest does not match the supported proof build.");
    fields.programVK = bytes32(guest.programVK);
  }
  const dependencies: Provision["dependencies"] = {};
  if (data.dependencies !== undefined) {
    const addresses = record(data.dependencies);
    for (const name of dependencyNames(identity.contract)) if (addresses[name] !== undefined) dependencies[name] = nonzeroAddress(addresses[name]);
  }
  const liquidity = identity.contract === "LPCreRankedShares" ? (() => {
    const lp = record(data.liquidity);
    return { manager: nonzeroAddress(lp.manager), stateView: nonzeroAddress(lp.stateView) };
  })() : undefined;
  return { id, identity, fields, dependencies, liquidity };
}
export async function provisionRound(base: string, id: string, identity: BuildIdentity, organizer: Address, deployer: Address, token: Address, votingDeadline: string) {
  return parseProvision(await serviceRequest(base, "/rounds", { ...identity, id, organizer, deployer, token, votingDeadline,
    ...(identity.contract === "NoirRankedShares" ? { capacity: profile.noir } : {}) }), id, identity);
}
export async function registerRound(base: string, provision: Provision, round: Address, transactionHash: Hex, lpVoting?: Address) {
  const result = record(await serviceRequest(base, `/rounds/${encodeURIComponent(provision.id)}/deployment`, { ...provision.identity, round, transactionHash, lpVoting }, "PUT"));
  if (result.id !== provision.id || typeof result.round !== "string" || result.round.toLowerCase() !== round.toLowerCase() || result.monitoring !== "active") throw new Error("The contract is deployed, but tally monitoring is not confirmed yet. Resume to check again.");
}
export async function verifyServiceContracts(client: PublicClient, provision: Provision) {
  const addresses = [provision.fields.forwarder, provision.liquidity?.manager, provision.liquidity?.stateView].filter(Boolean) as Address[];
  for (const address of addresses) {
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error("Tally service setup is incomplete on this network. A required contract is missing.");
  }
  if (provision.liquidity) {
    const abi = parseAbi(["function poolManager() view returns (address)", "function unsubscribeGasLimit() view returns (uint256)"]);
    const { manager, stateView } = provision.liquidity;
    const [gasLimit, a, b] = await Promise.all([
      client.readContract({ address: manager, abi, functionName: "unsubscribeGasLimit" }),
      client.readContract({ address: manager, abi, functionName: "poolManager" }),
      client.readContract({ address: stateView, abi, functionName: "poolManager" }),
    ]);
    if (gasLimit < 200000n || a.toLowerCase() !== b.toLowerCase() || a.toLowerCase() === zeroAddress) throw new Error("The configured liquidity contracts are incompatible with this round.");
  }
}

/** Hidden fields only come from verified service/deployment data and the pinned profile. */
export function resolveRoundValues(artifact: ContractArtifact, user: FieldValues, automatic: Record<string, string>): FieldValues {
  return Object.fromEntries(constructorFields(artifact, true).map(({ key, parameter }) => {
    const name = parameterName(parameter);
    return [key, organizerFields.has(name) ? user[key] || (["minDirectVote", "minSealedVote"].includes(name) ? "0" : "") : automatic[name] ?? ""];
  }));
}
