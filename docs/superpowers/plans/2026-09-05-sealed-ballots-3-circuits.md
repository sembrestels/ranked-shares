# Sealed ballots, plan 3 of 4: Noir circuits

> **Historical.** The Noir variant's paths and its contract name were moved and renamed
> on 2026-09-05: `SealedRankedShares` is now `NoirRankedShares`, its Solidity lives under
> `src/noir/` and `test/noir/`, its Python under `reference/noir/` and its vectors under
> `reference/vectors/noir/`. Paths below are as they were when the plan was written; see
> the README's Layout section for the current ones.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ingest` and `tally` Noir circuits of spec B7, proven equal to the Python reference on every fixture, their Honk verifiers in Solidity, real proofs replayed through `SealedRankedShares.advance` in Foundry, and the gate counts and proving times that fix the default profile.

**Architecture:** A Nargo workspace under `noir/`: two libraries (`sealed` for the Poseidon2 sponge, packing, ECDH and decryption; `pbear` for the circuit state, its commitment and the transcript-driven step) and four thin binaries, one per circuit per profile (`ingest-test`, `tally-test`, `ingest-default`, `tally-default`), each a few lines of globals plus a call into the libraries. Python tools generate `Prover.toml` inputs from the fixtures by replaying `reference/commitments.py`, so a successful `nargo execute` means the circuit agrees with the oracle. Barretenberg produces verification keys, Solidity verifiers and proofs for the `test` profile that a Foundry test feeds to the real `advance`.

**Tech Stack:** Noir `nargo 1.0.0-beta.26`, Barretenberg `bb 5.0.0` (both already installed under `~/.nargo/bin` and `~/.bb`; not on PATH in non-interactive shells), Foundry, Python 3.14.

**Spec:** `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (B4, B6.3, B6.4, B7, B12.1, B12.3, B12.5). The Python reference is the oracle: `reference/poseidon2.py`, `reference/sealed.py`, `reference/commitments.py`, fixtures in `reference/vectors/`. The contract these circuits must satisfy is `src/SealedRankedShares.sol` (`advance`, plan 2).

**Facts verified before writing this plan (on this machine, 2026-09-05):**
- `nargo 1.0.0-beta.26`, `bb 5.0.0`. `bb` takes `-t evm` (keccak oracle, zero-knowledge) for `write_vk`, `prove`, `verify`, `write_solidity_verifier`; `write_solidity_verifier --optimized` emits one `contract HonkVerifier is IVerifier` with `verify(bytes calldata, bytes32[] calldata) external view returns (bool)`; the generated contract is 15.5 KB of runtime bytecode; one verification costs about 630k gas for a 2-input circuit; an invalid proof **reverts** (custom error) rather than returning false, which is why `SealedRankedShares._verify` wraps the call in `try/catch` and surfaces `InvalidProof`.
- `SealedRankedShares.Config` carries `coordinator` (the only address allowed to pass `restart = true` to `advance`) and `minSealedVote`; `FixtureLoader.deployFromFixture` already fills both. `profileId()` is `keccak256(abi.encode(nSealedMax, mMax, batch))`.
- `bb prove -t evm` writes `proof` (7,232 bytes for a small circuit) and `public_inputs` (32 bytes per public input, in declaration order); the Solidity verifier takes exactly those public inputs, pairing points are inside the proof.
- Noir API on this version: `std::hash::poseidon2_permutation([Field; 4]) -> [Field; 4]`; `std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, multi_scalar_mul, fixed_base_scalar_mul}`; `EmbeddedCurvePoint::new(x, y)`, `EmbeddedCurvePoint::generator()`, `EmbeddedCurveScalar { lo, hi }` (128-bit limbs); `Field::to_le_bytes::<N>() -> [u8; N]`; unconstrained calls need `unsafe { }` preceded by a `// Safety:` comment.
- A sponge written over `poseidon2_permutation` exactly like `reference/poseidon2.py` reproduces the Python hash (checked on `[1..6]`).
- Gate counts: one Grumpkin scalar multiplication plus a 6-element sponge plus one division hint is 3,795 gates; one full tally step over 256 entries and 16 projects, including unpacking every ballot and one state commitment, is 113,622 gates.

## Global Constraints

- Toolchain: `nargo 1.0.0-beta.26`, `bb 5.0.0`. Every shell that runs them needs `export PATH=$HOME/.nargo/bin:$HOME/.bb:$HOME/.foundry/bin:$PATH`. `noir/VERSIONS` records both versions; a version change regenerates every artifact and is a new pool.
- The Python reference is the oracle. When a circuit disagrees with a fixture, the circuit is wrong until proven otherwise; fixtures and Python are never edited to make a circuit pass.
- Poseidon2 sponge: state `[0, 0, 0, len << 64]`; permutation before absorbing element `i` when `i > 0 && i % 3 == 0`; final permutation; output element 0. Variable-length hashes (`costsHash` over `m` elements, transcript steps over `m + 4`) encode the real length in the capacity element and absorb only the real elements.
- `DOMAIN = 0x52616e6b65645368617265732f7365616c65642f7632` (the ASCII bytes `RankedShares/sealed/v2` big-endian). Grumpkin generator `G = (1, 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c)`. `NONE = 2^64 − 1`.
- Public inputs are declared as `pub` parameters in exactly this order. Ingest: `k, n_sealed, m, budget, pk_x, pk_y, h_in, h_out, state_in, state_out`. Tally: `costs_hash, state_in, state_out, done, t_hash_out, funded_count, funded_order_packed`. No return values (a return value would append public inputs).
- State commitment: `Poseidon2([weights[0..E) as Field, ballots[0..E), fundedBits, fundedOrderPacked, funded_count, level, spent, done, m, budget, t_hash])`, `2E + 9` elements, as `reference/commitments.py:state_commit`.
- Every input the contract can hold must be provable: no `assert` may depend on voter-chosen data (ciphertexts); a zero `rx` is swapped for the generator before the scalar multiplication; invalid plaintext becomes weight 0 and ballot 0 through selects.
- The `tally` circuit asserts, per active step: `step.level == state.level`, `best == argmax`, `total == 0` on `NONE` else `total == sum[best]`. `pubSupport` and `total` are `u64` inputs (this is the 64-bit range check the spec requires).
- Profiles: `test` = `E 8, M 4, B 2, K 2`; `default` = `E 256, M 16, B 32, K 8` (`E = N_SEALED_MAX`).
- Generated artifacts committed: `noir/artifacts/<profile>/{ingest,tally}.{json,vk,vk_hash}`, `src/verifiers/{Ingest,Tally}Verifier.sol` (default profile), `test/verifiers/{Ingest,Tally}VerifierTest.sol` (test profile), `noir/proofs/<scenario>/*.proof|*.pub` for the `test` profile fixtures. `noir/**/target/` is git-ignored.
- `forge fmt` before commits touching Solidity; `nargo fmt` before commits touching Noir; no attribution lines in commit messages. Run `python3 -W error -m unittest discover reference`, `nargo test --workspace` (from `noir/`) and `forge test -q` before every commit.

## File structure

```
noir/Nargo.toml                        workspace
noir/VERSIONS                          pinned versions
noir/sealed/{Nargo.toml,src/lib.nr}    sponge, packing, ECDH, decrypt, pk check
noir/pbear/{Nargo.toml,src/lib.nr}     State, commit, Step, tally_step, ingest_batch
noir/ingest-test/, noir/tally-test/,
noir/ingest-default/, noir/tally-default/   binaries: globals + main
noir/scripts/env.sh                    PATH export
noir/scripts/build.sh                  compile, vk, solidity verifiers, artifacts
noir/scripts/prove_fixture.sh          proofs for one fixture scenario (test profile)
noir/README.md                         how to build, sizes, timings
reference/tools/noir_vectors.py        prints Noir test literals from the reference
reference/tools/noir_inputs.py         Prover.toml for one proof of a fixture
reference/tools/noir_run.py            executes every proof of a fixture with nargo
src/verifiers/IngestVerifier.sol, TallyVerifier.sol        (generated, default profile)
test/verifiers/IngestVerifierTest.sol, TallyVerifierTest.sol (generated, test profile)
test/verifiers/RealProofs.t.sol        advance with real proofs, real verifiers
script/DeployVerifiers.s.sol
```

---

### Task 0: Workspace, toolchain pin and the Poseidon2 sponge

**Files:**
- Create: `noir/Nargo.toml`, `noir/VERSIONS`, `noir/scripts/env.sh`, `noir/sealed/Nargo.toml`, `noir/sealed/src/lib.nr`, `reference/tools/noir_vectors.py`
- Modify: `.gitignore` (add `noir/**/target/`)

**Interfaces:**
- Produces in crate `sealed`: `pub fn sponge<let N: u32>(inputs: [Field; N]) -> Field`; `pub fn sponge_var<let N: u32>(inputs: [Field; N], len: u32) -> Field` (hash of the first `len ≤ N` elements with the length encoded as `len`); `pub global DOMAIN: Field`; `pub global GEN_X: Field`; `pub global GEN_Y: Field`; `pub global NONE: u64`.
- Produces `python3 reference/tools/noir_vectors.py` printing Noir `assert` lines with hash values from the reference for the tests below.

- [ ] **Step 1: Scaffold**

```toml
# noir/Nargo.toml
[workspace]
members = ["sealed", "pbear", "ingest-test", "tally-test", "ingest-default", "tally-default"]
default-member = "ingest-test"
```

Until the later crates exist, keep only the members that do: start with `members = ["sealed"]` and `default-member = "sealed"`, and extend the list in each task that adds a crate.

```
# noir/VERSIONS
nargo 1.0.0-beta.26
bb 5.0.0
bb.js 5.0.0
```

```bash
# noir/scripts/env.sh — source this: `. noir/scripts/env.sh`
export PATH="$HOME/.nargo/bin:$HOME/.bb:$HOME/.foundry/bin:$PATH"
```

```toml
# noir/sealed/Nargo.toml
[package]
name = "sealed"
type = "lib"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]
```

Append `noir/**/target/` to `.gitignore`.

- [ ] **Step 2: Print the test literals**

```python
# reference/tools/noir_vectors.py
"""Print Noir test assertions computed by the Python reference.

Usage: python3 reference/tools/noir_vectors.py
Paste the output into the #[test] functions of noir/sealed and noir/pbear.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import poseidon2  # noqa: E402
import sealed  # noqa: E402
import commitments as cm  # noqa: E402
from pbear import NONE, pbear_transcript  # noqa: E402
from profiles import PROFILES  # noqa: E402


def hx(n):
    return "0x" + format(int(n), "x")


def main():
    print("// sponge")
    for inputs in ([1], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6]):
        print(f"assert(sponge({inputs}) == {hx(poseidon2.hash(inputs))});")
    print(f"assert(sponge_var([1, 2, 3, 0, 0], 3) == {hx(poseidon2.hash([1, 2, 3]))});")
    print(f"assert(sponge_var([7, 0, 0], 1) == {hx(poseidon2.hash([7]))});")
    print(f"assert(sponge_var([0; 4], 0) == {hx(poseidon2.hash([]))});")

    print("// sealed vectors")
    with open(os.path.join(HERE, "..", "vectors", "sealed.json")) as f:
        v = json.load(f)
    sk = int(v["sk"], 16)
    print(f"// sk_lo = {hx(sk & ((1 << 128) - 1))}, sk_hi = {hx(sk >> 128)}")
    print(f"// pk = ({v['pk'][0]}, {v['pk'][1]})")
    for case in v["cases"]:
        if case.get("note"):
            continue
        rx, ry, c = (int(x, 16) for x in case["ciphertext"])
        print(f"// case m={case['m']} ranks={case['ranks']} voter={case['voter']}")
        print(f"//   rx={hx(rx)} ry={hx(ry)} c={hx(c)} packed={hx(sealed.pack(case['ranks']))}")

    print("// pbear: the [30, 70] example of test_commitments on the test profile")
    p = PROFILES["test"]
    costs = [30, 70]
    funded, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
    s = cm.empty_state(p, 2, 100)
    print(f"assert(commit(empty_state(2, 100)) == {hx(cm.state_commit(p, s))});")
    cm.ingest(s, 0, 60, sealed.pack([2, 1]))
    print(f"// after ingest of entry 0 (60, [2,1]): {hx(cm.state_commit(p, s))}")
    for i, step in enumerate(transcript):
        cm.tally_step(p, s, costs, step)
        print(f"// after step {i} {step}: commit={hx(cm.state_commit(p, s))} t_hash={hx(s.t_hash)} done={s.done}")
    print(f"// funded={funded} NONE={NONE}")


if __name__ == "__main__":
    main()
```

Run: `python3 reference/tools/noir_vectors.py`
Expected: lines of assertions and comments; keep the output at hand for Steps 3 and for Task 2.

- [ ] **Step 3: Write the sponge with its tests (the tests first, they fail to compile until the functions exist)**

```rust
// noir/sealed/src/lib.nr
//! Sealed-ballot primitives for the RankedShares circuits (spec B4, B6.1, B7).
//! Every function mirrors a function of the Python reference in `reference/`.

use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, fixed_base_scalar_mul, multi_scalar_mul};
use std::hash::poseidon2_permutation;

pub global RATE: u32 = 3;
pub global TWO_POW_64: Field = 18446744073709551616;
pub global DOMAIN: Field = 0x52616e6b65645368617265732f7365616c65642f7632;
pub global GEN_X: Field = 1;
pub global GEN_Y: Field = 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c;
pub global NONE: u64 = 18446744073709551615;

/// Poseidon2 sponge over BN254, t = 4, rate 3: Barretenberg's FieldSponge, as
/// `reference/poseidon2.py::hash`.
pub fn sponge<let N: u32>(inputs: [Field; N]) -> Field {
    let mut state = [0, 0, 0, (N as Field) * TWO_POW_64];
    for i in 0..N {
        if (i > 0) & (i % RATE == 0) {
            state = poseidon2_permutation(state);
        }
        state[i % RATE] += inputs[i];
    }
    poseidon2_permutation(state)[0]
}

/// Sponge over the first `len` elements of `inputs` (`len <= N`), with `len` in the
/// capacity element, so it equals `sponge` of the shorter array. Used for `costsHash`
/// (m elements) and transcript steps (m + 4 elements) where `m` is a runtime value.
pub fn sponge_var<let N: u32>(inputs: [Field; N], len: u32) -> Field {
    assert(len <= N);
    let mut state = [0, 0, 0, (len as Field) * TWO_POW_64];
    for i in 0..N {
        let active = i < len;
        if (i > 0) & (i % RATE == 0) {
            let permuted = poseidon2_permutation(state);
            state = if active { permuted } else { state };
        }
        let x = if active { inputs[i] } else { 0 };
        state[i % RATE] += x;
    }
    poseidon2_permutation(state)[0]
}

mod sponge_tests {
    use super::{sponge, sponge_var};

    #[test]
    fn matches_reference_vectors() {
        // paste the "// sponge" block printed by reference/tools/noir_vectors.py here
        assert(sponge([1]) == 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373);
        assert(sponge([1, 2, 3]) == 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8);
        assert(sponge([1, 2, 3, 4]) == 0x130bf204a32cac1f0ace56c78b731aa3809f06df2731ebcf6b3464a15788b1b9);
        assert(sponge([1, 2, 3, 4, 5, 6]) == 0x7f57fcda925c06dc0a311f3f17fa0218e079b514552744a25ba8a74ee8c9e7a);
    }

    #[test]
    fn var_length_equals_fixed_length() {
        assert(sponge_var([1, 2, 3, 0, 0], 3) == sponge([1, 2, 3]));
        assert(sponge_var([1, 2, 3, 4, 0, 0, 0], 4) == sponge([1, 2, 3, 4]));
        assert(sponge_var([7, 0, 0], 1) == sponge([7]));
    }

    #[test]
    fn length_is_part_of_the_hash() {
        assert(sponge([1]) != sponge([1, 0]));
        assert(sponge_var([1, 0], 1) != sponge_var([1, 0], 2));
    }
}
```

The four `sponge` literals above were produced by the reference and are the values `noir_vectors.py` prints; the `sponge_var` cases compare against `sponge` and need no literal. Add the `sponge_var([0; 4], 0)` literal for the empty hash from the script output as a fourth assertion if you want the empty transcript pinned.

Run: `. noir/scripts/env.sh && cd noir && nargo test --workspace`
Expected: 3 tests pass. If `matches_reference_vectors` fails, the sponge schedule differs from `reference/poseidon2.py::hash`: compare the permutation points (before element 3, before element 6, once at the end).

- [ ] **Step 4: Commit**

```bash
git add noir/Nargo.toml noir/VERSIONS noir/scripts/env.sh noir/sealed reference/tools/noir_vectors.py .gitignore
git commit -m "Add the Noir workspace and the Poseidon2 sponge library"
```

---

### Task 1: Packing, validation, ECDH and decryption

**Files:**
- Modify: `noir/sealed/src/lib.nr`

**Interfaces:**
- Produces: `pub fn unpack_and_validate<let M: u32>(packed: Field, m: u32) -> (bool, [u8; M])` (false when `packed ≥ 256^m`, a rank exceeds `m`, or the competition property fails; the bytes are returned either way); `pub fn effective_ranks<let M: u32>(ranks: [u8; M], m: u32) -> [u8; M]`; `pub fn shared_point(sk: EmbeddedCurveScalar, rx: Field, ry: Field) -> EmbeddedCurvePoint` (swaps a zero `rx` for the generator); `pub fn mask(shared: EmbeddedCurvePoint, voter: Field) -> Field`; `pub fn decrypt<let M: u32>(sk: EmbeddedCurveScalar, rx: Field, ry: Field, c: Field, voter: Field, m: u32) -> (bool, Field)` (validity, packed ballot); `pub fn pk_matches(sk: EmbeddedCurveScalar, pk_x: Field, pk_y: Field) -> bool`.

- [ ] **Step 1: Tests first**

Append to `noir/sealed/src/lib.nr`:

```rust
mod ballot_tests {
    use super::{decrypt, effective_ranks, pk_matches, unpack_and_validate};
    use std::embedded_curve_ops::EmbeddedCurveScalar;

    #[test]
    fn unpacks_valid_ballots() {
        let (ok, ranks) = unpack_and_validate::<4>(0x03000102, 4); // [2, 1, 0, 3]
        assert(ok);
        assert(ranks == [2, 1, 0, 3]);
        let (ok0, _) = unpack_and_validate::<4>(0, 4); // all unranked
        assert(ok0);
        let (ok2, _) = unpack_and_validate::<4>(0x0202, 2); // [2, 2] for m = 2
        assert(!ok2);
    }

    #[test]
    fn rejects_invalid_ballots() {
        let (too_wide, _) = unpack_and_validate::<4>(1 << 32, 4);
        assert(!too_wide);
        let (rank_gt_m, _) = unpack_and_validate::<4>(0x05, 4);
        assert(!rank_gt_m);
        let (gap, _) = unpack_and_validate::<4>(0x00030301, 4); // [1, 3, 3, 0]
        assert(!gap);
        let (beyond_m, _) = unpack_and_validate::<4>(0x01000000, 3); // byte 3 set, m = 3
        assert(!beyond_m);
    }

    #[test]
    fn effective_ranks_fill_the_last_tier() {
        assert(effective_ranks::<4>([2, 1, 0, 3], 4) == [2, 1, 4, 3]);
        assert(effective_ranks::<4>([0, 0, 0, 0], 4) == [1, 1, 1, 1]);
        assert(effective_ranks::<4>([1, 0, 0, 0], 2) == [1, 2, 2, 2]);
    }

    // Values from reference/vectors/sealed.json (printed by reference/tools/noir_vectors.py).
    global SK: EmbeddedCurveScalar =
        EmbeddedCurveScalar { lo: 0x86f0a28f12908cda56ee68f492a02a19, hi: 0x83abad4ae815c27ae5035ddfb0520ea };

    #[test]
    fn pk_matches_the_vector_key() {
        assert(pk_matches(
            SK,
            0x00e5f53c9afed1f9c1ef822bf03df8b2be36af7882d6d45744d989c5c8200d91,
            0x21c72d415f8e1a34760b86ca7a4d871c7913b305ea6ff5c2d354966a84fab321,
        ));
        assert(!pk_matches(SK, 1, 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c));
    }

    #[test]
    fn decrypts_the_first_vector() {
        let (ok, packed) = decrypt::<4>(
            SK,
            0x0656c259e26c7c93f06e5da9c501c3c5401ffa6514e0e3f30b91916b2bdcb084,
            0x2c42513bbb16004b692017ac1e0f82cffad63b648c5d2c55e53d4ae80672de49,
            0x2f996f763a3a50db39bec4b185cf0c74e7c2464e15f7d72da21ea40ca73dcb00,
            0x1111111111111111111111111111111111111111,
            4,
        );
        assert(ok);
        assert(packed == 0x03000102);
    }

    #[test]
    fn wrong_voter_is_absent() {
        let (ok, _) = decrypt::<4>(
            SK,
            0x0656c259e26c7c93f06e5da9c501c3c5401ffa6514e0e3f30b91916b2bdcb084,
            0x2c42513bbb16004b692017ac1e0f82cffad63b648c5d2c55e53d4ae80672de49,
            0x2f996f763a3a50db39bec4b185cf0c74e7c2464e15f7d72da21ea40ca73dcb00,
            0x2222222222222222222222222222222222222222,
            4,
        );
        assert(!ok);
    }

    #[test]
    fn zero_rx_is_absent_and_provable() {
        let (ok, packed) = decrypt::<4>(SK, 0, 0, 5, 0x1111111111111111111111111111111111111111, 4);
        assert(!ok);
        assert(packed == 0);
    }
}
```

The other vector cases of `sealed.json` (m = 16 and m = 31) can be added the same way from the script's output; two is the minimum.

Run: `. noir/scripts/env.sh && cd noir && nargo test --package sealed`
Expected: compile errors, functions undefined.

- [ ] **Step 2: Implement**

Insert before the test modules:

```rust
/// Bytes of a packed ballot and whether it is a competition ranking over `m`
/// projects: `packed < 256^m`, every rank `<= m`, and a rank `r` is used only if
/// exactly `r - 1` projects carry a smaller non-zero rank (`PBEAR._setBallot`).
pub fn unpack_and_validate<let M: u32>(packed: Field, m: u32) -> (bool, [u8; M]) {
    let bytes: [u8; 32] = packed.to_le_bytes();
    let mut ranks: [u8; M] = [0; M];
    let mut ok = true;
    for c in 0..32 {
        let in_range = c < m;
        let byte = bytes[c];
        // bytes at or beyond m must be zero
        ok &= in_range | (byte == 0);
        if c < M {
            ranks[c] = byte;
            ok &= (!in_range) | (byte as u32 <= m);
        }
    }
    // counts[r] for r in 1..=M
    let mut counts: [u32; M + 1] = [0; M + 1];
    for c in 0..M {
        let r = ranks[c] as u32;
        for k in 0..M + 1 {
            counts[k] += if (c < m) & (r == k) { 1 } else { 0 };
        }
    }
    let mut seen: u32 = 0;
    for r in 1..M + 1 {
        let used = counts[r] != 0;
        ok &= (!used) | (r == seen + 1);
        seen += counts[r];
    }
    (ok, ranks)
}

/// The rank used by the tally: the stored rank, or `1 + number of ranked projects`
/// for an unranked one (`PBEAR._defaultRank`).
pub fn effective_ranks<let M: u32>(ranks: [u8; M], m: u32) -> [u8; M] {
    let mut nonzero: u32 = 0;
    for c in 0..M {
        nonzero += if (c < m) & (ranks[c] != 0) { 1 } else { 0 };
    }
    let default = (nonzero + 1) as u8;
    let mut out: [u8; M] = [0; M];
    for c in 0..M {
        out[c] = if ranks[c] == 0 { default } else { ranks[c] };
    }
    out
}

/// `sk · R`, with a zero `rx` (an empty slot) replaced by the generator so the
/// black box always sees a valid point. The caller discards the result in that case.
pub fn shared_point(sk: EmbeddedCurveScalar, rx: Field, ry: Field) -> EmbeddedCurvePoint {
    let empty = rx == 0;
    let x = if empty { GEN_X } else { rx };
    let y = if empty { GEN_Y } else { ry };
    multi_scalar_mul([EmbeddedCurvePoint::new(x, y)], [sk])
}

/// `Poseidon2([DOMAIN, S.x, S.y, voter])` (spec B4).
pub fn mask(shared: EmbeddedCurvePoint, voter: Field) -> Field {
    sponge([DOMAIN, shared.x, shared.y, voter])
}

/// Decrypt one sealed ballot: (valid, packed). Absent ballots return (false, 0).
pub fn decrypt<let M: u32>(sk: EmbeddedCurveScalar, rx: Field, ry: Field, c: Field, voter: Field, m: u32) -> (bool, Field) {
    let s = shared_point(sk, rx, ry);
    let packed = c - mask(s, voter);
    let (ok, _) = unpack_and_validate::<M>(packed, m);
    let valid = ok & (rx != 0);
    (valid, if valid { packed } else { 0 })
}

/// `sk · G == pk`.
pub fn pk_matches(sk: EmbeddedCurveScalar, pk_x: Field, pk_y: Field) -> bool {
    let p = fixed_base_scalar_mul(sk);
    (p.x == pk_x) & (p.y == pk_y)
}
```

Notes for the implementer: `Field::to_le_bytes::<32>()` constrains the canonical 32-byte decomposition; a garbage `packed` (any field element) decomposes fine, so `decrypt` never fails on voter-chosen data. `[u32; M + 1]` compiles on this version (verified).

Run: `nargo test --package sealed`
Expected: 9 tests pass (3 sponge + 6 ballot).

- [ ] **Step 3: Commit**

```bash
cd noir && nargo fmt && cd ..
git add noir/sealed
git commit -m "Add ballot packing, validation and sealed-ballot decryption to the Noir library"
```

---

### Task 2: State, commitment and the transcript-driven step

**Files:**
- Create: `noir/pbear/Nargo.toml`, `noir/pbear/src/lib.nr`
- Modify: `noir/Nargo.toml` (add member)

**Interfaces:**
- Produces in crate `pbear`:

```rust
pub struct State<let E: u32, let M: u32> {
    pub weights: [u64; E], pub ballots: [Field; E],
    pub funded: [bool; M], pub funded_order: [u8; M], pub funded_count: u8,
    pub level: u8, pub spent: u64, pub done: bool, pub m: u8, pub budget: u64, pub t_hash: Field,
}
pub struct Step<let M: u32> { pub level: u8, pub pub_support: [u64; M], pub best: u64, pub total: u64 }
pub struct Entry { pub addr: Field, pub seat_weight: u64, pub rx: Field, pub ry: Field, pub c: Field }
pub fn empty_state<let E: u32, let M: u32>(m: u32, budget: u64) -> State<E, M>
pub fn funded_bits<let E: u32, let M: u32>(s: State<E, M>) -> Field
pub fn funded_order_packed<let E: u32, let M: u32>(s: State<E, M>) -> Field
pub fn commit<let E: u32, let M: u32>(s: State<E, M>) -> Field
pub fn ranks_of<let E: u32, let M: u32>(s: State<E, M>) -> [[u8; M]; E]
pub fn tally_step<let E: u32, let M: u32>(s: State<E, M>, costs: [u64; M], step: Step<M>, ranks: [[u8; M]; E]) -> State<E, M>
pub fn ingest_batch<let E: u32, let M: u32, let B: u32>(s: State<E, M>, sk: EmbeddedCurveScalar, k: u32, n_sealed: u32, h_in: Field, entries: [Entry; B]) -> (State<E, M>, Field)
```

- [ ] **Step 1: Crate and failing tests**

```toml
# noir/pbear/Nargo.toml
[package]
name = "pbear"
type = "lib"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]
sealed = { path = "../sealed" }
```

Add `"pbear"` to the workspace members. Write `noir/pbear/src/lib.nr` with the struct definitions above (so the tests compile up to the missing functions) and this test module. The literals are the values `reference/tools/noir_vectors.py` prints for the `[30, 70]` example on the test profile (deterministic; the plan author ran it):

```rust
mod tests {
    use super::{commit, empty_state, ranks_of, tally_step, State, Step};
    use sealed::NONE;

    // test profile: E = 8, M = 4
    fn example_state() -> State<8, 4> {
        let mut s = empty_state::<8, 4>(2, 100);
        s.weights[0] = 60;
        s.ballots[0] = 0x0102; // [2, 1]
        s
    }

    #[test]
    fn empty_state_commit_matches_reference() {
        assert(commit(empty_state::<8, 4>(2, 100)) == 0x1fb17e920d40fb7f02cbce8aab3e3efded4e7e3eeb99b04395c092d74bcbdfc3);
    }

    #[test]
    fn ingested_state_commit_matches_reference() {
        assert(commit(example_state()) == 0x135eb70676fa7070900a3c6e77ba18e3b79f31bc84c2db7614f451c595a05ae9);
    }

    #[test]
    fn follows_the_transcript_to_done() {
        let costs = [30, 70, 0, 0];
        let mut s = example_state();
        let ranks = ranks_of(s);
        // step 0: level 1, pub [40, 0], best 0, total 40
        s = tally_step(s, costs, Step { level: 1, pub_support: [40, 0, 0, 0], best: 0, total: 40 }, ranks);
        assert(s.funded[0]);
        assert(s.weights[0] == 60);
        // step 1: level 1, pub [0, 0], NONE
        s = tally_step(s, costs, Step { level: 1, pub_support: [0, 0, 0, 0], best: NONE, total: 0 }, ranks);
        assert(s.level == 2);
        // step 2: level 2, pub [0, 10], best 1, total 70
        s = tally_step(s, costs, Step { level: 2, pub_support: [0, 10, 0, 0], best: 1, total: 70 }, ranks);
        assert(s.done);
        assert(s.weights[0] == 0);
        assert(s.spent == 100);
        assert(s.funded_count == 2);
        assert(commit(s) == 0x12a8fea21747f47ef4fd23e5f378b276ac5d6ff17a6fd8ad352b8d3ab09c3efe);
        assert(s.t_hash == 0xb7b3941a1edf6e27602db80ed9c15cea40f3d320767c62e22fbe2498d85c5cc);
    }

    #[test]
    fn done_state_ignores_steps() {
        let costs = [5, 0, 0, 0];
        let mut s = empty_state::<8, 4>(1, 10);
        s.done = true;
        let before = commit(s);
        let after = tally_step(s, costs, Step { level: 1, pub_support: [0; 4], best: NONE, total: 0 }, ranks_of(s));
        assert(commit(after) == before);
    }

    #[test]
    fn exhausted_state_becomes_done_without_absorbing() {
        let costs = [50, 0, 0, 0];
        let s = empty_state::<8, 4>(1, 10);
        let after = tally_step(s, costs, Step { level: 1, pub_support: [0; 4], best: NONE, total: 0 }, ranks_of(s));
        assert(after.done);
        assert(after.t_hash == 0);
    }

    #[test(should_fail)]
    fn forged_best_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(s, costs, Step { level: 1, pub_support: [40, 0, 0, 0], best: 1, total: 40 }, ranks_of(s));
    }

    #[test(should_fail)]
    fn forged_total_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(s, costs, Step { level: 1, pub_support: [40, 0, 0, 0], best: 0, total: 41 }, ranks_of(s));
    }

    #[test(should_fail)]
    fn wrong_level_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(s, costs, Step { level: 2, pub_support: [40, 0, 0, 0], best: 0, total: 40 }, ranks_of(s));
    }
}
```

Run: `nargo test --package pbear`
Expected: compile errors for the missing functions.

- [ ] **Step 2: Implement**

```rust
// noir/pbear/src/lib.nr (top part)
//! Circuit model of the sealed block's tally state (spec B7), mirroring
//! reference/commitments.py: State, commit, ingest, tally_step.

use sealed::{decrypt, effective_ranks, pk_matches, sponge, sponge_var, unpack_and_validate, NONE};
use std::embedded_curve_ops::EmbeddedCurveScalar;

pub struct State<let E: u32, let M: u32> {
    pub weights: [u64; E],
    pub ballots: [Field; E],
    pub funded: [bool; M],
    pub funded_order: [u8; M],
    pub funded_count: u8,
    pub level: u8,
    pub spent: u64,
    pub done: bool,
    pub m: u8,
    pub budget: u64,
    pub t_hash: Field,
}

pub struct Step<let M: u32> {
    pub level: u8,
    pub pub_support: [u64; M],
    pub best: u64,
    pub total: u64,
}

pub struct Entry {
    pub addr: Field,
    pub seat_weight: u64,
    pub rx: Field,
    pub ry: Field,
    pub c: Field,
}

pub fn empty_state<let E: u32, let M: u32>(m: u32, budget: u64) -> State<E, M> {
    State {
        weights: [0; E],
        ballots: [0; E],
        funded: [false; M],
        funded_order: [0; M],
        funded_count: 0,
        level: 1,
        spent: 0,
        done: false,
        m: m as u8,
        budget,
        t_hash: 0,
    }
}

pub fn funded_bits<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut bits: Field = 0;
    let mut pow: Field = 1;
    for c in 0..M {
        bits += if s.funded[c] { pow } else { 0 };
        pow *= 2;
    }
    bits
}

pub fn funded_order_packed<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut packed: Field = 0;
    let mut pow: Field = 1;
    for j in 0..M {
        packed += if (j as u8) < s.funded_count { (s.funded_order[j] as Field) * pow } else { 0 };
        pow *= 256;
    }
    packed
}

/// Poseidon2 over [weights, ballots, fundedBits, fundedOrderPacked, funded_count, level,
/// spent, done, m, budget, t_hash]: 2E + 9 elements.
pub fn commit<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut flat: [Field; 2 * E + 9] = [0; 2 * E + 9];
    for e in 0..E {
        flat[e] = s.weights[e] as Field;
        flat[E + e] = s.ballots[e];
    }
    flat[2 * E] = funded_bits(s);
    flat[2 * E + 1] = funded_order_packed(s);
    flat[2 * E + 2] = s.funded_count as Field;
    flat[2 * E + 3] = s.level as Field;
    flat[2 * E + 4] = s.spent as Field;
    flat[2 * E + 5] = if s.done { 1 } else { 0 };
    flat[2 * E + 6] = s.m as Field;
    flat[2 * E + 7] = s.budget as Field;
    flat[2 * E + 8] = s.t_hash;
    sponge(flat)
}

/// Effective ranks of every entry, computed once per proof (ballots never change).
pub fn ranks_of<let E: u32, let M: u32>(s: State<E, M>) -> [[u8; M]; E] {
    let mut out: [[u8; M]; E] = [[0; M]; E];
    for e in 0..E {
        let (_, bytes) = unpack_and_validate::<M>(s.ballots[e], s.m as u32);
        out[e] = effective_ranks::<M>(bytes, s.m as u32);
    }
    out
}

fn exhausted<let E: u32, let M: u32>(s: State<E, M>, costs: [u64; M]) -> bool {
    let mut all = true;
    for c in 0..M {
        let relevant = (c as u8) < s.m;
        let affordable = s.spent + costs[c] <= s.budget;
        all &= (!relevant) | s.funded[c] | (!affordable);
    }
    all
}

unconstrained fn div_hint(a: u64, b: u64, d: u64) -> (u64, u64) {
    let p = (a as u128) * (b as u128);
    ((p / (d as u128)) as u64, (p % (d as u128)) as u64)
}

/// floor(a * b / d) for u64 inputs, d != 0.
pub fn mul_div(a: u64, b: u64, d: u64) -> u64 {
    // Safety: q and r are fixed uniquely by the equation and the range check below.
    let (q, r) = unsafe { div_hint(a, b, d) };
    assert((q as Field) * (d as Field) + (r as Field) == (a as Field) * (b as Field));
    assert(r < d);
    q
}

/// One PB-EAR step over the sealed block, driven by a transcript step (spec B7).
/// A done or exhausted state absorbs nothing. Every assert is masked by `active`, so a
/// proof over a done state is always possible; a wrong transcript step over an active
/// state is not.
pub fn tally_step<let E: u32, let M: u32>(s: State<E, M>, costs: [u64; M], step: Step<M>, ranks: [[u8; M]; E]) -> State<E, M> {
    let m = s.m as u32;
    let was_done = s.done;
    let is_exhausted = exhausted(s, costs);
    let active = (!was_done) & (!is_exhausted);
    assert((!active) | (step.level == s.level));

    // transcript hash over [t, level, pub_support[0..m), best, total] (m + 4 elements)
    let mut elems: [Field; M + 4] = [0; M + 4];
    elems[0] = s.t_hash;
    elems[1] = step.level as Field;
    for idx in 2..M + 4 {
        let c = idx - 2;
        elems[idx] = if c < m {
            step.pub_support[c] as Field
        } else if c == m {
            step.best as Field
        } else if c == m + 1 {
            step.total as Field
        } else {
            0
        };
    }
    let t_next = sponge_var(elems, m + 4);

    // sealed support at this level
    let mut sealed_support: [u64; M] = [0; M];
    for e in 0..E {
        for c in 0..M {
            let approves = (ranks[e][c] <= s.level) & (!s.funded[c]) & (c < m);
            sealed_support[c] += if approves { s.weights[e] } else { 0 };
        }
    }
    // argmax: highest sum, then lowest cost, then lowest id
    let mut best: u64 = NONE;
    let mut best_sum: u64 = 0;
    let mut best_cost: u64 = 0;
    for c in 0..M {
        let sum = step.pub_support[c] + sealed_support[c];
        let eligible = (c < m) & (!s.funded[c]) & (sum >= costs[c]);
        let better = (best == NONE) | (sum > best_sum) | ((sum == best_sum) & (costs[c] < best_cost));
        if eligible & better {
            best = c as u64;
            best_sum = sum;
            best_cost = costs[c];
        }
    }
    assert((!active) | (step.best == best));
    let none = best == NONE;
    assert((!active) | (!none) | (step.total == 0));
    assert((!active) | none | (step.total == best_sum));

    // reweighting of the sealed supporters, cumulative rounding from pub_support[best]
    let funding = active & (!none);
    let mut pub_best: u64 = 0;
    let mut supports_best_col: [bool; E] = [false; E];
    for c in 0..M {
        if (c as u64) == best {
            pub_best = step.pub_support[c];
        }
    }
    for e in 0..E {
        let mut supports = false;
        for c in 0..M {
            supports |= ((c as u64) == best) & (ranks[e][c] <= s.level);
        }
        supports_best_col[e] = supports & (s.weights[e] != 0);
    }
    let divisor = if funding { step.total } else { 1 };
    let mut weights = s.weights;
    let mut cum: u64 = pub_best;
    for e in 0..E {
        let take = funding & supports_best_col[e];
        let new_cum = cum + weights[e];
        let deduct = mul_div(new_cum, best_cost, divisor) - mul_div(cum, best_cost, divisor);
        weights[e] = if take { weights[e] - deduct } else { weights[e] };
        cum = if take { new_cum } else { cum };
    }

    // new state
    let mut out = s;
    out.weights = weights;
    out.t_hash = if active { t_next } else { s.t_hash };
    // NONE branch
    let level_up = active & none & (s.level as u32 < m);
    let end_none = active & none & (s.level as u32 >= m);
    out.level = if level_up { s.level + 1 } else { s.level };
    // funding branch
    for c in 0..M {
        out.funded[c] = s.funded[c] | (funding & ((c as u64) == best));
    }
    for j in 0..M {
        out.funded_order[j] = if funding & ((j as u8) == s.funded_count) { best as u8 } else { s.funded_order[j] };
    }
    out.funded_count = if funding { s.funded_count + 1 } else { s.funded_count };
    out.spent = if funding { s.spent + best_cost } else { s.spent };
    let exhausted_after = exhausted(out, costs);
    out.done = was_done | is_exhausted | end_none | (funding & exhausted_after);
    out
}

/// Ingest batch `k`: absorb the batch's entries into the sealed chain from `h_in`,
/// decrypt them, write entries `k·B + j` of the state. Returns (state, h_out).
pub fn ingest_batch<let E: u32, let M: u32, let B: u32>(
    s: State<E, M>,
    sk: EmbeddedCurveScalar,
    k: u32,
    n_sealed: u32,
    h_in: Field,
    entries: [Entry; B],
) -> (State<E, M>, Field) {
    let mut out = s;
    let mut h = h_in;
    for j in 0..B {
        let i = k * B + j;
        let active = i < n_sealed;
        let e = entries[j];
        let h_next = sponge([h, e.addr, e.seat_weight as Field, e.rx, e.ry, e.c]);
        h = if active { h_next } else { h };
        let (valid, packed) = decrypt::<M>(sk, e.rx, e.ry, e.c, e.addr, s.m as u32);
        let use_it = active & valid;
        let weight = if use_it { e.seat_weight } else { 0 };
        let ballot = if use_it { packed } else { 0 };
        let idx = if active { i } else { 0 };
        let keep_w = out.weights[idx];
        let keep_b = out.ballots[idx];
        out.weights[idx] = if active { weight } else { keep_w };
        out.ballots[idx] = if active { ballot } else { keep_b };
    }
    (out, h)
}

pub fn check_key(sk: EmbeddedCurveScalar, pk_x: Field, pk_y: Field) {
    assert(pk_matches(sk, pk_x, pk_y));
}
```

Two points the implementer must keep exactly: the `weights[e] != 0` factor in `supports_best_col` mirrors `PBEAR.step()`'s `if (w == 0) continue` and `reference/commitments.py` skipping zero-weight entries; and the `divisor = 1` trick when not funding keeps `mul_div` satisfiable (its results are discarded through `take`).

Arithmetic generics in array lengths (`[Field; 2 * E + 9]`, `[u32; M + 1]`, `[Field; M + 4]`), generic structs `State<E, M>` and `#[test(should_fail)]` were all verified to compile and run on `nargo 1.0.0-beta.26` before this plan was written.

Run: `nargo test --package pbear`
Expected: 8 tests pass (5 positive, 3 `should_fail`).

- [ ] **Step 3: Commit**

```bash
cd noir && nargo fmt && cd ..
git add noir/Nargo.toml noir/pbear
git commit -m "Add the sealed tally state, its commitment and the transcript-driven step in Noir"
```

---

### Task 3: Ingest circuits and fixture execution

**Files:**
- Create: `noir/ingest-test/{Nargo.toml,src/main.nr}`, `noir/ingest-default/{Nargo.toml,src/main.nr}`, `reference/tools/noir_inputs.py`, `reference/tools/noir_run.py`
- Modify: `noir/Nargo.toml` (members)

**Interfaces:**
- Produces `python3 reference/tools/noir_inputs.py --fixture <name> --ingest <k> --out <Prover.toml>` and `--tally <g>`; `python3 reference/tools/noir_run.py --fixture <name> [--only ingest|tally]` which writes each proof's `Prover.toml` into the right crate, runs `nargo execute --package <crate> <witness-name>`, and reports one line per proof; exit code non-zero on any failure. Witness files land in `noir/<crate>/target/<fixture>-ingest-<k>.gz` etc. (used by Task 5).
- Fixture → profile mapping: `test_*` fixtures use the `test` crates, `default_*` the `default` crates.

- [ ] **Step 1: The binaries**

```toml
# noir/ingest-test/Nargo.toml
[package]
name = "ingest_test"
type = "bin"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]
sealed = { path = "../sealed" }
pbear = { path = "../pbear" }
```

```rust
// noir/ingest-test/src/main.nr
use pbear::{check_key, commit, empty_state, ingest_batch, Entry, State};
use std::embedded_curve_ops::EmbeddedCurveScalar;

global E: u32 = 8;
global M: u32 = 4;
global B: u32 = 2;

fn main(
    k: pub u32,
    n_sealed: pub u32,
    m: pub u32,
    budget: pub u64,
    pk_x: pub Field,
    pk_y: pub Field,
    h_in: pub Field,
    h_out: pub Field,
    state_in: pub Field,
    state_out: pub Field,
    sk_lo: Field,
    sk_hi: Field,
    state: State<E, M>,
    entries: [Entry; B],
) {
    let sk = EmbeddedCurveScalar { lo: sk_lo, hi: sk_hi };
    check_key(sk, pk_x, pk_y);
    let first = k == 0;
    assert((!first) | (state_in == 0));
    assert(first | (commit(state) == state_in));
    let start: State<E, M> = if first { empty_state::<E, M>(m, budget) } else { state };
    let (end, h) = ingest_batch::<E, M, B>(start, sk, k, n_sealed, h_in, entries);
    assert(h == h_out);
    assert(commit(end) == state_out);
}
```

`noir/ingest-default/` is identical with `name = "ingest_default"` and `global E: u32 = 256; global M: u32 = 16; global B: u32 = 32;`. Add both to the workspace members.

Run: `nargo compile --workspace` — expected: both compile. Then `bb gates -b noir/ingest-test/target/ingest_test.json` and the default one; note the `circuit_size` values for Task 6.

- [ ] **Step 2: Input generator**

```python
# reference/tools/noir_inputs.py
"""Write the Prover.toml of one proof of a fixture, replaying the reference.

Usage:
  python3 reference/tools/noir_inputs.py --fixture test_main --ingest 0 --out P.toml
  python3 reference/tools/noir_inputs.py --fixture test_main --tally 1 --out P.toml
Fixtures live in reference/vectors/fixture_<name>.json.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import commitments as cm  # noqa: E402
import sealed  # noqa: E402
from pbear import NONE  # noqa: E402
from profiles import PROFILES  # noqa: E402

VECTORS = os.path.join(HERE, "..", "vectors")


def q(n):
    """TOML string for a field/integer value."""
    return f'"{int(n)}"'


def load(name):
    with open(os.path.join(VECTORS, f"fixture_{name}.json")) as f:
        return json.load(f)


def profile_of(fx):
    return PROFILES[fx["profile"]["name"]]


def sealed_voters(fx):
    return [v for v in fx["voters"] if v["hasSealed"]]


def replay_ingest(fx, upto_batch):
    """State after ingest batches 0..upto_batch (inclusive), and the state before it."""
    p = profile_of(fx)
    m = fx["m"]
    budget = int(fx["totalWeight"], 16)
    voters = sealed_voters(fx)
    state = cm.empty_state(p, m, budget)
    before = None
    for k in range(upto_batch + 1):
        before = cm.State(**vars(state))
        before.weights = list(state.weights)
        before.ballots = list(state.ballots)
        for j in range(p.batch):
            i = k * p.batch + j
            if i < len(voters):
                v = voters[i]
                cm.ingest(state, i, int(v["seatWeight"], 16), None if v["sealedRanks"] is None else sealed.pack(v["sealedRanks"]))
    return before, state


def state_after_all_ingest(fx):
    p = profile_of(fx)
    n = fx["sealedCount"]
    last = max(1, -(-n // p.batch)) - 1
    _, state = replay_ingest(fx, last)
    return state


def state_toml(state, p):
    lines = ["[state]"]
    lines.append("weights = [" + ", ".join(q(w) for w in state.weights) + "]")
    lines.append("ballots = [" + ", ".join(q(b) for b in state.ballots) + "]")
    lines.append("funded = [" + ", ".join("true" if f else "false" for f in state.funded) + "]")
    lines.append("funded_order = [" + ", ".join(q(x) for x in state.funded_order) + "]")
    lines.append(f"funded_count = {q(state.funded_count)}")
    lines.append(f"level = {q(state.level)}")
    lines.append(f"spent = {q(state.spent)}")
    lines.append(f"done = {'true' if state.done else 'false'}")
    lines.append(f"m = {q(state.m)}")
    lines.append(f"budget = {q(state.budget)}")
    lines.append(f"t_hash = {q(state.t_hash)}")
    return lines


def ingest_toml(fx, k):
    p = profile_of(fx)
    proof = fx["ingestProofs"][k]
    before, _ = replay_ingest(fx, k)
    voters = sealed_voters(fx)
    sk = int(fx["sk"], 16)
    lines = [
        f"k = {q(k)}",
        f"n_sealed = {q(fx['sealedCount'])}",
        f"m = {q(fx['m'])}",
        f"budget = {q(int(fx['totalWeight'], 16))}",
        f"pk_x = {q(int(proof['pkX'], 16))}",
        f"pk_y = {q(int(proof['pkY'], 16))}",
        f"h_in = {q(int(proof['hIn'], 16))}",
        f"h_out = {q(int(proof['hOut'], 16))}",
        f"state_in = {q(int(proof['stateIn'], 16))}",
        f"state_out = {q(int(proof['stateOut'], 16))}",
        f"sk_lo = {q(sk & ((1 << 128) - 1))}",
        f"sk_hi = {q(sk >> 128)}",
        "",
    ]
    lines += state_toml(before, p)
    for j in range(p.batch):
        i = k * p.batch + j
        lines.append("")
        lines.append("[[entries]]")
        if i < len(voters):
            v = voters[i]
            rx, ry, c = (int(x, 16) for x in v["ciphertext"])
            lines += [f"addr = {q(int(v['addr'], 16))}", f"seat_weight = {q(int(v['seatWeight'], 16))}",
                      f"rx = {q(rx)}", f"ry = {q(ry)}", f"c = {q(c)}"]
        else:
            lines += ['addr = "0"', 'seat_weight = "0"', 'rx = "0"', 'ry = "0"', 'c = "0"']
    return "\n".join(lines) + "\n"


def tally_toml(fx, g):
    p = profile_of(fx)
    proof = fx["tallyProofs"][g]
    costs = [int(c, 16) for c in fx["costs"]]
    m = fx["m"]
    state = state_after_all_ingest(fx)
    transcript = fx["transcript"]
    cursor = 0
    # replay groups before g
    for _ in range(g):
        for _ in range(p.k):
            step = transcript[cursor] if cursor < len(transcript) else [state.level] + [0] * m + [NONE, 0]
            before = state.t_hash
            cm.tally_step(p, state, costs, step)
            if state.t_hash != before:
                cursor += 1
    # the K steps of group g, as the circuit will see them
    steps = []
    probe = cm.State(**vars(state))
    probe.weights = list(state.weights)
    probe.ballots = list(state.ballots)
    probe.funded = list(state.funded)
    probe.funded_order = list(state.funded_order)
    for _ in range(p.k):
        step = transcript[cursor] if cursor < len(transcript) else [probe.level] + [0] * m + [NONE, 0]
        steps.append(step)
        before = probe.t_hash
        cm.tally_step(p, probe, costs, step)
        if probe.t_hash != before:
            cursor += 1
    lines = [
        f"costs_hash = {q(int(proof['costsHash'], 16))}",
        f"state_in = {q(int(proof['stateIn'], 16))}",
        f"state_out = {q(int(proof['stateOut'], 16))}",
        f"done = {q(proof['done'])}",
        f"t_hash_out = {q(int(proof['tHashOut'], 16))}",
        f"funded_count = {q(proof['fundedCount'])}",
        f"funded_order_packed = {q(int(proof['fundedOrderPacked'], 16))}",
        "costs = [" + ", ".join(q(c) for c in costs + [0] * (p.m_max - m)) + "]",
        "",
    ]
    lines += state_toml(state, p)
    for step in steps:
        level, pub, best, total = step[0], step[1 : m + 1], step[m + 1], step[m + 2]
        lines.append("")
        lines.append("[[steps]]")
        lines.append(f"level = {q(level)}")
        lines.append("pub_support = [" + ", ".join(q(x) for x in pub + [0] * (p.m_max - m)) + "]")
        lines.append(f"best = {q(best)}")
        lines.append(f"total = {q(total)}")
    return "\n".join(lines) + "\n"


def main(argv):
    name = argv[argv.index("--fixture") + 1]
    out = argv[argv.index("--out") + 1]
    fx = load(name)
    if "--ingest" in argv:
        text = ingest_toml(fx, int(argv[argv.index("--ingest") + 1]))
    else:
        text = tally_toml(fx, int(argv[argv.index("--tally") + 1]))
    with open(out, "w") as f:
        f.write(text)
    print(out)


if __name__ == "__main__":
    main(sys.argv)
```

The `tally_toml` function is used by Task 4; write it now so the tool is complete. `cm.State(**vars(state))` copies the dataclass; the explicit list copies avoid sharing the arrays.

```python
# reference/tools/noir_run.py
"""Execute every proof of a fixture with nargo and report.

Usage: python3 reference/tools/noir_run.py --fixture test_main [--only ingest|tally]
Requires nargo on PATH (`. noir/scripts/env.sh`). Exit code 1 on any failure.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path.insert(0, os.path.join(HERE, ".."))

from noir_inputs import load  # noqa: E402


def crate(fx, kind):
    return f"{kind}-{fx['profile']['name']}"


def package(fx, kind):
    return f"{kind}_{fx['profile']['name']}"


def run_one(name, fx, kind, index):
    c = crate(fx, kind)
    prover = os.path.join(ROOT, "noir", c, "Prover.toml")
    subprocess.run(
        [sys.executable, os.path.join(HERE, "noir_inputs.py"), "--fixture", name, f"--{kind}", str(index), "--out", prover],
        check=True, capture_output=True,
    )
    witness = f"{name}-{kind}-{index}"
    r = subprocess.run(
        ["nargo", "execute", "--package", package(fx, kind), witness],
        cwd=os.path.join(ROOT, "noir"), capture_output=True, text=True,
    )
    ok = r.returncode == 0
    print(f"{'ok ' if ok else 'FAIL'} {name} {kind} {index}")
    if not ok:
        print(r.stdout[-2000:], r.stderr[-2000:])
    return ok


def main(argv):
    name = argv[argv.index("--fixture") + 1]
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    fx = load(name)
    ok = True
    if only in (None, "ingest"):
        for k in range(len(fx["ingestProofs"])):
            ok &= run_one(name, fx, "ingest", k)
    if only in (None, "tally"):
        for g in range(len(fx["tallyProofs"])):
            ok &= run_one(name, fx, "tally", g)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 3: Execute the ingest proofs of every fixture**

```bash
. noir/scripts/env.sh
for f in test_main test_smallm test_nosealed default_main; do
  python3 reference/tools/noir_run.py --fixture $f --only ingest || exit 1
done
```

Expected: `ok` for every batch (3 + 3 + 1 + 3 lines). A failure means the circuit's chain or state commitment disagrees with `reference/commitments.py`: run `nargo execute` by hand in the crate to see which `assert` fired (`h == h_out` → sponge inputs order or the `active` mask; `commit(end) == state_out` → decryption validity, the `weights[e] != 0` rule, or the flat layout of `commit`).

- [ ] **Step 4: Commit**

```bash
cd noir && nargo fmt && cd ..
git add noir/Nargo.toml noir/ingest-test noir/ingest-default reference/tools/noir_inputs.py reference/tools/noir_run.py
git commit -m "Add the ingest circuits and execute them on every fixture"
```

---

### Task 4: Tally circuits and full-chain execution

**Files:**
- Create: `noir/tally-test/{Nargo.toml,src/main.nr}`, `noir/tally-default/{Nargo.toml,src/main.nr}`
- Modify: `noir/Nargo.toml` (members)

- [ ] **Step 1: The binaries**

```toml
# noir/tally-test/Nargo.toml
[package]
name = "tally_test"
type = "bin"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]
sealed = { path = "../sealed" }
pbear = { path = "../pbear" }
```

```rust
// noir/tally-test/src/main.nr
use pbear::{commit, funded_order_packed, ranks_of, tally_step, State, Step};
use sealed::sponge_var;

global E: u32 = 8;
global M: u32 = 4;
global K: u32 = 2;

fn main(
    costs_hash: pub Field,
    state_in: pub Field,
    state_out: pub Field,
    done: pub Field,
    t_hash_out: pub Field,
    funded_count: pub Field,
    funded_order_packed_in: pub Field,
    costs: [u64; M],
    state: State<E, M>,
    steps: [Step<M>; K],
) {
    let m = state.m as u32;
    let mut cost_fields: [Field; M] = [0; M];
    for c in 0..M {
        cost_fields[c] = costs[c] as Field;
    }
    assert(sponge_var(cost_fields, m) == costs_hash);
    assert(commit(state) == state_in);
    let ranks = ranks_of(state);
    let mut s = state;
    for i in 0..K {
        s = tally_step(s, costs, steps[i], ranks);
    }
    assert(commit(s) == state_out);
    assert((if s.done { 1 } else { 0 }) == done);
    assert(s.t_hash == t_hash_out);
    assert((s.funded_count as Field) == funded_count);
    assert(funded_order_packed(s) == funded_order_packed_in);
}
```

The seventh public input is named `funded_order_packed_in` to avoid clashing with the imported function; the public-input order is what matters and it is the seventh. `noir/tally-default/` is identical with `name = "tally_default"`, `E = 256`, `M = 16`, `K = 8`. Add both members.

Run: `nargo compile --workspace`; note `bb gates` for both tally circuits.

- [ ] **Step 2: Execute every proof of every fixture**

```bash
. noir/scripts/env.sh
for f in test_main test_smallm test_nosealed default_main; do
  python3 reference/tools/noir_run.py --fixture $f || exit 1
done
```

Expected: every ingest and tally line `ok`. `test_smallm` exercises `m < M` and the terminal `NONE` step; `test_nosealed` the empty batch and a tally over an all-zero sealed block; `default_main` the full profile (its tally execution takes seconds per group).

- [ ] **Step 3: Commit**

```bash
cd noir && nargo fmt && cd ..
git add noir/Nargo.toml noir/tally-test noir/tally-default
git commit -m "Add the tally circuits and execute the full proof chain of every fixture"
```

---

### Task 5: Verification keys, Solidity verifiers, real proofs in Foundry

**Files:**
- Create: `noir/scripts/build.sh`, `noir/scripts/prove_fixture.sh`, `noir/artifacts/<profile>/…`, `src/verifiers/IngestVerifier.sol`, `src/verifiers/TallyVerifier.sol`, `test/verifiers/IngestVerifierTest.sol`, `test/verifiers/TallyVerifierTest.sol`, `noir/proofs/<scenario>/…`, `test/verifiers/RealProofs.t.sol`, `script/DeployVerifiers.s.sol`
- Modify: `test/sealed/FixtureLoader.sol` (verifier factory hook), `script/DeploySealed.s.sol` header comment (mention `DeployVerifiers`)

**Interfaces:**
- `FixtureLoader` gains `function makeVerifiers() internal virtual returns (IHonkVerifier ingest, IHonkVerifier tally)` returning the mocks by default; `deployFromFixture` uses it. `RealProofs.t.sol` overrides it with the generated `test`-profile verifiers.
- `noir/scripts/build.sh [profile]`: compiles the workspace, writes `noir/artifacts/<profile>/{ingest,tally}.json` (ACIR), `.vk`, `.vk_hash`, and the Solidity verifiers (renamed contracts) into `src/verifiers/` (default) or `test/verifiers/` (test).
- `noir/scripts/prove_fixture.sh <fixture>`: for each proof of the fixture, generates inputs, executes, proves with `bb prove -t evm`, verifies with `bb verify`, and writes `noir/proofs/<fixture>/<kind>-<i>.proof` and `.pub`.

- [ ] **Step 1: Build script**

```bash
#!/usr/bin/env bash
# noir/scripts/build.sh [test|default]: ACIR, verification keys and Solidity verifiers.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh
profile="${1:-default}"
case "$profile" in
  test) dest="../test/verifiers"; suffix="Test" ;;
  default) dest="../src/verifiers"; suffix="" ;;
  *) echo "profile must be test or default" >&2; exit 1 ;;
esac
nargo compile --workspace
mkdir -p "artifacts/$profile" "$dest"
for kind in ingest tally; do
  pkg="${kind}_${profile}"
  cp "$kind-$profile/target/$pkg.json" "artifacts/$profile/$kind.json"
  bb write_vk -b "artifacts/$profile/$kind.json" -o "artifacts/$profile/$kind" -t evm
  # bb writes <out>/vk and <out>/vk_hash when -o is a directory
  mv "artifacts/$profile/$kind/vk" "artifacts/$profile/$kind.vk"
  mv "artifacts/$profile/$kind/vk_hash" "artifacts/$profile/$kind.vk_hash"
  rmdir "artifacts/$profile/$kind"
  name="$(tr '[:lower:]' '[:upper:]' <<< "${kind:0:1}")${kind:1}Verifier$suffix"
  bb write_solidity_verifier -k "artifacts/$profile/$kind.vk" -o "$dest/$name.sol" -t evm --optimized
  sed -i "s/contract HonkVerifier is IVerifier/contract $name is IVerifier/" "$dest/$name.sol"
  sed -i '1i // Generated by noir/scripts/build.sh from noir/artifacts/'"$profile/$kind"'.vk with bb 5.0.0. Do not edit.' "$dest/$name.sol"
done
echo "built $profile: artifacts/$profile, $dest"
```

If `bb write_vk -o <dir>` on this version writes `vk` and `vk_hash` inside the directory (it does for `-o target` in the probe), the `mv` lines are right; if it writes to the exact path given, drop the `mv`/`rmdir` lines and pass `-o artifacts/$profile/$kind.vk` directly. Check the first run and fix the script accordingly; report which.

Run: `noir/scripts/build.sh test && noir/scripts/build.sh default && forge build`
Expected: four verifier contracts compile; `forge build --sizes` shows each around 15–16 KB of runtime code.

- [ ] **Step 2: Prove the test-profile fixtures**

```bash
#!/usr/bin/env bash
# noir/scripts/prove_fixture.sh <fixture>: real proofs for every step of one fixture.
set -euo pipefail
cd "$(dirname "$0")/../.."
. noir/scripts/env.sh
fixture="$1"
profile="${fixture%%_*}"      # test_main -> test
out="noir/proofs/$fixture"
mkdir -p "$out"
python3 reference/tools/noir_run.py --fixture "$fixture"
count() { python3 -c "import json,sys; print(len(json.load(open('reference/vectors/fixture_$fixture.json'))['$1']))"; }
for kind in ingest tally; do
  key="${kind}Proofs"
  n=$(count "$key")
  pkg="${kind}_${profile}"
  for ((i = 0; i < n; i++)); do
    witness="noir/$kind-$profile/target/$fixture-$kind-$i.gz"
    bb prove -b "noir/artifacts/$profile/$kind.json" -w "$witness" -k "noir/artifacts/$profile/$kind.vk" -o "$out/tmp" -t evm
    mv "$out/tmp/proof" "$out/$kind-$i.proof"
    mv "$out/tmp/public_inputs" "$out/$kind-$i.pub"
    rmdir "$out/tmp"
    bb verify -k "noir/artifacts/$profile/$kind.vk" -p "$out/$kind-$i.proof" -i "$out/$kind-$i.pub" -t evm
  done
done
echo "proved $fixture into $out"
```

Run: `for f in test_main test_smallm test_nosealed; do noir/scripts/prove_fixture.sh $f; done`
Expected: every `bb verify` prints `Proof verified successfully`; `noir/proofs/` holds about 18 proof files. Record the wall time of one `bb prove` for each circuit in the report (Task 6 uses it).

- [ ] **Step 3: Foundry: real verifiers, real proofs, real `advance`**

Change `test/sealed/FixtureLoader.sol`: add

```solidity
    function makeVerifiers() internal virtual returns (IHonkVerifier ingest, IHonkVerifier tally) {
        ingestVerifier = new MockHonkVerifier();
        tallyVerifier = new MockHonkVerifier();
        return (IHonkVerifier(address(ingestVerifier)), IHonkVerifier(address(tallyVerifier)));
    }
```

and in `deployFromFixture` replace the two `new MockHonkVerifier()` lines and the `cfg.ingestVerifier`/`cfg.tallyVerifier` assignments with `(IHonkVerifier iv, IHonkVerifier tv) = makeVerifiers();` and `ingestVerifier: iv, tallyVerifier: tv`. Existing tests keep using the mocks (`ingestVerifier.setAccept(...)` still refers to the mock instances).

```solidity
// test/verifiers/RealProofs.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {IngestVerifierTest} from "./IngestVerifierTest.sol";
import {TallyVerifierTest} from "./TallyVerifierTest.sol";
import {FixtureLoader} from "../sealed/FixtureLoader.sol";

/// @dev The whole chain with the generated Honk verifiers and proofs made by bb from
///      the fixture witnesses: the strongest evidence the circuits, the Python
///      reference and the contract agree.
contract RealProofsTest is FixtureLoader {
    function makeVerifiers() internal override returns (IHonkVerifier, IHonkVerifier) {
        return (IHonkVerifier(address(new IngestVerifierTest())), IHonkVerifier(address(new TallyVerifierTest())));
    }

    function loadProof(string memory fixture, string memory kind, uint256 i)
        internal
        view
        returns (bytes memory proof, bytes32[] memory inputs)
    {
        string memory base = string.concat("noir/proofs/", fixture, "/", kind, "-", vm.toString(i));
        proof = vm.readFileBinary(string.concat(base, ".proof"));
        bytes memory raw = vm.readFileBinary(string.concat(base, ".pub"));
        inputs = new bytes32[](raw.length / 32);
        for (uint256 w = 0; w < inputs.length; w++) {
            bytes32 word;
            assembly {
                word := mload(add(add(raw, 32), mul(w, 32)))
            }
            inputs[w] = word;
        }
    }

    function report() internal {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) flat[s * width + w] = step[w];
        }
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat)));
    }

    function runFixture(string memory name) internal {
        loadFixture(name);
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            (bytes memory proof, bytes32[] memory inputs) = loadProof(name, "ingest", k);
            assertEq(inputs.length, 10, "ingest public inputs");
            uint256 g = gasleft();
            pool.advance(proof, inputs, false);
            emit log_named_uint(string.concat(name, " ingest advance gas"), g - gasleft());
        }
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 j = 0; j < nT; j++) {
            (bytes memory proof, bytes32[] memory inputs) = loadProof(name, "tally", j);
            assertEq(inputs.length, 7, "tally public inputs");
            uint256 g = gasleft();
            pool.advance(proof, inputs, false);
            emit log_named_uint(string.concat(name, " tally advance gas"), g - gasleft());
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven with real proofs");
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length);
        for (uint256 i = 0; i < order.length; i++) assertEq(got[i], order[i]);
    }

    function test_realProofs_testMain() public {
        runFixture("test_main");
    }

    function test_realProofs_restartByCoordinatorWithRealProof() public {
        // Apply tally group 0 twice: forward, then again as a coordinator restart from the
        // ingested state. The chain must end Proven either way.
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        report();
        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            (bytes memory p, bytes32[] memory pi) = loadProof("test_main", "ingest", k);
            pool.advance(p, pi, false);
        }
        (bytes memory p0, bytes32[] memory pi0) = loadProof("test_main", "tally", 0);
        pool.advance(p0, pi0, false);
        vm.prank(coordinator);
        pool.advance(p0, pi0, true);
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 j = 1; j < nT; j++) {
            (bytes memory p, bytes32[] memory pi) = loadProof("test_main", "tally", j);
            pool.advance(p, pi, false);
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven));
    }

    function test_realProofs_testSmallm() public {
        runFixture("test_smallm");
    }

    function test_realProofs_testNosealed() public {
        runFixture("test_nosealed");
    }

    function test_tamperedProofReverts() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        (bytes memory proof, bytes32[] memory inputs) = loadProof("test_main", "ingest", 0);
        proof[100] ^= 0x01;
        // The generated verifier reverts with its own error; advance wraps that into InvalidProof.
        vm.expectRevert(SealedRankedShares.InvalidProof.selector);
        pool.advance(proof, inputs, false);
    }

    function test_profileIdMatchesTheTestProfile() public {
        loadFixture("test_main");
        deployFromFixture();
        assertEq(pool.profileId(), keccak256(abi.encode(uint256(8), uint256(4), uint256(2))));
    }

    function test_proofForOtherBatchRejected() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
        closeAll(100);
        (bytes memory proof, bytes32[] memory inputs) = loadProof("test_main", "ingest", 1);
        vm.expectRevert(SealedRankedShares.ProofOutOfOrder.selector);
        pool.advance(proof, inputs, false);
    }
}
```

`foundry.toml` already grants read access to `./reference`; add `{ access = "read", path = "./noir/proofs" }` to `fs_permissions`.

Run: `forge test --match-path "test/verifiers/RealProofs.t.sol" -vv`
Expected: 5 tests pass; the gas lines show each `advance` in the 700k–900k range (verifier plus calldata plus the contract's checks). A revert with a verifier custom error on an honest proof means the public-input order or the verifier profile is wrong: compare `inputs` against `fxWords(".ingestProofs[k]...")` word by word.

- [ ] **Step 4: Deploy script**

```solidity
// script/DeployVerifiers.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IngestVerifier} from "../src/verifiers/IngestVerifier.sol";
import {TallyVerifier} from "../src/verifiers/TallyVerifier.sol";

/// @notice Deploys the default-profile Honk verifiers once per chain.
///   forge script script/DeployVerifiers.s.sol --rpc-url $RPC_URL --broadcast
/// Pass the two addresses to DeploySealed as INGEST_VERIFIER and TALLY_VERIFIER.
contract DeployVerifiers is Script {
    function run() external returns (IngestVerifier ingest, TallyVerifier tally) {
        vm.startBroadcast();
        ingest = new IngestVerifier();
        tally = new TallyVerifier();
        vm.stopBroadcast();
        console.log("IngestVerifier deployed at", address(ingest));
        console.log("TallyVerifier deployed at", address(tally));
    }
}
```

Update the header comment of `script/DeploySealed.s.sol` to say the real verifiers come from `DeployVerifiers`.

Run: `forge build && forge test -q`
Expected: everything green (the full suite now also compiles four verifiers; allow a longer build).

- [ ] **Step 5: Commit**

```bash
forge fmt
git add noir/scripts noir/artifacts noir/proofs src/verifiers test/verifiers test/sealed/FixtureLoader.sol script/DeployVerifiers.s.sol script/DeploySealed.s.sol foundry.toml
git commit -m "Generate Honk verifiers and prove the fixtures end to end through advance"
```

---

### Task 6: Sizes, timings, README, spec decision

**Files:**
- Create: `noir/README.md`
- Modify: `README.md` (Sealed pools section: verifiers and proving), `docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md` (B12.1, B12.3, B12.5 outcomes; decision 6 numbers if they changed)

- [ ] **Step 1: Measure**

```bash
. noir/scripts/env.sh
for p in test default; do for k in ingest tally; do
  echo "$k-$p: $(bb gates -b noir/artifacts/$p/$k.json 2>/dev/null | grep circuit_size)"
done; done
# proving time, default profile, on the default fixture's first ingest batch and first tally group
python3 reference/tools/noir_run.py --fixture default_main
for k in ingest tally; do
  /usr/bin/time -f "$k-default prove: %e s, %M KB" bb prove -b noir/artifacts/default/$k.json \
    -w noir/$k-default/target/default_main-$k-0.gz -k noir/artifacts/default/$k.vk -o /tmp/claude-1000/bbprove-$k -t evm
done
```

Record gate counts, proving wall time and peak memory for the four circuits.

- [ ] **Step 2: Decide the profile**

Spec B12.1: if the default `tally` proof is above about 1.2 M gates, lower `K` (8 → 4) in `noir/tally-default/src/main.nr` and in `reference/profiles.py`, regenerate fixtures (`python3 reference/tools/make_fixture.py --profile default`), rerun Tasks 4–5's execution and build for the default profile, and update spec decision 6 ("at most N proofs"). If it is under, keep `K = 8`. Either way write the numbers into the spec's B12.1 and B12.3 entries as "measured" outcomes (native `bb`; the browser measurement belongs to plan 4).

- [ ] **Step 3: Document**

`noir/README.md`:

```markdown
# Noir circuits

`sealed` and `pbear` are libraries mirroring `reference/sealed.py` and
`reference/commitments.py`; `ingest-<profile>` and `tally-<profile>` are the circuits of
spec B7 for the `test` (E 8, M 4, B 2, K 2) and `default` (E 256, M 16, B 32, K 8)
profiles.

    . noir/scripts/env.sh                     # nargo 1.0.0-beta.26, bb 5.0.0 (see VERSIONS)
    cd noir && nargo test --workspace         # library tests
    python3 reference/tools/noir_run.py --fixture test_main   # execute every proof of a fixture
    noir/scripts/build.sh test && noir/scripts/build.sh default  # ACIR, vk, Solidity verifiers
    noir/scripts/prove_fixture.sh test_main   # real proofs into noir/proofs/

| Circuit | Gates | bb prove (native) | Peak memory |
|---|---|---|---|
| ingest-test | … | … | … |
| tally-test | … | … | … |
| ingest-default | … | … | … |
| tally-default | … | … | … |

A change to any circuit changes its verification key: rerun `build.sh`, commit the new
verifiers, and deploy a new pool.
```

Fill the table from Step 1. In `README.md`'s "Sealed pools" section replace the sentence about accept-all mocks with a pointer to `script/DeployVerifiers.s.sol` and `noir/README.md`, and add the measured `advance` gas from `RealProofsTest`.

- [ ] **Step 4: Full verification and commit**

```bash
python3 -W error -m unittest discover reference
(cd noir && nargo test --workspace)
forge test -q
git add noir/README.md README.md docs/superpowers/specs/2026-09-05-sealed-ballots-noir-design.md noir reference/profiles.py reference/vectors
git commit -m "Record circuit sizes and proving times, document the Noir build"
```

(Include `reference/profiles.py` and `reference/vectors` only if Step 2 changed `K`.)

---

### Verification (end to end)

```
. noir/scripts/env.sh
(cd noir && nargo test --workspace)
for f in test_main test_smallm test_nosealed default_main; do python3 reference/tools/noir_run.py --fixture $f; done
forge test -q                                   # includes RealProofsTest
python3 -W error -m unittest discover reference
```

What plan 4 needs from this one: `noir/artifacts/default/{ingest,tally}.json` and `.vk` (bb.js loads the ACIR and derives or loads the key), the `Prover.toml` field names as the witness map the TypeScript prover must build (`reference/tools/noir_inputs.py` is the executable spec of that map), the public-input order, `src/verifiers/*.sol` addresses from `DeployVerifiers`, and the `bb.js 5.0.0` pin in `noir/VERSIONS`.
