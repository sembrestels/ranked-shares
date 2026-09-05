# zisk: the whole PB-EAR tally proven in a ZisK guest

Spec: `docs/superpowers/specs/2026-09-05-sealed-ballots-zisk-design.md`.

| Crate | What |
|---|---|
| `crates/pbear` | PB-EAR over `u64`, tested against `reference/pbear.py` |
| `crates/sealed` | witness types, secp256k1 ECDH + keccak pad, voter chain, `inputsHash`, output hash, `tally::run` |
| `guest` | the ZisK program: read, run, commit 32 bytes |
| `prover` | `tally-prover`: keys, encrypt, fetch, check, prove, wrap, export, submit, run |

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

## Prover

    export TALLIER_MASTER=0x…          # 32 bytes; the operator's master secret
    cargo run -p tally-prover -- keys --salt 0x…                       # pk for a pool's keySalt
    cargo run -p tally-prover -- encrypt --pk 0x… --voter 0x… --ranks 1,2,3,0
    cargo run -p tally-prover -- run --rpc $RPC --pool $POOL --workdir /tmp/pool  # after close()

`run` = fetch → check → prove → wrap → export → submit, with `SUBMITTER_KEY` holding the
key that pays for `finalize` (anyone may call it). Steps are also available one by one.
Environment overrides: `CARGO_ZISK`, `CARGO_ZISK_DEV`, `ZISK_PROVING_KEY`,
`ZISK_PROVING_KEY_SNARK`, `TALLY_GUEST_ELF`.

## Where to prove

This box proves on CPU: an Intel iGPU, no CUDA, and ZisK's GPU build needs CUDA 12.9
and an NVIDIA driver ≥ 525, neither installed here. RunPod-style GPU rentals would speed
proving but offer no TEE, so the tallier's master secret would leave this machine in the
clear. GPU-TEE providers billed by the hour — Intel TDX confidential VMs paired with
NVIDIA Confidential Computing on H100/H200/B300, e.g. Phala Cloud, VoltageGPU, Spheron on
reservation, Azure NCC H100 v5, Google confidential a3 — would keep the key inside an
attested enclave instead. A TEE only protects the key: the proof already guarantees the
tally's correctness regardless of where it runs. None of these have been validated with
the ZisK GPU build yet.

## End to end

    scripts/e2e-anvil.sh            # fresh anvil, main fixture replayed, committed proof: 5 s, ends `finality 1  funded [1, 2, 0]`
    scripts/e2e-anvil.sh --prove    # the same with a fresh proof: 28 min 50 s (prove 965 s, wrap 702 s, export 2 s)
    scripts/arc-probe.sh            # against https://rpc.testnet.arc.io on 2026-09-05: returned 0x…01, initcode 9,270 bytes

The Arc deployment itself needs a funded key: see
`docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md`.

## Contracts

`src/SealedPool.sol` (shared by cre and zisk), `src/zisk/ZiskRankedShares.sol`,
`src/cre/CreRankedShares.sol`, the vendored `src/zisk/ZiskVerifier.sol` (AGPL-3.0, from
the ZisK v1.2.0-alpha PLONK key). `verifySnarkProof` alone costs 515,230 gas
(`test/zisk/ZiskVerifier.t.sol`); `finalize` with the real verifier costs about 666,683
gas (`test/zisk/ZiskFinalize.t.sol`). `ZiskVerifier`'s runtime bytecode is 7,183 bytes.

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
This is a genuine marginal rate: `nodirect` and `nosealed` share `m = 4` and differ
only in their sealed voters, so subtracting cancels the fixed cost (program start,
witness decode, the `pk = sk·G` multiplication, the tally loop) and leaves the
per-ballot cost of decryption alone. `nosealed / 3 ≈ 5,472` is not that kind of
number: `nosealed` has no sealed voters to subtract against, so this is a per-voter
*average that still carries the fixed cost inside it*, and is therefore an upper
bound on a direct voter's marginal cost rather than a marginal rate itself. (`main`
isn't used for either estimate: its sealed set mixes valid, corrupt and revoked
ballots at different costs.)

`cargo-zisk run -e target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest -i <main.bin> -p summary`
attributes 93.6% of `main`'s weighted cost to plain instruction execution ("Base").
Among individually named functions, `secp256k1::scalar_mul_secp256k1` (the ECDH
point multiplication run once per sealed ballot to derive its keystream) is the
largest at 3.4%, ahead of `keccak256` at 1.8%; the tally logic itself
(`pbear::validate`) is negligible (0.1%). So: among attributable named costs,
decryption leads — but the generic "Base" bucket, which is 93.6% of the total, holds
the witness decode, the ballot handling and the PB-EAR loop itself, and the summary
does not break that bucket down further.

Extrapolating the two per-voter rates above to `big`'s 2000 direct and 200 sealed
voters predicts ≈ 2000·5,472 + 200·5,584 ≈ 12.06M steps; the emulator measured
15.64M. `big` runs `m = 16` against `m = 4` for the other three fixtures, and the
gap is far too large for decryption's share alone to explain: 200 sealed ballots at
≈5,584 steps each is only ≈1.1M steps, a small fraction of the 3.6M-step shortfall.
PB-EAR's tally loop is `O(entries × m × steps-per-round)`, so at `m = 16` over 2,200
voters it is the tally loop, not sealed-ballot decryption, that accounts for most of
the gap between the linear extrapolation and the observed count.

### Proof

Only `main` (92,660 steps) has been proven end to end. `big` (15,638,535 steps, about
170× `main`) has not been attempted on this 30 GB machine. ZisK proving time grows with
the step count, so the voter ceiling spec Z9 expects a documented answer for is still
open; establishing it — on this box or a larger one — is the first thing plan B's
measurement work needs to do.

Proving `main` on this machine (CPU, 30 GB RAM plus swap): STARK 20 min (25.8 GiB peak
RSS, `Proof verified successfully`), PLONK wrap 13 min (25.2 GiB peak RSS, heavy swap). A
later re-prove of `main` took prove 19m34s, wrap 12m48s; the peak-RSS figures above are
from the first run only and were not re-measured on the later one.
`programVK` `0x7d0bd8b882832ec6121439dd210a142169a0e8dc2cbc8c1c0a29633911c1394b`,
`rootCVadcopFinal` `0x564c2b1bcbd5932c81cfad1fa786a98372eb3d6495257c2d944544334f84382f`
(ZisK v1.2.0-alpha PLONK key; it equals `getRootCVadcopFinal()` of
`provingKeySnark/final/ZiskVerifier.sol`). `fixtures/main-calldata.json` is the exported
calldata; plan B verifies it against `ZiskVerifier.sol` in Foundry.

`scripts/check_publics.py <calldata.json> <outputHash>` pins the layout: `publicValues`
is 512 bytes, slot `i` (8 bytes) is `hash[4i..4i+4]` followed by four zero bytes for
`i < 8` and zero beyond — confirmed against the fixture's
`outputHash 0x1acfe0dbbf9d7e3e3ae53afa48dac536ac1912e51f3788b31053951c84aec78f`.
`proofBytes` is 768 bytes (the `uint256[24]` PLONK proof).

    HWLOC_COMPONENTS=-gl GLIBC_TUNABLES=glibc.rtld.execstack=2 \
      cargo-zisk prove -e <elf> -i <main.bin> -k ~/.zisk/provingKey \
        -o proofs/main-stark.bin -y
    ... cargo-zisk wrap -p proofs/main-stark.bin -k ~/.zisk/provingKey \
      -w ~/.zisk/provingKeySnark --plonk -o proofs/main-plonk.bin
    cargo-zisk-dev export-solidity-calldata -p proofs/main-plonk.bin \
      -o fixtures/main-calldata.json
    python3 scripts/check_publics.py fixtures/main-calldata.json <outputHash>

Run `prove` and `wrap` as two processes; `prove --plonk` in one process does not fit in
this machine's memory. The `wrap` step needs a `cargo-zisk` carrying the fix of ZisK
PR #1299: the v1.2.0-alpha release binary wraps a saved plain vadcop_final proof against
the program VK instead of the vadcop_final verkey and aborts after 39 s with
`Failed assert in template/function VerifyPoW`.

`~/.zisk/bin/cargo-zisk` and `~/.zisk/bin/cargo-zisk-dev` on this machine were therefore
rebuilt from branch `fix/wrap-plain-vadcop-final-verkey` of `~/.zisk/src/zisk-upstream`
(commit `f869e705`, `cargo build --release -p cargo-zisk`, 2m43s) and installed over the
originals, which are kept beside them as `cargo-zisk.pre-pr1299.bak` and
`cargo-zisk-dev.pre-pr1299.bak`. Any `ziskup` run or ZisK reinstall silently puts the
broken wrap back, so re-apply the rebuild before proving until the fix is released.
