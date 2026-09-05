#!/usr/bin/env bash
# cre/scripts/sync-abi.sh — copy the pool ABI from the forge build output.
set -euo pipefail
cd "$(dirname "$0")/../.."
forge build -q
jq '.abi' out/SealedRankedShares.sol/SealedRankedShares.json > cre/src/abi/SealedRankedShares.json
echo "cre/src/abi/SealedRankedShares.json updated"
