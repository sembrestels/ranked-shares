import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type Address as AddressType, type Hex, isAddress, keccak256 } from "viem";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { DeploymentForm } from "../components/deployment/deployment-form";
import { Address, Button, Notice } from "../components/ui";
import { chain, useRound } from "../context/providers";
import { loadRoundArtifact, roundContracts } from "../lib/deployment-catalog";
import { type ContractArtifact, type FieldValues, constructorFields, initialValues, parameterName, parseArtifact, prepareDeployment } from "../lib/deployment";
import { sendDeployment } from "../lib/deploy-transaction";
import { fundingTokens } from "../lib/funding-tokens";
import { errorMessage } from "../lib/proposals";
import { buildIdentity, checkTallyService, isSealedKind, organizerFields, proofProfile, tallyServiceUrl } from "../lib/round-configuration";
import { clearRoundDeployment, restoreRoundDeployment, runRoundDeployment, type RoundDeployment } from "../lib/round-deployment";

type Deployment = { hash: Hex; account: AddressType; name: string; round: boolean; chainId: number };
const storageKey = `ranked-shares:deployment:${chain.id}`;
export function meta() { return [{ title: "Deploy a round · RankedShares" }]; }

export default function DeployPage() {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const client = usePublicClient({ chainId: chain.id });
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { setPool, markMined } = useRound();
  const [selection, setSelection] = useState("RankedShares");
  const [artifact, setArtifact] = useState<ContractArtifact>();
  const [values, setValues] = useState<FieldValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [artifactText, setArtifactText] = useState("");
  const [bytecodeText, setBytecodeText] = useState("");
  const [nativeValue, setNativeValue] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<Deployment>();
  const [result, setResult] = useState<Deployment & { contractAddress: AddressType }>();
  const [check, setCheck] = useState(0);
  const [restored, setRestored] = useState(false);
  const [organizerOverride, setOrganizerOverride] = useState(false);
  const [roundDraft, setRoundDraft] = useState<RoundDeployment>();
  const [service, setService] = useState<{ ready: boolean; message?: string }>({ ready: false });
  const [serviceCheck, setServiceCheck] = useState(0);
  const currentAccount = useRef(address);
  currentAccount.current = address;
  const operation = useRef(false);
  const round = selection !== "custom";
  const locked = busy || !!pending || !!result || !!roundDraft;
  const ownerField = artifact && round ? constructorFields(artifact, true).find((field) => parameterName(field.parameter) === "owner") : undefined;
  const displayedOwner = roundDraft && ownerField ? roundDraft.values[ownerField.key] : organizerOverride && ownerField ? values[ownerField.key] : address;
  const displayedOverride = roundDraft ? displayedOwner?.toLowerCase() !== roundDraft.account.toLowerCase() : organizerOverride;

  function remember(deployment?: Deployment) {
    try {
      if (deployment) localStorage.setItem(storageKey, JSON.stringify(deployment));
      else localStorage.removeItem(storageKey);
    } catch { /* Receipt tracking still works when browser storage is unavailable. */ }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && saved.chainId === chain.id && /^0x[\da-fA-F]{64}$/.test(saved.hash) &&
        isAddress(saved.account) && typeof saved.name === "string" && typeof saved.round === "boolean") setPending(saved);
      const draft = restoreRoundDeployment(chain.id);
      if (draft) { setRoundDraft(draft); setSelection(draft.kind); }
    } catch (err) { setError(errorMessage(err)); }
    setRestored(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setArtifact(undefined); setErrors({}); setValues({}); setNativeValue("0"); setOrganizerOverride(false);
    if (selection === "custom") { setLoading(false); return; }
    setLoading(true);
    loadRoundArtifact(selection).then((next) => {
      if (!cancelled) { setArtifact(next); setValues(initialValues(next, true, chain.id, currentAccount.current)); }
    }).catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selection]);

  useEffect(() => {
    if (!artifact || !round || locked || organizerOverride) return;
    const field = constructorFields(artifact, true).find((field) => parameterName(field.parameter) === "owner");
    if (field) setValues((old) => ({ ...old, [field.key]: address || "" }));
  }, [artifact, round, address, locked, organizerOverride]);

  useEffect(() => {
    let active = true;
    if (!isSealedKind(selection)) { setService({ ready: true }); return; }
    setService({ ready: false, message: "Checking tally service availability…" });
    if (!artifact) return;
    const kind = selection;
    (async () => {
      const url = tallyServiceUrl();
      if (!url) throw new Error("Tally service setup is still needed for this round type on this network. Public voting is available now.");
      await checkTallyService(url, await buildIdentity(chain.id, kind, artifact));
      if (active) setService({ ready: true, message: "Tally service ready. Encryption and result delivery will be configured automatically." });
    })().catch((err) => { if (active) setService({ ready: false, message: errorMessage(err) }); });
    return () => { active = false; };
  }, [selection, artifact, serviceCheck]);

  useEffect(() => {
    if (!pending || !client) return;
    let active = true;
    setBusy(true); setError(undefined); setProgress("Transaction sent. Waiting for confirmation…");
    client.waitForTransactionReceipt({ hash: pending.hash, onReplaced: ({ transaction }) => {
      if (!active) return;
      const replacement = { ...pending, hash: transaction.hash };
      remember(replacement); setPending(replacement);
    } }).then((receipt) => {
      if (!active) return;
      if (receipt.status !== "success" || !receipt.contractAddress) {
        remember(); setPending(undefined); setProgress("");
        throw new Error("The deployment reverted or was cancelled. Review the constructor values and try again.");
      }
      const deployed = { ...pending, contractAddress: receipt.contractAddress };
      setResult(deployed); setPending(undefined); remember();
      if (pending.round) { setPool(receipt.contractAddress); markMined(Number(receipt.blockNumber)); }
      setProgress("Contract deployed successfully.");
    }).catch((err) => {
      if (active) { setError(errorMessage(err)); setProgress(""); }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  // Context setters change identity when the selected round changes; a receipt must only be handled once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, client, check]);

  function importBuild(text: string, code?: string) {
    setArtifact(undefined); setErrors({}); setError(undefined); setNativeValue("0");
    try {
      const next = parseArtifact(text, code);
      setArtifact(next); setValues(initialValues(next, false, chain.id));
    } catch (err) { setError(errorMessage(err)); }
  }
  async function upload(file: File) {
    setLoading(true); setArtifact(undefined); setError(undefined);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Use a contract artifact smaller than 10 MB.");
      const text = await file.text();
      setArtifactText(text); setBytecodeText(""); importBuild(text);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }
  async function deploy() {
    if (!artifact || !address || !wallet || !client || locked || operation.current) return;
    setError(undefined); setErrors({});
    try {
      const effectiveValues = { ...values };
      if (round && !organizerOverride) {
        const owner = constructorFields(artifact, true).find((field) => parameterName(field.parameter) === "owner")!;
        effectiveValues[owner.key] = address;
      }
      const prepared = prepareDeployment(artifact, effectiveValues, round, nativeValue, chain.id);
      const sealed = isSealedKind(selection);
      const visibleKeys = new Set(constructorFields(artifact, round).filter((field) => organizerFields.has(parameterName(field.parameter))).map((field) => field.key));
      const validationErrors = Object.fromEntries(Object.entries(prepared.errors).filter(([key]) => !sealed || visibleKeys.has(key)));
      setErrors(validationErrors);
      if (Object.keys(validationErrors).length) {
        setError(round ? "Check the highlighted round options before deploying." : "Check the highlighted constructor fields before deploying.");
        requestAnimationFrame(() => {
          const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
          field?.closest("details")?.setAttribute("open", ""); field?.focus();
        });
        return;
      }
      if (sealed) {
        if (!service.ready) throw new Error(service.message || "The tally service is not ready yet.");
        const serviceUrl = tallyServiceUrl();
        if (!serviceUrl) throw new Error("The tally service is not configured yet.");
        const draft: RoundDeployment = { version: 1, id: crypto.randomUUID(), kind: selection, account: address,
          chainId: chain.id, buildId: keccak256(artifact.bytecode), values: effectiveValues, serviceUrl, steps: {} };
        await continueRound(draft);
        return;
      }
      if (!prepared.data || prepared.value === undefined) {
        setError("Check the highlighted constructor fields before deploying.");
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      operation.current = true; setBusy(true); setProgress("Checking the constructor and estimating gas…");
      const hash = await sendDeployment(client, wallet, address, chain, prepared.data, prepared.value,
        () => setProgress("Confirm the deployment in your wallet…"));
      const deployment = { hash, account: address, name: artifact.contractName || "Custom contract", round, chainId: chain.id };
      remember(deployment); setPending(deployment);
    } catch (err) { setError(errorMessage(err)); setProgress(""); }
    finally { operation.current = false; setBusy(false); }
  }
  async function continueRound(draft: RoundDeployment) {
    if (!artifact || !wallet || !client || operation.current) return;
    operation.current = true; setBusy(true); setError(undefined);
    try {
      const deployed = await runRoundDeployment({ draft, artifact, client, wallet, chain, onProgress: setProgress, onSave: setRoundDraft });
      setResult({ ...deployed, account: draft.account, name: draft.kind, round: true, chainId: chain.id });
      setRoundDraft(undefined); setPool(deployed.contractAddress); markMined(Number(deployed.blockNumber));
      setProgress("Your round is deployed and the tally service is watching it.");
    } catch (err) { setError(errorMessage(err)); setProgress(""); }
    finally { operation.current = false; setBusy(false); }
  }
  async function connect() {
    setError(undefined);
    try {
      if (!connectors[0]) throw new Error("Install or enable a browser wallet to deploy a contract.");
      setBusy(true);
      await connectAsync({ connector: connectors[0] });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className="deployment-page">
      <div className="page-heading">
        <p className="eyebrow">Create / {chain.name}</p>
        <h1>Deploy {round ? "a round" : "a contract"}.</h1>
        <p>{round ? "Choose how to vote, a funding currency and a deadline. We’ll handle the contract setup." : "Import a compiled build and deploy it from your wallet."}</p>
      </div>
      {result ? <section className="deployment-success stack" aria-labelledby="deployed-heading">
        <p className="eyebrow">Deployment confirmed</p><h2 id="deployed-heading">{result.round ? "Your round is ready for setup." : "Your contract is deployed."}</h2>
        <p>{result.name} · {chain.name}</p><Address address={result.contractAddress} full copy />
        <div className="actions">
          {result.round && <Link className="button primary no-underline" to={`/setup?pool=${result.contractAddress}`}>Set up this round</Link>}
          {chain.blockExplorers?.default && <a href={`${chain.blockExplorers.default.url}/address/${result.contractAddress}`} target="_blank" rel="noreferrer">View contract on explorer</a>}
          <Button variant="secondary" onClick={() => { setResult(undefined); setProgress(""); }}>Deploy another contract</Button>
        </div>
        <p className="hint">Transaction <code>{result.hash}</code></p>
      </section> : <div className="deployment-layout">
        <div>
          <DeploymentForm selection={selection} artifact={artifact} values={roundDraft?.values || values} errors={errors} busy={locked || loading}
            loading={loading} artifactText={artifactText} bytecodeText={bytecodeText} nativeValue={nativeValue} symbol={chain.nativeCurrency.symbol} tokens={fundingTokens(chain.id)}
            organizerOverride={displayedOverride} onOrganizerOverride={(value) => { setOrganizerOverride(value); setErrors({}); }}
            serviceStatus={isSealedKind(selection) && !roundDraft ? service.message : undefined}
            transactionHint={selection === "LPCreRankedShares" ? `Up to ${organizerOverride ? "4" : "3"} wallet transactions: create the round, add and connect liquidity voting${organizerOverride ? ", then assign the organizer" : ""}.`
              : selection === "NoirRankedShares" ? "Up to 4 wallet transactions: prepare shared verification contracts, then deploy your round. Existing matching contracts are reused."
              : selection === "ZiskRankedShares" ? "Up to 2 wallet transactions: prepare verification, then deploy your round. Existing matching contracts are reused." : undefined}
            onSelect={(value) => { setSelection(value); setError(undefined); }} onChange={(key, value) => { setValues((old) => ({ ...old, [key]: value })); setErrors((old) => ({ ...old, [key]: "" })); }}
            onArtifactText={(value) => { setArtifactText(value); setArtifact(undefined); }}
            onBytecodeText={(value) => { setBytecodeText(value); setArtifact(undefined); }}
            onImport={() => importBuild(artifactText, bytecodeText)} onFile={upload} onNativeValue={setNativeValue} onSubmit={deploy}
            canSubmit={restored && !!address && !!wallet && chainId === chain.id && (!isSealedKind(selection) || service.ready)}
            submitLabel={pending ? "Waiting for confirmation…" : busy ? "Preparing deployment…" : round ? "Deploy round" : "Deploy contract"} />
          {error && <Notice error>{error}</Notice>}
          {progress && <Notice>{progress}</Notice>}
          {isSealedKind(selection) && !service.ready && !roundDraft && <Button variant="secondary" disabled={busy || loading} onClick={() => setServiceCheck((value) => value + 1)}>Check availability again</Button>}
          {roundDraft && <section className="deployment-pending stack" aria-label="Round deployment progress">
            <h2>{roundDraft.steps.round ? "Finish setting up your round" : "Continue your deployment"}</h2>
            <p>Your progress is saved. Continuing checks sent transactions before requesting any remaining signatures.</p>
            <p className="hint">Use the deploying wallet: <Address address={roundDraft.account} /></p>
            {Object.entries(roundDraft.steps).map(([step, transaction]) => <p key={step} className="hint">{step}: {chain.blockExplorers?.default ? <a href={`${chain.blockExplorers.default.url}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a> : <code>{transaction.hash}</code>}</p>)}
            <Button disabled={busy || loading || !wallet || chainId !== chain.id || address?.toLowerCase() !== roundDraft.account.toLowerCase()} onClick={() => continueRound(roundDraft)}>Continue deployment</Button>
            {!roundDraft.steps.round && Object.values(roundDraft.steps).every((step) => step.confirmed) && <Button variant="secondary" disabled={busy} onClick={() => { clearRoundDeployment(chain.id); setValues(roundDraft.values); setOrganizerOverride(displayedOverride); setRoundDraft(undefined); setError(undefined); }}>Edit round options</Button>}
          </section>}
          {pending && <div className="deployment-pending stack">
            <p>{pending.name} · Transaction <code>{pending.hash}</code></p>
            {chain.blockExplorers?.default && <a href={`${chain.blockExplorers.default.url}/tx/${pending.hash}`} target="_blank" rel="noreferrer">Track transaction on explorer</a>}
            <p className="hint">This transaction is already sent. You can return to this page to check its confirmation.</p>
            {!busy && <Button variant="secondary" onClick={() => setCheck((n) => n + 1)}>Check confirmation</Button>}
          </div>}
        </div>
        <aside className="deployment-summary stack" aria-label="Deployment details">
          <p className="eyebrow">Deployment details</p>
          <h2>{roundContracts.find((entry) => entry.id === selection)?.name || "Custom contract"}</h2>
          <dl className="deployment-facts"><div><dt>Network</dt><dd>{chain.name} <span className="hint">({chain.id})</span></dd></div>
            <div><dt>Gas paid in</dt><dd>{chain.nativeCurrency.symbol}</dd></div>
            <div><dt>Deploying wallet</dt><dd>{address ? <Address address={address} /> : "Not connected"}</dd></div>
            {round && <div><dt>Organizer</dt><dd>{displayedOwner && isAddress(displayedOwner) ? <Address address={displayedOwner} /> : "Your connected wallet"}</dd></div>}
            {selection === "NoirRankedShares" && <div><dt>Round capacity</dt><dd>{proofProfile.noir.nSealedMax} sealed voters · {proofProfile.noir.mMax} projects</dd></div>}
            {isSealedKind(selection) && <div><dt>Recovery policy</dt><dd>{selection === "NoirRankedShares" && "Provisional results can be accepted after 1 day. "}An unfinished round can be abandoned 7 days after voting closes.</dd></div>}
            {!round && artifact && <div><dt>Contract</dt><dd><code>{artifact.contractName || "Imported build"}</code></dd></div>}
          </dl>
          {!address ? <Button disabled={busy} onClick={connect}>Connect wallet to deploy</Button> : chainId !== chain.id ?
            <Button disabled={busy} onClick={() => switchChainAsync({ chainId: chain.id }).catch((err) => setError(errorMessage(err)))}>Switch to {chain.name}</Button> :
            <p className="hint">Wallet connected. Review the deployment in your wallet when you’re ready.</p>}
          {chain.id === 5042002 && <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Get testnet USDC ↗</a>}
          <p className="hint">{round ? "Once confirmed, this round becomes your selected round. Continue to organizer setup to prepare proposals and voting." : "Your deployed address will appear here. Custom contracts do not replace your selected round."}</p>
        </aside>
      </div>}
    </div>
  );
}
