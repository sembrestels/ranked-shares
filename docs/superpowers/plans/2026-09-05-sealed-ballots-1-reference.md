# Sealed ballots, plan 1 of 4: Python reference for the Noir design

> **Historical.** The Noir variant's paths and its contract name were moved and renamed
> on 2026-09-05: `SealedRankedShares` is now `NoirRankedShares`, its Solidity lives under
> `src/noir/` and `test/noir/`, its Python under `reference/noir/` and its vectors under
> `reference/vectors/noir/`. Paths below are as they were when the plan was written; see
> the README's Layout section for the current ones.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `reference/` so that every hash, curve operation, ciphertext, commitment, transcript and circuit state of the sealed-ballot design has one executable Python definition plus checked-in vectors that the Solidity, Noir and TypeScript ports will be tested against.

**Architecture:** `reference/` stays dependency-free Python (stdlib only), one module per primitive: keccak-256, Poseidon2 (BN254, t = 4), Grumpkin, sealed-ballot encryption, PB-EAR in transcript mode, and the commitments (chains, roots, state hash). A one-off Node tool pulls Poseidon2 vectors out of Barretenberg's own bb.js so the Python Poseidon2 is proven equal to the one Noir uses. A fixture generator writes two JSON fixtures (a tiny test profile and the default profile) that the later plans consume.

**Tech Stack:** Python 3.14 (`unittest`), Node 24 with `@aztec/bb.js@5.2.0` for vector extraction only, `curl` for fetching Barretenberg's parameter header.

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (sections B2, B4, B6.1, B6.3, B7). Read the spec first; the plan argues from it.

**Roadmap (the other three plans, written when this one is done):**
- Plan 2, contracts: `PoolBase` extraction, `Poseidon2.sol`, `Grumpkin.sol`, `SealedRankedShares` (B1, B2, B4, B6), mock verifiers, deploy scripts. Tests read the fixtures this plan produces.
- Plan 3, circuits: `noir/` libraries and the `ingest` / `tally` circuits (B7), verifier generation, fork test. Spike B12.1 is its first task.
- Plan 4, TypeScript: `cre/src/sealed.ts`, `pbear.ts` transcript mode, the CRE workflow (B9), the browser prover and `audit` (B8).

## Global Constraints

- Python in `reference/` uses the standard library only. No pip packages.
- BN254 scalar field modulus `P = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. This is the field of Noir `Field` values and the base field of Grumpkin.
- Grumpkin: `y² = x³ − 17` over `P`; group order `Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583`; generator `G = (1, 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c)`.
- Poseidon2 BN254: `t = 4`, `RATE = 3`, S-box `x⁵`, 8 full rounds (4 + 4), 56 partial rounds; sponge capacity element initialised to `len << 64`; output is state element 0 after a final permutation. Constants come from Barretenberg's `Poseidon2Bn254ScalarFieldParams` (`round_constants`, `internal_matrix_diagonal_minus_one`).
- `DOMAIN` for the ballot mask is the ASCII bytes `RankedShares/sealed/v2` read as a big-endian integer.
- `NONE = 2**64 − 1` marks a transcript step that funded nothing.
- Tally entry order: the public block (addresses with a direct ballot, registration order) followed by the sealed block (addresses with a ciphertext, registration order).
- Weights, costs, budgets and `total` fit in 64 bits.
- Profiles: `default` = `N_SEALED_MAX 256, M_MAX 16, B 32, K 8`; `test` = `N_SEALED_MAX 8, M_MAX 4, B 2, K 2`.
- Existing behaviour of `reference/pbear.py`'s CLI (positional JSON argument, ABI-encoded output) must not change: `test/PBEARDifferential.t.sol` depends on it.
- Run the whole suite with `python3 -m unittest discover reference` before every commit. Commit messages have no attribution lines.

---

### Task 1: Keccak-256 in pure Python

**Files:**
- Create: `reference/keccak.py`
- Test: `reference/test_keccak.py`

**Interfaces:**
- Produces: `keccak256(data: bytes) -> bytes` (32 bytes).

- [ ] **Step 1: Write the failing test**

```python
# reference/test_keccak.py
import unittest

from keccak import keccak256


class KeccakTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(
            keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        )

    def test_abc(self):
        self.assertEqual(
            keccak256(b"abc").hex(),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
        )

    def test_block_boundaries(self):
        # 135, 136 and 137 bytes exercise the three padding cases of the 136-byte rate:
        # the 0x81 single pad byte, a full extra block, and a partial extra block.
        digests = {n: keccak256(b"a" * n) for n in (135, 136, 137, 300)}
        for out in digests.values():
            self.assertEqual(len(out), 32)
        self.assertEqual(len(set(digests.values())), 4)

    def test_solidity_packed_shape(self):
        # keccak256(abi.encodePacked(bytes32(0), address(0xAA), uint256(5))) computed with
        # `cast keccak` equals hashing the raw 84 bytes.
        data = b"\x00" * 32 + (0xAA).to_bytes(20, "big") + (5).to_bytes(32, "big")
        self.assertEqual(len(data), 84)
        self.assertEqual(len(keccak256(data)), 32)


if __name__ == "__main__":
    unittest.main()
```

Before committing, pin one more digest by hand: run `cast keccak 0x$(python3 -c "print('00'*32 + 'aa'.rjust(40,'0') + '05'.rjust(64,'0'))")` and add its output as an `assertEqual` on `keccak256(data).hex()` in `test_solidity_packed_shape`. This ties the Python keccak to the exact byte layout `public_chain` will use later.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd reference && python3 -m unittest test_keccak -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'keccak'`

- [ ] **Step 3: Implement keccak-256**

```python
# reference/keccak.py
"""Keccak-256 (the Ethereum variant: pad10*1 with 0x01, not SHA3's 0x06)."""

_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]
_MASK = (1 << 64) - 1
_RATE = 136


def _rol(x, n):
    n %= 64
    return ((x << n) | (x >> (64 - n))) & _MASK if n else x


def keccak_f(a):
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        a = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        a[0][0] ^= rc
    return a


def keccak256(data: bytes) -> bytes:
    padded = bytearray(data) + b"\x01"
    while len(padded) % _RATE:
        padded += b"\x00"
    padded[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(padded), _RATE):
        block = padded[off : off + _RATE]
        for i in range(_RATE // 8):
            a[i % 5][i // 5] ^= int.from_bytes(block[8 * i : 8 * i + 8], "little")
        a = keccak_f(a)
    return b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd reference && python3 -m unittest test_keccak -v`
Expected: 3 tests, OK

- [ ] **Step 5: Commit**

```bash
git add reference/keccak.py reference/test_keccak.py
git commit -m "Add pure-Python keccak-256 to the reference"
```

---

### Task 2: Poseidon2 (BN254, t = 4) with vectors from bb.js

**Files:**
- Create: `reference/tools/extract_poseidon2_params.py`
- Create: `reference/poseidon2_params.py` (generated, committed)
- Create: `reference/tools/poseidon2_vectors.mjs`, `reference/tools/package.json`
- Create: `reference/vectors/poseidon2.json` (generated, committed)
- Create: `reference/poseidon2.py`
- Test: `reference/test_poseidon2.py`

**Interfaces:**
- Produces: `poseidon2.P: int`, `poseidon2.permutation(state: list[int]) -> list[int]` (4 elements), `poseidon2.hash(inputs: list[int]) -> int`.
- Produces: `reference/vectors/poseidon2.json` with shape `{"permutation": [{"input": [hex×4], "output": [hex×4]}], "hash": [{"input": [hex…], "output": hex}]}`; hex strings are `0x`-prefixed, 64 hex digits.

- [ ] **Step 1: Extract the parameters from Barretenberg**

```python
# reference/tools/extract_poseidon2_params.py
"""Fetch Barretenberg's Poseidon2 BN254 parameters and write poseidon2_params.py.

Usage: python3 reference/tools/extract_poseidon2_params.py [path-to-header]
Without a path the header is downloaded from aztec-packages master.
"""

import hashlib
import re
import sys
import urllib.request

URL = (
    "https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/"
    "barretenberg/cpp/src/barretenberg/crypto/poseidon2/poseidon2_params.hpp"
)
HEX = re.compile(r"0x[0-9a-fA-F]{1,64}")


def hex_after(text, name, count):
    start = text.index(name)
    values = [int(h, 16) for h in HEX.findall(text[start:])[:count]]
    if len(values) != count:
        raise SystemExit(f"expected {count} constants after {name}, found {len(values)}")
    return values


def main(argv):
    if len(argv) > 1:
        raw = open(argv[1], "rb").read()
    else:
        raw = urllib.request.urlopen(URL).read()
    text = raw.decode()
    struct = text[text.index("Poseidon2Bn254ScalarFieldParams") :]
    diag = hex_after(struct, "internal_matrix_diagonal_minus_one", 4)
    rc = hex_after(struct, "round_constants", 64 * 4)
    rounds = [rc[i * 4 : (i + 1) * 4] for i in range(64)]
    with open("reference/poseidon2_params.py", "w") as f:
        f.write('"""Generated by tools/extract_poseidon2_params.py; do not edit.\n\n')
        f.write(f"Source: {URL}\nsha256 of the header: {hashlib.sha256(raw).hexdigest()}\n")
        f.write('"""\n\n')
        f.write("INTERNAL_DIAG = [\n" + "".join(f"    {v:#x},\n" for v in diag) + "]\n\n")
        f.write("ROUND_CONSTANTS = [\n")
        for row in rounds:
            f.write("    [" + ", ".join(f"{v:#x}" for v in row) + "],\n")
        f.write("]\n")


if __name__ == "__main__":
    main(sys.argv)
```

Run: `python3 reference/tools/extract_poseidon2_params.py`
Expected: `reference/poseidon2_params.py` exists; `python3 -c "import sys; sys.path.insert(0,'reference'); import poseidon2_params as p; print(len(p.ROUND_CONSTANTS), hex(p.ROUND_CONSTANTS[0][0]), hex(p.INTERNAL_DIAG[0]))"` prints `64 0x19b849f69450b06848da1d39bd5e4a4302bb86744edc26238b0878e269ed23e5 0x10dc6e9c006ea38b04b1e03b4bd9490c0d03f98929ca1d7fb56821fd19d3b6e7`.

If the first round constant or the first diagonal value differ from those, the header layout changed: open the header, find `Poseidon2Bn254ScalarFieldParams`, and adjust the two `hex_after` calls so they read the arrays with those names. The last round constant is `0x176563472456aaa746b694c60e1823611ef39039b2edc7ff391e6f2293d2c404`.

- [ ] **Step 2: Generate vectors with bb.js**

```json
// reference/tools/package.json
{
  "name": "reference-tools",
  "private": true,
  "type": "module",
  "dependencies": { "@aztec/bb.js": "5.2.0" }
}
```

```javascript
// reference/tools/poseidon2_vectors.mjs
// Prints reference/vectors/poseidon2.json content to stdout.
import { Barretenberg, Fr } from "@aztec/bb.js";

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const hex = (fr) => "0x" + fr.toString().replace(/^0x/, "").padStart(64, "0");
const fr = (n) => new Fr(((n % P) + P) % P);

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
  const output = await api.poseidon2Permutation(input.map(fr));
  out.permutation.push({ input: input.map((n) => hex(fr(n))), output: output.map(hex) });
}
for (const input of hashInputs) {
  const output = await api.poseidon2Hash(input.map(fr));
  out.hash.push({ input: input.map((n) => hex(fr(n))), output: hex(output) });
}
await api.destroy();
console.log(JSON.stringify(out, null, 2));
```

Run:

```bash
cd reference/tools && npm install && cd ../..
mkdir -p reference/vectors
node reference/tools/poseidon2_vectors.mjs > reference/vectors/poseidon2.json
```

Expected: the JSON has 3 permutation and 7 hash entries. If `poseidon2Permutation` or `poseidon2Hash` is not a method, run `grep -n "poseidon2" reference/tools/node_modules/@aztec/bb.js/dest/node/index.d.ts` and use the exported names it shows (they take `Fr[]` and return `Promise<Fr[]>` / `Promise<Fr>`). Add `reference/tools/node_modules/` and `reference/tools/package-lock.json` to `.gitignore`.

- [ ] **Step 3: Write the failing test**

```python
# reference/test_poseidon2.py
import json
import os
import unittest

from poseidon2 import P, hash, permutation

VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "poseidon2.json")


class Poseidon2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(VECTORS) as f:
            cls.vectors = json.load(f)

    def test_permutation_matches_bbjs(self):
        for case in self.vectors["permutation"]:
            state = [int(x, 16) for x in case["input"]]
            expected = [int(x, 16) for x in case["output"]]
            self.assertEqual(permutation(state), expected)

    def test_hash_matches_bbjs(self):
        for case in self.vectors["hash"]:
            inputs = [int(x, 16) for x in case["input"]]
            self.assertEqual(hash(inputs), int(case["output"], 16))

    def test_hash_depends_on_length(self):
        # The capacity element carries the length, so [1, 0] and [1] differ.
        self.assertNotEqual(hash([1]), hash([1, 0]))

    def test_outputs_are_reduced(self):
        self.assertLess(hash([P - 1, P - 1, P - 1, P - 1]), P)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd reference && python3 -m unittest test_poseidon2 -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'poseidon2'`

- [ ] **Step 5: Implement Poseidon2**

```python
# reference/poseidon2.py
"""Poseidon2 over the BN254 scalar field, t = 4, as Barretenberg and Noir compute it.

Permutation: an initial external linear layer, 4 full rounds, 56 partial rounds,
4 full rounds. A full round adds the round constants to every element, applies x^5
to every element and the external matrix M4. A partial round adds the round
constant to element 0 only, applies x^5 to element 0 only and the internal matrix.

Sponge (Noir's Poseidon2Hasher and bb's poseidon2::hash): state = [0, 0, 0, len << 64];
absorb inputs three at a time with a permutation after each full block; the last
partial block is added without a permutation; then one final permutation; output
element 0.
"""

from poseidon2_params import INTERNAL_DIAG, ROUND_CONSTANTS

P = 21888242871839275222246405745257275088548364400416034343698204186575808495617
T = 4
RATE = 3
ROUNDS_F = 8
ROUNDS_P = 56


def _sbox(x):
    return pow(x, 5, P)


def _external(s):
    # Poseidon2's M4, in the additions-only form of the reference implementation.
    t0 = s[0] + s[1]
    t1 = s[2] + s[3]
    t2 = 2 * s[1] + t1
    t3 = 2 * s[3] + t0
    t4 = 4 * t1 + t3
    t5 = 4 * t0 + t2
    t6 = t3 + t5
    t7 = t2 + t4
    return [t6 % P, t5 % P, t7 % P, t4 % P]


def _internal(s):
    total = sum(s) % P
    return [(s[i] * INTERNAL_DIAG[i] + total) % P for i in range(T)]


def permutation(state):
    if len(state) != T:
        raise ValueError("state must have 4 elements")
    s = _external([x % P for x in state])
    half = ROUNDS_F // 2
    for r in range(half):
        s = _external([_sbox((s[i] + ROUND_CONSTANTS[r][i]) % P) for i in range(T)])
    for r in range(half, half + ROUNDS_P):
        s[0] = _sbox((s[0] + ROUND_CONSTANTS[r][0]) % P)
        s = _internal(s)
    for r in range(half + ROUNDS_P, ROUNDS_F + ROUNDS_P):
        s = _external([_sbox((s[i] + ROUND_CONSTANTS[r][i]) % P) for i in range(T)])
    return s


def hash(inputs):
    inputs = [x % P for x in inputs]
    n = len(inputs)
    state = [0, 0, 0, (n << 64) % P]
    for i in range(n // RATE):
        for j in range(RATE):
            state[j] = (state[j] + inputs[i * RATE + j]) % P
        state = permutation(state)
    absorbed = (n // RATE) * RATE
    for i in range(n % RATE):
        state[i] = (state[i] + inputs[absorbed + i]) % P
    return permutation(state)[0]
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd reference && python3 -m unittest test_poseidon2 -v`
Expected: 4 tests, OK.

If `test_permutation_matches_bbjs` fails but the constants were verified in Step 1, the round structure differs from Barretenberg's. Open `barretenberg/cpp/src/barretenberg/crypto/poseidon2/poseidon2_permutation.hpp` in aztec-packages and compare `permutation()`, `matrix_multiplication_external()` and `matrix_multiplication_internal()` line by line with the three functions above; the vectors are the authority.

- [ ] **Step 7: Commit**

```bash
git add reference/poseidon2.py reference/poseidon2_params.py reference/test_poseidon2.py \
        reference/tools/extract_poseidon2_params.py reference/tools/poseidon2_vectors.mjs \
        reference/tools/package.json reference/vectors/poseidon2.json .gitignore
git commit -m "Add Poseidon2 reference with vectors from bb.js"
```

---

### Task 3: Grumpkin and sealed-ballot encryption

**Files:**
- Create: `reference/grumpkin.py`
- Create: `reference/sealed.py`
- Create: `reference/vectors/sealed.json` (generated by the test module's `--write` mode, committed)
- Test: `reference/test_sealed.py`

**Interfaces:**
- Produces: `grumpkin.P, grumpkin.Q, grumpkin.G, grumpkin.is_on_curve(pt), grumpkin.add(p1, p2), grumpkin.mul(k, pt)`; points are `(x, y)` tuples, infinity is `None`.
- Produces: `sealed.DOMAIN`, `sealed.pack(ranks: list[int]) -> int`, `sealed.unpack(packed: int, m: int) -> list[int] | None`, `sealed.derive_sk(master: bytes, key_salt: bytes) -> int`, `sealed.pubkey(sk) -> (x, y)`, `sealed.mask(shared: (x, y), voter: int) -> int`, `sealed.encrypt(pk, voter: int, ranks, k: int) -> (rx, ry, c)`, `sealed.decrypt(sk, voter: int, ct: (rx, ry, c), m: int) -> list[int] | None`.
- Produces: `reference/vectors/sealed.json` (shape in Step 3).

- [ ] **Step 1: Write the failing tests**

```python
# reference/test_sealed.py
import json
import os
import sys
import unittest

import grumpkin
import sealed
from keccak import keccak256

VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "sealed.json")
MASTER = keccak256(b"test master secret")
SALT = keccak256(b"test key salt")


def det_k(label):
    return int.from_bytes(keccak256(b"k:" + label), "big") % grumpkin.Q


class GrumpkinTest(unittest.TestCase):
    def test_generator_on_curve(self):
        self.assertTrue(grumpkin.is_on_curve(grumpkin.G))
        self.assertEqual(grumpkin.G[0], 1)
        self.assertEqual(grumpkin.G[1], 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C)

    def test_order(self):
        self.assertIsNone(grumpkin.mul(grumpkin.Q, grumpkin.G))
        self.assertEqual(grumpkin.mul(grumpkin.Q + 1, grumpkin.G), grumpkin.G)

    def test_add_double_consistency(self):
        two_g = grumpkin.add(grumpkin.G, grumpkin.G)
        self.assertEqual(two_g, grumpkin.mul(2, grumpkin.G))
        three_g = grumpkin.add(two_g, grumpkin.G)
        self.assertEqual(three_g, grumpkin.mul(3, grumpkin.G))
        self.assertTrue(grumpkin.is_on_curve(three_g))

    def test_scalar_mul_is_bilinear(self):
        a, b = 123456789, 987654321
        lhs = grumpkin.mul(a, grumpkin.mul(b, grumpkin.G))
        rhs = grumpkin.mul((a * b) % grumpkin.Q, grumpkin.G)
        self.assertEqual(lhs, rhs)


class PackingTest(unittest.TestCase):
    def test_pack_unpack_round_trip(self):
        self.assertEqual(sealed.unpack(sealed.pack([1, 2, 2, 4]), 4), [1, 2, 2, 4])
        self.assertEqual(sealed.unpack(sealed.pack([0, 0, 0]), 3), [0, 0, 0])
        self.assertEqual(sealed.pack([1, 2]), 1 + (2 << 8))

    def test_unpack_rejects_invalid(self):
        self.assertIsNone(sealed.unpack(1 << 32, 4))          # too wide for m = 4
        self.assertIsNone(sealed.unpack(sealed.pack([5, 0, 0, 0]), 4))  # rank > m
        self.assertIsNone(sealed.unpack(sealed.pack([1, 3, 3, 0]), 4))  # gap in ranking


class SealedTest(unittest.TestCase):
    def setUp(self):
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)
        self.voter = 0x1111111111111111111111111111111111111111

    def test_sk_in_group(self):
        self.assertTrue(0 < self.sk < grumpkin.Q)
        self.assertTrue(grumpkin.is_on_curve(self.pk))

    def test_round_trip(self):
        ranks = [2, 1, 0, 3]
        ct = sealed.encrypt(self.pk, self.voter, ranks, det_k(b"a"))
        self.assertTrue(grumpkin.is_on_curve((ct[0], ct[1])))
        self.assertEqual(sealed.decrypt(self.sk, self.voter, ct, 4), ranks)

    def test_wrong_voter_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"b"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter + 1, ct, 4))

    def test_wrong_key_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"c"))
        self.assertIsNone(sealed.decrypt((self.sk + 1) % grumpkin.Q, self.voter, ct, 4))

    def test_invalid_ranking_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 3, 3, 0], det_k(b"d"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter, ct, 4))

    def test_wrong_m_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"e"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter, ct, 3))

    def test_domain(self):
        self.assertEqual(sealed.DOMAIN, int.from_bytes(b"RankedShares/sealed/v2", "big"))

    def test_vectors(self):
        with open(VECTORS) as f:
            v = json.load(f)
        sk = int(v["sk"], 16)
        pk = tuple(int(x, 16) for x in v["pk"])
        self.assertEqual(sk, sealed.derive_sk(bytes.fromhex(v["master"][2:]), bytes.fromhex(v["keySalt"][2:])))
        self.assertEqual(pk, sealed.pubkey(sk))
        for case in v["cases"]:
            ct = tuple(int(x, 16) for x in case["ciphertext"])
            voter = int(case["voter"], 16)
            if case.get("note"):
                # A ciphertext made for another address: only the decryption outcome is pinned.
                self.assertIsNone(sealed.decrypt(sk, voter, ct, case["m"]))
                continue
            self.assertEqual(sealed.encrypt(pk, voter, case["ranks"], int(case["k"], 16)), ct)
            self.assertEqual(sealed.decrypt(sk, voter, ct, case["m"]), case["plaintext"])


def hx(n):
    return "0x" + format(n, "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def write_vectors():
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)
    cases = []
    specs = [
        (0x1111111111111111111111111111111111111111, 4, [2, 1, 0, 3], b"v1"),
        (0x2222222222222222222222222222222222222222, 4, [0, 0, 0, 0], b"v2"),
        (0x3333333333333333333333333333333333333333, 16, list(range(1, 17)), b"v3"),
        (0x4444444444444444444444444444444444444444, 31, [1] * 31, b"v4"),
    ]
    for voter, m, ranks, label in specs:
        k = det_k(label)
        ct = sealed.encrypt(pk, voter, ranks, k)
        cases.append({"voter": addr_hex(voter), "m": m, "ranks": ranks, "k": hx(k),
                      "ciphertext": [hx(x) for x in ct], "plaintext": sealed.decrypt(sk, voter, ct, m)})
    # a ciphertext made for voter 1, replayed by voter 2: absent
    ct = sealed.encrypt(pk, specs[0][0], specs[0][2], det_k(b"v1"))
    cases.append({"voter": addr_hex(specs[1][0]), "m": 4, "ranks": specs[0][2],
                  "k": hx(det_k(b"v1")), "ciphertext": [hx(x) for x in ct], "plaintext": None,
                  "note": "replayed under another address"})
    out = {"master": "0x" + MASTER.hex(), "keySalt": "0x" + SALT.hex(), "sk": hx(sk),
           "pk": [hx(pk[0]), hx(pk[1])], "domain": hx(sealed.DOMAIN), "cases": cases}
    with open(VECTORS, "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write":
        write_vectors()
    else:
        unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd reference && python3 -m unittest test_sealed -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'grumpkin'`

- [ ] **Step 3: Implement Grumpkin**

```python
# reference/grumpkin.py
"""Grumpkin: y^2 = x^3 - 17 over the BN254 scalar field. Affine, infinity is None."""

P = 21888242871839275222246405745257275088548364400416034343698204186575808495617
Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583
B = P - 17
G = (1, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C)


def _inv(a):
    return pow(a % P, P - 2, P)


def is_on_curve(pt):
    if pt is None:
        return True
    x, y = pt
    return (y * y - (x * x * x + B)) % P == 0


def add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * _inv(2 * y1) % P
    else:
        lam = (y2 - y1) * _inv(x2 - x1) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)


def mul(k, pt):
    k %= Q
    result = None
    acc = pt
    while k:
        if k & 1:
            result = add(result, acc)
        acc = add(acc, acc)
        k >>= 1
    return result
```

- [ ] **Step 4: Implement the sealed-ballot module**

```python
# reference/sealed.py
"""Sealed-ballot packing, key derivation and encryption (spec B4)."""

import grumpkin
import poseidon2
from keccak import keccak256

DOMAIN = int.from_bytes(b"RankedShares/sealed/v2", "big")


def pack(ranks):
    return sum(r << (8 * c) for c, r in enumerate(ranks))


def validate(ranks, m):
    """True iff ranks is a competition ranking over m projects (PBEAR._setBallot rules)."""
    if len(ranks) != m or any(r < 0 or r > m for r in ranks):
        return False
    counts = [0] * (m + 1)
    for r in ranks:
        counts[r] += 1
    seen = 0
    for r in range(1, m + 1):
        if counts[r] and r != seen + 1:
            return False
        seen += counts[r]
    return True


def unpack(packed, m):
    if packed < 0 or packed >= 1 << (8 * m):
        return None
    ranks = [(packed >> (8 * c)) & 0xFF for c in range(m)]
    return ranks if validate(ranks, m) else None


def derive_sk(master, key_salt):
    return int.from_bytes(keccak256(master + key_salt), "big") % grumpkin.Q


def pubkey(sk):
    return grumpkin.mul(sk, grumpkin.G)


def mask(shared, voter):
    return poseidon2.hash([DOMAIN, shared[0], shared[1], voter])


def encrypt(pk, voter, ranks, k):
    r = grumpkin.mul(k, grumpkin.G)
    s = grumpkin.mul(k, pk)
    c = (pack(ranks) + mask(s, voter)) % grumpkin.P
    return (r[0], r[1], c)


def decrypt(sk, voter, ct, m):
    rx, ry, c = ct
    if rx == 0 or not grumpkin.is_on_curve((rx, ry)):
        return None
    s = grumpkin.mul(sk, (rx, ry))
    if s is None:
        return None
    packed = (c - mask(s, voter)) % grumpkin.P
    return unpack(packed, m)
```

- [ ] **Step 5: Generate the vectors and run the tests**

Run:

```bash
cd reference && python3 test_sealed.py --write && python3 -m unittest test_sealed -v
```

Expected: `vectors/sealed.json` written with 5 cases; 13 tests OK.

- [ ] **Step 6: Commit**

```bash
git add reference/grumpkin.py reference/sealed.py reference/test_sealed.py reference/vectors/sealed.json
git commit -m "Add Grumpkin and sealed-ballot encryption to the reference"
```

---

### Task 4: PB-EAR transcript mode and public replay

**Files:**
- Modify: `reference/pbear.py` (add functions; keep `pbear`, `is_ipsc`, `is_exhaustive`, `main`'s positional path unchanged)
- Test: `reference/test_pbear.py` (append a class)

**Interfaces:**
- Consumes: `validate_ballot`, `effective_ranks`, `cumulative_deductions`, `pbear` from `reference/pbear.py`.
- Produces: `NONE = 2**64 - 1`; `pbear_transcript(costs, public, sealed, budget) -> (funded: list[int], transcript: list[list[int]])` where `public` and `sealed` are lists of `(weight, ballot | None)` and each transcript step is `[level, *pubSupport(m), best, total]`; `replay_public(costs, public, transcript, budget) -> bool`.
- Produces: CLI `python3 reference/pbear.py --transcript '<json>'` with input `{"costs": [...], "public": [[w, ballot|null]], "sealed": [[w, ballot|null]], "budget": n}` printing `{"funded": [...], "transcript": [[...]]}`.

- [ ] **Step 1: Write the failing tests**

Append to `reference/test_pbear.py`:

```python
import json
import os
import subprocess
import sys

from pbear import NONE, pbear_transcript, replay_public


def random_instance(rng, n_pub, n_sealed, m):
    costs = [rng.randint(1, 10) for _ in range(m)]

    def entry():
        w = rng.randint(0, 10)
        if rng.random() < 0.2:
            return (w, None)
        order = list(range(m))
        rng.shuffle(order)
        kept = rng.randint(0, m)
        ranks = [0] * m
        rank = 1
        for pos in range(kept):
            if pos == 0 or rng.random() < 0.6:
                rank = pos + 1
            ranks[order[pos]] = rank
        return (w, ranks)

    public = [entry() for _ in range(n_pub)]
    sealed = [entry() for _ in range(n_sealed)]
    budget = sum(w for w, _ in public + sealed) + rng.randint(0, 10)
    return costs, public, sealed, budget


class TranscriptTest(unittest.TestCase):
    def test_matches_single_list_tally(self):
        rng = random.Random(7)
        for _ in range(300):
            m = rng.randint(1, 5)
            costs, public, sealed, budget = random_instance(rng, rng.randint(0, 4), rng.randint(0, 4), m)
            abstaining = budget - sum(w for w, _ in public + sealed)
            expected = pbear(costs, public + sealed, abstaining)
            funded, transcript = pbear_transcript(costs, public, sealed, budget)
            self.assertEqual(funded, expected)
            self.assertEqual([s[m + 1] for s in transcript if s[m + 1] != NONE], funded)

    def test_step_shape_and_levels(self):
        costs = [30, 70]
        public = [(40, [1, 2])]
        sealed = [(60, [2, 1])]
        funded, transcript = pbear_transcript(costs, public, sealed, 100)
        # Level 1: A (id 0) funded with public 40 + sealed 0 = 40 ≥ 30.
        # Level 1 again: the public voter ranks B second, so public support for B is
        # still 0; sealed 60 < 70 → NONE, level advances.
        # Level 2: B has public 10 (40 − 30) + sealed 60 = 70 → funded.
        self.assertEqual(funded, [0, 1])
        self.assertEqual(transcript[0], [1, 40, 0, 0, 40])
        self.assertEqual(transcript[1], [1, 0, 0, NONE, 0])
        self.assertEqual(transcript[2], [2, 0, 10, 1, 70])

    def test_terminal_none_step_recorded(self):
        # Nothing affordable by support at any level: the last step is NONE at level >= m.
        costs = [100]
        funded, transcript = pbear_transcript(costs, [(10, [1])], [(10, [1])], 100)
        self.assertEqual(funded, [])
        self.assertEqual(transcript, [[1, 10, NONE, 0]])

    def test_exhausted_at_start_has_no_steps(self):
        funded, transcript = pbear_transcript([50], [(10, [1])], [], 10)
        self.assertEqual((funded, transcript), ([], []))

    def test_public_replay_accepts_and_rejects(self):
        rng = random.Random(11)
        for _ in range(100):
            m = rng.randint(1, 4)
            costs, public, sealed, budget = random_instance(rng, rng.randint(1, 4), rng.randint(0, 3), m)
            _, transcript = pbear_transcript(costs, public, sealed, budget)
            self.assertTrue(replay_public(costs, public, transcript, budget))
            if transcript:
                tampered = [list(s) for s in transcript]
                tampered[0][1] += 1  # first public support entry
                self.assertFalse(replay_public(costs, public, tampered, budget))

    def test_public_replay_rejects_double_funding(self):
        costs = [30, 70]
        _, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
        tampered = [list(s) for s in transcript]
        tampered[2][3] = 0  # fund project 0 twice
        self.assertFalse(replay_public(costs, [(40, [1, 2])], tampered, 100))

    def test_cli_transcript_mode(self):
        payload = {"costs": [30, 70], "public": [[40, [1, 2]]], "sealed": [[60, [2, 1]]], "budget": 100}
        out = subprocess.run(
            [sys.executable, "pbear.py", "--transcript", json.dumps(payload)],
            capture_output=True, text=True, check=True, cwd=os.path.dirname(os.path.abspath(__file__)),
        ).stdout
        result = json.loads(out)
        self.assertEqual(result["funded"], [0, 1])
        self.assertEqual(len(result["transcript"]), 3)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd reference && python3 -m unittest test_pbear -v 2>&1 | tail -5`
Expected: `ImportError: cannot import name 'NONE' from 'pbear'`

- [ ] **Step 3: Implement transcript mode and replay**

Add to `reference/pbear.py` after `pbear`:

```python
NONE = 2**64 - 1


def _ranks_of(entries, m):
    out = []
    for _, ballot in entries:
        if ballot is None:
            out.append(None)
        else:
            validate_ballot(ballot, m)
            out.append(effective_ranks(ballot))
    return out


def _support(weights, ranks, indices, is_funded, level, m):
    support = [0] * m
    for i in indices:
        r = ranks[i]
        if r is None or weights[i] == 0:
            continue
        for c in range(m):
            if not is_funded[c] and r[c] <= level:
                support[c] += weights[i]
    return support


def _argmax(costs, support, is_funded):
    best = None
    for c in range(len(costs)):
        if is_funded[c] or support[c] < costs[c]:
            continue
        if best is None or support[c] > support[best] or (
            support[c] == support[best] and costs[c] < costs[best]
        ):
            best = c
    return best


def pbear_transcript(costs, public, sealed, budget):
    """PB-EAR over the public block followed by the sealed block, with the transcript
    of spec B6.3: one record per executed step, [level, pubSupport..., best, total]."""
    m = len(costs)
    entries = list(public) + list(sealed)
    n_pub = len(public)
    weights = [w for w, _ in entries]
    if sum(weights) > budget:
        raise ValueError("entry weights exceed the budget")
    ranks = _ranks_of(entries, m)
    pub_idx = range(0, n_pub)
    sealed_idx = range(n_pub, len(entries))
    funded, is_funded, spent, level, transcript = [], [False] * m, 0, 1, []

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        pub = _support(weights, ranks, pub_idx, is_funded, level, m)
        sea = _support(weights, ranks, sealed_idx, is_funded, level, m)
        total_support = [pub[c] + sea[c] for c in range(m)]
        best = _argmax(costs, total_support, is_funded)
        if best is None:
            transcript.append([level] + pub + [NONE, 0])
            if level >= m:
                break
            level += 1
            continue
        total = total_support[best]
        transcript.append([level] + pub + [best, total])
        supporters = [i for i in range(len(entries)) if ranks[i] is not None and weights[i] and ranks[i][best] <= level]
        for i, d in zip(supporters, cumulative_deductions([weights[i] for i in supporters], costs[best])):
            weights[i] -= d
        is_funded[best] = True
        funded.append(best)
        spent += costs[best]
    return funded, transcript


def replay_public(costs, public, transcript, budget):
    """The audit of spec B6.3: replay the public block against a transcript using
    only public data. True iff every public support vector, level, funding and
    deduction is consistent. Cannot judge `best` against sealed support."""
    m = len(costs)
    weights = [w for w, _ in public]
    try:
        ranks = _ranks_of(public, m)
    except ValueError:
        return False
    is_funded, spent, level = [False] * m, 0, 1

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    for step in transcript:
        if len(step) != m + 3 or exhausted():
            return False
        s_level, pub, best, total = step[0], step[1 : m + 1], step[m + 1], step[m + 2]
        if s_level != level:
            return False
        if pub != _support(weights, ranks, range(len(public)), is_funded, level, m):
            return False
        if best == NONE:
            if total != 0 or any(not is_funded[c] and pub[c] >= costs[c] for c in range(m)):
                return False
            if level >= m:
                level = None  # terminal; any further step is invalid
                continue
            level += 1
            continue
        if level is None or not 0 <= best < m or is_funded[best]:
            return False
        if total < costs[best] or total < pub[best] or spent + costs[best] > budget:
            return False
        thr, cum = costs[best], 0
        for i in range(len(public)):
            if ranks[i] is None or weights[i] == 0 or ranks[i][best] > level:
                continue
            new_cum = cum + weights[i]
            weights[i] -= new_cum * thr // total - cum * thr // total
            cum = new_cum
        is_funded[best] = True
        spent += thr
    if level is None:
        return True
    return exhausted()
```

In `main`, before the existing body, add the transcript branch:

```python
def main(argv):
    if len(argv) > 2 and argv[1] == "--transcript":
        payload = json.loads(argv[2])
        funded, transcript = pbear_transcript(
            payload["costs"],
            [(w, b) for w, b in payload["public"]],
            [(w, b) for w, b in payload["sealed"]],
            payload["budget"],
        )
        print(json.dumps({"funded": funded, "transcript": transcript}))
        return
    payload = json.loads(argv[1])
    ...  # existing body unchanged
```

Note on `replay_public`'s final check: a transcript that ends because the tally is exhausted must leave the replayed public state exhausted too; one that ends with a terminal `NONE` step is complete by itself. A transcript cut short fails.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd reference && python3 -m unittest test_pbear -v`
Expected: all tests OK, including the pre-existing ones.

Then confirm the Solidity differential fuzz still passes against the unchanged positional CLI:

Run: `forge test --match-contract Differential`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reference/pbear.py reference/test_pbear.py
git commit -m "Add PB-EAR transcript mode and public replay to the reference"
```

---

### Task 5: Commitments, profiles and the circuit state

**Files:**
- Create: `reference/profile.py`
- Create: `reference/commitments.py`
- Test: `reference/test_commitments.py`

**Interfaces:**
- Consumes: `poseidon2.hash`, `keccak256`, `sealed.unpack`, `pbear.NONE`, `pbear.effective_ranks`, `pbear.cumulative_deductions`.
- Produces: `profile.PROFILES: dict[str, Profile]` with fields `n_sealed_max, m_max, batch, k`.
- Produces in `commitments.py`:
  - `sealed_chain(entries, batch) -> (h: int, checkpoints: list[int])`, `entries` = list of `(addr, seat_weight, rx, ry, c)`.
  - `public_chain(entries) -> bytes`, `entries` = list of `(addr, direct_weight, packed)`.
  - `costs_hash(costs) -> int`.
  - `inputs_root(h_pub: bytes, h_sealed: int, sealed_count: int, costs_hash: int, total_weight: int) -> bytes`.
  - `transcript_hash(transcript) -> int` and `transcript_hash_after(t_hash, step) -> int`.
  - `State` dataclass with `weights, ballots, funded, funded_order, funded_count, level, spent, done, m, budget, t_hash` and `empty_state(profile, m, budget) -> State`.
  - `state_commit(profile, state) -> int`, `funded_bits(state) -> int`, `funded_order_packed(state) -> int`.
  - `ingest(state, index, seat_weight, packed_or_none) -> None` (mutates), `tally_step(profile, state, costs, step) -> None` (mutates; raises `TranscriptMismatch` on a step the circuit would reject).
- All integers are plain Python ints; addresses are ints below `2**160`.

- [ ] **Step 1: Write the failing tests**

```python
# reference/test_commitments.py
import unittest

import commitments as cm
import poseidon2
from keccak import keccak256
from pbear import NONE, pbear_transcript
from profile import PROFILES
from sealed import pack

TEST = PROFILES["test"]


class ChainTest(unittest.TestCase):
    def test_sealed_chain_and_checkpoints(self):
        entries = [(i + 1, 10 * (i + 1), 100 + i, 200 + i, 300 + i) for i in range(5)]
        h, checkpoints = cm.sealed_chain(entries, batch=2)
        expected = 0
        manual = [0]
        for j, (a, w, rx, ry, c) in enumerate(entries):
            expected = poseidon2.hash([expected, a, w, rx, ry, c])
            if (j + 1) % 2 == 0 or j + 1 == len(entries):
                manual.append(expected)
        self.assertEqual(h, expected)
        self.assertEqual(checkpoints, manual)
        self.assertEqual(len(checkpoints), 1 + 3)  # ceil(5 / 2) batches

    def test_sealed_chain_empty(self):
        self.assertEqual(cm.sealed_chain([], batch=2), (0, [0]))

    def test_public_chain(self):
        entries = [(0xAA, 5, pack([1, 2])), (0xBB, 7, pack([2, 1]))]
        h = b"\x00" * 32
        for a, w, p in entries:
            h = keccak256(h + a.to_bytes(20, "big") + w.to_bytes(32, "big") + p.to_bytes(32, "big"))
        self.assertEqual(cm.public_chain(entries), h)
        self.assertEqual(cm.public_chain([]), b"\x00" * 32)

    def test_costs_hash_and_inputs_root(self):
        self.assertEqual(cm.costs_hash([3, 4]), poseidon2.hash([3, 4]))
        root = cm.inputs_root(b"\x01" * 32, 5, 2, 9, 100)
        self.assertEqual(root, keccak256(b"\x01" * 32 + (5).to_bytes(32, "big") + (2).to_bytes(32, "big") + (9).to_bytes(32, "big") + (100).to_bytes(32, "big")))

    def test_transcript_hash(self):
        t = [[1, 40, 0, 0, 40], [1, 0, 10, NONE, 0]]
        h = poseidon2.hash([0] + t[0])
        h = poseidon2.hash([h] + t[1])
        self.assertEqual(cm.transcript_hash(t), h)
        self.assertEqual(cm.transcript_hash([]), 0)


class StateTest(unittest.TestCase):
    def test_empty_state_commit_is_deterministic(self):
        s1 = cm.empty_state(TEST, m=2, budget=100)
        s2 = cm.empty_state(TEST, m=2, budget=100)
        self.assertEqual(cm.state_commit(TEST, s1), cm.state_commit(TEST, s2))
        self.assertEqual(s1.level, 1)
        self.assertEqual(len(s1.weights), TEST.n_sealed_max)

    def test_commit_layout(self):
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 0, 60, pack([2, 1]))
        s.funded[1] = True
        s.funded_order[0] = 1
        s.funded_count = 1
        flat = s.weights + s.ballots + [cm.funded_bits(s), cm.funded_order_packed(s), s.funded_count, s.level, s.spent, int(s.done), s.m, s.budget, s.t_hash]
        self.assertEqual(cm.state_commit(TEST, s), poseidon2.hash(flat))
        self.assertEqual(cm.funded_bits(s), 0b10)
        self.assertEqual(cm.funded_order_packed(s), 1)

    def test_ingest_absent_ballot_writes_zeros(self):
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 3, 60, None)
        self.assertEqual((s.weights[3], s.ballots[3]), (0, 0))

    def test_tally_follows_transcript(self):
        costs = [30, 70]
        public = [(40, [1, 2])]
        sealed = [(60, [2, 1])]
        funded, transcript = pbear_transcript(costs, public, sealed, 100)
        s = cm.empty_state(TEST, m=2, budget=100)
        cm.ingest(s, 0, 60, pack([2, 1]))
        for step in transcript:
            cm.tally_step(TEST, s, costs, step)
        self.assertTrue(s.done)
        self.assertEqual(s.funded_order[: s.funded_count], funded)
        self.assertEqual(s.t_hash, cm.transcript_hash(transcript))
        self.assertEqual(s.spent, 100)
        self.assertEqual(s.weights[0], 0)  # 60 − 60·70/70 after funding B with total 70

    def test_tally_rejects_forged_best_total_level(self):
        costs = [30, 70]
        _, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
        for index, field, value in [(0, 3, 1), (0, 4, 41), (0, 0, 2), (1, 3, 1)]:
            s = cm.empty_state(TEST, m=2, budget=100)
            cm.ingest(s, 0, 60, pack([2, 1]))
            forged = [list(x) for x in transcript]
            forged[index][field] = value
            with self.assertRaises(cm.TranscriptMismatch):
                for step in forged:
                    cm.tally_step(TEST, s, costs, step)

    def test_done_state_ignores_steps(self):
        s = cm.empty_state(TEST, m=1, budget=10)
        s.done = True
        before = cm.state_commit(TEST, s)
        cm.tally_step(TEST, s, [5], [1, 0, NONE, 0])
        self.assertEqual(cm.state_commit(TEST, s), before)

    def test_exhausted_state_becomes_done_without_absorbing(self):
        s = cm.empty_state(TEST, m=1, budget=10)  # cost 50 > budget: exhausted at start
        cm.tally_step(TEST, s, [50], [1, 0, NONE, 0])
        self.assertTrue(s.done)
        self.assertEqual(s.t_hash, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd reference && python3 -m unittest test_commitments -v 2>&1 | tail -3`
Expected: `ModuleNotFoundError: No module named 'commitments'`

- [ ] **Step 3: Implement profiles and commitments**

```python
# reference/profile.py
"""Circuit profiles (spec decision 7). A pool is deployed against one profile."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    n_sealed_max: int
    m_max: int
    batch: int
    k: int


PROFILES = {
    "default": Profile("default", n_sealed_max=256, m_max=16, batch=32, k=8),
    "test": Profile("test", n_sealed_max=8, m_max=4, batch=2, k=2),
}
```

```python
# reference/commitments.py
"""Commitments of spec B6.1, B6.3 and the circuit state of B7, in Python."""

from dataclasses import dataclass, field

import poseidon2
from keccak import keccak256
from pbear import NONE, cumulative_deductions, effective_ranks
from sealed import unpack


class TranscriptMismatch(Exception):
    """A transcript step the tally circuit would refuse to absorb."""


def _w32(n):
    return int(n).to_bytes(32, "big")


def sealed_chain(entries, batch):
    h, checkpoints = 0, [0]
    n = len(entries)
    for j, (addr, seat_weight, rx, ry, c) in enumerate(entries):
        h = poseidon2.hash([h, addr, seat_weight, rx, ry, c])
        if (j + 1) % batch == 0 or j + 1 == n:
            checkpoints.append(h)
    return h, checkpoints


def public_chain(entries):
    h = b"\x00" * 32
    for addr, direct_weight, packed in entries:
        h = keccak256(h + int(addr).to_bytes(20, "big") + _w32(direct_weight) + _w32(packed))
    return h


def costs_hash(costs):
    return poseidon2.hash(list(costs))


def inputs_root(h_pub, h_sealed, sealed_count, costs_hash_value, total_weight):
    return keccak256(h_pub + _w32(h_sealed) + _w32(sealed_count) + _w32(costs_hash_value) + _w32(total_weight))


def transcript_hash_after(t_hash, step):
    return poseidon2.hash([t_hash] + list(step))


def transcript_hash(transcript):
    h = 0
    for step in transcript:
        h = transcript_hash_after(h, step)
    return h


@dataclass
class State:
    weights: list
    ballots: list
    funded: list
    funded_order: list
    funded_count: int
    level: int
    spent: int
    done: bool
    m: int
    budget: int
    t_hash: int = 0


def empty_state(profile, m, budget):
    return State(
        weights=[0] * profile.n_sealed_max,
        ballots=[0] * profile.n_sealed_max,
        funded=[False] * profile.m_max,
        funded_order=[0] * profile.m_max,
        funded_count=0,
        level=1,
        spent=0,
        done=False,
        m=m,
        budget=budget,
    )


def funded_bits(state):
    return sum(1 << c for c, f in enumerate(state.funded) if f)


def funded_order_packed(state):
    return sum(state.funded_order[j] << (8 * j) for j in range(state.funded_count))


def state_commit(profile, state):
    assert len(state.weights) == profile.n_sealed_max and len(state.funded) == profile.m_max
    flat = (
        list(state.weights)
        + list(state.ballots)
        + [funded_bits(state), funded_order_packed(state), state.funded_count, state.level,
           state.spent, int(state.done), state.m, state.budget, state.t_hash]
    )
    return poseidon2.hash(flat)


def ingest(state, index, seat_weight, packed):
    """Entry `index` of the sealed block: weight and ballot, or zeros when absent."""
    if packed is None:
        state.weights[index], state.ballots[index] = 0, 0
    else:
        state.weights[index], state.ballots[index] = seat_weight, packed


def _exhausted(state, costs):
    return all(state.funded[c] or state.spent + costs[c] > state.budget for c in range(state.m))


def _entry_ranks(state, e):
    ranks = unpack(state.ballots[e], state.m)
    return None if ranks is None else effective_ranks(ranks)


def tally_step(profile, state, costs, step):
    """One step of the `tally` circuit (spec B7), driven by a transcript step."""
    m = state.m
    if state.done:
        return
    if _exhausted(state, costs):
        state.done = True
        return
    if len(step) != m + 3:
        raise TranscriptMismatch("step length")
    level, pub, best, total = step[0], list(step[1 : m + 1]), step[m + 1], step[m + 2]
    if level != state.level:
        raise TranscriptMismatch("level")
    state.t_hash = transcript_hash_after(state.t_hash, step)
    sealed = [0] * m
    ranks = [(_entry_ranks(state, e) if state.weights[e] else None) for e in range(len(state.weights))]
    for e, r in enumerate(ranks):
        if r is None:
            continue
        for c in range(m):
            if not state.funded[c] and r[c] <= level:
                sealed[c] += state.weights[e]
    total_support = [pub[c] + sealed[c] for c in range(m)]
    argmax = None
    for c in range(m):
        if state.funded[c] or total_support[c] < costs[c]:
            continue
        if argmax is None or total_support[c] > total_support[argmax] or (
            total_support[c] == total_support[argmax] and costs[c] < costs[argmax]
        ):
            argmax = c
    if best != (NONE if argmax is None else argmax):
        raise TranscriptMismatch("best")
    if best == NONE:
        if total != 0:
            raise TranscriptMismatch("total")
        if level >= m:
            state.done = True
        else:
            state.level += 1
        return
    if total != total_support[best]:
        raise TranscriptMismatch("total")
    thr, cum = costs[best], pub[best]
    for e, r in enumerate(ranks):
        if r is None or r[best] > level:
            continue
        new_cum = cum + state.weights[e]
        state.weights[e] -= new_cum * thr // total - cum * thr // total
        cum = new_cum
    state.funded[best] = True
    state.funded_order[state.funded_count] = best
    state.funded_count += 1
    state.spent += thr
    if _exhausted(state, costs):
        state.done = True
```

`ranks` skips entries with weight zero, matching the circuit's weight-masked sums and `PBEAR.step()`'s `if (w == 0) continue`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd reference && python3 -m unittest test_commitments -v`
Expected: 11 tests OK.

- [ ] **Step 5: Cross-check the sealed-block deductions against the full tally**

Add to `reference/test_commitments.py`:

```python
class SplitConsistencyTest(unittest.TestCase):
    def test_sealed_weights_match_full_tally(self):
        import random
        from test_pbear import random_instance
        rng = random.Random(3)
        for _ in range(200):
            m = rng.randint(1, TEST.m_max)
            costs, public, sealed, budget = random_instance(rng, rng.randint(0, 3), rng.randint(0, TEST.n_sealed_max), m)
            funded, transcript = pbear_transcript(costs, public, sealed, budget)
            s = cm.empty_state(TEST, m, budget)
            for i, (w, ballot) in enumerate(sealed):
                cm.ingest(s, i, w, None if ballot is None else pack(ballot))
            for step in transcript:
                cm.tally_step(TEST, s, costs, step)
            self.assertEqual(s.funded_order[: s.funded_count], funded)
            self.assertEqual(s.done or not transcript, True)
```

`random_instance` lives in `test_pbear.py`; importing it works because the tests run with `reference/` as the working directory. Run the file again; expected 12 tests OK.

- [ ] **Step 6: Commit**

```bash
git add reference/profile.py reference/commitments.py reference/test_commitments.py
git commit -m "Add commitments, profiles and the sealed circuit state to the reference"
```

---

### Task 6: Fixture generator

**Files:**
- Create: `reference/tools/make_fixture.py`
- Create: `reference/vectors/fixture_test.json`, `reference/vectors/fixture_default.json` (generated, committed)
- Test: `reference/test_fixture.py`
- Modify: `README.md` (reference section)

**Interfaces:**
- Consumes: everything above.
- Produces: `python3 reference/tools/make_fixture.py --profile test|default` writing `reference/vectors/fixture_<profile>.json` with this shape (all numbers as `0x`-prefixed 64-digit hex strings unless noted; addresses as 40-digit hex):

```
{
  "profile": {"name", "nSealedMax", "mMax", "batch", "k"}          (ints)
  "master", "keySalt", "sk", "pk": [x, y],
  "costs": [...], "totalWeight", "minDirectVote",
  "voters": [ { "addr", "directWeight", "seatWeight", "hasDirect": bool, "directRanks": [ints]|null,
                "directPacked", "ciphertext": [rx, ry, c]|null, "sealedRanks": [ints]|null } ],
  "publicEntries": [[addr, directWeight, packed]], "sealedEntries": [[addr, seatWeight, rx, ry, c]],
  "hPub", "hSealed", "checkpoints": [...], "sealedCount" (int), "numBatches" (int),
  "costsHash", "inputsRoot",
  "funded": [ints], "transcript": [[ints]], "transcriptHash",
  "ingestProofs": [ {"k", "nSealed", "m", "budget", "pkX", "pkY", "hIn", "hOut", "stateIn", "stateOut"} ],
  "tallyProofs":  [ {"costsHash", "stateIn", "stateOut", "done", "tHashOut", "fundedCount", "fundedOrderPacked"} ]
}
```

The `voters` list is the registration order. Plans 2, 3 and 4 read these files.

- [ ] **Step 1: Write the failing test**

```python
# reference/test_fixture.py
import json
import os
import subprocess
import sys
import unittest

from pbear import replay_public
from profile import PROFILES

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, "vectors", f"fixture_{name}.json")) as f:
        return json.load(f)


class FixtureTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        before = open(os.path.join(HERE, "vectors", "fixture_test.json")).read()
        subprocess.run([sys.executable, os.path.join(HERE, "tools", "make_fixture.py"), "--profile", "test"], check=True, cwd=os.path.dirname(HERE))
        after = open(os.path.join(HERE, "vectors", "fixture_test.json")).read()
        self.assertEqual(before, after)

    def test_test_fixture_exercises_chains(self):
        fx = load("test")
        p = PROFILES["test"]
        self.assertGreater(fx["numBatches"], 1)
        self.assertGreater(len(fx["tallyProofs"]), 1)
        self.assertEqual(len(fx["ingestProofs"]), fx["numBatches"])
        self.assertEqual(fx["ingestProofs"][0]["stateIn"], "0x" + "0" * 64)
        self.assertEqual(fx["ingestProofs"][-1]["hOut"], fx["checkpoints"][-1])
        self.assertEqual(fx["tallyProofs"][-1]["done"], 1)
        self.assertEqual(fx["tallyProofs"][-1]["tHashOut"], fx["transcriptHash"])
        self.assertLessEqual(fx["sealedCount"], p.n_sealed_max)
        self.assertTrue(any(v["ciphertext"] is not None and v["sealedRanks"] is None for v in fx["voters"]), "an invalid ciphertext")

    def test_chain_of_states(self):
        for name in ("test", "default"):
            fx = load(name)
            proofs = fx["ingestProofs"] + fx["tallyProofs"]
            for a, b in zip(proofs, proofs[1:]):
                self.assertEqual(a["stateOut"], b["stateIn"])

    def test_public_replay_passes(self):
        for name in ("test", "default"):
            fx = load(name)
            public = [(int(v["directWeight"], 16), v["directRanks"]) for v in fx["voters"] if v["hasDirect"]]
            self.assertTrue(replay_public([int(c, 16) for c in fx["costs"]], public, fx["transcript"], int(fx["totalWeight"], 16)))

    def test_default_fixture_uses_default_profile(self):
        fx = load("default")
        self.assertEqual(fx["profile"]["nSealedMax"], 256)
        self.assertEqual(len(fx["ingestProofs"]), fx["numBatches"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd reference && python3 -m unittest test_fixture -v 2>&1 | tail -3`
Expected: FAIL (fixture files and generator missing).

- [ ] **Step 3: Implement the generator**

```python
# reference/tools/make_fixture.py
"""Write reference/vectors/fixture_<profile>.json (see plan 1, Task 6, for the shape).

Usage: python3 reference/tools/make_fixture.py --profile test|default
Run from the repository root.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import commitments as cm  # noqa: E402
import grumpkin  # noqa: E402
import sealed  # noqa: E402
from keccak import keccak256  # noqa: E402
from pbear import pbear_transcript  # noqa: E402
from profile import PROFILES  # noqa: E402

MASTER = keccak256(b"fixture master secret")
SALT = keccak256(b"fixture key salt")
MIN_DIRECT_VOTE = 10_000_000  # 10 USDC at 6 decimals


def hx(n):
    return "0x" + format(int(n), "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def det_k(label):
    return int.from_bytes(keccak256(b"fixture-k:" + label.encode()), "big") % grumpkin.Q


def ballot(m, order, kept=None):
    """Strict ranking over the first `kept` projects of `order`, rest unranked."""
    kept = m if kept is None else kept
    ranks = [0] * m
    for pos in range(kept):
        ranks[order[pos]] = pos + 1
    return ranks


def build(profile):
    m = profile.m_max
    costs = [(c + 1) * 25_000_000 for c in range(m)]  # 25, 50, 75 ... USDC
    rot = lambda i: [(c + i) % m for c in range(m)]

    # Registration order: public-only, sealed-only, both, abstaining, replayed, dropped seat.
    voters = []
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)

    def add(addr, direct, seat, direct_ranks, sealed_ranks, k_label, copy_from=None):
        v = {"addr": addr, "directWeight": direct, "seatWeight": seat, "hasDirect": direct_ranks is not None,
             "directRanks": direct_ranks, "ciphertext": None, "sealedRanks": None}
        if copy_from is not None:
            v["ciphertext"] = copy_from["ciphertext"]
        elif sealed_ranks is not None:
            v["ciphertext"] = sealed.encrypt(pk, addr, sealed_ranks, det_k(k_label))
        if v["ciphertext"] is not None:
            v["sealedRanks"] = sealed.decrypt(sk, addr, v["ciphertext"], m)
        voters.append(v)
        return v

    base = 0x1000
    n_sealed = min(profile.n_sealed_max, 2 * profile.batch + 1)  # spans > 2 batches
    # 3 public-only voters
    for i in range(3):
        add(base + i, 40_000_000 * (i + 1), 0, ballot(m, rot(i), kept=min(m, 3)), None, "")
    # sealed voters with valid ballots
    first = add(base + 10, 0, 30_000_000, None, ballot(m, rot(1)), "s0")
    for i in range(1, n_sealed - 2):
        add(base + 10 + i, 0, 30_000_000, None, ballot(m, rot(i % m), kept=1 + i % m), f"s{i}")
    # one address with both direct and sealed weight
    add(base + 500, 15_000_000, 30_000_000, ballot(m, rot(2)), ballot(m, rot(3)), "both")
    # one sealed voter whose ciphertext is a copy of another voter's: decrypts to absent
    add(base + 501, 0, 30_000_000, None, None, "", copy_from=first)
    # one seat holder who never voted (no ciphertext, abstaining)
    add(base + 502, 0, 30_000_000, None, None, "")
    # one direct voter with no ballot (abstaining)
    add(base + 503, 5_000_000, 0, None, None, "")

    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in voters) + 7_000_000  # + NFT dust
    public = [(v["directWeight"], v["directRanks"]) for v in voters if v["hasDirect"]]
    sealed_voters = [v for v in voters if v["ciphertext"] is not None]
    sealed_block = [(v["seatWeight"], v["sealedRanks"]) for v in sealed_voters]
    assert len(sealed_voters) <= profile.n_sealed_max
    funded, transcript = pbear_transcript(costs, public, sealed_block, total_weight)

    public_entries = [(v["addr"], v["directWeight"], sealed.pack(v["directRanks"])) for v in voters if v["hasDirect"]]
    sealed_entries = [(v["addr"], v["seatWeight"], *v["ciphertext"]) for v in sealed_voters]
    h_pub = cm.public_chain(public_entries)
    h_sealed, checkpoints = cm.sealed_chain(sealed_entries, profile.batch)
    costs_hash = cm.costs_hash(costs)
    inputs_root = cm.inputs_root(h_pub, h_sealed, len(sealed_entries), costs_hash, total_weight)
    num_batches = max(1, -(-len(sealed_entries) // profile.batch))

    # Ingest proofs: batch k covers sealed entries [k·B, (k+1)·B).
    state = cm.empty_state(profile, m, total_weight)
    ingest_proofs = []
    state_in = 0
    for k in range(num_batches):
        for j in range(profile.batch):
            i = k * profile.batch + j
            if i < len(sealed_voters):
                v = sealed_voters[i]
                cm.ingest(state, i, v["seatWeight"], None if v["sealedRanks"] is None else sealed.pack(v["sealedRanks"]))
        state_out = cm.state_commit(profile, state)
        ingest_proofs.append({"k": k, "nSealed": len(sealed_entries), "m": m, "budget": hx(total_weight),
                              "pkX": hx(pk[0]), "pkY": hx(pk[1]), "hIn": hx(checkpoints[k]), "hOut": hx(checkpoints[k + 1]),
                              "stateIn": hx(state_in), "stateOut": hx(state_out)})
        state_in = state_out

    # Tally proofs: K transcript steps each, until done. A step is consumed exactly
    # when `tally_step` absorbs it, which it signals by advancing `t_hash`; a done or
    # exhausted state absorbs nothing and gets a dummy NONE step.
    tally_proofs = []
    cursor = 0
    while not state.done:
        s_in = cm.state_commit(profile, state)
        for _ in range(profile.k):
            step = transcript[cursor] if cursor < len(transcript) else [state.level] + [0] * m + [cm.NONE, 0]
            before = state.t_hash
            cm.tally_step(profile, state, costs, step)
            if state.t_hash != before:
                cursor += 1
        tally_proofs.append({"costsHash": hx(costs_hash), "stateIn": hx(s_in), "stateOut": hx(cm.state_commit(profile, state)),
                             "done": int(state.done), "tHashOut": hx(state.t_hash), "fundedCount": state.funded_count,
                             "fundedOrderPacked": hx(cm.funded_order_packed(state))})
    assert cursor == len(transcript)
    assert state.t_hash == cm.transcript_hash(transcript)
    assert state.funded_order[: state.funded_count] == funded

    return {
        "profile": {"name": profile.name, "nSealedMax": profile.n_sealed_max, "mMax": profile.m_max, "batch": profile.batch, "k": profile.k},
        "master": "0x" + MASTER.hex(), "keySalt": "0x" + SALT.hex(), "sk": hx(sk), "pk": [hx(pk[0]), hx(pk[1])],
        "costs": [hx(c) for c in costs], "totalWeight": hx(total_weight), "minDirectVote": hx(MIN_DIRECT_VOTE),
        "voters": [{"addr": addr_hex(v["addr"]), "directWeight": hx(v["directWeight"]), "seatWeight": hx(v["seatWeight"]),
                    "hasDirect": v["hasDirect"], "directRanks": v["directRanks"],
                    "directPacked": hx(sealed.pack(v["directRanks"]) if v["hasDirect"] else 0),
                    "ciphertext": None if v["ciphertext"] is None else [hx(x) for x in v["ciphertext"]],
                    "sealedRanks": v["sealedRanks"]} for v in voters],
        "publicEntries": [[addr_hex(a), hx(w), hx(p)] for a, w, p in public_entries],
        "sealedEntries": [[addr_hex(a), hx(w), hx(rx), hx(ry), hx(c)] for a, w, rx, ry, c in sealed_entries],
        "hPub": "0x" + h_pub.hex(), "hSealed": hx(h_sealed), "checkpoints": [hx(c) for c in checkpoints],
        "sealedCount": len(sealed_entries), "numBatches": num_batches,
        "costsHash": hx(costs_hash), "inputsRoot": "0x" + inputs_root.hex(),
        "funded": funded, "transcript": transcript, "transcriptHash": hx(cm.transcript_hash(transcript)),
        "ingestProofs": ingest_proofs, "tallyProofs": tally_proofs,
    }
```

Then the entry point:

```python
def main(argv):
    name = argv[argv.index("--profile") + 1] if "--profile" in argv else "test"
    fx = build(PROFILES[name])
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vectors", f"fixture_{name}.json")
    with open(out, "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
    print(out, "voters", len(fx["voters"]), "sealed", fx["sealedCount"], "steps", len(fx["transcript"]), "proofs", len(fx["ingestProofs"]) + len(fx["tallyProofs"]))


if __name__ == "__main__":
    main(sys.argv)
```

`cm.NONE` must exist: add `from pbear import NONE` to the imports of `commitments.py` (it is already imported there; re-export is automatic because the name is module-level).

- [ ] **Step 4: Generate both fixtures and run the tests**

Run:

```bash
python3 reference/tools/make_fixture.py --profile test
python3 reference/tools/make_fixture.py --profile default
cd reference && python3 -m unittest test_fixture -v
```

Expected: the `test` fixture reports 3 batches (5 sealed entries with batch 2) and at least 2 tally proofs; the `default` fixture reports 3 batches (65 sealed entries with batch 32); 5 tests OK. The default fixture is a few hundred kilobytes because of the 256-entry state; that is intended.

If `test_test_fixture_exercises_chains` fails on `len(tallyProofs) > 1`, the four-project instance finished in two steps; change the public voters' `kept` from 3 to 1 so the tally needs more level advances, regenerate, and re-run.

- [ ] **Step 5: Run the whole reference suite**

Run: `python3 -m unittest discover reference -v 2>&1 | tail -3`
Expected: OK, all tests.

- [ ] **Step 6: Document the reference in the README**

Append to `README.md` under the existing testing section:

```markdown
## Reference implementation

`reference/` is the oracle every port is tested against, in dependency-free Python:

| Module | Defines |
|---|---|
| `pbear.py` | PB-EAR, the IPSC checker, and the transcript mode of the sealed design |
| `poseidon2.py` | Poseidon2 over BN254 (t = 4), equal to Barretenberg's; vectors in `vectors/poseidon2.json` |
| `grumpkin.py`, `sealed.py` | Grumpkin, ballot packing, ECDH ballot encryption; vectors in `vectors/sealed.json` |
| `commitments.py`, `profile.py` | on-chain commitments, transcript hash, circuit state and profiles |
| `tools/make_fixture.py` | writes `vectors/fixture_<profile>.json`, consumed by the Solidity, Noir and TypeScript tests |

Run `python3 -m unittest discover reference`. Regenerate Poseidon2 constants and vectors with
`python3 reference/tools/extract_poseidon2_params.py` and
`node reference/tools/poseidon2_vectors.mjs > reference/vectors/poseidon2.json`
(needs `npm install` in `reference/tools`).
```

- [ ] **Step 7: Commit**

```bash
git add reference/tools/make_fixture.py reference/vectors/fixture_test.json reference/vectors/fixture_default.json reference/test_fixture.py README.md
git commit -m "Add sealed-ballot fixtures for the contract, circuit and TypeScript tests"
```

---

### Verification (end to end)

```
python3 -m unittest discover reference -v
forge test                              # existing suites, including the ffi differential fuzz
git status --short                      # only reference/tools/node_modules should be untracked-and-ignored
```

What the next plan needs from this one: `reference/vectors/poseidon2.json` (for `Poseidon2.sol`), `reference/vectors/sealed.json` (for `Grumpkin.sol` and `sealed.ts`), `reference/vectors/fixture_test.json` (for every `SealedRankedShares` test that touches `close`, `onReport` and `advance`), and the `--transcript` CLI (for a differential fuzz of the enclave port).
