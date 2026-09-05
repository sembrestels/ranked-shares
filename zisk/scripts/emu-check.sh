#!/usr/bin/env bash
# zisk/scripts/emu-check.sh <scenario | path/to/fixture.json>
# Runs the guest on a fixture in the ZisK emulator and compares the committed bytes with
# the fixture's outputHash. Exit 0 on a match.
set -euo pipefail
scenario=${1:-main}
here=$(cd "$(dirname "$0")/.." && pwd)
# cargo-zisk v1.2.0-alpha puts the guest ELF under target/elf/; older layouts under target/.
elf="$here/target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest"
[ -f "$elf" ] || elf="$here/target/riscv64ima-zisk-zkvm-elf/release/tally-guest"
if [ -f "$scenario" ]; then
  # a fixture path, e.g. the on-demand `big`; absolute, because `cargo run` runs in $here
  fixture=$(cd "$(dirname "$scenario")" && pwd)/$(basename "$scenario")
else
  fixture="$here/../reference/vectors/zisk/fixture_${scenario}.json"
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

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
