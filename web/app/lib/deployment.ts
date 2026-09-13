import {
  type Abi, type AbiParameter, type Address, type Hex,
  encodeDeployData, getAddress, isAddress, parseUnits,
} from "viem";
import { fundingTokens } from "./funding-tokens";
export { ARC_USDC } from "./funding-tokens";

export type ContractArtifact = { abi: Abi; bytecode: Hex; contractName?: string };
export type ConstructorField = {
  key: string;
  parameter: AbiParameter;
  label: string;
  group?: string;
};
export type FieldValues = Record<string, string>;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function checkParameter(value: unknown, depth = 0): asserts value is AbiParameter {
  if (depth > 16 || !object(value) || typeof value.type !== "string" ||
    (value.name !== undefined && typeof value.name !== "string")) {
    throw new Error("The constructor contains an invalid ABI parameter.");
  }
  const base = value.type.replace(/\[[0-9]*\]/g, "");
  if (!/^(address|bool|string|bytes([1-9]|[12][0-9]|3[0-2])?|u?int([0-9]+)?|tuple)$/.test(base) ||
    !new RegExp(`^${base}(\\[[0-9]*\\])*$`).test(value.type)) {
    throw new Error(`Unsupported constructor type: ${value.type}.`);
  }
  if (/^u?int/.test(base)) {
    const bits = Number(base.match(/[0-9]+/)?.[0] || 256);
    if (bits < 8 || bits > 256 || bits % 8) throw new Error(`Invalid integer type: ${base}.`);
  }
  if (base === "tuple") {
    if (!Array.isArray(value.components)) throw new Error("Tuple parameters need ABI components.");
    value.components.forEach((item) => checkParameter(item, depth + 1));
  }
}

/** Accept Foundry, Hardhat, solc contract output, or an ABI with separate creation bytecode. */
export function parseArtifact(input: unknown, bytecodeInput?: string): ContractArtifact {
  const source: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const abi = Array.isArray(source) ? source : object(source) ? source.abi : undefined;
  if (!Array.isArray(abi) || abi.some((item) => !object(item) ||
    !["constructor", "function", "event", "error", "fallback", "receive"].includes(String(item.type)))) {
    throw new Error("Provide a JSON ABI array or a compiled artifact containing an ABI.");
  }
  const constructors = abi.filter((item) => item.type === "constructor");
  if (constructors.length > 1) throw new Error("An ABI can contain only one constructor.");
  for (const ctor of constructors) {
    if (!Array.isArray(ctor.inputs) || !["payable", "nonpayable"].includes(ctor.stateMutability)) {
      throw new Error("The constructor needs inputs and a payable or nonpayable stateMutability.");
    }
    ctor.inputs.forEach((item: unknown) => checkParameter(item));
  }
  const evm = object(source) && object(source.evm) ? source.evm : undefined;
  const raw = bytecodeInput?.trim() || (object(source) ? source.bytecode ?? evm?.bytecode : undefined);
  const candidate = object(raw) ? raw.object : raw;
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error("Add creation bytecode from your compiler. ABI alone cannot deploy a contract.");
  }
  let bytecode = candidate.trim();
  if (bytecode.includes("__")) {
    throw new Error("This bytecode has unlinked libraries. Link their deployed addresses in your compiler, then import it again.");
  }
  if (!bytecode.startsWith("0x")) bytecode = `0x${bytecode}`;
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    throw new Error("Creation bytecode must contain complete hexadecimal bytes.");
  }
  return {
    abi: abi as Abi,
    bytecode: bytecode as Hex,
    contractName: object(source) && typeof source.contractName === "string" ? source.contractName : undefined,
  };
}

export const constructorInputs = (artifact: ContractArtifact): readonly AbiParameter[] =>
  artifact.abi.find((item) => item.type === "constructor")?.inputs ?? [];

const labels: Record<string, string> = {
  token: "Funding token", owner: "Organizer address", votingDeadline: "Voting deadline",
  deadline: "Voting deadline", tallierPk: "Tallier public key", keySalt: "Key salt",
  minDirectVote: "Minimum direct vote", minSealedVote: "Minimum sealed vote",
  abandonGrace: "Abandonment grace", proofGrace: "Proof grace", forwarder: "CRE forwarder",
  workflowOwner: "Workflow owner", workflowName: "Workflow name hash", coordinator: "Coordinator",
  poseidon: "Poseidon contract", ingestVerifier: "Ingest verifier", tallyVerifier: "Tally verifier",
  verifier: "ZisK verifier", programVK: "Program verification key", rootC: "Circuit root",
  tallierPkX: "Tallier public key X", tallierPkY: "Tallier public key Y",
  nSealedMax: "Maximum sealed voters", mMax: "Maximum projects", batch: "Proof batch size",
};
export const parameterName = (p: AbiParameter) => (p.name || "").replace(/_$/, "");
export const isDeadline = (p: AbiParameter) => ["deadline", "votingDeadline"].includes(parameterName(p));

export function constructorFields(artifact: ContractArtifact, round: boolean): ConstructorField[] {
  const fields: ConstructorField[] = [];
  function visit(inputs: readonly AbiParameter[], prefix = "", group?: string) {
    inputs.forEach((parameter, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      const name = parameterName(parameter);
      if (parameter.type === "tuple" && "components" in parameter) {
        visit(parameter.components, key, [group, parameter.name || "Configuration"].filter(Boolean).join(" / "));
      } else {
        const label = (round && labels[name]) || parameter.name || `Argument ${index + 1}`;
        fields.push({ key, parameter, group, label: !round && group ? `${group} / ${label}` : label });
      }
    });
  }
  visit(constructorInputs(artifact));
  return fields;
}

export function initialValues(artifact: ContractArtifact, round: boolean, chainId: number, account?: Address): FieldValues {
  return Object.fromEntries(constructorFields(artifact, round).map(({ key, parameter }) => {
    const name = parameterName(parameter);
    let value = "";
    if (parameter.type === "bool") value = "false";
    if (round) {
      if (name === "token") value = fundingTokens(chainId).find((token) => token.address)?.address || "";
      if (name === "owner" && account) value = account;
      if (name === "abandonGrace") value = "604800";
      if (name === "proofGrace") value = "86400";
      if (name === "minDirectVote" || name === "minSealedVote") value = "0";
    }
    return [key, value];
  }));
}

/** Never pass user integers through Number: uint256 values must retain every digit. */
export function parseArgument(parameter: AbiParameter, value: unknown): unknown {
  const array = /^(.*)\[([0-9]*)\]$/.exec(parameter.type);
  if (array) {
    if (!Array.isArray(value)) throw new Error("Enter a JSON array.");
    if (array[2] && value.length !== Number(array[2])) throw new Error(`Expected ${array[2]} array items.`);
    return value.map((item) => parseArgument({ ...parameter, type: array[1] } as AbiParameter, item));
  }
  if (parameter.type === "tuple" && "components" in parameter) {
    if (!Array.isArray(value) && !object(value)) throw new Error("Enter a JSON array or object for the tuple.");
    if (Array.isArray(value) && value.length !== parameter.components.length) throw new Error("The tuple has the wrong number of values.");
    return parameter.components.map((part, index) => parseArgument(part,
      Array.isArray(value) ? value[index] : value[part.name ?? String(index)]));
  }
  if (parameter.type === "bool") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new Error("Choose true or false.");
  }
  if (parameter.type === "string") {
    if (typeof value !== "string") throw new Error("Enter a string.");
    return value;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("Wrap large integers in quotes in JSON to preserve every digit.");
  }
  const text = String(value ?? "").trim();
  if (parameter.type === "address") {
    if (!isAddress(text)) throw new Error("Enter a valid 0x wallet or contract address.");
    return getAddress(text);
  }
  if (/^u?int/.test(parameter.type)) {
    if (!/^-?\d+$/.test(text)) throw new Error("Enter a whole number in base units.");
    const n = BigInt(text);
    const signed = parameter.type.startsWith("int");
    const bits = BigInt(parameter.type.match(/\d+/)?.[0] || 256);
    const min = signed ? -(1n << (bits - 1n)) : 0n;
    const max = (1n << (signed ? bits - 1n : bits)) - 1n;
    if (n < min || n > max) throw new Error(`Value is outside the ${parameter.type} range.`);
    return n;
  }
  if (/^bytes/.test(parameter.type)) {
    if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(text)) throw new Error("Enter hexadecimal bytes starting with 0x.");
    const size = Number(parameter.type.slice(5));
    if (size && text.length !== 2 + size * 2) throw new Error(`Enter exactly ${size} bytes (${size * 2} hex characters).`);
    return text;
  }
  throw new Error(`Unsupported constructor type: ${parameter.type}.`);
}

export function prepareDeployment(artifact: ContractArtifact, values: FieldValues, round: boolean, nativeValue: string, chainId = 5042002) {
  const errors: Record<string, string> = {};
  const parsed: Record<string, unknown> = {};
  for (const field of constructorFields(artifact, round)) {
    try {
      let raw: unknown = values[field.key] ?? "";
      if (round && ["minDirectVote", "minSealedVote"].includes(parameterName(field.parameter))) {
        const amount = String(raw).trim() || "0";
        if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new Error("Enter a non-negative amount with at most 6 decimals.");
        raw = parseUnits(amount, 6).toString();
        if (BigInt(String(raw)) > (1n << 64n) - 1n) throw new Error("This amount exceeds the round’s supported voting weight.");
      }
      if (round && isDeadline(field.parameter)) {
        const timestamp = new Date(String(raw)).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error("Choose a voting deadline in the future.");
        raw = String(Math.floor(timestamp / 1000));
      } else if (field.parameter.type.includes("[")) {
        raw = JSON.parse(String(raw));
      }
      parsed[field.key] = parseArgument(field.parameter, raw);
      if (round && parameterName(field.parameter) === "token" &&
        !fundingTokens(chainId).some((token) => token.address?.toLowerCase() === String(parsed[field.key]).toLowerCase())) {
        throw new Error("Choose USDC or EURC configured for this network.");
      }
      if (round && ["token", "owner"].includes(parameterName(field.parameter)) &&
        parsed[field.key] === "0x0000000000000000000000000000000000000000") throw new Error("Use a non-zero address.");
    } catch (error) {
      errors[field.key] = error instanceof SyntaxError ? "Enter valid JSON. Put large integers in quotes." : (error as Error).message;
    }
  }
  function collect(inputs: readonly AbiParameter[], prefix = ""): unknown[] {
    return inputs.map((parameter, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      return parameter.type === "tuple" && "components" in parameter ? collect(parameter.components, key) : parsed[key];
    });
  }
  let value = 0n;
  try {
    const amount = nativeValue.trim() || "0";
    if (!/^\d+(\.\d{1,18})?$/.test(amount)) throw new Error("Enter a non-negative amount with at most 18 decimals.");
    value = parseUnits(amount, 18);
    if (value && !artifact.abi.some((item) => item.type === "constructor" && item.stateMutability === "payable")) {
      throw new Error("This constructor does not accept a native token payment.");
    }
  } catch (error) { errors.value = (error as Error).message; }
  if (Object.keys(errors).length) return { errors };
  const args = collect(constructorInputs(artifact));
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  return { errors, args, data, value };
}
