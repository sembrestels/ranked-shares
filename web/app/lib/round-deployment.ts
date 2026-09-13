import { type Address, type Chain, type Hex, type PublicClient, type WalletClient, encodeDeployData, encodeFunctionData, isAddress, keccak256, parseAbi } from "viem";
import { constructorFields, parameterName, prepareDeployment, type ContractArtifact, type FieldValues } from "./deployment";
import { sendDeployment } from "./deploy-transaction";
import { assertWallet } from "./transactions";
import { buildIdentity, checkTallyService, dependencyNames, isSealedKind, loadDependency, loadLPArtifact, proofProfile, provisionRound, recoveryPolicy, registerRound, resolveRoundValues, verifyServiceContracts, type DependencyName, type Provision, type SealedKind } from "./round-configuration";

type Step = { hash: Hex; confirmed?: boolean };
export type RoundDeployment = {
  version: 1; id: string; chainId: number; kind: SealedKind; account: Address; serviceUrl: string;
  values: FieldValues; buildId: Hex; provision?: Provision; steps: Record<string, Step>;
};
export const roundDeploymentKey = (chainId: number) => `ranked-shares:round-deployment:${chainId}`;
export function restoreRoundDeployment(chainId: number): RoundDeployment | undefined {
  const value = localStorage.getItem(roundDeploymentKey(chainId));
  if (!value) return;
  const saved = JSON.parse(value) as RoundDeployment;
  if (saved.version !== 1 || saved.chainId !== chainId || !isSealedKind(saved.kind) || !isAddress(saved.account) ||
    typeof saved.serviceUrl !== "string" || typeof saved.id !== "string" || !saved.values || !saved.steps ||
    !/^0x[\da-fA-F]{64}$/.test(saved.buildId) || Object.values(saved.steps).some((step) => !/^0x[\da-fA-F]{64}$/.test(step.hash))) {
    throw new Error("A saved deployment could not be read. Keep its transaction records before resetting browser storage.");
  }
  return saved;
}
export function saveRoundDeployment(draft: RoundDeployment) {
  // Multi-transaction deployments need durable hashes before the next signature.
  localStorage.setItem(roundDeploymentKey(draft.chainId), JSON.stringify(draft));
}
export function clearRoundDeployment(chainId: number) { localStorage.removeItem(roundDeploymentKey(chainId)); }

type Context = {
  draft: RoundDeployment; artifact: ContractArtifact; client: PublicClient; wallet: WalletClient; chain: Chain;
  onProgress: (message: string) => void; onSave: (draft: RoundDeployment) => void;
};

export async function runRoundDeployment({ draft: input, artifact, client, wallet, chain, onProgress, onSave }: Context) {
  const draft: RoundDeployment = structuredClone(input);
  const account = draft.account;
  if (draft.chainId !== chain.id || await client.getChainId() !== chain.id) throw new Error("Switch to the deployment’s network to resume.");
  await assertWallet(client, wallet, account);
  if (draft.buildId !== keccak256(artifact.bytecode)) throw new Error("This saved deployment uses an earlier contract build. Restore that app build to resume safely.");
  const save = () => {
    onSave(structuredClone(draft));
    try { saveRoundDeployment(draft); }
    catch { throw new Error("Browser storage could not save deployment progress. Keep this page open and retain the transaction hashes shown below before retrying."); }
  };
  save();
  async function transaction(key: string, label: string, request: () => Promise<{ data: Hex; to?: Address }>) {
    let step = draft.steps[key];
    if (!step) {
      onProgress(`Preparing ${label}…`);
      const { data, to } = await request();
      const hash = await sendDeployment(client, wallet, account, chain, data, 0n,
        () => onProgress(`Confirm ${label} in your wallet…`), to);
      step = draft.steps[key] = { hash }; save();
    }
    onProgress(`Waiting for ${label} to confirm…`);
    const receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 120000, onReplaced: ({ reason, transaction }) => {
      if (reason === "repriced") { draft.steps[key] = { hash: transaction.hash }; save(); }
      else { delete draft.steps[key]; save(); }
    } });
    if (!draft.steps[key]) throw new Error("The transaction was replaced or cancelled. Resume to retry this step.");
    if (receipt.status !== "success") {
      delete draft.steps[key]; save();
      throw new Error(`The transaction for ${label} reverted. Resume to retry this step.`);
    }
    draft.steps[key].confirmed = true; save();
    return receipt;
  }
  const fields = constructorFields(artifact, true);
  const fieldValue = (name: string) => draft.values[fields.find((field) => parameterName(field.parameter) === name)!.key];
  const organizer = fieldValue("owner") as Address;
  const token = fieldValue("token") as Address;
  const deadline = fields.find((field) => ["deadline", "votingDeadline"].includes(parameterName(field.parameter)))!;
  const identity = await buildIdentity(chain.id, draft.kind, artifact);
  if (!draft.provision) {
    onProgress("Preparing the tally service for your round…");
    await checkTallyService(draft.serviceUrl, identity);
    draft.provision = await provisionRound(draft.serviceUrl, draft.id, identity, organizer, account, token,
      String(Math.floor(new Date(draft.values[deadline.key]).getTime() / 1000)));
    save();
  }
  const provision = draft.provision;
  if (Object.entries(identity).some(([key, value]) => provision.identity[key as keyof typeof identity] !== value)) throw new Error("The saved tally configuration does not match this build.");
  await verifyServiceContracts(client, provision);
  const decimals = await client.readContract({ address: token, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
  if (decimals !== 6) throw new Error("The configured funding token must use 6 decimals. Check the network’s token configuration.");
  async function dependency(name: DependencyName): Promise<Address> {
    const build = await loadDependency(name);
    const hash = keccak256(build.runtimeBytecode);
    const registryKey = `ranked-shares:dependency:${chain.id}:${name}:${hash}`;
    const cached = localStorage.getItem(registryKey);
    const suggested = provision.dependencies[name];
    const matches = async (address: Address) => {
      const code = await client.getCode({ address });
      return !!code && code !== "0x" && keccak256(code) === hash;
    };
    // Always settle an already-sent transaction before considering another address.
    if (!draft.steps[name]) {
      if (suggested) {
        if (!await matches(suggested)) throw new Error("A shared verification contract does not match this build. The tally service configuration needs updating.");
        localStorage.setItem(registryKey, suggested);
        return suggested;
      }
      if (cached && isAddress(cached) && await matches(cached)) return cached;
    }
    const receipt = await transaction(name, "a shared verification contract", async () => ({ data: build.bytecode }));
    const address = receipt.contractAddress;
    if (!address || !await matches(address)) throw new Error("The deployed verification contract does not match the pinned build.");
    localStorage.setItem(registryKey, address);
    return address;
  }
  const automatic: Record<string, string> = { ...provision.fields, ...recoveryPolicy,
    ...Object.fromEntries(Object.entries(proofProfile.noir).map(([key, value]) => [key, String(value)])) };
  const dependencyFields = { Poseidon2: "poseidon", IngestVerifier: "ingestVerifier", TallyVerifier: "tallyVerifier", ZiskVerifier: "verifier" };
  for (const name of dependencyNames(draft.kind)) automatic[dependencyFields[name]] = await dependency(name);
  if (draft.kind === "ZiskRankedShares") {
    automatic.rootC = await client.readContract({ address: automatic.verifier as Address,
      abi: parseAbi(["function getRootCVadcopFinal() view returns (bytes32)"]), functionName: "getRootCVadcopFinal" });
  }
  const roundReceipt = await transaction("round", "your round", async () => {
    const values = resolveRoundValues(artifact, draft.values, automatic);
    // Attaching LPVoting is owner-only. Hand ownership over after attachment.
    if (draft.kind === "LPCreRankedShares") values[fields.find((field) => parameterName(field.parameter) === "owner")!.key] = account;
    const prepared = prepareDeployment(artifact, values, true, "0", chain.id);
    if (!prepared.data) throw new Error(`The round configuration is incomplete: ${Object.values(prepared.errors).join(" ")}`);
    return { data: prepared.data };
  });
  const round = roundReceipt.contractAddress;
  if (!round) throw new Error("The round deployment did not return a contract address.");
  let lpVoting: Address | undefined;
  let blockNumber = roundReceipt.blockNumber;
  if (draft.kind === "LPCreRankedShares") {
    const lp = provision.liquidity!;
    const module = await transaction("liquidity", "liquidity voting", async () => {
      const build = await loadLPArtifact();
      return { data: encodeDeployData({ ...build, args: [round, lp.manager, lp.stateView, automatic.forwarder, automatic.workflowOwner, automatic.workflowName] }) };
    });
    lpVoting = module.contractAddress || undefined;
    if (!lpVoting) throw new Error("The liquidity deployment did not return a contract address.");
    const abi = parseAbi(["function setLPVoting(address module)", "function transferOwnership(address newOwner)"]);
    const attached = await transaction("attach", "connecting liquidity voting", async () => ({ to: round, data: encodeFunctionData({ abi, functionName: "setLPVoting", args: [lpVoting!] }) }));
    blockNumber = attached.blockNumber;
    if (organizer.toLowerCase() !== account.toLowerCase()) {
      const handedOver = await transaction("organizer", "assigning the organizer", async () => ({ to: round, data: encodeFunctionData({ abi, functionName: "transferOwnership", args: [organizer] }) }));
      blockNumber = handedOver.blockNumber;
    }
  }
  onProgress("Confirming that the tally service is watching your round…");
  await registerRound(draft.serviceUrl, provision, round, roundReceipt.transactionHash, lpVoting);
  clearRoundDeployment(chain.id);
  return { contractAddress: round, hash: roundReceipt.transactionHash, blockNumber };
}
