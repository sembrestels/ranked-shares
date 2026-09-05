#!/usr/bin/env bash
# zisk/scripts/arc-probe.sh [RPC_URL]
# Asks a chain's EVM to verify the committed ZisK proof without deploying anything:
# eth_call of a creation transaction whose constructor runs the verifier. Prints the
# returned code (32 bytes ending in 01 on success) and exits non-zero on a revert.
set -euo pipefail
rpc=${1:-https://rpc.testnet.arc.io}
here=$(cd "$(dirname "$0")/../.." && pwd)
cd "$here"
mkdir -p zisk/proofs
forge script script/ArcProbe.s.sol -q >/dev/null
code=$(cat zisk/proofs/arc-probe.hex)
echo "rpc      $rpc"
echo "initcode $(( (${#code} - 2) / 2 )) bytes"
out=$(cast call --rpc-url "$rpc" --create "$code")
echo "returned $out"
[ "$out" = "0x0000000000000000000000000000000000000000000000000000000000000001" ]
