#!/usr/bin/env bash
# zisk/scripts/e2e-anvil.sh [--prove]
# Replays the main fixture on a fresh anvil and finalises it with the committed proof
# (or a fresh one with --prove). Needs anvil, cast, forge, python3, cargo.
set -euo pipefail
prove=0
if [ "${1:-}" = "--prove" ]; then prove=1; fi
root=$(cd "$(dirname "$0")/../.." && pwd); cd "$root"
FX=reference/vectors/zisk/fixture_main.json
RPC=http://127.0.0.1:8545
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
started=$SECONDS
work=$(mktemp -d); trap 'kill ${ANVIL:-} 2>/dev/null || true; rm -rf "$work"' EXIT

anvil --silent --chain-id 31337 > "$work/anvil.log" 2>&1 & ANVIL=$!
for _ in $(seq 1 50); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.2; done

now=$(cast block latest --rpc-url $RPC -f timestamp)
export VOTING_DEADLINE=$((now + 3600))
forge script script/E2EAnvil.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast > "$work/deploy.log" 2>&1 || { cat "$work/deploy.log"; exit 1; }
logged() { awk -v k="$1" '$1 == k {print $2}' "$work/deploy.log" | head -1; }
TOKEN=$(logged TOKEN); NFT=$(logged NFT); POOL=$(logged POOL)
[ -n "$POOL" ] || { grep -E "TOKEN|NFT|POOL" "$work/deploy.log" || cat "$work/deploy.log"; exit 1; }
echo "token $TOKEN  nft $NFT  pool $POOL"

send() { cast send --rpc-url $RPC --private-key $DEPLOYER_KEY "$@" > /dev/null; }
sendas() { local from=$1; shift; cast send --rpc-url $RPC --unlocked --from "$from" "$@" > /dev/null; }
impersonate() { cast rpc --rpc-url $RPC anvil_impersonateAccount "$1" > /dev/null; cast rpc --rpc-url $RPC anvil_setBalance "$1" 0x1000000000000000000 > /dev/null; }
# `cast call` may annotate a number ("687000000 [6.87e8]"); keep the plain decimal.
callnum() { cast call --rpc-url $RPC "$@" | awk '{print $1}'; }

# Roster lines: addr direct seat directBallot ciphertext (hex or "-")
python3 - "$FX" > "$work/roster.txt" <<'PY'
import json, sys
fx = json.load(open(sys.argv[1]))
t = fx["nftTakeover"] or {}
print("TAKEOVER", t.get("from", "-"), t.get("to", "-"), int(t.get("sponsorshipAmount", "0x0"), 16))
for v in fx["voters"]:
    print(v["addr"], int(v["directWeight"], 16), int(v["seatWeight"], 16), v["directBallot"] or "-", v["ciphertext"] or "-")
print("TOTAL", int(fx["totalWeight"], 16))
PY
read -r _ TFROM TTO TAMOUNT < <(head -1 "$work/roster.txt")
TOTAL=$(awk '/^TOTAL/ {print $2}' "$work/roster.txt")
mapfile -t ROSTER < <(grep -vE '^(TAKEOVER|TOTAL) ' "$work/roster.txt")
granted=0; nftSponsorship=""
send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 18446744073709551615
send "$TOKEN" "approve(address,uint256)" "$POOL" 18446744073709551615
for line in "${ROSTER[@]}"; do
  read -r addr direct seat ballot ct <<< "$line"
  impersonate "$addr"
  if [ "$direct" != 0 ]; then
    send "$TOKEN" "mint(address,uint256)" "$addr" "$direct"
    sendas "$addr" "$TOKEN" "approve(address,uint256)" "$POOL" "$direct"
    sendas "$addr" "$POOL" "contribute(uint256)" "$direct"
    granted=$((granted + direct))
  fi
  if [ "$addr" = "$TFROM" ]; then
    nftSponsorship=$(callnum "$POOL" "sponsorshipCount()(uint256)")
    send "$POOL" "sponsorNFT(uint256,address,uint256)" "$TAMOUNT" "$NFT" 1
    send "$NFT" "mint(address,uint256)" "$addr" 1
    sendas "$addr" "$POOL" "claimSeat(uint256,uint256)" "$nftSponsorship" 1
    granted=$((granted + TAMOUNT))
  elif [ "$seat" != 0 ]; then
    list=$seat; [ "$addr" = "$TTO" ] && list=$((seat - TAMOUNT))
    send "$POOL" "sponsor(uint256,address[])" "$list" "[$addr]"
    granted=$((granted + list))
  fi
done
for line in "${ROSTER[@]}"; do
  read -r addr direct seat ballot ct <<< "$line"
  if [ "$ballot" != - ]; then sendas "$addr" "$POOL" "vote(bytes)" "$ballot"; fi
  if [ "$ct" != - ]; then sendas "$addr" "$POOL" "voteSealed(bytes)" "$ct"; fi
done
if [ "$TFROM" != - ]; then
  sendas "$TFROM" "$NFT" "transferFrom(address,address,uint256)" "$TFROM" "$TTO" 1
  sendas "$TTO" "$POOL" "claimSeat(uint256,uint256)" "$nftSponsorship" 1
fi
dust=$((TOTAL - granted))
if [ "$dust" -gt 0 ]; then send "$POOL" "sponsorNFT(uint256,address,uint256)" "$dust" "$NFT" "$dust"; fi
echo "totalWeight on chain $(callnum "$POOL" "totalWeight()(uint256)") expected $TOTAL"

cast rpc --rpc-url $RPC evm_increaseTime 3601 > /dev/null; cast rpc --rpc-url $RPC evm_mine > /dev/null
send "$POOL" "close(uint256)" 100
echo "inputsHash on chain $(callnum "$POOL" "inputsHash()(bytes32)")"
echo "inputsHash fixture  $(python3 -c "import json;print(json.load(open('$FX'))['inputsHash'])")"

TALLIER_MASTER=$(python3 -c "import json;print(json.load(open('$FX'))['master'])"); export TALLIER_MASTER
export SUBMITTER_KEY=$DEPLOYER_KEY
(cd zisk && cargo build -q -p tally-prover)
TP=zisk/target/debug/tally-prover
$TP fetch --rpc $RPC --pool "$POOL" --out "$work/input.bin"
$TP check --input "$work/input.bin" --rpc $RPC --pool "$POOL"
if [ $prove = 1 ]; then
  $TP run --rpc $RPC --pool "$POOL" --workdir "$work/run"
else
  $TP submit --rpc $RPC --pool "$POOL" --calldata zisk/fixtures/main-calldata.json --input "$work/input.bin"
fi
fin=$(callnum "$POOL" "finality()(uint8)")
funded=$(cast call --rpc-url $RPC "$POOL" "fundedProjects()(uint256[])")
echo "finality $fin  funded $funded"
send "$POOL" "claim(uint256)" 1
echo "recipient balance after claim(1): $(callnum "$TOKEN" "balanceOf(address)(uint256)" "$DEPLOYER")"
echo "elapsed $((SECONDS - started))s"
[ "$fin" = 1 ]
