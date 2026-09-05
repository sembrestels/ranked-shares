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
| ingest-test | 8,947 | 0.27 s | 42 MB |
| tally-test | 11,855 | 0.23 s | 45 MB |
| ingest-default | 137,200 | 1.13 s | 243 MB |
| tally-default | 1,034,184 | 9.28 s | 1.73 GB |

`tally-default` is under spec B12.1's 1.2 M-gate threshold, so the default profile keeps
`K = 8` (spec decision 6): no change to `reference/profiles.py` or the fixtures. These are
native `bb` numbers on the machine that built this workspace; the browser proving budget
(bb.js in Chrome/Firefox) is plan 4's spike, not measured here.

A change to any circuit changes its verification key: rerun `build.sh`, commit the new
verifiers, and deploy a new pool.
