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
    try:
        subprocess.run(
            [sys.executable, os.path.join(HERE, "noir_inputs.py"), "--fixture", name, f"--{kind}", str(index), "--out", prover],
            check=True, capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"FAIL {name} {kind} {index}: noir_inputs.py exited {e.returncode}")
        print(e.stderr.decode(errors="replace") if isinstance(e.stderr, bytes) else e.stderr)
        return False
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
