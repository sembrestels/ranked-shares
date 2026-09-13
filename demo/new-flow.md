# Combined contribution and vote demo

The version 2 demo uses these new Arc Testnet pools:

| Round | Pool | Proposals | Confirmed votes |
| --- | --- | --- | --- |
| EURC / Noir | `0x1fb1595b7330296e4d55e759209a2783ce4cfd36` | 15 Urbe Hub proposals | 2 public, 18 encrypted |
| USDC / CRE Liquidity | `0x56e4c0836f694bbbcf705c440feafea22dbfd18f` | 6 Golem proposals | 2 public, 18 encrypted |

[new-flow-deployment.json](new-flow-deployment.json) records the actual confirmed
transactions, proposal IDs, ballot references and Arkiv entity keys. Its
`verifiedAt` is written only after all 40 accepted ballots have been recovered
from both Arc events and live Arkiv data and compared with the encrypted backup.
All 40 ballots passed this check on **13 September 2026 at 08:25:25 Madrid**.

The organizer remains `0x5A57DB3F5c9469534f76EF279193B502F77F2860`; recipients remain
`0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF`. Voting ends on **13 September 2026
at 12:25:32 Madrid / 10:25:32 UTC**. The previously approved simulator forwarder
and disabled workflow authentication remain testnet-only demo settings.

Both pools use the same 20 operator-controlled demo wallets. The first two wallets
each contribute one token and cast a public ballot in one `castBallot` transaction,
using a token permit signature. The remaining 18 wallets each receive a sponsored
seat worth one token and cast encrypted ballots with no token deposit. Each pool
therefore receives 20 test tokens. These votes demonstrate sponsored seats in the
CRE Liquidity pool; they do not represent Uniswap positions or independent voters.
The test budgets are below the proposals' requested amounts, so the current
funding projection awards no projects.

All four public transaction receipts contain both `Contributed` and
`BallotPublished` events. Their calldata uses a nonzero permit deadline and a
one-token contribution in the same `castBallot` call. Both voting pages load their
Swarm proposal titles and show two accepted public ballots in the live result.

No voter pays Arkiv gas. The storage worker uploads accepted bytes afterwards
using the funded organizer account. Public receipts omit private keys and encrypted
rankings. The encrypted wallet/ranking backup and signed transaction journals live
under `demo/.local/`.

## Reproduce or resume this deployment

The scripts require the existing encrypted demo account, tally master secret,
original wallet backup, deployment state, and Swarm stamp counters. They preserve
the original pools and their historical receipts. All commands below resume this
specific version 2 run rather than creating additional pools.

```sh
bun cre/scripts/redeploy-vote-demo.ts prepare
bun cre/scripts/redeploy-vote-demo.ts deploy
# Only needed for a missing Golem upload receipt; enter the batch signer privately.
node cre/scripts/upload-public-golem.cjs --prepare
python3 cre/scripts/upload-public-golem.py
# --public-golem explicitly authorizes the already-public Golem demo import.
bun cre/scripts/redeploy-vote-demo.ts broadcast --public-golem
bun cre/scripts/redeploy-vote-demo.ts verify
```

Do not regenerate upload receipts during an interrupted upload. Signed Arc
transactions are persisted before sending, so resuming reuses completed deposits,
votes, and proposal imports. Keep `new-flow-state.json`,
`new-flow-voters.encrypted.json`, and `new-flow-arkiv.json` backed up privately.
Run only one deployment/import/voting process at a time.

For continued storage after the demo run completes:

```sh
cd cre
bun scripts/sync-ballots.ts \
  --pools 0x1fb1595b7330296e4d55e759209a2783ce4cfd36,0x56e4c0836f694bbbcf705c440feafea22dbfd18f \
  --state ../demo/.local/new-flow-arkiv.json --watch
```

Stop that worker before running the demo's `broadcast` or `sync` command, so only
one process signs Arkiv transactions. `verify` is read-only on both networks.
The local demo worker runs in the background; its PID and log are recorded in
`demo/.local/new-flow-arkiv-worker.pid` and
`demo/.local/new-flow-arkiv-worker.log`. It must be restarted after a machine reboot.

The deployment tooling resolves Noir and liquidity CRE artifacts through Foundry's
`noir-ir` cache entries and rejects runtime bytecode above 24,576 bytes. This avoids
accidentally using an older default-profile artifact at the unsuffixed filename.
