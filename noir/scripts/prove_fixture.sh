#!/usr/bin/env bash
# noir/scripts/prove_fixture.sh <fixture>: real proofs for every step of one fixture.
set -euo pipefail
cd "$(dirname "$0")/../.."
. noir/scripts/env.sh
fixture="$1"
json="reference/vectors/fixture_$fixture.json"
# the fixture names its own profile; the file name prefix only happens to agree
profile="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['profile']['name'])" "$json")"
out="noir/proofs/$fixture"
mkdir -p "$out"
# bb writes into $out/tmp and the moves below empty it again; a failed or interrupted
# run would otherwise leave a stray proof there for the next run to trip over.
trap 'rm -rf "$out/tmp"' EXIT
python3 reference/tools/noir_run.py --fixture "$fixture"
count() { python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['$1']))" "$json"; }
for kind in ingest tally; do
  key="${kind}Proofs"
  n=$(count "$key")
  for ((i = 0; i < n; i++)); do
    witness="noir/target/$fixture-$kind-$i.gz"
    bb prove -b "noir/artifacts/$profile/$kind.json" -w "$witness" -k "noir/artifacts/$profile/$kind.vk" -o "$out/tmp" -t evm
    mv "$out/tmp/proof" "$out/$kind-$i.proof"
    mv "$out/tmp/public_inputs" "$out/$kind-$i.pub"
    rmdir "$out/tmp"
    bb verify -k "noir/artifacts/$profile/$kind.vk" -p "$out/$kind-$i.proof" -i "$out/$kind-$i.pub" -t evm
  done
done
echo "proved $fixture into $out"
