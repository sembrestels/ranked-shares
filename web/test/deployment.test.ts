import { expect, test } from "vitest";
import { decodeAbiParameters, parseAbi } from "viem";
import { ARC_USDC, constructorFields, initialValues, parseArgument, parseArtifact, prepareDeployment } from "../app/lib/deployment";
import { loadRoundArtifact, roundContracts } from "../app/lib/deployment-catalog";
import { ARC_EURC, fundingTokens } from "../app/lib/funding-tokens";
import { buildIdentity, organizerFields, parseProvision, resolveRoundValues, workflowNameHash } from "../app/lib/round-configuration";

test("all round constructors restrict funding to USDC and EURC on the configured network", async () => {
  expect(fundingTokens(5042002).map((token) => token.symbol)).toEqual(["USDC", "EURC"]);
  for (const entry of roundContracts) {
    const artifact = await loadRoundArtifact(entry.id);
    const field = constructorFields(artifact, true).find((field) => field.label === "Funding token")!;
    const values = initialValues(artifact, true, 5042002);
    for (const address of [ARC_USDC, ARC_EURC]) {
      values[field.key] = address;
      expect(prepareDeployment(artifact, values, true, "0", 5042002).errors[field.key]).toBeUndefined();
    }
    values[field.key] = "0x1111111111111111111111111111111111111111";
    expect(prepareDeployment(artifact, values, true, "0", 5042002).errors[field.key]).toMatch(/USDC or EURC/);
  }
  expect(fundingTokens(999999).every((token) => !token.address)).toBe(true);
});

test("all five shipped round builds expose their actual constructors and deployable bytecode", async () => {
  for (const entry of roundContracts) {
    const artifact = await loadRoundArtifact(entry.id);
    const fields = constructorFields(artifact, true);
    expect(artifact.contractName).toBe(entry.id);
    expect(fields.find((field) => field.label === "Funding token")).toBeTruthy();
    expect(fields.find((field) => field.label === "Voting deadline")).toBeTruthy();
    expect(artifact.bytecode.length).toBeGreaterThan(100);
  }
});

test("round defaults and datetime conversion preserve token and organizer addresses", async () => {
  const artifact = await loadRoundArtifact("RankedShares");
  const values = initialValues(artifact, true, 5042002, ARC_USDC);
  expect(values["0"]).toBe(ARC_USDC);
  expect(values["1"]).toBe(ARC_USDC);
  values["2"] = "2099-06-01T12:30";
  const result = prepareDeployment(artifact, values, true, "0");
  expect(result.errors).toEqual({});
  expect(result.args).toEqual([ARC_USDC, ARC_USDC, BigInt(new Date(values["2"]).getTime() / 1000)]);
  values["2"] = "2000-01-01T12:00";
  expect(prepareDeployment(artifact, values, true, "0").errors["2"]).toMatch(/future/);
});

test("generic nested tuples, arrays and uint256 keep exact constructor calldata", () => {
  const abi = parseAbi(["constructor((address owner, uint256[] amounts)[] allocations, int8 offset, bool enabled, bytes4 tag, string title) payable"]);
  const artifact = parseArtifact(abi, "60006000");
  const max = (2n ** 256n - 1n).toString();
  const result = prepareDeployment(artifact, {
    "0": JSON.stringify([{ owner: ARC_USDC, amounts: [max, "7"] }]),
    "1": "-128", "2": "true", "3": "0x12345678", "4": "A round",
  }, false, "1.000000000000000001");
  expect(result.errors).toEqual({});
  expect(result.value).toBe(1000000000000000001n);
  const encodedArgs = `0x${result.data!.slice(artifact.bytecode.length)}` as `0x${string}`;
  const decoded = decodeAbiParameters(abi[0].inputs, encodedArgs);
  expect(decoded[0][0].amounts[0]).toBe(2n ** 256n - 1n);
  expect(decoded[1]).toBe(-128);
  expect(decoded[2]).toBe(true);
});

test("invalid ranges, precision loss, fixed byte lengths and array lengths are rejected", () => {
  expect(() => parseArgument({ type: "uint8" }, "256")).toThrow(/range/);
  expect(() => parseArgument({ type: "uint256" }, "-1")).toThrow(/range/);
  expect(() => parseArgument({ type: "int8" }, "-129")).toThrow(/range/);
  expect(() => parseArgument({ type: "uint256" }, 9007199254740992)).toThrow(/quotes/);
  expect(() => parseArgument({ type: "bytes32" }, "0x12")).toThrow(/exactly 32/);
  expect(() => parseArgument({ type: "bool" }, "yes")).toThrow(/true or false/);
  expect(() => parseArgument({ type: "uint256[2]" }, ["1"])).toThrow(/2 array items/);
  expect(() => parseArgument({ type: "address" }, "0x123")).toThrow(/address/);
});

test("compiled artifact formats accept creation bytecode and reject runtime-only or unlinked builds", () => {
  expect(parseArtifact({ abi: [], bytecode: { object: "0x6000" } }).bytecode).toBe("0x6000");
  expect(parseArtifact({ abi: [], evm: { bytecode: { object: "6000" } } }).bytecode).toBe("0x6000");
  expect(() => parseArtifact({ abi: [], deployedBytecode: "0x6000" })).toThrow(/creation bytecode/);
  expect(() => parseArtifact({ abi: [], bytecode: "0x__$aabb$__" })).toThrow(/unlinked/);
  expect(() => parseArtifact({ abi: [], bytecode: "0x123" })).toThrow(/complete hexadecimal/);
  expect(() => parseArtifact({ abi: [{ type: "constructor", inputs: [{ type: "tuple" }], stateMutability: "nonpayable" }], bytecode: "0x6000" })).toThrow(/components/);
});

test("nonpayable constructors reject value and empty constructors encode without arguments", () => {
  const artifact = parseArtifact({ abi: [], bytecode: "0x6000" });
  expect(prepareDeployment(artifact, {}, false, "0").data).toBe("0x6000");
  expect(prepareDeployment(artifact, {}, false, "1").errors.value).toMatch(/does not accept/);
  expect(prepareDeployment(artifact, {}, false, "0.0000000000000000001").errors.value).toMatch(/18 decimals/);
});

test("round amount inputs use six decimal currency units without changing arbitrary constructors", () => {
  const artifact = parseArtifact(parseAbi(["constructor(uint64 minDirectVote, uint64 minSealedVote)"]), "6000");
  expect(prepareDeployment(artifact, { "0": "1.25", "1": "0.000001" }, true, "0").args).toEqual([1250000n, 1n]);
  expect(prepareDeployment(artifact, { "0": "", "1": "" }, true, "0").args).toEqual([0n, 0n]);
  expect(prepareDeployment(artifact, { "0": "1.0000001", "1": "0" }, true, "0").errors["0"]).toMatch(/6 decimals/);
  expect(prepareDeployment(artifact, { "0": "18446744073709.551616", "1": "0" }, true, "0").errors["0"]).toMatch(/supported voting weight/);
  expect(prepareDeployment(artifact, { "0": "1250000", "1": "1" }, false, "0").args).toEqual([1250000n, 1n]);
});

test("organizer-supplied values cannot override hidden round configuration", async () => {
  const artifact = await loadRoundArtifact("NoirRankedShares");
  const user = Object.fromEntries(constructorFields(artifact, true).map((field) => [field.key, "user input"]));
  const automatic = Object.fromEntries(constructorFields(artifact, true).map((field) => [field.parameter.name!.replace(/_$/, ""), "configured value"]));
  const resolved = resolveRoundValues(artifact, user, automatic);
  for (const field of constructorFields(artifact, true)) {
    expect(resolved[field.key]).toBe(organizerFields.has(field.parameter.name!.replace(/_$/, "")) ? "user input" : "configured value");
  }
});

test("workflow name uses ASCII of the first ten SHA-256 hex characters", () => {
  // SHA-256('abc') starts ba7816bf8f; this is ten ASCII bytes, not ten raw hash bytes.
  expect(workflowNameHash("abc")).toBe("0x62613738313662663866");
});

test("provisioning rejects wrong builds, zero identities and keys that are not on the curve", async () => {
  const artifact = await loadRoundArtifact("NoirRankedShares");
  const identity = await buildIdentity(5042002, "NoirRankedShares", artifact);
  const payload = { ...identity, id: "test", monitoring: "reserved", coordinator: ARC_USDC,
    key: { x: "1", y: BigInt("0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c").toString(), salt: `0x${"12".repeat(32)}` },
    workflow: { forwarder: ARC_USDC, owner: ARC_EURC, name: "abc" } };
  expect(parseProvision(payload, "test", identity).fields.workflowName).toBe("0x62613738313662663866");
  expect(() => parseProvision({ ...payload, chainId: 1 }, "test", identity)).toThrow(/does not support/);
  expect(() => parseProvision({ ...payload, profileId: `0x${"00".repeat(32)}` }, "test", identity)).toThrow(/does not support/);
  expect(() => parseProvision({ ...payload, key: { ...payload.key, y: "1" } }, "test", identity)).toThrow(/Noir public key/);
  expect(() => parseProvision({ ...payload, workflow: { ...payload.workflow, owner: `0x${"00".repeat(20)}` } }, "test", identity)).toThrow(/identity/);
  expect(() => parseProvision({ ...payload, monitoring: "missing" }, "test", identity)).toThrow(/monitoring/);
});
