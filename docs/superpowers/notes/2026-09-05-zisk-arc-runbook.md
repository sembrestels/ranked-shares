# zisk variant on Arc testnet: runbook

Everything here needs a key funded from https://faucet.circle.com (Arc testnet, chain id
5042002, gas paid in USDC; the ERC-20 view of USDC is 0x3600000000000000000000000000000000000000
with 6 decimals). Until then, `zisk/scripts/arc-probe.sh` is the only Arc step that runs;
its result on 2026-09-05: `returned 0x0000000000000000000000000000000000000000000000000000000000000001`
(initcode 9270 bytes, exit 0 — Arc testnet's EVM verifies the committed proof).

Environment for every command: `export RPC=https://rpc.testnet.arc.io`, the deployer key in
`DEPLOYER_KEY`, the operator's `TALLIER_MASTER` (32-byte hex, kept off the repo), and the
ZisK machine variables of `zisk/README.md`.

1. Verifier, once per chain:
   `forge script script/DeployZiskVerifier.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast`
   Note the address as `VERIFIER`; the printed rootC must be 0x564c2b1b…4f84382f.
2. Pool key: `KEY_SALT=$(cast keccak "pool-1")` (any fresh 32 bytes), then
   `TALLIER_PK=$(cd zisk && cargo run -q -p tally-prover -- keys --salt $KEY_SALT)`.
3. Pool: `TOKEN=0x3600000000000000000000000000000000000000 OWNER=<deployer> VOTING_DEADLINE=<unix> TALLIER_PK=… KEY_SALT=… MIN_DIRECT_VOTE=10000000 ABANDON_GRACE=604800 VERIFIER=… PROGRAM_VK=$(jq -r .programVK zisk/fixtures/main-calldata.json) forge script script/DeployZisk.s.sol --rpc-url $RPC --private-key $DEPLOYER_KEY --broadcast`
   (`PROGRAM_VK` is the VK of the guest that produced the committed proof; a rebuilt guest means a new VK and a new pool. The VK in `zisk/fixtures/main-calldata.json` is only valid for the committed guest build; a rebuilt guest needs a new proof export to learn its VK — there is no `tally-prover vk` command.)
   A `CreRankedShares` pool additionally needs `WORKFLOW_OWNER=<address>` and, optionally, `WORKFLOW_NAME=<name>` (the workflow's name string, hashed by the script the same way CRE derives `bytes10 workflowName`) so `onReport` only accepts reports from that workflow — `CreRankedShares` shares Chainlink's per-chain `KeystoneForwarder` with every other workflow. Leaving `WORKFLOW_OWNER` unset disables that check and prints a `WARNING`; never deploy a cre pool that way for real funds.
4. Setup: `cast send $POOL "addProject(uint256,address)" 50000000 <recipient>` per project, then `cast send $POOL "openVoting()"`.
5. Votes: contributions with `cast send $TOKEN "approve(address,uint256)"` + `cast send $POOL "contribute(uint256)"`, public ballots `cast send $POOL "vote(bytes)" 0x01020300`, seats `cast send $POOL "sponsor(uint256,address[])" 30000000 "[<member>]"`, sealed ballots `CT=$(cd zisk && cargo run -q -p tally-prover -- encrypt --pk $TALLIER_PK --voter <member> --ranks 1,2,3,0)` then `cast send $POOL "voteSealed(bytes)" $CT` from the member.
6. After the deadline: `cast send $POOL "close(uint256)" 200` until `cast call $POOL "closed()(bool)"` is true. `close(200)` is about 3M gas per call, so use a smaller chunk if the chain's block gas limit is tight.
7. On the operator machine: `SUBMITTER_KEY=$DEPLOYER_KEY cargo run -p tally-prover -- run --rpc $RPC --pool $POOL --workdir ~/pools/pool-1` (about 30 minutes; fetch, check, prove, wrap, export, submit). The workdir holds the pool's private key (in `input.bin`) while proving; `run` deletes `input.bin` when it finishes and keeps only the public `calldata.json`.
8. `cast call $POOL "finality()(uint8)"` is 1 (`Proven`); `cast call $POOL "fundedProjects()(uint256[])"`; `cast send $POOL "claim(uint256)" 0`.

Evidence for the submission: the `Finalized` event on https://testnet.arcscan.app and `~/pools/pool-1/calldata.json`.
