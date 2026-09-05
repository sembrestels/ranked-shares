# Sealed ballots, zisk variant, plan A of 2: reference, Rust workspace, guest, spikes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One executable Python definition of the zisk variant's encryption, commitments and fixtures; a Rust workspace whose `sealed::tally::run` reproduces those fixtures natively; a ZisK guest that commits the same 32 bytes in the emulator; and the three measurements plan B needs (public-values layout on chain, cycles, proving time).

**Architecture:** `reference/zisk/` mirrors the structure of the Noir reference (pure stdlib Python, vectors and fixtures as JSON) and reuses `keccak.py` and `pbear.py` from the reference root. `zisk/` is a Cargo workspace: `pbear` (PB-EAR over `u64`, no dependencies), `sealed` (types, secp256k1 ECDH + keccak with a host implementation on `k256`/`tiny-keccak` and a guest implementation on `ziskos::zisklib`, the voter chain, `inputsHash`, the ABI-encoded output hash, and `run`), and `guest` (five lines: read, run, commit). The guest is excluded from the host build; `cargo-zisk` builds it for `riscv64ima-zisk-zkvm-elf`.

**Tech Stack:** Python 3.14 (`unittest`, stdlib only), Rust stable on the host, ZisK v1.2.0-alpha (`~/.zisk/bin/cargo-zisk`, `ziskemu`, `cargo-zisk-dev`, proving keys in `~/.zisk`), crates `k256 0.13`, `tiny-keccak 2`, `serde 1`, `bincode 2`, `serde_json 1`, `hex 0.4`, `ziskos` from the ZisK git tag `v1.2.0-alpha`.

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`, sections Z3 (encryption), Z4 (guest), Z5 step 2 (public values layout), Z7 (reference and fixtures), Z8 (Rust tests), Z10 (spikes). Read the spec first; the plan argues from it. Plan B (contracts, prover CLI, Arc) is written when this plan is done.

## Global Constraints

- Python in `reference/` uses the standard library only. Run `python3 -m unittest discover reference` (about 70 tests today) before every commit; it must stay green.
- Domain string: `RankedShares/sealed/secp256k1` (ASCII bytes).
- secp256k1: `p = 2^256 − 2^32 − 977`, `n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141`, `G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)`. Points are SEC1 compressed (33 bytes, prefix `0x02` even y / `0x03` odd y).
- Key: `key = keccak256(DOMAIN ‖ S.x (32 bytes BE) ‖ voter (20 bytes))`, `pad[b] = keccak256(key ‖ uint8(b))`, `ciphertext = R ‖ (ranks ⊕ pad)`, length `33 + m`. `sk = keccak256(master ‖ keySalt) mod n`.
- Voter chain: `h ← keccak256(h ‖ addr (20) ‖ uint256(directWeight) ‖ uint256(seatWeight) ‖ keccak256(directBallot) ‖ keccak256(ciphertext))` from `h = 0`, empty bytes hashing as `keccak256("")`. `inputsHash = keccak256(uint256(chainId) ‖ pool (20) ‖ h ‖ uint256(n) ‖ keccak256(costs as 32-byte words) ‖ uint256(totalWeight))`.
- Output hash: `keccak256(abi.encode(bytes32 inputsHash, bytes pk, uint256[] fundedOrder))`, Solidity's three-argument `abi.encode`: heads `inputsHash`, `0x60`, `0x60 + 32 + 64`; tails `uint256(33) ‖ pk padded to 64 bytes`, then `uint256(len) ‖ ids`.
- Tally order: every voter with a non-empty direct ballot, in registration order, then every voter whose ciphertext decrypts, in registration order. `abstaining = totalWeight − Σ entry weights`. Weights, costs, budget `< 2^64`; `m ≤ 31`.
- Guest input: bincode 2 `standard()` encoding of `TallyInput`, framed for ZisK as `u64 LE length ‖ bytes ‖ zero padding to a multiple of 8`. Guest output: `commit_slice` of the 32-byte output hash. Emulator output file (`ziskemu -o`): 256 bytes, the 64 `u32` slots; our hash is bytes `0..32`.
- On-chain public values (plan B decodes them, this plan proves the layout): 512 bytes, slot `i` at bytes `8i..8i+8` holding the `u32` as a little-endian `u64`, so `publicValues[8i..8i+4] == hash[4i..4i+4]` for `i < 8` and every other byte zero.
- ZisK invocations on this machine need `HWLOC_COMPONENTS=-gl` and `GLIBC_TUNABLES=glibc.rtld.execstack=2` in the environment and run `prove` and `wrap` as separate processes. `cargo-zisk` is at `~/.zisk/bin/cargo-zisk` (not on `PATH`).
- Nothing under `reference/` other than `reference/sealed.py` (one import line) and the new `reference/ballots.py` is modified; nothing under `src/`, `test/` or `script/` is touched in this plan. No attribution lines in commit messages.

## File structure

```
reference/ballots.py                    validate, pack, unpack (Task 1; sealed.py imports them)
reference/test_ballots.py
reference/zisk/__init__.py
reference/zisk/secp256k1.py             curve arithmetic, compress/decompress (Task 2)
reference/zisk/test_secp256k1.py
reference/zisk/sealed.py                derive_sk, pubkey, encrypt, decrypt (Task 3)
reference/zisk/test_sealed.py           + `--write` for vectors/zisk/sealed.json
reference/zisk/commitments.py           voter_chain, inputs_hash, abi_encode_output, output_hash (Task 4)
reference/zisk/test_commitments.py
reference/zisk/make_fixture.py          scenarios main, nosealed, nodirect, big (Task 5)
reference/zisk/test_fixture.py
reference/vectors/zisk/sealed.json, fixture_{main,nosealed,nodirect}.json
zisk/Cargo.toml, Cargo.lock, .gitignore, README.md
zisk/crates/pbear/                      Task 6
zisk/crates/sealed/                     Tasks 7, 8, 9 (+ src/bin/fixture-input.rs)
zisk/guest/                             Task 10
zisk/scripts/emu-check.sh               Task 10
zisk/scripts/check_publics.py           Task 12
zisk/fixtures/main-calldata.json        Task 12 (consumed by plan B)
```

---

### Task 1: Shared ballot helpers in `reference/ballots.py`

**Files:**
- Create: `reference/ballots.py`, `reference/test_ballots.py`
- Modify: `reference/sealed.py` (replace the `pack`, `validate`, `unpack` definitions by one import)

**Interfaces:**
- Produces: `validate(ranks, m) -> bool`, `pack(ranks) -> int`, `unpack(packed, m) -> list | None`, identical behaviour to today's `sealed.pack/validate/unpack`. `sealed.pack` etc. keep working because `sealed.py` re-exports them.

- [ ] **Step 1: Write the failing test**

```python
# reference/test_ballots.py
import unittest

from ballots import pack, unpack, validate


class BallotsTest(unittest.TestCase):
    def test_validate_accepts_competition_rankings(self):
        self.assertTrue(validate([1, 2, 3, 0], 4))
        self.assertTrue(validate([1, 2, 2, 4], 4))
        self.assertTrue(validate([0, 0, 0, 0], 4))
        self.assertTrue(validate([2, 1, 0, 0], 4))

    def test_validate_rejects_gaps_length_and_range(self):
        self.assertFalse(validate([1, 3, 0, 0], 4))  # gap
        self.assertFalse(validate([2, 2, 0, 0], 4))  # no rank 1
        self.assertFalse(validate([1, 2, 3], 4))  # length
        self.assertFalse(validate([1, 2, 3, 5], 4))  # > m
        self.assertFalse(validate([4, 4, 4, 4], 4))
        self.assertFalse(validate([1, 2, 3, -1], 4))

    def test_pack_unpack_round_trip(self):
        ranks = [1, 2, 2, 4]
        self.assertEqual(pack(ranks), 0x04020201)
        self.assertEqual(unpack(pack(ranks), 4), ranks)
        self.assertIsNone(unpack(1 << 32, 4))
        self.assertIsNone(unpack(0x0300, 4))  # rank 3 without ranks 1 and 2

    def test_sealed_reexports(self):
        import sealed

        self.assertIs(sealed.validate, validate)
        self.assertIs(sealed.pack, pack)
        self.assertIs(sealed.unpack, unpack)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd reference && python3 -m unittest test_ballots -v`
Expected: `ModuleNotFoundError: No module named 'ballots'`.

- [ ] **Step 3: Create `ballots.py` and make `sealed.py` import from it**

```python
# reference/ballots.py
"""Ballot encoding shared by every variant.

A ballot is one competition rank per project: `1 +` the number of projects the voter
strictly prefers, `0` for unranked. This is `PBEAR._setBallot`'s rule; `validate` is the
same check on a Python list, `pack`/`unpack` the field-element form the Noir variant uses.
"""


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


def pack(ranks):
    return sum(r << (8 * c) for c, r in enumerate(ranks))


def unpack(packed, m):
    if packed < 0 or packed >= 1 << (8 * m):
        return None
    ranks = [(packed >> (8 * c)) & 0xFF for c in range(m)]
    return ranks if validate(ranks, m) else None
```

In `reference/sealed.py`, delete the three function definitions `pack`, `validate` and `unpack` (they are the first three functions after `DOMAIN`) and add, next to the other imports:

```python
from ballots import pack, unpack, validate  # noqa: F401  (re-exported for the Noir tests)
```

- [ ] **Step 4: Run the whole reference suite**

Run: `python3 -m unittest discover reference`
Expected: OK, four more tests than before, nothing else changes (the Noir fixtures are byte-identical because the functions are).

- [ ] **Step 5: Commit**

```bash
git add reference/ballots.py reference/test_ballots.py reference/sealed.py
git commit -m "Move ballot validation and packing to a shared reference module"
```

---

### Task 2: secp256k1 in pure Python

**Files:**
- Create: `reference/zisk/__init__.py` (empty), `reference/zisk/secp256k1.py`, `reference/zisk/test_secp256k1.py`

**Interfaces:**
- Produces: `P`, `N`, `G`; `add(p, q)`, `mul(k, p)` over affine points with `None` as the identity; `is_on_curve(p)`; `compress(p) -> bytes` (33); `decompress(b: bytes) -> tuple | None` (None for a bad prefix, wrong length, `x ≥ p`, or a non-residue).

- [ ] **Step 1: Write the failing test**

```python
# reference/zisk/test_secp256k1.py
import unittest

from zisk import secp256k1 as ec


class Secp256k1Test(unittest.TestCase):
    def test_generator(self):
        self.assertTrue(ec.is_on_curve(ec.G))
        self.assertEqual(ec.P, 2**256 - 2**32 - 977)

    def test_doubling(self):
        self.assertEqual(
            ec.mul(2, ec.G),
            (
                0xC6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5,
                0x1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52A,
            ),
        )

    def test_known_public_key(self):
        # From the widely reproduced secp256k1 test vectors (Chuck Batson).
        k = 0xAA5E28D6A97A2479A65527F7290311A3624D4CC0FA1578598EE3C2613BF99522
        self.assertEqual(
            ec.mul(k, ec.G),
            (
                0x34F9460F0E4F08393D192B3C5133A6BA099AA0AD9FD54EBCCFACDFA239FF49C6,
                0x0B71EA9BD730FD8923F6D25A7A91E7DD7728A960686CB5A901BB419E0F2CA232,
            ),
        )

    def test_group_order(self):
        self.assertIsNone(ec.mul(ec.N, ec.G))
        self.assertEqual(ec.mul(ec.N - 1, ec.G), (ec.G[0], ec.P - ec.G[1]))

    def test_compress_round_trip(self):
        for k in (1, 2, 3, 12345, ec.N - 1):
            pt = ec.mul(k, ec.G)
            c = ec.compress(pt)
            self.assertEqual(len(c), 33)
            self.assertIn(c[0], (2, 3))
            self.assertEqual(c[0] - 2, pt[1] & 1)
            self.assertEqual(ec.decompress(c), pt)

    def test_decompress_rejects_garbage(self):
        x = ec.G[0].to_bytes(32, "big")
        self.assertIsNone(ec.decompress(b"\x04" + x))
        self.assertIsNone(ec.decompress(b"\x02" + x[:-1]))
        self.assertIsNone(ec.decompress(b"\x02" + ec.P.to_bytes(32, "big")))
        # x = 5: 5³ + 7 = 132 is a quadratic non-residue mod p, so no point has this x.
        self.assertIsNone(ec.decompress(b"\x02" + (5).to_bytes(32, "big")))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd reference && python3 -m unittest zisk.test_secp256k1 -v`
Expected: `ModuleNotFoundError: No module named 'zisk'` (or `secp256k1`).

- [ ] **Step 3: Implement**

Create the empty `reference/zisk/__init__.py`, then:

```python
# reference/zisk/secp256k1.py
"""secp256k1 in affine coordinates, enough for ECDH and SEC1 compression.

Points are (x, y) tuples; None is the point at infinity. Not constant-time: this is a
reference for tests and fixtures, never for a real key.
"""

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)


def is_on_curve(pt):
    if pt is None:
        return True
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - x * x * x - 7) % P == 0


def add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    (x1, y1), (x2, y2) = p, q
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * pow(2 * y1, P - 2, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, P - 2, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)


def mul(k, pt):
    k %= N
    result, acc = None, pt
    while k:
        if k & 1:
            result = add(result, acc)
        acc = add(acc, acc)
        k >>= 1
    return result


def compress(pt):
    x, y = pt
    return bytes([2 + (y & 1)]) + x.to_bytes(32, "big")


def decompress(b):
    if len(b) != 33 or b[0] not in (2, 3):
        return None
    x = int.from_bytes(b[1:], "big")
    if x >= P:
        return None
    y2 = (x * x * x + 7) % P
    y = pow(y2, (P + 1) // 4, P)  # p ≡ 3 mod 4
    if y * y % P != y2:
        return None
    if (y & 1) != b[0] - 2:
        y = P - y
    return (x, y)
```

- [ ] **Step 4: Run the test**

Run: `cd reference && python3 -m unittest zisk.test_secp256k1 -v`
Expected: 6 tests OK. Then `python3 -m unittest discover reference` still OK (discovery now descends into the `zisk` package).

- [ ] **Step 5: Commit**

```bash
git add reference/zisk/__init__.py reference/zisk/secp256k1.py reference/zisk/test_secp256k1.py
git commit -m "Add a pure Python secp256k1 for the zisk reference"
```

---

### Task 3: Ballot encryption for the zisk variant, with vectors

**Files:**
- Create: `reference/zisk/sealed.py`, `reference/zisk/test_sealed.py`, `reference/vectors/zisk/sealed.json`

**Interfaces:**
- Produces: `DOMAIN` (bytes), `derive_sk(master: bytes, key_salt: bytes) -> int`, `pubkey(sk: int) -> bytes` (33), `ballot_key(shared_x: int, voter: int) -> bytes`, `pad(key: bytes, m: int) -> bytes`, `encrypt(pk: bytes, voter: int, ranks: list, k: int) -> bytes`, `decrypt(sk: int, voter: int, ciphertext: bytes, m: int) -> list | None`. `voter` is the address as an integer (as the Noir reference does).
- Vector file schema: `{"vectors": [{"master", "keySalt", "sk", "pk", "voter", "m", "ranks", "k", "ciphertext"}]}`, every bytes/int field as `0x` hex (`sk`, `k` 32 bytes; `voter` 20 bytes; `pk`, `ciphertext` raw hex).

- [ ] **Step 1: Write the failing test**

```python
# reference/zisk/test_sealed.py
import json
import os
import sys
import unittest

from keccak import keccak256
from zisk import secp256k1 as ec
from zisk import sealed

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vectors", "zisk", "sealed.json")
MASTER = keccak256(b"zisk test master secret")
SALT = keccak256(b"zisk test key salt")
VOTER = 0x1000


def det_k(label):
    return int.from_bytes(keccak256(b"zisk-k:" + label), "big") % ec.N


def hx(b):
    return "0x" + (b.hex() if isinstance(b, bytes) else format(b, "x"))


def h32(n):
    return "0x" + format(n, "064x")


CASES = [
    # (label, m, ranks)
    ("strict", 4, [1, 2, 3, 4]),
    ("ties", 4, [1, 2, 2, 4]),
    ("partial", 4, [2, 1, 0, 0]),
    ("indifferent", 4, [0, 0, 0, 0]),
    ("one", 1, [1]),
    ("long", 31, [1 + (i % 5) if i % 5 else 0 for i in range(31)]),  # not a valid ranking; encrypt must not care
    ("wide", 40, list(range(1, 41))),  # more than one pad block
]


class SealedTest(unittest.TestCase):
    def setUp(self):
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)

    def test_key_derivation(self):
        self.assertEqual(self.sk, int.from_bytes(keccak256(MASTER + SALT), "big") % ec.N)
        self.assertEqual(self.pk, ec.compress(ec.mul(self.sk, ec.G)))
        self.assertEqual(len(self.pk), 33)

    def test_round_trip(self):
        for label, m, ranks in CASES:
            if not sealed.validate(ranks, m):
                continue
            ct = sealed.encrypt(self.pk, VOTER, ranks, det_k(label.encode()))
            self.assertEqual(len(ct), 33 + m)
            self.assertEqual(sealed.decrypt(self.sk, VOTER, ct, m), ranks)

    def test_wrong_address_or_key_or_length_is_absent(self):
        ct = sealed.encrypt(self.pk, VOTER, [1, 2, 3, 4], det_k(b"strict"))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER + 1, ct, 4))
        self.assertIsNone(sealed.decrypt((self.sk + 1) % ec.N, VOTER, ct, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct, 5))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct[:-1], 4))

    def test_malformed_point_is_absent(self):
        tail = bytes(4)
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x04" + bytes(32) + tail, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x02" + ec.P.to_bytes(32, "big") + tail, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x02" + (5).to_bytes(32, "big") + tail, 4))

    def test_invalid_plaintext_is_absent(self):
        ct = sealed.encrypt(self.pk, VOTER, [4, 4, 4, 4], det_k(b"bad"))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct, 4))

    def test_vectors_are_current(self):
        with open(VECTORS) as f:
            committed = json.load(f)
        self.assertEqual(committed, build_vectors())
        for v in committed["vectors"]:
            sk = int(v["sk"], 16)
            ct = bytes.fromhex(v["ciphertext"][2:])
            got = sealed.decrypt(sk, int(v["voter"], 16), ct, v["m"])
            expected = v["ranks"] if sealed.validate(v["ranks"], v["m"]) else None
            self.assertEqual(got, expected, v)


def build_vectors():
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)
    out = []
    for label, m, ranks in CASES:
        k = det_k(label.encode())
        out.append({
            "master": hx(MASTER), "keySalt": hx(SALT), "sk": h32(sk), "pk": hx(pk),
            "voter": "0x" + format(VOTER, "040x"), "m": m, "ranks": ranks, "k": h32(k),
            "ciphertext": hx(sealed.encrypt(pk, VOTER, ranks, k)),
        })
    return {"vectors": out}


def write_vectors():
    os.makedirs(os.path.dirname(VECTORS), exist_ok=True)
    with open(VECTORS, "w") as f:
        json.dump(build_vectors(), f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write":
        write_vectors()
    else:
        unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd reference && python3 -m unittest zisk.test_sealed -v`
Expected: import error on `zisk.sealed`.

- [ ] **Step 3: Implement**

```python
# reference/zisk/sealed.py
"""Sealed-ballot encryption of the zisk variant (spec Z3): secp256k1 ECDH, keccak pad."""

from ballots import validate  # noqa: F401  (re-exported; the tests use sealed.validate)
from keccak import keccak256
from zisk import secp256k1 as ec

DOMAIN = b"RankedShares/sealed/secp256k1"


def derive_sk(master, key_salt):
    return int.from_bytes(keccak256(master + key_salt), "big") % ec.N


def pubkey(sk):
    return ec.compress(ec.mul(sk, ec.G))


def ballot_key(shared_x, voter):
    return keccak256(DOMAIN + shared_x.to_bytes(32, "big") + voter.to_bytes(20, "big"))


def pad(key, m):
    blocks = b"".join(keccak256(key + bytes([b])) for b in range((m + 31) // 32))
    return blocks[:m]


def _xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def encrypt(pk, voter, ranks, k):
    """R ‖ (ranks ⊕ pad). `ranks` is not validated: the fixtures encrypt garbage on purpose."""
    r = ec.compress(ec.mul(k, ec.G))
    s = ec.mul(k, ec.decompress(pk))
    return r + _xor(bytes(ranks), pad(ballot_key(s[0], voter), len(ranks)))


def decrypt(sk, voter, ciphertext, m):
    """The ranks, or None when the ballot is absent for any reason (spec Z4 step 3)."""
    if len(ciphertext) != 33 + m:
        return None
    r = ec.decompress(ciphertext[:33])
    if r is None:
        return None
    s = ec.mul(sk, r)
    if s is None:
        return None
    ranks = list(_xor(ciphertext[33:], pad(ballot_key(s[0], voter), m)))
    return ranks if validate(ranks, m) else None
```

- [ ] **Step 4: Write the vectors, run the tests**

Run:
```bash
cd reference && python3 -m zisk.test_sealed --write && python3 -m unittest zisk.test_sealed -v
```
Expected: `reference/vectors/zisk/sealed.json` exists with 7 vectors; 6 tests OK. The module form (`-m zisk.test_sealed`) is required: it puts `reference/` on `sys.path`, which `from keccak import …` needs. Put that command in the module docstring.

- [ ] **Step 5: Commit**

```bash
git add reference/zisk/sealed.py reference/zisk/test_sealed.py reference/vectors/zisk/sealed.json
git commit -m "Add the zisk sealed-ballot encryption and its vectors"
```

---

### Task 4: Commitments: voter chain, inputsHash, output hash

**Files:**
- Create: `reference/zisk/commitments.py`, `reference/zisk/test_commitments.py`

**Interfaces:**
- Produces: `w32(n) -> bytes`, `voter_chain(voters) -> bytes` where each voter is a dict with `addr` (int), `directWeight` (int), `seatWeight` (int), `directBallot` (bytes, possibly empty), `ciphertext` (bytes, possibly empty); `costs_hash(costs) -> bytes`; `inputs_hash(chain_id, pool, chain, n, costs, total_weight) -> bytes`; `abi_encode_output(inputs_hash: bytes, pk: bytes, funded: list) -> bytes`; `output_hash(inputs_hash, pk, funded) -> bytes`.

- [ ] **Step 1: Write the failing test**

```python
# reference/zisk/test_commitments.py
import unittest

from keccak import keccak256
from zisk import commitments as cm

EMPTY = keccak256(b"")


class CommitmentsTest(unittest.TestCase):
    def test_voter_chain_one_voter_by_hand(self):
        v = {"addr": 0x1000, "directWeight": 5, "seatWeight": 7, "directBallot": b"\x01\x02", "ciphertext": b""}
        expected = keccak256(
            bytes(32) + (0x1000).to_bytes(20, "big") + cm.w32(5) + cm.w32(7) + keccak256(b"\x01\x02") + EMPTY
        )
        self.assertEqual(cm.voter_chain([v]), expected)
        self.assertEqual(cm.voter_chain([]), bytes(32))

    def test_voter_chain_is_order_sensitive(self):
        a = {"addr": 1, "directWeight": 0, "seatWeight": 0, "directBallot": b"", "ciphertext": b""}
        b = {"addr": 2, "directWeight": 0, "seatWeight": 0, "directBallot": b"", "ciphertext": b""}
        self.assertNotEqual(cm.voter_chain([a, b]), cm.voter_chain([b, a]))

    def test_inputs_hash_by_hand(self):
        chain = keccak256(b"chain")
        costs = [25, 50]
        expected = keccak256(
            cm.w32(31337) + (0xABCD).to_bytes(20, "big") + chain + cm.w32(3)
            + keccak256(cm.w32(25) + cm.w32(50)) + cm.w32(1000)
        )
        self.assertEqual(cm.inputs_hash(31337, 0xABCD, chain, 3, costs, 1000), expected)

    def test_abi_encode_output_layout(self):
        ih = keccak256(b"inputs")
        pk = bytes([2]) + bytes(range(32))
        enc = cm.abi_encode_output(ih, pk, [3, 0])
        words = [enc[i : i + 32] for i in range(0, len(enc), 32)]
        self.assertEqual(len(enc), 32 * 9)  # 3 heads, 2 for the pk tail, 1 length + 2 ids
        self.assertEqual(words[0], ih)
        self.assertEqual(words[1], cm.w32(0x60))  # offset of `bytes pk`
        self.assertEqual(words[2], cm.w32(0x60 + 32 + 64))  # offset of `uint256[] funded`
        self.assertEqual(words[3], cm.w32(33))
        self.assertEqual(words[4] + words[5], pk + bytes(31))
        self.assertEqual(words[6], cm.w32(2))
        self.assertEqual(words[7], cm.w32(3))
        self.assertEqual(words[8], cm.w32(0))
        enc2 = cm.abi_encode_output(ih, pk, [])
        self.assertEqual(len(enc2), 32 * 7)
        self.assertEqual(enc2[-32:], cm.w32(0))
        self.assertEqual(cm.output_hash(ih, pk, [3, 0]), keccak256(enc))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd reference && python3 -m unittest zisk.test_commitments -v`
Expected: import error.

- [ ] **Step 3: Implement**

```python
# reference/zisk/commitments.py
"""Commitments of the zisk variant (spec Z4 steps 2 and 5, Z5): voter chain, inputsHash,
and the ABI-encoded output whose keccak the guest commits."""

from keccak import keccak256


def w32(n):
    return int(n).to_bytes(32, "big")


def voter_chain(voters):
    h = bytes(32)
    for v in voters:
        h = keccak256(
            h
            + int(v["addr"]).to_bytes(20, "big")
            + w32(v["directWeight"])
            + w32(v["seatWeight"])
            + keccak256(bytes(v["directBallot"]))
            + keccak256(bytes(v["ciphertext"]))
        )
    return h


def costs_hash(costs):
    return keccak256(b"".join(w32(c) for c in costs))


def inputs_hash(chain_id, pool, chain, n, costs, total_weight):
    return keccak256(w32(chain_id) + int(pool).to_bytes(20, "big") + chain + w32(n) + costs_hash(costs) + w32(total_weight))


def abi_encode_output(inputs_hash_value, pk, funded):
    """abi.encode(bytes32, bytes, uint256[]) exactly as Solidity lays it out."""
    pk_tail = w32(len(pk)) + pk + bytes((-len(pk)) % 32)
    funded_tail = w32(len(funded)) + b"".join(w32(i) for i in funded)
    head = inputs_hash_value + w32(0x60) + w32(0x60 + len(pk_tail))
    return head + pk_tail + funded_tail


def output_hash(inputs_hash_value, pk, funded):
    return keccak256(abi_encode_output(inputs_hash_value, pk, funded))
```

- [ ] **Step 4: Run the tests**

Run: `cd reference && python3 -m unittest zisk.test_commitments -v`
Expected: 4 tests OK.

- [ ] **Step 5: Commit**

```bash
git add reference/zisk/commitments.py reference/zisk/test_commitments.py
git commit -m "Add the zisk voter chain, inputsHash and output encoding"
```

---

### Task 5: Fixture generator and fixtures

**Files:**
- Create: `reference/zisk/make_fixture.py`, `reference/zisk/test_fixture.py`, `reference/vectors/zisk/fixture_main.json`, `fixture_nosealed.json`, `fixture_nodirect.json`

**Interfaces:**
- Produces: `build(scenario) -> dict` and `write_fixture(fx, scenario, out_dir) -> path`; CLI `python3 -m zisk.make_fixture [--scenario NAME] [--out DIR]` run from `reference/` (default: all committed scenarios into `reference/vectors/zisk/`). Fixture keys, in order: `scenario, chainId, pool, m, costs, totalWeight, minDirectVote, master, keySalt, sk, pk, voters, voterChain, inputsHash, funded, outputHash`. Each voter: `addr` (0x + 40 hex), `directWeight`, `seatWeight` (0x + 64 hex), `directBallot`, `ciphertext` (0x + hex, `""` when absent), `directRanks` (list or null), `sealedRanks` (list, or null when absent or invalid), `k` (0x + 64 hex, or null when no fresh encryption was made).
- Consumed by: Task 8 (Rust), Task 10 (fixture-input), plan B (Foundry).

- [ ] **Step 1: Write the failing test**

```python
# reference/zisk/test_fixture.py
import json
import os
import tempfile
import unittest

from pbear import pbear
from zisk import make_fixture, sealed

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(os.path.dirname(HERE), "vectors", "zisk")
COMMITTED = ("main", "nosealed", "nodirect")


def load(scenario, directory=VECTORS):
    with open(os.path.join(directory, f"fixture_{scenario}.json")) as f:
        return json.load(f)


def entries_of(fx):
    m = fx["m"]
    sk = int(fx["sk"], 16)
    public = [(int(v["directWeight"], 16), v["directRanks"]) for v in fx["voters"] if v["directBallot"]]
    sealed_block = []
    for v in fx["voters"]:
        if not v["ciphertext"]:
            continue
        ranks = sealed.decrypt(sk, int(v["addr"], 16), bytes.fromhex(v["ciphertext"][2:]), m)
        if ranks is not None:
            sealed_block.append((int(v["seatWeight"], 16), ranks))
    return public + sealed_block


class GeneratorTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        with tempfile.TemporaryDirectory() as out_dir:
            for scenario in COMMITTED:
                produced = make_fixture.write_fixture(make_fixture.build(scenario), scenario, out_dir)
                with open(produced, "rb") as f:
                    fresh = f.read()
                with open(os.path.join(VECTORS, f"fixture_{scenario}.json"), "rb") as f:
                    self.assertEqual(fresh, f.read(), f"fixture_{scenario}.json is stale")

    def test_schema(self):
        for scenario in COMMITTED:
            fx = load(scenario)
            self.assertEqual(tuple(fx.keys()), make_fixture.FIXTURE_KEYS)
            for v in fx["voters"]:
                self.assertEqual(tuple(v.keys()), make_fixture.VOTER_KEYS)
                self.assertEqual(bool(v["directBallot"]), v["directRanks"] is not None)
                if v["directBallot"]:
                    self.assertEqual(len(bytes.fromhex(v["directBallot"][2:])), fx["m"])
                if v["ciphertext"]:
                    self.assertEqual(len(bytes.fromhex(v["ciphertext"][2:])), 33 + fx["m"])


class FixtureTest(unittest.TestCase):
    def test_funded_is_pbear_over_the_entry_list(self):
        for scenario in COMMITTED:
            fx = load(scenario)
            entries = entries_of(fx)
            abstaining = int(fx["totalWeight"], 16) - sum(w for w, _ in entries)
            self.assertGreaterEqual(abstaining, 0)
            self.assertEqual(pbear([int(c, 16) for c in fx["costs"]], entries, abstaining), fx["funded"])

    def test_main_exercises_every_case(self):
        fx = load("main")
        voters = fx["voters"]
        self.assertTrue(any(v["directBallot"] and v["ciphertext"] for v in voters), "both kinds")
        absent = [v for v in voters if v["ciphertext"] and v["sealedRanks"] is None]
        self.assertGreaterEqual(len(absent), 5, "copied, off-curve, x>=p, bad prefix, invalid ranking")
        self.assertTrue(any(v["ciphertext"] and int(v["seatWeight"], 16) == 0 for v in voters), "revoked seat")
        self.assertTrue(any(not v["directBallot"] and not v["ciphertext"] and int(v["seatWeight"], 16) for v in voters))
        self.assertTrue(any(not v["directBallot"] and not v["ciphertext"] and int(v["directWeight"], 16) for v in voters))
        self.assertGreater(len(fx["funded"]), 0)
        self.assertLess(len(fx["funded"]), fx["m"])

    def test_nosealed_and_nodirect(self):
        self.assertFalse(any(v["ciphertext"] for v in load("nosealed")["voters"]))
        self.assertFalse(any(v["directBallot"] for v in load("nodirect")["voters"]))

    def test_big_builds(self):
        fx = make_fixture.build("big")
        self.assertEqual(fx["m"], 16)
        self.assertEqual(len(fx["voters"]), 2200)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd reference && python3 -m unittest zisk.test_fixture -v`
Expected: import error on `zisk.make_fixture`.

- [ ] **Step 3: Write the generator**

```python
# reference/zisk/make_fixture.py
"""Write reference/vectors/zisk/fixture_<scenario>.json (spec Z7).

Usage, from `reference/`:  python3 -m zisk.make_fixture [--scenario NAME] [--out DIR]

Scenarios: `main` (every case the guest must handle), `nosealed`, `nodirect`, and `big`
(200 sealed and 2000 direct voters, 16 projects) which is only built on demand for
cycle measurements and is not committed.
"""

import json
import os
import sys

from keccak import keccak256
from pbear import pbear
from zisk import commitments as cm
from zisk import secp256k1 as ec
from zisk import sealed

MASTER = keccak256(b"zisk fixture master secret")
SALT = keccak256(b"zisk fixture key salt")
CHAIN_ID = 31337
POOL = int.from_bytes(keccak256(b"zisk fixture pool")[12:], "big")
MIN_DIRECT_VOTE = 10_000_000  # 10 USDC at 6 decimals
USDC = 1_000_000

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vectors", "zisk")
COMMITTED = ("main", "nosealed", "nodirect")

FIXTURE_KEYS = (
    "scenario", "chainId", "pool", "m", "costs", "totalWeight", "minDirectVote", "master",
    "keySalt", "sk", "pk", "voters", "voterChain", "inputsHash", "funded", "outputHash",
)
VOTER_KEYS = ("addr", "directWeight", "seatWeight", "directBallot", "ciphertext", "directRanks", "sealedRanks", "k")


def hx(n):
    return "0x" + format(int(n), "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def bx(b):
    return "0x" + b.hex() if b else ""


def det_k(label):
    return int.from_bytes(keccak256(b"zisk-k:" + label.encode()), "big") % ec.N


def ballot(m, order, kept=None):
    """Strict ranking over the first `kept` projects of `order`, rest unranked."""
    kept = m if kept is None else kept
    ranks = [0] * m
    for pos in range(kept):
        ranks[order[pos]] = pos + 1
    return ranks


def _bad_x():
    """The smallest x with no point on the curve, as 32 bytes."""
    x = 1
    while ec.decompress(b"\x02" + x.to_bytes(32, "big")) is not None:
        x += 1
    return x.to_bytes(32, "big")


class Roster:
    def __init__(self, m):
        self.m = m
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)
        self.voters = []

    def add(self, addr, direct=0, seat=0, direct_ranks=None, sealed_ranks=None, k_label=None, raw_ciphertext=None):
        v = {"addr": addr, "directWeight": direct, "seatWeight": seat,
             "directBallot": bytes(direct_ranks) if direct_ranks is not None else b"",
             "ciphertext": b"", "directRanks": direct_ranks, "sealedRanks": None, "k": None}
        if raw_ciphertext is not None:
            v["ciphertext"] = raw_ciphertext
        elif sealed_ranks is not None:
            k = det_k(k_label)
            v["k"] = k
            v["ciphertext"] = sealed.encrypt(self.pk, addr, sealed_ranks, k)
        if v["ciphertext"]:
            v["sealedRanks"] = sealed.decrypt(self.sk, addr, v["ciphertext"], self.m)
        self.voters.append(v)
        return v


def _roster(scenario):
    """(m, costs, roster, total_weight). Only this function differs between scenarios."""
    if scenario == "big":
        m = 16
        costs = [(c + 1) * 2500 * USDC for c in range(m)]
    else:
        m = 4
        # 50, 100, 150, 200 USDC: with the `main` roster below (255 USDC of public and
        # 210 USDC of sealed voting weight) PB-EAR funds projects 1, 2 and 0 and leaves 3
        # unfunded, so the fixture exercises a partial result.
        costs = [(c + 1) * 50 * USDC for c in range(m)]
    rot = lambda i: [(c + i) % m for c in range(m)]
    r = Roster(m)
    base = 0x1000
    dust = 7 * USDC  # unclaimed NFT seats and per-seat division dust

    if scenario == "nosealed":
        for i in range(3):
            r.add(base + i, direct=40 * USDC * (i + 1), direct_ranks=ballot(m, rot(i), kept=3))
        r.add(base + 0x506, direct=5 * USDC)  # never voted
    elif scenario == "nodirect":
        for i in range(5):
            r.add(base + 0x10 + i, seat=30 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % m), k_label=f"s{i}")
        r.add(base + 0x505, seat=30 * USDC)  # silent seat holder
    elif scenario == "big":
        for i in range(2000):
            r.add(base + i, direct=(10 + i % 50) * USDC, direct_ranks=ballot(m, rot(i % m), kept=1 + i % 5))
        for i in range(200):
            r.add(base + 0x1000 + i, seat=40 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % 7), k_label=f"b{i}")
    else:
        # three public-only voters
        for i in range(3):
            r.add(base + i, direct=40 * USDC * (i + 1), direct_ranks=ballot(m, rot(i), kept=3))
        # six sealed voters with valid ballots
        first = r.add(base + 0x10, seat=30 * USDC, sealed_ranks=ballot(m, rot(1)), k_label="s0")
        for i in range(1, 6):
            r.add(base + 0x10 + i, seat=30 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % m), k_label=f"s{i}")
        # one address with both kinds of weight and both ballots
        r.add(base + 0x500, direct=15 * USDC, seat=30 * USDC, direct_ranks=ballot(m, rot(2)), sealed_ranks=ballot(m, rot(3)), k_label="both")
        # absent sealed ballots of every kind the guest must survive
        r.add(base + 0x501, seat=30 * USDC, raw_ciphertext=first["ciphertext"])  # copied from another voter
        r.add(base + 0x502, seat=30 * USDC, raw_ciphertext=b"\x02" + _bad_x() + bytes(m))  # x off the curve
        r.add(base + 0x503, seat=30 * USDC, raw_ciphertext=b"\x02" + ec.P.to_bytes(32, "big") + bytes(m))  # x >= p
        r.add(base + 0x504, seat=30 * USDC, raw_ciphertext=b"\x04" + first["ciphertext"][1:])  # bad prefix
        r.add(base + 0x508, seat=30 * USDC, sealed_ranks=[m] * m, k_label="invalid")  # decrypts to an invalid ranking
        # silent seat holder, silent direct voter below the minimum, revoked seat with a ballot
        r.add(base + 0x505, seat=30 * USDC)
        r.add(base + 0x506, direct=5 * USDC)
        r.add(base + 0x507, seat=0, sealed_ranks=ballot(m, rot(0), kept=1), k_label="revoked")

    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in r.voters) + dust
    return m, costs, r, total_weight


def entries(voters):
    public = [(v["directWeight"], v["directRanks"]) for v in voters if v["directBallot"]]
    sealed_block = [(v["seatWeight"], v["sealedRanks"]) for v in voters if v["ciphertext"] and v["sealedRanks"] is not None]
    return public + sealed_block


def build(scenario="main"):
    m, costs, roster, total_weight = _roster(scenario)
    voters = roster.voters
    ents = entries(voters)
    abstaining = total_weight - sum(w for w, _ in ents)
    assert abstaining >= 0
    funded = pbear(costs, ents, abstaining)
    chain = cm.voter_chain(voters)
    ih = cm.inputs_hash(CHAIN_ID, POOL, chain, len(voters), costs, total_weight)
    oh = cm.output_hash(ih, roster.pk, funded)
    fx = {
        "scenario": scenario,
        "chainId": CHAIN_ID,
        "pool": addr_hex(POOL),
        "m": m,
        "costs": [hx(c) for c in costs],
        "totalWeight": hx(total_weight),
        "minDirectVote": hx(MIN_DIRECT_VOTE),
        "master": "0x" + MASTER.hex(),
        "keySalt": "0x" + SALT.hex(),
        "sk": hx(roster.sk),
        "pk": "0x" + roster.pk.hex(),
        "voters": [
            {
                "addr": addr_hex(v["addr"]),
                "directWeight": hx(v["directWeight"]),
                "seatWeight": hx(v["seatWeight"]),
                "directBallot": bx(v["directBallot"]),
                "ciphertext": bx(v["ciphertext"]),
                "directRanks": v["directRanks"],
                "sealedRanks": v["sealedRanks"],
                "k": hx(v["k"]) if v["k"] is not None else None,
            }
            for v in voters
        ],
        "voterChain": "0x" + chain.hex(),
        "inputsHash": "0x" + ih.hex(),
        "funded": funded,
        "outputHash": "0x" + oh.hex(),
    }
    assert tuple(fx.keys()) == FIXTURE_KEYS
    return fx


def write_fixture(fx, scenario, out_dir=VECTORS):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"fixture_{scenario}.json")
    with open(path, "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
    return path


def main(argv):
    scenarios, out_dir = COMMITTED, VECTORS
    args = argv[1:]
    while args:
        flag, value, *args = args
        if flag == "--scenario":
            scenarios = (value,)
        elif flag == "--out":
            out_dir = value
        else:
            raise SystemExit(__doc__)
    for scenario in scenarios:
        print(write_fixture(build(scenario), scenario, out_dir))


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Generate the fixtures and run the tests**

Run:
```bash
cd reference && python3 -m zisk.make_fixture && python3 -m unittest zisk.test_fixture -v && cd .. && python3 -m unittest discover reference
```
Expected: three files under `reference/vectors/zisk/`; `main` has 18 voters and `funded == [1, 2, 0]` (checked with the reference tally while writing this plan); all tests OK. The `big` build takes a few seconds (200 encryptions in pure Python; the scalar multiplications dominate).

- [ ] **Step 5: Commit**

```bash
git add reference/zisk/make_fixture.py reference/zisk/test_fixture.py reference/vectors/zisk/
git commit -m "Generate the zisk fixtures: main, nosealed, nodirect"
```

---

### Task 6: Rust workspace and the `pbear` crate

**Files:**
- Create: `zisk/Cargo.toml`, `zisk/.gitignore`, `zisk/crates/pbear/Cargo.toml`, `zisk/crates/pbear/src/lib.rs`, `zisk/crates/pbear/tests/differential.rs`

**Interfaces:**
- Produces: `pbear::Entry { weight: u64, ranks: Option<Vec<u8>> }`, `pbear::validate(ranks: &[u8], m: usize) -> bool`, `pbear::effective_ranks(ranks: &[u8]) -> Vec<u16>`, `pbear::tally(costs: &[u64], entries: &[Entry], abstaining: u64) -> Vec<u8>` (funded ids in funding order). `tally` panics on an entry whose ranks fail `validate`; callers pass `None` instead.

- [ ] **Step 1: Workspace skeleton**

```toml
# zisk/Cargo.toml
[workspace]
resolver = "2"
members = ["crates/pbear", "crates/sealed", "guest"]
# `cargo test` on the host builds only these; the guest is built by cargo-zisk (Task 10).
default-members = ["crates/pbear", "crates/sealed"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

```
# zisk/.gitignore
target/
proofs/
*.bin
```

```toml
# zisk/crates/pbear/Cargo.toml
[package]
name = "pbear"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "PB-EAR over u64 weights, matching RankedShares' PBEAR.sol and reference/pbear.py"

[dependencies]
```

Until Task 7 exists, `members` must not list `crates/sealed` and `guest`, or cargo refuses to load the workspace: start with `members = ["crates/pbear"]`, `default-members = ["crates/pbear"]`, and extend the lists in Tasks 7 and 10.

- [ ] **Step 2: Write the failing unit tests**

```rust
// zisk/crates/pbear/src/lib.rs  (tests first; the implementation goes above them in Step 4)
#[cfg(test)]
mod tests {
    use super::*;

    fn e(weight: u64, ranks: &[u8]) -> Entry {
        Entry { weight, ranks: Some(ranks.to_vec()) }
    }

    #[test]
    fn validate_matches_pbear_sol() {
        assert!(validate(&[1, 2, 3, 0], 4));
        assert!(validate(&[1, 2, 2, 4], 4));
        assert!(validate(&[0, 0, 0, 0], 4));
        assert!(!validate(&[1, 3, 0, 0], 4));
        assert!(!validate(&[2, 2, 0, 0], 4));
        assert!(!validate(&[1, 2, 3], 4));
        assert!(!validate(&[1, 2, 3, 5], 4));
        assert!(!validate(&[4, 4, 4, 4], 4));
    }

    #[test]
    fn effective_ranks_put_unranked_last() {
        assert_eq!(effective_ranks(&[2, 1, 0, 0]), vec![2, 1, 3, 3]);
        assert_eq!(effective_ranks(&[0, 0]), vec![1, 1]);
    }

    #[test]
    fn readme_example() {
        // README "The algorithm": 30 + 70 costs, one 40 voter a>b, one 60 voter b>a, budget 100.
        let funded = tally(&[30, 70], &[e(40, &[1, 2]), e(60, &[2, 1])], 0);
        assert_eq!(funded, vec![0, 1]);
    }

    #[test]
    fn ties_break_on_cost_then_id() {
        // Both projects reach their cost with the same support; the cheaper wins, and the
        // deduction leaves too little for the other one.
        assert_eq!(tally(&[50, 40], &[e(50, &[1, 1])], 40), vec![1]);
        // Same support and same cost: the lower id wins.
        assert_eq!(tally(&[40, 40], &[e(40, &[1, 1])], 40), vec![0]);
    }

    #[test]
    fn abstaining_weight_only_enlarges_the_budget() {
        // 25 of voting weight cannot fund a 30 project even though the budget allows it.
        assert_eq!(tally(&[30], &[e(25, &[1])], 100), Vec::<u8>::new());
        // A None ballot behaves like abstaining weight.
        assert_eq!(tally(&[30], &[e(25, &[1]), Entry { weight: 10, ranks: None }], 0), Vec::<u8>::new());
    }

    #[test]
    fn cumulative_rounding_is_integer_exact_at_u64_scale() {
        let big = u64::MAX / 4;
        let funded = tally(&[big, big], &[e(big, &[1, 2]), e(big, &[1, 2]), e(big, &[2, 1])], 0);
        assert_eq!(funded, vec![0, 1]);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd zisk && cargo test -p pbear`
Expected: compile errors, `Entry`, `validate`, `tally` not found.

- [ ] **Step 4: Implement**

Put this above the `tests` module:

```rust
//! PB-EAR (Aziz & Lee) with the integer arithmetic of `PBEAR.sol`, over `u64` weights.
//!
//! Same voter order, same support sums, same argmax (highest support, then lowest cost,
//! then lowest id), same cumulative rounding in voter order, same termination. The
//! Solidity engine is the definition; `reference/pbear.py` is the executable oracle the
//! differential test in `tests/differential.rs` runs against.

/// One tally entry: a weight and, unless the entry abstains, a competition ranking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub weight: u64,
    pub ranks: Option<Vec<u8>>,
}

/// `PBEAR._setBallot`'s check: length `m`, every rank `<= m`, no gaps.
pub fn validate(ranks: &[u8], m: usize) -> bool {
    if ranks.len() != m || ranks.iter().any(|&r| r as usize > m) {
        return false;
    }
    let mut counts = vec![0usize; m + 1];
    for &r in ranks {
        counts[r as usize] += 1;
    }
    let mut seen = 0usize;
    for r in 1..=m {
        if counts[r] != 0 && r != seen + 1 {
            return false;
        }
        seen += counts[r];
    }
    true
}

/// Unranked projects (`0`) form the last tier: `1 +` the number of ranked projects.
pub fn effective_ranks(ranks: &[u8]) -> Vec<u16> {
    let default = 1 + ranks.iter().filter(|&&r| r != 0).count() as u16;
    ranks.iter().map(|&r| if r == 0 { default } else { r as u16 }).collect()
}

/// The funded projects in funding order.
///
/// `abstaining` is weight that belongs to the budget but never supports anything: money
/// behind voters without a usable ballot, unclaimed seats, division dust.
pub fn tally(costs: &[u64], entries: &[Entry], abstaining: u64) -> Vec<u8> {
    let m = costs.len();
    let mut weights: Vec<u64> = entries.iter().map(|e| e.weight).collect();
    let ranks: Vec<Option<Vec<u16>>> = entries
        .iter()
        .map(|e| {
            e.ranks.as_ref().map(|r| {
                assert!(validate(r, m), "invalid ballot handed to tally");
                effective_ranks(r)
            })
        })
        .collect();
    let budget: u128 = weights.iter().map(|&w| w as u128).sum::<u128>() + abstaining as u128;

    let mut funded: Vec<u8> = Vec::new();
    let mut is_funded = vec![false; m];
    let mut spent: u128 = 0;
    let mut level: u16 = 1;

    let exhausted = |is_funded: &[bool], spent: u128| {
        (0..m).all(|c| is_funded[c] || spent + costs[c] as u128 > budget)
    };

    while !exhausted(&is_funded, spent) {
        let mut support = vec![0u128; m];
        for (i, r) in ranks.iter().enumerate() {
            let Some(r) = r else { continue };
            if weights[i] == 0 {
                continue;
            }
            for c in 0..m {
                if !is_funded[c] && r[c] <= level {
                    support[c] += weights[i] as u128;
                }
            }
        }
        let mut best: Option<usize> = None;
        for c in 0..m {
            if is_funded[c] || support[c] < costs[c] as u128 {
                continue;
            }
            best = match best {
                None => Some(c),
                Some(b) if support[c] > support[b] || (support[c] == support[b] && costs[c] < costs[b]) => Some(c),
                keep => keep,
            };
        }
        let Some(b) = best else {
            if level as usize >= m {
                break;
            }
            level += 1;
            continue;
        };
        let supporters: Vec<usize> = (0..ranks.len())
            .filter(|&i| ranks[i].as_ref().is_some_and(|r| weights[i] != 0 && r[b] <= level))
            .collect();
        let total: u128 = supporters.iter().map(|&i| weights[i] as u128).sum();
        let cost = costs[b] as u128;
        let mut cum: u128 = 0;
        for &i in &supporters {
            let new_cum = cum + weights[i] as u128;
            let d = new_cum * cost / total - cum * cost / total;
            weights[i] -= d as u64;
            cum = new_cum;
        }
        is_funded[b] = true;
        funded.push(b as u8);
        spent += cost;
    }
    funded
}
```

- [ ] **Step 5: Run the unit tests**

Run: `cd zisk && cargo test -p pbear`
Expected: 6 tests pass.

- [ ] **Step 6: Write the differential test against `reference/pbear.py`**

```rust
// zisk/crates/pbear/tests/differential.rs
//! Random instances tallied by `pbear::tally` and by `reference/pbear.py`, which is the
//! oracle the Foundry differential fuzz already uses. Needs `python3` on the PATH.

use pbear::{tally, Entry};
use std::path::PathBuf;
use std::process::Command;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A random competition ranking with ties: score each project 0..=3, 0 = unranked.
fn random_ranks(rng: &mut Rng, m: usize) -> Vec<u8> {
    let scores: Vec<u64> = (0..m).map(|_| rng.below(4)).collect();
    scores
        .iter()
        .map(|&s| if s == 0 { 0 } else { 1 + scores.iter().filter(|&&t| t != 0 && t > s).count() as u8 })
        .collect()
}

fn reference_py() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../reference/pbear.py")
}

fn oracle(costs: &[u64], entries: &[Entry], abstaining: u64) -> Vec<u8> {
    let voters: Vec<String> = entries
        .iter()
        .map(|e| match &e.ranks {
            Some(r) => format!("[{}, {:?}]", e.weight, r),
            None => format!("[{}, null]", e.weight),
        })
        .collect();
    let payload = format!(
        "{{\"costs\": {:?}, \"voters\": [{}], \"abstaining\": {}}}",
        costs,
        voters.join(", "),
        abstaining
    );
    let out = Command::new("python3").arg(reference_py()).arg(&payload).output().expect("python3 runs");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let hex = String::from_utf8(out.stdout).unwrap();
    let hex = hex.trim().trim_start_matches("0x");
    let words: Vec<u64> = (0..hex.len() / 64)
        .map(|i| u64::from_str_radix(&hex[i * 64 + 48..i * 64 + 64], 16).unwrap())
        .collect();
    // words: [0x20, len, ipsc, exhaustive, funded...]
    words[4..].iter().map(|&w| w as u8).collect()
}

#[test]
fn matches_python_reference_on_random_instances() {
    let mut rng = Rng(0x5EED_5EED_5EED_5EED);
    for round in 0..150 {
        let m = 1 + rng.below(5) as usize;
        let huge = round % 5 == 4; // exercise the u128 path
        let scale: u64 = if huge { 1 << 58 } else { 1 };
        let costs: Vec<u64> = (0..m).map(|_| (1 + rng.below(60)) * scale).collect();
        let n = rng.below(9) as usize;
        let entries: Vec<Entry> = (0..n)
            .map(|_| Entry {
                weight: rng.below(50) * scale,
                ranks: if rng.below(8) == 0 { None } else { Some(random_ranks(&mut rng, m)) },
            })
            .collect();
        let abstaining = rng.below(40) * scale;
        assert_eq!(tally(&costs, &entries, abstaining), oracle(&costs, &entries, abstaining), "round {round}: costs {costs:?} entries {entries:?} abstaining {abstaining}");
    }
}
```

- [ ] **Step 7: Run it**

Run: `cd zisk && cargo test -p pbear --test differential`
Expected: passes in a few seconds (150 Python spawns). A mismatch here is a bug in the Rust port, never in the oracle; fix the port.

- [ ] **Step 8: Commit**

```bash
git add zisk/Cargo.toml zisk/Cargo.lock zisk/.gitignore zisk/crates/pbear
git commit -m "Add the zisk workspace and a PB-EAR crate checked against the Python oracle"
```

---

### Task 7: `sealed` crate: types, curve, keccak, encryption

**Files:**
- Create: `zisk/crates/sealed/Cargo.toml`, `src/lib.rs`, `src/types.rs`, `src/curve.rs`, `src/hash.rs`, `src/ballot.rs`, `tests/common/mod.rs`, `tests/vectors.rs`
- Modify: `zisk/Cargo.toml` (add `crates/sealed` to `members` and `default-members`)

**Interfaces:**
- Produces:
  - `sealed::types::{VoterIn, TallyInput, TallyOutput}` as in spec Z4 (`TallyOutput { inputs_hash: [u8; 32], pk: [u8; 33], funded_order: Vec<u8>, output_hash: [u8; 32] }`).
  - `sealed::curve::pubkey(sk: &[u8; 32]) -> Option<[u8; 33]>`, `sealed::curve::shared_x(scalar: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]>`.
  - `sealed::hash::keccak256(data: &[u8]) -> [u8; 32]`.
  - `sealed::ballot::{DOMAIN, ballot_key, pad, encrypt(pk, voter, ranks, k) -> Option<Vec<u8>>, decrypt(sk, voter, ciphertext, m) -> Option<Vec<u8>>}`.
  - Test helper `tests/common/mod.rs`: `hex_bytes(&str) -> Vec<u8>`, `hex_u64(&str) -> u64`, `hex_arr::<N>(&str) -> [u8; N]`, `vectors_dir() -> PathBuf`, `load_json(name) -> serde_json::Value`.

- [ ] **Step 1: Manifest and module skeleton**

```toml
# zisk/crates/sealed/Cargo.toml
[package]
name = "sealed"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Sealed-ballot decryption, commitments and the whole tally of the zisk variant"

[dependencies]
pbear = { path = "../pbear" }
serde = { version = "1", default-features = false, features = ["derive", "alloc"] }
bincode = { version = "2", default-features = false, features = ["alloc", "serde"] }
# Host-side tools (fixture-input binary). The guest builds with default-features = false.
serde_json = { version = "1", optional = true }
hex = { version = "0.4", optional = true }

[target.'cfg(target_os = "zkvm")'.dependencies]
ziskos = { git = "https://github.com/0xPolygonHermez/zisk.git", tag = "v1.2.0-alpha" }

[target.'cfg(not(target_os = "zkvm"))'.dependencies]
k256 = { version = "0.13", default-features = false, features = ["arithmetic"] }
tiny-keccak = { version = "2", features = ["keccak"] }

[dev-dependencies]
serde_json = "1"
hex = "0.4"

[features]
default = ["tools"]
tools = ["dep:serde_json", "dep:hex"]

[[bin]]
name = "fixture-input"
path = "src/bin/fixture-input.rs"
required-features = ["tools"]
```

```rust
// zisk/crates/sealed/src/lib.rs
//! The zisk variant's guest logic, usable on the host as well: decrypt sealed ballots,
//! recompute the commitments, run PB-EAR, hash the result. `curve` and `hash` have a
//! `ziskos::zisklib` implementation on the guest target and a `k256`/`tiny-keccak` one
//! elsewhere; everything above them is one code path.

pub mod ballot;
pub mod commitments;
pub mod curve;
pub mod hash;
pub mod io;
pub mod tally;
pub mod types;
```

(`commitments`, `io` and `tally` are written in Task 8; create them as empty files now so the crate compiles, or add the `pub mod` lines in Task 8. Pick the latter: in this task `lib.rs` declares only `ballot`, `curve`, `hash`, `types`.)

Add `"crates/sealed"` to both lists in `zisk/Cargo.toml`. The `fixture-input` binary is written in Task 10; until then leave the `[[bin]]` block out of the manifest too (cargo errors on a missing `path`).

- [ ] **Step 2: Types**

```rust
// zisk/crates/sealed/src/types.rs
use serde::{Deserialize, Serialize};

/// One registered voter as the contract holds it after `close` (spec Z4).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct VoterIn {
    pub addr: [u8; 20],
    pub direct_weight: u64,
    pub seat_weight: u64,
    /// `m` bytes, or empty when the voter cast no direct ballot.
    pub direct_ballot: Vec<u8>,
    /// `33 + m` bytes, or empty when the voter cast no sealed ballot.
    pub ciphertext: Vec<u8>,
}

/// The guest's private witness. bincode 2 `standard()` encoding, framed by `io::frame`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TallyInput {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub sk: [u8; 32],
    pub costs: Vec<u64>,
    pub total_weight: u64,
    pub voters: Vec<VoterIn>,
}

/// What `tally::run` computes. Only `output_hash` leaves the guest.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TallyOutput {
    pub inputs_hash: [u8; 32],
    pub pk: [u8; 33],
    pub funded_order: Vec<u8>,
    pub output_hash: [u8; 32],
}
```

- [ ] **Step 3: Write the failing vector test**

```rust
// zisk/crates/sealed/tests/common/mod.rs
#![allow(dead_code)]
use std::path::PathBuf;

pub fn hex_bytes(s: &str) -> Vec<u8> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() {
        return Vec::new();
    }
    hex::decode(s).expect("hex")
}

pub fn hex_arr<const N: usize>(s: &str) -> [u8; N] {
    hex_bytes(s).try_into().expect("length")
}

pub fn hex_u64(s: &str) -> u64 {
    let b = hex_bytes(s);
    assert!(b.len() == 32 && b[..24].iter().all(|&x| x == 0), "fits u64");
    u64::from_be_bytes(b[24..].try_into().unwrap())
}

pub fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../reference/vectors/zisk")
}

pub fn load_json(name: &str) -> serde_json::Value {
    let text = std::fs::read_to_string(vectors_dir().join(name)).expect("fixture file");
    serde_json::from_str(&text).expect("json")
}
```

```rust
// zisk/crates/sealed/tests/vectors.rs
mod common;
use common::*;
use sealed::{ballot, curve, hash};

#[test]
fn keccak_matches_known_digests() {
    assert_eq!(
        hex::encode(hash::keccak256(b"")),
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    assert_eq!(
        hex::encode(hash::keccak256(b"abc")),
        "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    );
}

#[test]
fn pubkey_matches_vectors() {
    let v = load_json("sealed.json");
    for case in v["vectors"].as_array().unwrap() {
        let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
        let pk: [u8; 33] = hex_arr(case["pk"].as_str().unwrap());
        assert_eq!(curve::pubkey(&sk), Some(pk));
    }
}

#[test]
fn encrypt_and_decrypt_match_vectors() {
    let v = load_json("sealed.json");
    for case in v["vectors"].as_array().unwrap() {
        let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
        let pk: [u8; 33] = hex_arr(case["pk"].as_str().unwrap());
        let k: [u8; 32] = hex_arr(case["k"].as_str().unwrap());
        let voter: [u8; 20] = hex_arr(case["voter"].as_str().unwrap());
        let m = case["m"].as_u64().unwrap() as usize;
        let ranks: Vec<u8> = case["ranks"].as_array().unwrap().iter().map(|r| r.as_u64().unwrap() as u8).collect();
        let ct = hex_bytes(case["ciphertext"].as_str().unwrap());
        assert_eq!(ballot::encrypt(&pk, &voter, &ranks, &k), Some(ct.clone()), "{case}");
        let expected = if pbear::validate(&ranks, m) { Some(ranks) } else { None };
        assert_eq!(ballot::decrypt(&sk, &voter, &ct, m), expected, "{case}");
    }
}

#[test]
fn garbage_is_absent() {
    let v = load_json("sealed.json");
    let case = &v["vectors"][0];
    let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
    let voter: [u8; 20] = hex_arr(case["voter"].as_str().unwrap());
    let m = case["m"].as_u64().unwrap() as usize;
    let ct = hex_bytes(case["ciphertext"].as_str().unwrap());
    let mut other = voter;
    other[19] ^= 1;
    assert_eq!(ballot::decrypt(&sk, &other, &ct, m), None);
    assert_eq!(ballot::decrypt(&sk, &voter, &ct[..ct.len() - 1], m), None);
    let mut bad_prefix = ct.clone();
    bad_prefix[0] = 4;
    assert_eq!(ballot::decrypt(&sk, &voter, &bad_prefix, m), None);
    let mut x_too_big = ct.clone();
    x_too_big[1..33].copy_from_slice(&[0xff; 32]);
    assert_eq!(ballot::decrypt(&sk, &voter, &x_too_big, m), None);
    let mut off_curve = ct.clone();
    off_curve[1..33].copy_from_slice(&[0; 32]);
    off_curve[32] = 5; // x = 5 has no point
    assert_eq!(ballot::decrypt(&sk, &voter, &off_curve, m), None);
    assert_eq!(curve::pubkey(&[0u8; 32]), None);
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd zisk && cargo test -p sealed --test vectors`
Expected: compile errors (`curve`, `hash`, `ballot` missing).

- [ ] **Step 5: Implement `hash`, `curve`, `ballot`**

```rust
// zisk/crates/sealed/src/hash.rs
//! keccak-256: ZisK's accelerated `zisklib::keccak256` on the guest, tiny-keccak elsewhere.

#[cfg(target_os = "zkvm")]
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    ziskos::zisklib::keccak256(data)
}

#[cfg(not(target_os = "zkvm"))]
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut h = Keccak::v256();
    h.update(data);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    out
}
```

```rust
// zisk/crates/sealed/src/curve.rs
//! secp256k1 for ECDH: `pubkey` and `shared_x`. Points are SEC1 compressed. Every
//! malformed input is `None`; nothing here panics on voter-chosen bytes (spec Z4).

/// `scalar·G`, compressed. `None` when the scalar is zero or not below the group order.
pub fn pubkey(scalar: &[u8; 32]) -> Option<[u8; 33]> {
    imp::pubkey(scalar)
}

/// The x coordinate of `scalar·point`. `None` for a bad prefix, a wrong length, `x >= p`,
/// an x with no point on the curve, a bad scalar, or a product equal to the identity.
pub fn shared_x(scalar: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
    imp::shared_x(scalar, point)
}

#[cfg(target_os = "zkvm")]
mod imp {
    use ziskos::zisklib::{lift_x_secp256k1, scalar_mul_secp256k1};

    // Little-endian u64 limbs, as zisklib represents field elements and scalars.
    const P: [u64; 4] = [0xFFFFFFFEFFFFFC2F, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF];
    const N: [u64; 4] = [0xBFD25E8CD0364141, 0xBAAEDCE6AF48A03B, 0xFFFFFFFFFFFFFFFE, 0xFFFFFFFFFFFFFFFF];
    const G: [u64; 8] = [
        0x59F2815B16F81798, 0x029BFCDB2DCE28D9, 0x55A06295CE870B07, 0x79BE667EF9DCBBAC,
        0x9C47D08FFB10D4B8, 0xFD17B448A6855419, 0x5DA4FBFC0E1108A8, 0x483ADA7726A3C465,
    ];

    fn to_limbs(b: &[u8; 32]) -> [u64; 4] {
        let mut out = [0u64; 4];
        for i in 0..4 {
            out[i] = u64::from_be_bytes(b[32 - 8 * (i + 1)..32 - 8 * i].try_into().unwrap());
        }
        out
    }

    fn from_limbs(l: &[u64]) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..4 {
            out[32 - 8 * (i + 1)..32 - 8 * i].copy_from_slice(&l[i].to_be_bytes());
        }
        out
    }

    fn lt(a: &[u64; 4], b: &[u64; 4]) -> bool {
        for i in (0..4).rev() {
            if a[i] != b[i] {
                return a[i] < b[i];
            }
        }
        false
    }

    fn scalar(s: &[u8; 32]) -> Option<[u64; 4]> {
        let k = to_limbs(s);
        (k != [0; 4] && lt(&k, &N)).then_some(k)
    }

    fn compress(p: &[u64; 8]) -> [u8; 33] {
        let mut out = [0u8; 33];
        out[0] = 2 + (p[4] & 1) as u8;
        out[1..].copy_from_slice(&from_limbs(&p[..4]));
        out
    }

    pub fn pubkey(s: &[u8; 32]) -> Option<[u8; 33]> {
        let k = scalar(s)?;
        scalar_mul_secp256k1(&k, &G).map(|p| compress(&p))
    }

    pub fn shared_x(s: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
        if point[0] != 2 && point[0] != 3 {
            return None;
        }
        let x = to_limbs(point[1..].try_into().unwrap());
        if !lt(&x, &P) {
            return None;
        }
        let p = lift_x_secp256k1(&x, point[0] == 3).ok()?;
        let k = scalar(s)?;
        scalar_mul_secp256k1(&k, &p).map(|q| from_limbs(&q[..4]))
    }
}

#[cfg(not(target_os = "zkvm"))]
mod imp {
    use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
    use k256::elliptic_curve::{Field, PrimeField};
    use k256::{AffinePoint, EncodedPoint, ProjectivePoint, Scalar};

    fn scalar(s: &[u8; 32]) -> Option<Scalar> {
        let k: Option<Scalar> = Scalar::from_repr((*s).into()).into();
        k.filter(|k| *k != Scalar::ZERO)
    }

    pub fn pubkey(s: &[u8; 32]) -> Option<[u8; 33]> {
        let k = scalar(s)?;
        let ep = (ProjectivePoint::GENERATOR * k).to_affine().to_encoded_point(true);
        ep.as_bytes().try_into().ok()
    }

    pub fn shared_x(s: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
        if point[0] != 2 && point[0] != 3 {
            return None;
        }
        let ep = EncodedPoint::from_bytes(point).ok()?;
        let a: Option<AffinePoint> = AffinePoint::from_encoded_point(&ep).into();
        let k = scalar(s)?;
        let q = (ProjectivePoint::from(a?) * k).to_affine().to_encoded_point(false);
        if q.is_identity() {
            return None;
        }
        q.x().map(|x| x.as_slice().try_into().unwrap())
    }
}
```

```rust
// zisk/crates/sealed/src/ballot.rs
//! The sealed-ballot scheme of spec Z3, on top of `curve` and `hash`.

use crate::{curve, hash::keccak256};

pub const DOMAIN: &[u8] = b"RankedShares/sealed/secp256k1";

pub fn ballot_key(shared_x: &[u8; 32], voter: &[u8; 20]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(DOMAIN.len() + 52);
    buf.extend_from_slice(DOMAIN);
    buf.extend_from_slice(shared_x);
    buf.extend_from_slice(voter);
    keccak256(&buf)
}

pub fn pad(key: &[u8; 32], m: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(m + 32);
    for b in 0..m.div_ceil(32) {
        let mut buf = [0u8; 33];
        buf[..32].copy_from_slice(key);
        buf[32] = b as u8;
        out.extend_from_slice(&keccak256(&buf));
    }
    out.truncate(m);
    out
}

/// `R ‖ (ranks ⊕ pad)`. `ranks` is not validated (the fixtures encrypt garbage on purpose).
/// `None` only for a bad `pk` or `k`; used by tests and by plan B's tooling.
pub fn encrypt(pk: &[u8; 33], voter: &[u8; 20], ranks: &[u8], k: &[u8; 32]) -> Option<Vec<u8>> {
    let r = curve::pubkey(k)?;
    let sx = curve::shared_x(k, pk)?;
    let key = ballot_key(&sx, voter);
    let mut out = Vec::with_capacity(33 + ranks.len());
    out.extend_from_slice(&r);
    out.extend(ranks.iter().zip(pad(&key, ranks.len())).map(|(a, b)| a ^ b));
    Some(out)
}

/// The ranks, or `None` when the ballot is absent for any reason (spec Z4 step 3).
pub fn decrypt(sk: &[u8; 32], voter: &[u8; 20], ciphertext: &[u8], m: usize) -> Option<Vec<u8>> {
    if ciphertext.len() != 33 + m {
        return None;
    }
    let r: [u8; 33] = ciphertext[..33].try_into().unwrap();
    let sx = curve::shared_x(sk, &r)?;
    let key = ballot_key(&sx, voter);
    let ranks: Vec<u8> = ciphertext[33..].iter().zip(pad(&key, m)).map(|(a, b)| a ^ b).collect();
    pbear::validate(&ranks, m).then_some(ranks)
}
```

- [ ] **Step 6: Run the tests**

Run: `cd zisk && cargo test -p sealed`
Expected: the 4 vector tests pass on the host path. If `k256`'s API differs in small ways (`Scalar::ZERO` visibility, `is_identity` on `EncodedPoint`), adjust to the 0.13 API; do not change the behaviour under test. Also run `cargo build -p sealed --no-default-features` to be sure the guest-facing feature set compiles on the host.

- [ ] **Step 7: Commit**

```bash
git add zisk/Cargo.toml zisk/Cargo.lock zisk/crates/sealed
git commit -m "Add the sealed crate: types, secp256k1 ECDH, keccak pad, vectors test"
```

---

### Task 8: `sealed` crate: commitments, input framing and `tally::run`

**Files:**
- Create: `zisk/crates/sealed/src/commitments.rs`, `src/io.rs`, `src/tally.rs`, `tests/fixtures.rs`
- Modify: `zisk/crates/sealed/src/lib.rs` (declare the three modules)

**Interfaces:**
- Produces:
  - `sealed::commitments::{w32(u64) -> [u8; 32], voter_chain(&[VoterIn]) -> [u8; 32], inputs_hash(chain_id: u64, pool: &[u8; 20], chain: &[u8; 32], n: u64, costs: &[u64], total_weight: u64) -> [u8; 32], abi_encode_output(&[u8; 32], pk: &[u8], funded: &[u8]) -> Vec<u8>, output_hash(&[u8; 32], &[u8], &[u8]) -> [u8; 32]}`.
  - `sealed::io::{encode_input(&TallyInput) -> Vec<u8>, decode_input(&[u8]) -> Result<TallyInput, String>, frame(&[u8]) -> Vec<u8>}`; `frame` is the ZisK stdin frame (`u64 LE length ‖ bytes ‖ pad to 8`).
  - `sealed::tally::{Error, run(&TallyInput) -> Result<TallyOutput, Error>}` with `Error::{InvalidKey, BadCosts, WeightsExceedBudget}`.
- Consumed by: Task 10 (guest and fixture-input), plan B (prover `check`).

- [ ] **Step 1: Write the failing fixture test**

```rust
// zisk/crates/sealed/tests/fixtures.rs
mod common;
use common::*;
use sealed::types::{TallyInput, VoterIn};
use sealed::{commitments, io, tally};

pub fn input_of(fx: &serde_json::Value) -> TallyInput {
    TallyInput {
        chain_id: fx["chainId"].as_u64().unwrap(),
        pool: hex_arr(fx["pool"].as_str().unwrap()),
        sk: hex_arr(fx["sk"].as_str().unwrap()),
        costs: fx["costs"].as_array().unwrap().iter().map(|c| hex_u64(c.as_str().unwrap())).collect(),
        total_weight: hex_u64(fx["totalWeight"].as_str().unwrap()),
        voters: fx["voters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| VoterIn {
                addr: hex_arr(v["addr"].as_str().unwrap()),
                direct_weight: hex_u64(v["directWeight"].as_str().unwrap()),
                seat_weight: hex_u64(v["seatWeight"].as_str().unwrap()),
                direct_ballot: hex_bytes(v["directBallot"].as_str().unwrap()),
                ciphertext: hex_bytes(v["ciphertext"].as_str().unwrap()),
            })
            .collect(),
    }
}

const SCENARIOS: [&str; 3] = ["main", "nosealed", "nodirect"];

#[test]
fn commitments_match_every_fixture() {
    for s in SCENARIOS {
        let fx = load_json(&format!("fixture_{s}.json"));
        let input = input_of(&fx);
        let chain = commitments::voter_chain(&input.voters);
        assert_eq!(hex::encode(chain), fx["voterChain"].as_str().unwrap().trim_start_matches("0x"), "{s}");
        let ih = commitments::inputs_hash(input.chain_id, &input.pool, &chain, input.voters.len() as u64, &input.costs, input.total_weight);
        assert_eq!(hex::encode(ih), fx["inputsHash"].as_str().unwrap().trim_start_matches("0x"), "{s}");
    }
}

#[test]
fn run_reproduces_every_fixture() {
    for s in SCENARIOS {
        let fx = load_json(&format!("fixture_{s}.json"));
        let out = tally::run(&input_of(&fx)).unwrap();
        let funded: Vec<u8> = fx["funded"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect();
        assert_eq!(out.funded_order, funded, "{s}");
        assert_eq!(hex::encode(out.pk), fx["pk"].as_str().unwrap().trim_start_matches("0x"), "{s}");
        assert_eq!(hex::encode(out.output_hash), fx["outputHash"].as_str().unwrap().trim_start_matches("0x"), "{s}");
    }
}

#[test]
fn decryption_agrees_with_the_fixture_per_voter() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    for (v, j) in input.voters.iter().zip(fx["voters"].as_array().unwrap()) {
        if v.ciphertext.is_empty() {
            continue;
        }
        let expected: Option<Vec<u8>> = j["sealedRanks"].as_array().map(|a| a.iter().map(|r| r.as_u64().unwrap() as u8).collect());
        assert_eq!(sealed::ballot::decrypt(&input.sk, &v.addr, &v.ciphertext, input.costs.len()), expected, "{}", j["addr"]);
    }
}

#[test]
fn input_round_trips_through_bincode_and_the_frame() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    let bytes = io::encode_input(&input);
    assert_eq!(io::decode_input(&bytes).unwrap(), input);
    let framed = io::frame(&bytes);
    assert_eq!(&framed[..8], &(bytes.len() as u64).to_le_bytes());
    assert_eq!(framed.len() % 8, 0);
    assert_eq!(&framed[8..8 + bytes.len()], &bytes[..]);
}

#[test]
fn operator_errors_are_reported_not_panicked() {
    let fx = load_json("fixture_main.json");
    let mut input = input_of(&fx);
    input.sk = [0u8; 32];
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::InvalidKey);
    let mut input = input_of(&fx);
    input.total_weight = 0;
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::WeightsExceedBudget);
    let mut input = input_of(&fx);
    input.costs.clear();
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::BadCosts);
}

#[test]
fn voter_garbage_never_panics() {
    let fx = load_json("fixture_main.json");
    let mut input = input_of(&fx);
    for v in input.voters.iter_mut() {
        v.direct_ballot = vec![9; 3]; // wrong length and invalid
        v.ciphertext = vec![0xff; 33 + input.costs.len()];
    }
    let out = tally::run(&input).unwrap();
    assert!(out.funded_order.is_empty());
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd zisk && cargo test -p sealed --test fixtures`
Expected: compile errors (`commitments`, `io`, `tally` missing).

- [ ] **Step 3: Implement**

```rust
// zisk/crates/sealed/src/commitments.rs
//! The voter chain and `inputsHash` of spec Z5 (what `close` computes) and the ABI-encoded
//! output of spec Z4 step 5 (what `finalize` recomputes).

use crate::hash::keccak256;
use crate::types::VoterIn;

pub fn w32(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

pub fn voter_chain(voters: &[VoterIn]) -> [u8; 32] {
    let mut h = [0u8; 32];
    for v in voters {
        let mut buf = Vec::with_capacity(180);
        buf.extend_from_slice(&h);
        buf.extend_from_slice(&v.addr);
        buf.extend_from_slice(&w32(v.direct_weight));
        buf.extend_from_slice(&w32(v.seat_weight));
        buf.extend_from_slice(&keccak256(&v.direct_ballot));
        buf.extend_from_slice(&keccak256(&v.ciphertext));
        h = keccak256(&buf);
    }
    h
}

pub fn costs_hash(costs: &[u64]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(32 * costs.len());
    for &c in costs {
        buf.extend_from_slice(&w32(c));
    }
    keccak256(&buf)
}

pub fn inputs_hash(chain_id: u64, pool: &[u8; 20], chain: &[u8; 32], n: u64, costs: &[u64], total_weight: u64) -> [u8; 32] {
    let mut buf = Vec::with_capacity(32 + 20 + 32 + 32 + 32 + 32);
    buf.extend_from_slice(&w32(chain_id));
    buf.extend_from_slice(pool);
    buf.extend_from_slice(chain);
    buf.extend_from_slice(&w32(n));
    buf.extend_from_slice(&costs_hash(costs));
    buf.extend_from_slice(&w32(total_weight));
    keccak256(&buf)
}

/// `abi.encode(bytes32 inputsHash, bytes pk, uint256[] fundedOrder)`.
pub fn abi_encode_output(inputs_hash: &[u8; 32], pk: &[u8], funded: &[u8]) -> Vec<u8> {
    let pk_padded = pk.len().div_ceil(32) * 32;
    let mut out = Vec::with_capacity(96 + 32 + pk_padded + 32 + 32 * funded.len());
    out.extend_from_slice(inputs_hash);
    out.extend_from_slice(&w32(0x60));
    out.extend_from_slice(&w32(0x60 + 32 + pk_padded as u64));
    out.extend_from_slice(&w32(pk.len() as u64));
    out.extend_from_slice(pk);
    out.resize(out.len() + pk_padded - pk.len(), 0);
    out.extend_from_slice(&w32(funded.len() as u64));
    for &id in funded {
        out.extend_from_slice(&w32(id as u64));
    }
    out
}

pub fn output_hash(inputs_hash: &[u8; 32], pk: &[u8], funded: &[u8]) -> [u8; 32] {
    keccak256(&abi_encode_output(inputs_hash, pk, funded))
}
```

```rust
// zisk/crates/sealed/src/io.rs
//! Encoding of the guest input: bincode 2 `standard()` (what `ziskos::io::read` decodes)
//! and the ZisK stdin frame the CLI and emulator expect in an input file.

use crate::types::TallyInput;

pub fn encode_input(input: &TallyInput) -> Vec<u8> {
    bincode::serde::encode_to_vec(input, bincode::config::standard()).expect("serialize")
}

pub fn decode_input(bytes: &[u8]) -> Result<TallyInput, String> {
    bincode::serde::decode_from_slice(bytes, bincode::config::standard())
        .map(|(v, _)| v)
        .map_err(|e| e.to_string())
}

/// `u64 LE length ‖ bytes ‖ zero padding to a multiple of 8` (ZiskStdin::write_slice).
pub fn frame(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + bytes.len() + 8);
    out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(bytes);
    let pad = (8 - out.len() % 8) % 8;
    out.resize(out.len() + pad, 0);
    out
}
```

```rust
// zisk/crates/sealed/src/tally.rs
//! Spec Z4: from the private witness to the committed output hash. Shared by the guest
//! and by `tally-prover check`.

use crate::ballot::decrypt;
use crate::commitments::{inputs_hash, output_hash, voter_chain};
use crate::curve;
use crate::types::{TallyInput, TallyOutput};
use pbear::{validate, Entry};

/// Errors caused by the operator's own input. Voter-chosen bytes never produce one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// `sk` is zero or not below the secp256k1 group order.
    InvalidKey,
    /// No projects, or more than 31.
    BadCosts,
    /// The listed entry weights exceed `total_weight`; the input does not come from `close`.
    WeightsExceedBudget,
}

pub fn run(input: &TallyInput) -> Result<TallyOutput, Error> {
    let m = input.costs.len();
    if m == 0 || m > 31 {
        return Err(Error::BadCosts);
    }
    let pk = curve::pubkey(&input.sk).ok_or(Error::InvalidKey)?;

    let chain = voter_chain(&input.voters);
    let ih = inputs_hash(input.chain_id, &input.pool, &chain, input.voters.len() as u64, &input.costs, input.total_weight);

    let mut entries: Vec<Entry> = Vec::new();
    let mut voting: u128 = 0;
    // Public block: every voter with a direct ballot, registration order.
    for v in &input.voters {
        if !v.direct_ballot.is_empty() && validate(&v.direct_ballot, m) {
            entries.push(Entry { weight: v.direct_weight, ranks: Some(v.direct_ballot.clone()) });
            voting += v.direct_weight as u128;
        }
    }
    // Sealed block: every voter whose ciphertext decrypts, registration order.
    for v in &input.voters {
        if v.ciphertext.is_empty() {
            continue;
        }
        if let Some(ranks) = decrypt(&input.sk, &v.addr, &v.ciphertext, m) {
            entries.push(Entry { weight: v.seat_weight, ranks: Some(ranks) });
            voting += v.seat_weight as u128;
        }
    }
    let abstaining = (input.total_weight as u128).checked_sub(voting).ok_or(Error::WeightsExceedBudget)? as u64;

    let funded_order = pbear::tally(&input.costs, &entries, abstaining);
    let oh = output_hash(&ih, &pk, &funded_order);
    Ok(TallyOutput { inputs_hash: ih, pk, funded_order, output_hash: oh })
}
```

Add `pub mod commitments; pub mod io; pub mod tally;` to `lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cd zisk && cargo test -p sealed`
Expected: all vector and fixture tests pass. A mismatch in `commitments_match_every_fixture` means the byte layout differs from the Python; compare `w32`, the address width and the empty-bytes hashing before anything else. A mismatch in `run_reproduces_every_fixture` with matching commitments means the entry order or the abstaining weight differs.

- [ ] **Step 5: Commit**

```bash
git add zisk/crates/sealed
git commit -m "Add commitments, input framing and the whole-tally run to the sealed crate"
```

---

### Task 9: Cross-check the Rust ABI encoding against the Python one, per fixture (already covered) and add the `fixture-input` tool

**Files:**
- Create: `zisk/crates/sealed/src/bin/fixture-input.rs`
- Modify: `zisk/crates/sealed/Cargo.toml` (add the `[[bin]]` block from Task 7 Step 1)

**Interfaces:**
- Produces: `cargo run -p sealed --bin fixture-input -- <fixture.json> <input.bin>` writes the framed guest input, runs `tally::run` natively, prints `inputsHash`, `pk`, `fundedOrder`, `outputHash`, and exits non-zero if `outputHash` differs from the fixture's. Consumed by Task 10, 11, 12 and by plan B's prover tests.

- [ ] **Step 1: Write the tool**

```rust
// zisk/crates/sealed/src/bin/fixture-input.rs
//! fixture-input <fixture.json> <input.bin>
//! Writes a fixture as a framed guest input and prints what the guest must commit.

use sealed::types::{TallyInput, VoterIn};
use sealed::{io, tally};
use std::process::exit;

fn hex_bytes(s: &str) -> Vec<u8> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() { Vec::new() } else { hex::decode(s).expect("hex") }
}

fn hex_arr<const N: usize>(s: &str) -> [u8; N] {
    hex_bytes(s).try_into().expect("length")
}

fn hex_u64(s: &str) -> u64 {
    let b = hex_bytes(s);
    u64::from_be_bytes(b[24..].try_into().unwrap())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: fixture-input <fixture.json> <input.bin>");
        exit(2);
    }
    let fx: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("read fixture")).expect("json");
    let input = TallyInput {
        chain_id: fx["chainId"].as_u64().unwrap(),
        pool: hex_arr(fx["pool"].as_str().unwrap()),
        sk: hex_arr(fx["sk"].as_str().unwrap()),
        costs: fx["costs"].as_array().unwrap().iter().map(|c| hex_u64(c.as_str().unwrap())).collect(),
        total_weight: hex_u64(fx["totalWeight"].as_str().unwrap()),
        voters: fx["voters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| VoterIn {
                addr: hex_arr(v["addr"].as_str().unwrap()),
                direct_weight: hex_u64(v["directWeight"].as_str().unwrap()),
                seat_weight: hex_u64(v["seatWeight"].as_str().unwrap()),
                direct_ballot: hex_bytes(v["directBallot"].as_str().unwrap()),
                ciphertext: hex_bytes(v["ciphertext"].as_str().unwrap()),
            })
            .collect(),
    };
    std::fs::write(&args[2], io::frame(&io::encode_input(&input))).expect("write input");

    let out = tally::run(&input).expect("fixture input is valid");
    println!("inputsHash 0x{}", hex::encode(out.inputs_hash));
    println!("pk 0x{}", hex::encode(out.pk));
    println!("fundedOrder {:?}", out.funded_order);
    println!("outputHash 0x{}", hex::encode(out.output_hash));
    let expected = fx["outputHash"].as_str().unwrap().trim_start_matches("0x");
    if hex::encode(out.output_hash) != expected {
        eprintln!("native run disagrees with the fixture ({expected})");
        exit(1);
    }
}
```

- [ ] **Step 2: Run it on every fixture**

Run:
```bash
cd zisk && for s in main nosealed nodirect; do cargo run -q -p sealed --bin fixture-input -- ../reference/vectors/zisk/fixture_$s.json /tmp/claude-1000/-home-sem-Projects-ranked-shares/6ee2b1b9-dedd-4c4d-a760-82437a373710/scratchpad/$s.bin; done
```
Expected: three `outputHash` lines equal to the fixtures' values, exit 0, and three `.bin` files whose size is `8 + bincode length`, padded to 8.

- [ ] **Step 3: Commit**

```bash
git add zisk/crates/sealed/Cargo.toml zisk/crates/sealed/src/bin/fixture-input.rs
git commit -m "Add fixture-input: fixture JSON to framed guest input"
```

---

### Task 10: The guest, built with cargo-zisk and checked in the emulator

**Files:**
- Create: `zisk/guest/Cargo.toml`, `zisk/guest/src/main.rs`, `zisk/scripts/emu-check.sh`, `zisk/README.md`
- Modify: `zisk/Cargo.toml` (add `"guest"` to `members` only, not to `default-members`)

**Interfaces:**
- Produces: the ELF `zisk/target/riscv64ima-zisk-zkvm-elf/release/tally-guest`; `zisk/scripts/emu-check.sh <scenario>` exits 0 iff the emulator's committed bytes equal the fixture's `outputHash`.

- [ ] **Step 1: Guest crate**

```toml
# zisk/guest/Cargo.toml
[package]
name = "tally-guest"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
ziskos = { git = "https://github.com/0xPolygonHermez/zisk.git", tag = "v1.2.0-alpha" }
sealed = { path = "../crates/sealed", default-features = false }
```

```rust
// zisk/guest/src/main.rs
//! The zisk variant's guest (spec Z4): read the witness, run the whole tally, commit the
//! 32-byte output hash. Everything that can fail on voter data fails inside `run`
//! without panicking; `expect` here only fires on operator input.

#![no_main]
ziskos::entrypoint!(main);

use sealed::tally;
use sealed::types::TallyInput;

fn main() {
    let input: TallyInput = ziskos::io::read();
    let out = tally::run(&input).expect("operator input rejected");
    ziskos::io::commit_slice(&out.output_hash);
}
```

- [ ] **Step 2: Build it**

Run:
```bash
cd zisk && ~/.zisk/bin/cargo-zisk build --release -p tally-guest
ls -la target/riscv64ima-zisk-zkvm-elf/release/tally-guest
```
Expected: the ELF exists. If cargo-zisk complains it cannot select the package from the workspace root, run it from `zisk/guest` instead (`cd zisk/guest && ~/.zisk/bin/cargo-zisk build --release`); the artifact lands in the same workspace `target/`. Record whichever form works in `zisk/README.md`. If the `ziskos` git dependency fails to resolve the `zisklib` functions (`lift_x_secp256k1`, `scalar_mul_secp256k1`, `keccak256`), check they are `pub use`d from `ziskos::zisklib` at that tag; they are in the local checkout `~/.zisk/src/zisk-upstream/ziskos/entrypoint/src/zisklib/lib/`.

Also confirm the host build still ignores the guest: `cargo test` (no `-p`) must not try to compile `tally-guest`.

- [ ] **Step 3: Emulator check script**

```bash
#!/usr/bin/env bash
# zisk/scripts/emu-check.sh <scenario | path/to/fixture.json>
# Runs the guest on a fixture in the ZisK emulator and compares the committed bytes with
# the fixture's outputHash. Exit 0 on a match.
set -euo pipefail
scenario=${1:-main}
here=$(cd "$(dirname "$0")/.." && pwd)
elf="$here/target/riscv64ima-zisk-zkvm-elf/release/tally-guest"
if [ -f "$scenario" ]; then
  fixture=$scenario                     # a fixture path, e.g. the on-demand `big`
else
  fixture="$here/../reference/vectors/zisk/fixture_${scenario}.json"
fi
work=$(mktemp -d)

(cd "$here" && cargo run -q -p sealed --bin fixture-input -- "$fixture" "$work/input.bin") > "$work/native.txt"
expected=$(awk '/^outputHash/ {print substr($2, 3)}' "$work/native.txt")

export HWLOC_COMPONENTS=-gl
~/.zisk/bin/ziskemu -e "$elf" -i "$work/input.bin" -o "$work/output.bin" -m > "$work/emu.txt" 2>&1 || {
  cat "$work/emu.txt"; exit 1; }
got=$(head -c 32 "$work/output.bin" | od -An -v -tx1 | tr -d ' \n')
steps=$(grep -o 'steps=[0-9]*' "$work/emu.txt" | head -1 || true)

echo "scenario  $scenario"
echo "expected  $expected"
echo "committed $got"
echo "$steps"
[ "$got" = "$expected" ]
```

`chmod +x zisk/scripts/emu-check.sh`.

- [ ] **Step 4: Run it on every committed fixture**

Run: `for s in main nosealed nodirect; do zisk/scripts/emu-check.sh $s || exit 1; done`
Expected: three matches. If `-m` is not accepted by this `ziskemu`, drop it and take the step count from `-v` output or from `cargo-zisk execute -e ... -i ...` (which prints `steps:`); the byte comparison is what matters. If the committed bytes are all zero, the guest panicked before committing: run `ziskemu` with `-v` and look for the panic message; a panic inside `zisklib` on the guest path while the host path passed points at the limb conversion in `curve::imp`.

- [ ] **Step 5: Emulator test in `cargo test`, ignored by default**

Append to `zisk/crates/sealed/tests/fixtures.rs`:

```rust
/// Runs the real guest in ziskemu. `cargo test -- --ignored` on a machine with ZisK.
#[test]
#[ignore]
fn guest_commits_the_fixture_hash_in_the_emulator() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for s in SCENARIOS {
        let status = std::process::Command::new(root.join("scripts/emu-check.sh")).arg(s).status().expect("script runs");
        assert!(status.success(), "{s}");
    }
}
```

Run: `cd zisk && cargo test -p sealed --test fixtures -- --ignored`
Expected: passes (it rebuilds nothing; the ELF must exist from Step 2).

- [ ] **Step 6: `zisk/README.md`**

```markdown
# zisk: the whole PB-EAR tally proven in a ZisK guest

Spec: `docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`.

| Crate | What |
|---|---|
| `crates/pbear` | PB-EAR over `u64`, tested against `reference/pbear.py` |
| `crates/sealed` | witness types, secp256k1 ECDH + keccak pad, voter chain, `inputsHash`, output hash, `tally::run` |
| `guest` | the ZisK program: read, run, commit 32 bytes |

## Host

    cargo test                        # pbear + sealed, needs python3 for the differential test
    cargo run -p sealed --bin fixture-input -- ../reference/vectors/zisk/fixture_main.json main.bin

## Guest

    ~/.zisk/bin/cargo-zisk build --release -p tally-guest
    scripts/emu-check.sh main         # emulator run, compares the committed bytes with the fixture
    cargo test -p sealed -- --ignored # the same, from cargo

ZisK v1.2.0-alpha. On this machine every ZisK process needs
`HWLOC_COMPONENTS=-gl` and, for the PLONK wrap, `GLIBC_TUNABLES=glibc.rtld.execstack=2`.

## Measurements

(filled in by Tasks 11 and 12)
```

- [ ] **Step 7: Commit**

```bash
git add zisk/Cargo.toml zisk/Cargo.lock zisk/guest zisk/scripts/emu-check.sh zisk/README.md zisk/crates/sealed/tests/fixtures.rs
git commit -m "Add the ZisK guest and an emulator check against the fixtures"
```

---

### Task 11: Spike Z10.2, cycles per scenario

**Files:**
- Modify: `zisk/README.md` (Measurements table)

- [ ] **Step 1: Build the `big` fixture and measure all four**

Run:
```bash
SCRATCH=/tmp/claude-1000/-home-sem-Projects-ranked-shares/6ee2b1b9-dedd-4c4d-a760-82437a373710/scratchpad
(cd reference && python3 -m zisk.make_fixture --scenario big --out $SCRATCH/zisk-vectors)
for s in main nosealed nodirect $SCRATCH/zisk-vectors/fixture_big.json; do zisk/scripts/emu-check.sh $s; done
```
Expected: four matches and four step counts. The `big` run may take a minute in the Rust emulator. Then, for the per-opcode breakdown on `main`:

```bash
cd zisk && HWLOC_COMPONENTS=-gl ~/.zisk/bin/cargo-zisk run -e target/riscv64ima-zisk-zkvm-elf/release/tally-guest -i /tmp/claude-1000/-home-sem-Projects-ranked-shares/6ee2b1b9-dedd-4c4d-a760-82437a373710/scratchpad/main.bin -p summary 2>&1 | tail -40
```

- [ ] **Step 2: Record**

Fill the README table:

```markdown
## Measurements

Emulator steps (`ziskemu -m`), guest built on <date>:

| Scenario | Voters (direct / sealed) | m | Steps |
|---|---|---|---|
| main | 5 / 13 | 4 | … |
| nosealed | 4 / 0 | 4 | … |
| nodirect | 0 / 6 | 4 | … |
| big | 2000 / 200 | 16 | … |

Steps per sealed ballot ≈ (nodirect − nosealed) / 6 … ; per direct voter ≈ … .
```

with the numbers observed, and one sentence on which part dominates (from the `-p summary` top functions).

- [ ] **Step 3: Commit**

```bash
git add zisk/README.md
git commit -m "Record guest cycle counts per fixture"
```

---

### Task 12: Spike Z10.1, prove and wrap `main`, confirm the public values layout

**Files:**
- Create: `zisk/scripts/check_publics.py`, `zisk/fixtures/main-calldata.json`
- Modify: `zisk/README.md` (proving time, `programVK`, `rootCVadcopFinal`)

This task takes about half an hour of machine time and most of the machine's memory; run nothing else heavy meanwhile. Proof files go under `zisk/proofs/` (ignored).

- [ ] **Step 1: The layout checker**

```python
#!/usr/bin/env python3
"""check_publics.py <calldata.json> <outputHash hex>

Asserts that the exported `publicValues` are exactly what a guest committing those 32
bytes produces (spec Z5 step 2): 512 bytes, slot i (8 bytes) = hash[4i:4i+4] + 4 zero
bytes for i < 8, all zero beyond. Prints programVK and rootCVadcopFinal for plan B.
"""
import json
import sys

calldata, expected = sys.argv[1], sys.argv[2]
d = json.load(open(calldata))
pv = bytes.fromhex(d["publicValues"][2:])
h = bytes.fromhex(expected.removeprefix("0x"))
assert len(h) == 32
want = b"".join(h[4 * i : 4 * i + 4] + bytes(4) for i in range(8)) + bytes(512 - 64)
assert len(pv) == 512, f"publicValues is {len(pv)} bytes, expected 512"
assert pv == want, "publicValues do not match the expected layout:\n got  %s\n want %s" % (pv.hex(), want.hex())
assert d["rootCVadcopFinal"] != d["programVK"], "rootC equals programVK: the wrap bug of ZisK PR #1299 is present in this cargo-zisk"
print("publicValues layout OK")
print("programVK        ", d["programVK"])
print("rootCVadcopFinal ", d["rootCVadcopFinal"])
print("proofBytes       ", len(bytes.fromhex(d["proofBytes"][2:])), "bytes")
```

- [ ] **Step 2: Prove, wrap, export**

```bash
cd zisk && mkdir -p proofs fixtures
export HWLOC_COMPONENTS=-gl GLIBC_TUNABLES=glibc.rtld.execstack=2
ELF=target/riscv64ima-zisk-zkvm-elf/release/tally-guest
IN=/tmp/claude-1000/-home-sem-Projects-ranked-shares/6ee2b1b9-dedd-4c4d-a760-82437a373710/scratchpad/main.bin
time ~/.zisk/bin/cargo-zisk prove -e $ELF -i $IN -k ~/.zisk/provingKey -o proofs/main-stark.bin -y 2>&1 | tail -20
time ~/.zisk/bin/cargo-zisk wrap -p proofs/main-stark.bin -k ~/.zisk/provingKey -w ~/.zisk/provingKeySnark --plonk -o proofs/main-plonk.bin 2>&1 | tail -20
~/.zisk/bin/cargo-zisk-dev export-solidity-calldata -p proofs/main-plonk.bin -o fixtures/main-calldata.json
python3 scripts/check_publics.py fixtures/main-calldata.json $(awk '/^outputHash/ {print $2}' <(cargo run -q -p sealed --bin fixture-input -- ../reference/vectors/zisk/fixture_main.json /tmp/claude-1000/-home-sem-Projects-ranked-shares/6ee2b1b9-dedd-4c4d-a760-82437a373710/scratchpad/main2.bin))
```

Expected: `prove` in the order of fifteen minutes, `wrap` in the order of ten, then `publicValues layout OK`. If `prove` needs a program setup first, run `~/.zisk/bin/cargo-zisk-dev program-setup -e $ELF -k ~/.zisk/provingKey` once and retry. If `-o` for `prove` expects a directory rather than a file, pass `proofs/` and use the file it writes. If `check_publics.py` fails on the `rootCVadcopFinal == programVK` assertion, the installed `cargo-zisk` predates the fix of ZisK PR #1299: rebuild it from `~/.zisk/src/zisk-upstream` on branch `fix/wrap-plain-vadcop-final-verkey` (`cargo build --release -p cargo-zisk` in that checkout, then copy `target/release/cargo-zisk` over `~/.zisk/bin/cargo-zisk`) and rerun only the `wrap` and `export` steps. If the layout assertion fails while `rootC` is fine, print both hex strings side by side and fix the spec's Z5 step 2 and this script together; that is exactly what this spike exists to catch, and plan B's contract must follow the observed layout.

- [ ] **Step 3: Record and commit the calldata fixture**

Add to `zisk/README.md` under Measurements:

```markdown
Proving `main` on this machine (CPU, 30 GB RAM plus swap): STARK … min, PLONK wrap … min.
`programVK` … , `rootCVadcopFinal` … (ZisK v1.2.0-alpha PLONK key). `fixtures/main-calldata.json`
is the exported calldata; plan B verifies it against `ZiskVerifier.sol` in Foundry.
```

```bash
git add zisk/scripts/check_publics.py zisk/fixtures/main-calldata.json zisk/README.md
git commit -m "Prove the main fixture end to end and pin the public values layout"
```

---

### Task 13: Root README pointer

**Files:**
- Modify: `README.md` (Layout section and Reference implementation section)

- [ ] **Step 1: Add the pointers**

In the `## Layout` block add two lines:

```
reference/zisk/         secp256k1, sealed ballots, commitments and fixtures of the zisk variant
zisk/                   Rust workspace: PB-EAR, sealed-ballot guest logic, the ZisK guest
```

At the end of `## Reference implementation` add:

```markdown
### zisk variant

`reference/zisk/` holds the secp256k1 + keccak scheme of the zisk (and cre) variant and
its fixtures; `python3 -m zisk.make_fixture` from `reference/` regenerates them, and
`zisk/README.md` describes the Rust side. Spec:
`docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`.
```

- [ ] **Step 2: Final full run and commit**

Run: `python3 -m unittest discover reference && (cd zisk && cargo test) && forge test -q`
Expected: all green (forge is untouched by this plan but must still pass).

```bash
git add README.md
git commit -m "Point the README at the zisk reference and workspace"
```

---

## Self-review notes

- Spec coverage: Z3 → Tasks 2–3 and 7; Z4 → Tasks 6–10; Z5 step 2 → Task 12; Z7 → Tasks 1–5; Z8 Rust bullets → Tasks 6 (differential), 7 (vectors), 8 (fixtures, `run`), 10 (emulator, ignored); Z10.1 → Task 12; Z10.2 → Task 11; Z10.4 is resolved by design (host path on `k256`, guest path on `zisklib`, the emulator test compares them). Z10.3 (Arc verifier), Z1–Z2, Z5 contracts, Z6 prover, Z8 Foundry, Z11 scripts are plan B.
- The cross-variant test of Z8 waits for the Noir files to move; not in this plan.
