// Prints reference/vectors/noir/poseidon2.json content to stdout.
//
// bb.js@5.2.0's Barretenberg async API takes/returns raw 32-byte big-endian
// Uint8Arrays wrapped in command/response objects (there is no Fr class and
// no top-level poseidon2Hash(inputs) / poseidon2Permutation(inputs) helpers):
//   api.poseidon2Hash({ inputs: Uint8Array[] }) -> Promise<{ hash: Uint8Array }>
//   api.poseidon2Permutation({ inputs: Uint8Array[] }) -> Promise<{ outputs: Uint8Array[] }>
// (see node_modules/@aztec/bb.js/dest/node/cbind/generated/{async,api_types}.d.ts)
import { Barretenberg } from "@aztec/bb.js";

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const mod = (n) => ((n % P) + P) % P;

const toBytes = (n) => {
  const bytes = new Uint8Array(32);
  let v = mod(n);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
};
const toHex = (bytes) => "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");

const api = await Barretenberg.new({ threads: 1 });

const permutationInputs = [
  [0n, 0n, 0n, 0n],
  [0n, 1n, 2n, 3n],
  [P - 1n, P - 2n, 7n, 1n << 200n],
];
const hashInputs = [
  [1n],
  [1n, 2n],
  [1n, 2n, 3n],
  [1n, 2n, 3n, 4n],
  [1n, 2n, 3n, 4n, 5n, 6n, 7n],
  Array.from({ length: 19 }, (_, i) => BigInt(i) * 1234567n),
  [P - 1n, 0n, 1n << 64n, 1n << 128n, 1n << 250n],
];

const out = { permutation: [], hash: [] };
for (const input of permutationInputs) {
  const { outputs } = await api.poseidon2Permutation({ inputs: input.map(toBytes) });
  out.permutation.push({ input: input.map((n) => toHex(toBytes(n))), output: outputs.map(toHex) });
}
for (const input of hashInputs) {
  const { hash } = await api.poseidon2Hash({ inputs: input.map(toBytes) });
  out.hash.push({ input: input.map((n) => toHex(toBytes(n))), output: toHex(hash) });
}
await api.destroy();
console.log(JSON.stringify(out, null, 2));
