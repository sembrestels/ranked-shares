#!/usr/bin/env bash
# cre/scripts/sync-abi.sh — copy the pool ABI from the forge build output.
set -euo pipefail
cd "$(dirname "$0")/../.."
forge build -q
jq '.abi' out/NoirRankedShares.sol/NoirRankedShares.json > cre/src/abi/NoirRankedShares.json
echo "cre/src/abi/NoirRankedShares.json updated"
