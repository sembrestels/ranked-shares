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
    cargo test -p sealed --test fixtures -- --ignored   # the same, from cargo

The ELF lands in `target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest`.

ZisK v1.2.0-alpha. On this machine every ZisK process needs
`HWLOC_COMPONENTS=-gl` and, for the PLONK wrap, `GLIBC_TUNABLES=glibc.rtld.execstack=2`.

## Measurements

Emulator steps (`ziskemu -m` via `scripts/emu-check.sh`), guest built 2026-09-05
(`target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest`). All four scenarios matched
the Python reference's `outputHash`.

Voter counts are read off `reference/zisk/make_fixture.py`, not off the fixture files'
raw voter count: a voter counts as **sealed** if it has a non-empty `ciphertext` (valid
or corrupt — five of `main`'s ciphertexts are deliberately invalid and still cost steps
to reject) and as **direct** if it has a non-empty `directBallot` (an address that only
holds weight but never cast a ballot, e.g. `main`/`nosealed`'s "never voted" registrant
below `minDirectVote`, or `main`'s "silent seat holder", counts as neither). `main`'s
"both" voter is counted in each column once.

| Scenario | Voters (direct / sealed) | m | Steps |
|---|---|---|---|
| main | 4 / 13 | 4 | 92,660 |
| nosealed | 3 / 0 | 4 | 16,415 |
| nodirect | 0 / 5 | 4 | 44,337 |
| big | 2000 / 200 | 16 | 15,638,535 |

`big` (2,200 voters, 16 projects) is generated on demand from `reference/` with
`python3 -m zisk.make_fixture --scenario big --out <dir>` and is not committed.

Steps per sealed ballot ≈ (nodirect − nosealed) / 5 = (44,337 − 16,415) / 5 ≈ 5,584.
Steps per direct voter ≈ nosealed / 3 = 16,415 / 3 ≈ 5,472. (`main` isn't used for
either estimate: its sealed set mixes valid, corrupt and revoked ballots at different
costs.) Extrapolating both rates to `big` predicts ≈ 2000·5,472 + 200·5,584 ≈
12.06M steps against an observed 15.64M — `big` runs `m = 16` versus `m = 4` for the
other three fixtures, and PB-EAR's iterative funding rounds scale with the project
count too, so a per-voter rate measured at `m = 4` under-predicts a larger `m`.

`cargo-zisk run -e target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest -i <main.bin> -p summary`
attributes 93.6% of `main`'s weighted cost to plain instruction execution ("Base"),
with precompiles only 3.3%. Among individual functions, `secp256k1::scalar_mul_secp256k1`
(the ECDH point multiplication run once per sealed ballot to derive its keystream) is
the single largest named contributor (3.4%), ahead of `keccak256` (1.8%); the tally
logic itself (`pbear::validate`) is negligible (0.1%). Sealed-ballot decryption, not
the PB-EAR arithmetic, dominates the guest's cost.
