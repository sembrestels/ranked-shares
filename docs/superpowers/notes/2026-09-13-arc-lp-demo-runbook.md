# Arc LP demo: build, review and sign

The implementation and local rehearsal are complete. **No Arc transactions or CRE
registry/secret writes have been sent by the agent.** Run the commands below yourself
with your wallet. Paths are relative to the repository root unless a block says `cd`.
The [specification](../specs/2026-09-13-uniswap-proportional-arc-demo.md) explains the
allocation and oracle assumptions.

## 1. Build and choose public configuration

Use Foundry, Bun, Node/npm and the CRE CLI. Commands were checked with CRE CLI
1.32.0. The separate `v4/` build pins official periphery at
`dce236d4e2057422d0791d9a973a58765eb46f65` and its submodules; root Solidity stays on
0.8.28 while v4 uses 0.8.26 and Permit2 uses 0.8.17.

```bash
git submodule update --init --recursive
forge build
bash v4/setup.sh
(cd cre && bun install --frozen-lockfile && bun run compile:lp)
(cd web && npm ci)
cp script/lp-demo.env.example .env.lp-demo
```

Fill the empty values needed for stage 1 in `.env.lp-demo`: `DEPLOYER`, your existing
encrypted Foundry `DEPLOY_ACCOUNT` name, and two different LP wallet addresses
`DEMO_LP_A`/`DEMO_LP_B`. These can be wallets you control for demonstrating different
registration times. Fund the deployer with **at least 11 test USDC and 1 test EURC,
plus USDC for gas**. LP wallets also need Arc gas and Arkiv Tiramisu testGLM to vote.
The app's Arkiv flow has two signatures: storage on Tiramisu and acceptance on Arc.

The demo uses Arc testnet chain ID **5042002**. Its USDC and EURC ERC-20 interfaces
have six decimals; native USDC gas uses eighteen. The canonical addresses in the
sample match the [Arc contract directory](https://docs.arc.io/arc/references/contract-addresses).
Use the [Circle faucet](https://faucet.circle.com/) and
[Arkiv faucet](https://hub.arkiv.network/faucet) as appropriate.

Configure CRE before opening the short voting window. Run these read-only commands
from `cre/` after your own CLI login:

```bash
cd cre
cre whoami
cre registry list
cre workflow supported-chains
cd ..
```

Set `FORWARDER` to the **Keystone forwarder for Arc returned for your tenant**, not
the mock forwarder. Set `WORKFLOW_OWNER` to the public owner address of the workflow
you will deploy; keep `WORKFLOW_NAME=ranked-shares-lp-demo`. The name and owner must
match its report metadata. Both receiver contracts enforce them. Do not disable
these checks to make simulator reports pass.

This workflow requests Nitro confidential execution. Verify your CRE organization
has deployment and confidential-workflow access before choosing the deadline.
CRE registry management is separate from Arc: the public onchain registry requires
its own network/RPC and gas, while an available private registry uses organization
login. See [CRE deployment options](https://docs.chain.link/cre/guides/operations/deploying-workflows).
This runbook supplies the onchain registry signing path; a private-registry owner
must be resolved before deploying the immutable Arc receivers.

## 2. Sign the v4 infrastructure and positions

```bash
source .env.lp-demo
cast chain-id --rpc-url "$RPC_URL"
cast call "$USDC" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC_URL"
cast call "$EURC" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC_URL"

# Simulation: no signatures or broadcast.
forge script --root v4 script/DeployV4.s.sol:DeployV4 \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"

# Sign with your encrypted Foundry account after reviewing the simulation.
forge script --root v4 script/DeployV4.s.sol:DeployV4 \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" \
  --account "$DEPLOY_ACCOUNT" --broadcast --slow
```

The script deploys PoolManager, PositionDescriptor, PositionManager, StateView and
an open-faucet demo DAO token. It uses Arc's existing Permit2 (and fails if its code
is absent). It creates DAO/USDC and DAO/EURC pools, fee 3000, tick spacing 60, no hook,
initial raw price 1:1, then mints these positions:

| Wallet | IDs | Ranges | Liquidity per position |
| --- | --- | --- | --- |
| LP A | 1 (USDC), 3 (EURC) | -600 to 600 | 10,000,000 |
| LP B | 2 (USDC), 4 (EURC) | -120 to 120 | 50,000,000 |

This deliberately compares different ranges with similar initial capital. Maximum
deposit per currency per NFT is 0.4 tokens; exact usage is computed
by v4. ERC-20 approvals to Permit2 are limited to 2 DAO, 1 USDC and 1 EURC; its
PositionManager allowances expire after one day. The native-wrapper address is zero
because this demo uses only ERC-20 currencies; do not use this manager for native
currency wrapping. The DAO faucet has no access control and no economic value.

Copy the printed `POOL_MANAGER`, `POSITION_MANAGER`, `STATE_VIEW`, `DAO_TOKEN` and
`VITE_LP_FROM_BLOCK` into `.env.lp-demo`, then source it again. Save the broadcast
receipt files. `--slow` sends sequentially and was used in the successful rehearsal.
If a broadcast is interrupted, inspect its receipts before using Foundry's `--resume`
for that same stage; do not blindly create a second infrastructure deployment.

## 3. Prepare the tallier key and sign the voting round

Load your existing 32-byte master secret into `CRE_RANKED_SHARES_MASTER` using your
local secret manager. Alternatively create a fresh demo master locally, keep a
recoverable copy in your secret manager, and provision that exact value to CRE.
Never use a repository fixture secret for live ballots or put a secret in `VITE_`
configuration. `KEY_SALT` and the resulting `TALLIER_PK` are public.

```bash
# Only if creating a NEW demo master; preserve it in your local secret manager.
# Skip this line if you already loaded the intended master.
export CRE_RANKED_SHARES_MASTER="0x$(openssl rand -hex 32)"

# A public random salt, one per round.
export KEY_SALT="0x$(openssl rand -hex 32)"

# Reads the master from your environment; prints only the public key.
(cd cre && bun scripts/lp-key.ts)
```

Copy the printed public `TALLIER_PK` and `KEY_SALT` to `.env.lp-demo`. Set an absolute
Unix `VOTING_DEADLINE`; for a demo, allow at least two hours to activate CRE and cast
ballots. The script accepts deadlines more than ten minutes and at most thirty days
ahead. Regenerating the master or salt after deployment will make the tally key
wrong; preserve the pair.

```bash
source .env.lp-demo
export VOTING_DEADLINE="$(date -d '+2 hours' +%s)" # GNU date; save this value

forge script script/DeployLPDemo.s.sol:DeployLPDemo \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"

forge script script/DeployLPDemo.s.sol:DeployLPDemo \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" \
  --account "$DEPLOY_ACCOUNT" --broadcast --slow
```

This creates and connects `LPCreRankedShares` and `LPVoting`, adds projects costing
2, 3 and 5 USDC with recipients LP A, LP B and the deployer, enables Arkiv ballots,
opens voting and deposits **10 USDC**: five for each pool's LPs. Both minimum
registration values are 0.01 of their valuation currency. The projects are direct
onchain demo entries and display fallback project IDs; no Swarm proposal upload is
required for the demo.

Copy `VITE_POOL_ADDRESS` and `LP_MODULE` from the logs into `.env.lp-demo`. Confirm:

```bash
source .env.lp-demo
cast call "$VITE_POOL_ADDRESS" 'lpVoting()(address)' --rpc-url "$RPC_URL"
cast call "$VITE_POOL_ADDRESS" 'phase()(uint8)' --rpc-url "$RPC_URL" # 1 = Voting
cast call "$VITE_POOL_ADDRESS" 'totalWeight()(uint256)' --rpc-url "$RPC_URL" # 10000000
cast call "$LP_MODULE" 'sponsorshipCount()(uint256)' --rpc-url "$RPC_URL" # 2
```

## 4. Configure, simulate and activate CRE

Edit `cre/workflows/lp/config.staging.json`: replace the zero entry in `lpModules`
with `LP_MODULE`. Keep `pools: []`; this entry point discovers each round through its
LP module. It runs every two minutes with a 25-item closing/allocation chunk.
In `workflow.yaml`, add `workflow-owner-address` under `user-workflow`, matching
`WORKFLOW_OWNER`, and select your onchain `deployment-registry` from `cre registry list`.
Set the same public owner under the target's `user-workflow` in `cre/project.yaml`
so standalone secret-management commands use the same owner.
Configure its required RPC alongside Arc in `cre/project.yaml`. The bundled target
currently contains only the Arc RPC.

```yaml
# Under staging-settings in workflows/lp/workflow.yaml:
user-workflow:
  workflow-name: "ranked-shares-lp-demo"
  workflow-owner-address: "YOUR_PUBLIC_WORKFLOW_OWNER"
  deployment-registry: "onchain:ethereum-mainnet"
```

```bash
cd cre
bun run compile:lp
cre workflow simulate workflows/lp --target staging-settings \
  --non-interactive --trigger-index 0 --wasm "$PWD/dist/lp-workflow.wasm"
```

Simulation does not broadcast. Once a campaign is due, inspect the generated price
reports; after the deadline inspect finalization, closing and tally reports. A mock
forwarder cannot deliver them to these authenticated live receivers. A successful
simulation is not evidence that the workflow is deployed on a DON.

For onchain registry operations, provision the master and prepare transactions for
your own signing. Complete each CLI-guided step before the next command:

```bash
cre secrets create workflows/sealed/secrets.yaml --target staging-settings --unsigned
cre workflow deploy workflows/lp --target staging-settings \
  --wasm "$PWD/dist/lp-workflow.wasm" --unsigned
cre workflow get workflows/lp --target staging-settings
# If the registered workflow is paused:
cre workflow activate workflows/lp --target staging-settings --unsigned
```

The CLI can upload artifacts while preparing unsigned registry transactions. It
prints the destination, chain and calldata for your signer; submit those exact
values using the configured workflow-owner wallet. Secrets provisioning may require
a second CLI step after the registry receipt. The CLI's unsigned path may still
require local `CRE_ETH_PRIVATE_KEY` initialization; keep credentials in your local
secret environment and follow [Chainlink's unsigned-signing guide](https://docs.chain.link/cre/guides/operations/using-multisig-wallets).
Do not paste them into chat. Check `cre workflow get` after the signed receipt and
verify `ReferencePriceSet` events on Arc have nonzero source blocks before presenting
automation as live.

## 5. Run the page and demonstrate the lifecycle

```bash
cd .. # from cre/ back to the repository root
source .env.lp-demo
export VITE_RPC_URL="$RPC_URL"
export VITE_CHAIN_ID=5042002
export VITE_CHAIN_NAME='Arc Testnet'
export VITE_NATIVE_SYMBOL=USDC
cd web
npm run dev
```

Open `http://localhost:5174/liquidity` in your wallet-enabled browser. These Vite
variables are public and embedded at build time; export them for `npm run build`
as well if serving a static build.

1. Connect LP A. Position discovery uses the new manager's Transfer events; enter
   NFT ID 1 or 3 if your RPC limits log reads. Start earning on both positions.
   Each registration is one PositionManager subscription transaction, no NFT transfer.
2. Open **Vote privately**, rank the three projects, store the encrypted ballot in
   Arkiv and confirm it on Arc. This works before final LP weights exist.
3. Connect LP B later, register IDs 2 and 4, and cast a different ranking. Compare
   accumulated shares and projected weights. They reflect capital and time, not the
   different raw liquidity numbers shown above.
4. Show fresh CRE source blocks in **Pool and valuation details**. Optionally stop
   accrual from the page; old credit remains. Transfer/resize/burn behavior is also
   exercised against real v4 contracts in the integration suite.
5. After the deadline, CRE first allocates LP weight, then closes ballot commitments,
   then attests the tally on subsequent runs. With this small demo each phase normally
   fits one run. On `/vote`, verify the final funded projects and use the existing
   claim flow for their recipients. Rounding/unvoted budget follows existing pool rules.

If allocation needs a manual push, the page offers **Advance finalization**; or sign
these permissionless calls yourself after the deadline:

```bash
cd .. # from web/ back to the repository root
cast send "$LP_MODULE" 'finalizeLP(uint256,uint256)' 0 25 \
  --rpc-url "$RPC_URL" --account "$DEPLOY_ACCOUNT"
cast send "$LP_MODULE" 'finalizeLP(uint256,uint256)' 1 25 \
  --rpc-url "$RPC_URL" --account "$DEPLOY_ACCOUNT"
cast call "$LP_MODULE" 'finalized()(bool)' --rpc-url "$RPC_URL"
```

Repeat chunks only while `finalized()` is false. Arkiv closing can be advanced from
the vote page after LP finalization. The final CRE attestation still requires the
configured authenticated workflow; there is no unauthenticated manual-price/tally
backdoor. A stale-price notice means accrual continues at the previous price.

## Reproduce local verification

```bash
forge test
forge test --root v4 --match-contract LPIntegrationTest -vv
(cd cre && bun test && bunx tsc --noEmit && bun run compile:lp)
(cd web && npm run typecheck && npm test && npm run build)
```

The successful local rehearsal used Anvil chain 31337 and both deployment scripts
with `--unlocked --sender <Anvil account> --broadcast --slow`; that chain branch
creates mock stablecoins and a local Permit2. Never use `--unlocked` against Arc.
Both real-v4 tests exercise actual mint/subscription callbacks through settlement
and payout, not a mocked PositionManager. Root tests include bounded callback gas,
fuzzed credit/value math, price replay protection and early Arkiv voting.
