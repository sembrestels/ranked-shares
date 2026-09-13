# Arc Testnet proposal demo

Two pools were deployed and verified on 13 September 2026, chain ID 5042002.
All 11 deployment transactions succeeded. Both pools remain in review with zero
proposals; encrypted uploads and proposal submissions await Swarm ID connection.

| Round | Pool | Planned proposals |
| --- | --- | --- |
| EURC / Sealed Noir | `0x35a7915dc29c67805b7323e5a0384f919c9cf210` | 15 Urbe Hub proposals, requesting 32,250 EURC |
| USDC / CRE Liquidity | `0x2bf2515baf13444a4c91d9135172a4a632fa440c` | 6 Golem proposals, requesting 88,000 USDC |

Organizer and proposer: `0x5A57DB3F5c9469534f76EF279193B502F77F2860`.
Every payout recipient remains `0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF`.
The voting deadline is **13 September 2026, 10:25:32 UTC / 12:25:32 Madrid**.
Requested proposal budgets are not transferred during import.

[deployment.json](deployment.json) records the public addresses, transaction
hashes, verified settings, and verification time. [import-plan.json](import-plan.json)
preserves the original proposal text, checksums, amounts, and approved recipients.
The source manifest is [swarm/pool-import-plan.json](../swarm/pool-import-plan.json).

## Simulation boundary

These are explicitly approved **testnet-only, unauthenticated CRE demo pools**.
They accept reports from Chainlink's simulator forwarder
`0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1`, with workflow-owner/name validation
disabled because the simulator does not supply production workflow metadata.
Another caller can deliver a forged report through this forwarder. Do not use
these deployments for real assets or present their reports as authenticated DON
results. Local simulation provides neither DON consensus nor enclave protection.
Production contract authentication checks remain unchanged.

The USDC deployment includes the real Uniswap v4 manager, position manager,
descriptor, state view, and attached LP voting module. It does not yet include
seeded trading pairs, LP positions, sponsorships, or cast ballots.

## Finish the encrypted import

Run these commands from the repository root. They use the existing encrypted
Foundry demo account and private local configuration in `demo/.local/`.

1. Open the frontend at `/import` and connect the organizer's Swarm ID. The page
   displays its **sharing public key**. Keep recovery phrases and passwords private.
2. Register that public key for both pools:

   ```sh
   bun cre/scripts/demo.ts register-key --key 0xYOUR_SHARING_PUBLIC_KEY
   ```

3. Choose `demo/import-plan.json` on `/import`. Select **Upload and verify
   proposals**. Each proposal is encrypted through the existing private-review
   flow, downloaded, and checked against its source. Browser checkpoints retain
   public references so an interrupted upload can resume.
4. Download `encrypted-proposal-uploads.json`, then submit it:

   ```sh
   bun cre/scripts/demo.ts import --file /absolute/path/to/encrypted-proposal-uploads.json
   ```

   The operator verifies every receipt before submitting and saves mined proposal
   IDs in `demo/proposal-receipts.json`. Signed transactions are journaled before
   broadcast; retries reuse the same transaction instead of creating duplicates.
5. Proposals stay pending organizer review. Acceptance, rejection, publication,
   and opening voting are separate actions.

The original Markdown files already have public Swarm copies, recorded in
[proposal-uploads.md](../swarm/proposal-uploads.md). Encrypting new copies cannot
make those earlier public copies private.

## Rehearsal and operation

```sh
bun cre/scripts/demo.ts status
bun cre/scripts/rehearse-demo.ts
bun cre/scripts/demo.ts simulate --round EURC
bun cre/scripts/demo.ts simulate --round USDC
```

The rehearsal uses disposable local Anvil ports 8552/8553, deploys both real pool
types and Noir verifiers, sponsors and encrypts one ballot, then runs the CRE CLI
twice with local broadcasts to close and report the provisional funding order
`[0, 1]`. It leaves the Arc import pools untouched. See [rehearsal.json](rehearsal.json)
for the successful local result. Final Noir proof verification is covered by the
separate prover E2E test, not by that provisional CRE report.

Simulation requires compiled CRE WASM in `cre/dist/`; deployment and rehearsal
also require Foundry artifacts in `out/` and `v4/out/`. The operator account,
password, tally master secret, and private journals are gitignored under
`demo/.local/` and blocked by the frontend dev server. A fresh checkout requires
its own locally provisioned account and configuration.

Add `--broadcast` to a simulation only when ready to submit reports to these demo
pools. Simulation is manually invoked; this setup does not run an automatic DON
workflow or an unattended tally service.
