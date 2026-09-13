import type { ConstructorField as FieldDefinition } from "../../lib/deployment";
import { isDeadline, parameterName } from "../../lib/deployment";
import type { FundingToken } from "../../lib/funding-tokens";
import { Field, Input, Textarea } from "../ui";

const hints: Record<string, string> = {
  token: "Choose the currency used to fund projects: USDC or EURC.",
  owner: "This wallet manages proposals and opens voting. It can differ from the deploying wallet.",
  tallierPk: "Compressed 33-byte public key, starting with 0x02 or 0x03. Use the key from your tallier.",
  keySalt: "32-byte salt shared with your tallier configuration.",
  workflowName: "The derived bytes10 workflow name hash from your CRE configuration.",
  abandonGrace: "Seconds after the deadline before an unfinished round can be abandoned.",
  proofGrace: "Seconds allowed for the proof. Must be shorter than the abandonment grace.",
  minDirectVote: "Minimum weight for a direct vote. 0 adds no extra minimum; positive eligible weight is still required.",
  minSealedVote: "Minimum sponsored-seat weight for a sealed vote. 0 adds no extra minimum.",
};

export function ConstructorField({ field, value, error, round, tokens, onChange }: {
  field: FieldDefinition; value: string; error?: string; round: boolean;
  tokens: readonly FundingToken[];
  onChange: (value: string) => void;
}) {
  const { parameter, key, label } = field;
  const id = `constructor-${key.replaceAll(".", "-")}`;
  const array = parameter.type.includes("[");
  const deadline = round && isDeadline(parameter);
  const fundingToken = round && parameterName(parameter) === "token";
  const amount = round && ["minDirectVote", "minSealedVote"].includes(parameterName(parameter));
  const hint = fundingToken && !tokens.some((token) => token.address) ? "USDC and EURC are not configured on this network."
    : deadline ? "Your local time. Voting closes at this time; deployment starts the setup phase."
    : array ? "JSON array. Wrap large integers in quotes, for example [\"1000000\", \"2000000\"]."
    : (round && hints[parameterName(parameter)]) || `${parameter.name || "argument"}: ${parameter.type}`;
  const common = { id, "aria-describedby": `${id}-hint${error ? ` ${id}-error` : ""}`, "aria-invalid": !!error };
  return (
    <Field id={id} label={label} hint={hint}>
      {fundingToken ? (
        <select {...common} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          {!value && <option value="" disabled>Choose a funding token</option>}
          {tokens.map((token) => <option key={token.symbol} value={token.address || token.symbol} disabled={!token.address}>{token.symbol}</option>)}
        </select>
      ) : parameter.type === "bool" ? (
        <select {...common} className="input" value={value || "false"} onChange={(event) => onChange(event.target.value)}>
          <option value="false">False</option><option value="true">True</option>
        </select>
      ) : array ? (
        <Textarea {...common} value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...common} type={deadline ? "datetime-local" : "text"} value={value}
          inputMode={amount ? "decimal" : /^uint/.test(parameter.type) && !deadline ? "numeric" : undefined}
          placeholder={parameter.type === "address" || parameter.type.startsWith("bytes") ? "0x…" : undefined}
          spellCheck={false} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      )}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </Field>
  );
}
