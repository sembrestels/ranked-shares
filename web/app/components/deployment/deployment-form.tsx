import type { ContractArtifact, FieldValues } from "../../lib/deployment";
import { constructorFields, constructorInputs, isDeadline, parameterName } from "../../lib/deployment";
import { roundContracts } from "../../lib/deployment-catalog";
import type { FundingToken } from "../../lib/funding-tokens";
import { Button, Field, Input, Notice, Textarea } from "../ui";
import { ConstructorField } from "./constructor-field";

export function DeploymentForm({ selection, artifact, values, errors, busy, loading, artifactText, bytecodeText, nativeValue, symbol, tokens,
  organizerOverride, onOrganizerOverride, serviceStatus, transactionHint,
  onSelect, onChange, onArtifactText, onBytecodeText, onImport, onFile, onNativeValue, onSubmit, canSubmit, submitLabel,
}: {
  selection: string; artifact?: ContractArtifact; values: FieldValues; errors: Record<string, string>;
  busy: boolean; loading: boolean; artifactText: string; bytecodeText: string; nativeValue: string; symbol: string;
  tokens: readonly FundingToken[];
  organizerOverride: boolean; onOrganizerOverride: (value: boolean) => void;
  serviceStatus?: string; transactionHint?: string;
  onSelect: (value: string) => void; onChange: (key: string, value: string) => void;
  onArtifactText: (value: string) => void; onBytecodeText: (value: string) => void;
  onImport: () => void; onFile: (file: File) => void; onNativeValue: (value: string) => void;
  onSubmit: () => void; canSubmit: boolean; submitLabel: string;
}) {
  const round = selection !== "custom";
  const selected = roundContracts.find((entry) => entry.id === selection);
  const fields = artifact ? constructorFields(artifact, round) : [];
  const inputs = artifact ? constructorInputs(artifact) : [];
  const required = fields.filter((field) => !round || parameterName(field.parameter) === "token" || isDeadline(field.parameter));
  const owner = fields.find((field) => parameterName(field.parameter) === "owner");
  const token = tokens.find((token) => fields.some((field) => parameterName(field.parameter) === "token" && values[field.key]?.toLowerCase() === token.address?.toLowerCase()));
  const minimums = fields.filter((field) => ["minDirectVote", "minSealedVote"].includes(parameterName(field.parameter)));
  function input(field: typeof fields[number]) {
    const minimum = ["minDirectVote", "minSealedVote"].includes(parameterName(field.parameter));
    const label = round && minimum ? `${parameterName(field.parameter) === "minSealedVote" ? "Minimum sponsored sealed vote" : field.label} (${token?.symbol || "USDC"})` : field.label;
    return <ConstructorField key={field.key} field={{ ...field, label }} value={values[field.key] || ""}
      round={round} tokens={tokens} error={errors[field.key]} onChange={(value) => onChange(field.key, value)} />;
  }
  const payable = artifact?.abi.some((item) => item.type === "constructor" && item.stateMutability === "payable");
  return (
    <form className="deployment-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <fieldset disabled={busy} className="stack">
        <section className="deployment-section" aria-labelledby="contract-type-heading">
          <div className="deployment-section-heading"><span className="step-number" aria-hidden="true">01</span><h2 id="contract-type-heading">Choose how voting works</h2></div>
          <Field id="contract-type" label={round ? "Round type" : "Contract type"}>
            <select id="contract-type" className="input" value={selection} onChange={(event) => onSelect(event.target.value)}>
              <optgroup label="RankedShares rounds">{roundContracts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>
              <option value="custom">Custom contract · import a build</option>
            </select>
          </Field>
          {selected && <><p className="deployment-description">{selected.description}</p><p className="hint">{selected.note}</p></>}
          {!round && <div className="stack">
            <p className="deployment-description">Deploy an EVM contract from a compiled build. Its constructor fields appear below.</p>
            <Field id="contract-file" label="Upload compiled artifact" hint="Foundry, Hardhat or solc contract JSON with ABI and creation bytecode.">
              <Input id="contract-file" type="file" accept=".json,application/json" aria-describedby="contract-file-hint"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ""; }} />
            </Field>
            <details className="deployment-import">
              <summary>Or paste ABI and bytecode</summary>
              <div className="stack">
                <Field id="artifact-json" label="Artifact or ABI JSON"><Textarea id="artifact-json" value={artifactText} spellCheck={false} onChange={(event) => onArtifactText(event.target.value)} /></Field>
                <Field id="creation-bytecode" label="Creation bytecode" hint="Required for a standalone ABI. Include library links before importing; use creation bytecode, not deployed runtime bytecode.">
                  <Textarea id="creation-bytecode" value={bytecodeText} spellCheck={false} aria-describedby="creation-bytecode-hint" onChange={(event) => onBytecodeText(event.target.value)} />
                </Field>
                <Button variant="secondary" onClick={onImport}>Load constructor</Button>
              </div>
            </details>
            {artifact && <Notice>Loaded {artifact.contractName || "custom contract"}. {inputs.length} constructor {inputs.length === 1 ? "argument" : "arguments"}.</Notice>}
          </div>}
        </section>
        <section className="deployment-section" aria-labelledby="constructor-heading">
          <div className="deployment-section-heading"><span className="step-number" aria-hidden="true">02</span><h2 id="constructor-heading">{round ? "Set the currency and deadline" : "Fill the constructor"}</h2></div>
          {loading ? <Notice>Loading the contract build…</Notice> : !artifact ? <p className="hint">Import your contract to fill its constructor.</p> : <>
            {required.length === 0 ? <p>This contract has no constructor arguments.</p> : <div className="constructor-fields">
              {required.map(input)}
            </div>}
            {round && <details key={selection} className="deployment-options">
              <summary>Round options <span className="hint">Organizer{minimums.length > 0 ? " and voting minimums" : ""}</span></summary>
              <div className="stack">
                <label className="deployment-organizer-toggle"><input type="checkbox" checked={organizerOverride} onChange={(event) => onOrganizerOverride(event.target.checked)} /> Use a different organizer</label>
                {organizerOverride && owner ? input(owner) : <p className="hint">Your connected wallet will manage proposals and open voting.</p>}
                {minimums.map(input)}
              </div>
            </details>}
            {payable && <Field id="native-value" label={`Send with deployment (${symbol})`} hint="Optional native token payment to the constructor, in addition to gas.">
              <Input id="native-value" value={nativeValue} inputMode="decimal" aria-describedby="native-value-hint" aria-invalid={!!errors.value} onChange={(event) => onNativeValue(event.target.value)} />
              {errors.value && <p className="field-error">{errors.value}</p>}
            </Field>}
          </>}
        </section>
      </fieldset>
      {serviceStatus && <Notice>{serviceStatus}</Notice>}
      <div className="deployment-submit">
        <Button type="submit" disabled={!canSubmit || !artifact || loading || busy}>{submitLabel}</Button>
        <p className="hint">{transactionHint || "Your wallet shows the transaction and gas fee before you confirm."}</p>
      </div>
    </form>
  );
}
