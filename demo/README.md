# Arc Testnet proposal demo

Two pools were deployed and verified on 13 September 2026, chain ID 5042002.
All 11 deployment transactions succeeded. The EURC pool now has all 15 Urbe Hub
proposals submitted publicly and accepted. Arkiv ballot storage is enabled and
voting is open with 20 distinct encrypted ballots accepted from the demo wallets. The USDC
pool has no proposals yet and awaits Swarm ID connection for encrypted imports.

| Round | Pool | Proposals |
| --- | --- | --- |
| EURC / Sealed Noir | `0x35a7915dc29c67805b7323e5a0384f919c9cf210` | 15 Urbe Hub proposals accepted, requesting 32,250 EURC |
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

## Finish the USDC encrypted import

Run these commands from the repository root. They use the existing encrypted
Foundry demo account and private local configuration in `demo/.local/`.

1. Open the frontend at `/import` and connect the organizer's Swarm ID. The page
   displays its **sharing public key**. Keep recovery phrases and passwords private.
2. Register that public key for the remaining USDC pool:

   ```sh
   bun cre/scripts/demo.ts register-key --round USDC --key 0xYOUR_SHARING_PUBLIC_KEY
   ```

3. Choose the generated `demo/import-plan-usdc.json` on `/import`. Select **Upload and verify
   proposals**. Each proposal is encrypted through the existing private-review
   flow, downloaded, and checked against its source. Browser checkpoints retain
   public references so an interrupted upload can resume.
4. Download `encrypted-proposal-uploads.json`, then submit it:

   ```sh
   bun cre/scripts/demo.ts import --round USDC --file /absolute/path/to/encrypted-proposal-uploads.json
   ```

   The operator verifies every receipt before submitting and saves mined proposal
   IDs in `demo/proposal-receipts.json`. Signed transactions are journaled before
   broadcast; retries reuse the same transaction instead of creating duplicates.
5. Proposals stay pending organizer review. Acceptance, rejection, publication,
   and opening voting are separate actions.

The original Markdown files already have public Swarm copies, recorded in
[proposal-uploads.md](../swarm/proposal-uploads.md). Encrypting new copies cannot
make those earlier public copies private.

## Twenty demo voters with Arkiv storage

The EURC runner creates 20 operator-controlled wallets and gives each 1 test EURC
of sponsored voting weight, 0.05 test USDC for Arc gas, and 0.02 test GLM for
Tiramisu gas. These wallets represent simulated voters, not independent participants.
The sponsorship deposits 20 test EURC into the pool. This budget is below the
cheapest proposal's 750 EURC request; additional sponsorship is needed for a
nonempty funding result.

```sh
cd cre
bun scripts/vote-urbehub-demo.ts --prepare
# Before the first live opening: exercise the Arc contracts and restart handling.
bun scripts/vote-urbehub-demo.ts --rehearse
# Open, sponsor, fund gas on both chains, store, verify, and vote.
bun scripts/vote-urbehub-demo.ts --broadcast
```

The runner is restricted to this EURC pool, its 15 accepted projects, the generated
organizer, and the two testnets. `--setup` can separately open voting, sponsor the
seats, and fund Arc gas while Tiramisu funding is pending. Arkiv must be enabled
before opening; [urbehub-arkiv.json](urbehub-arkiv.json) records that transaction.

Every ranking differs. Ballots include complete rankings, partial rankings, and
ties, and are encrypted to the pool's existing Noir tallier key. Each voter owns
its Arkiv entity. Entities use the frontend's typed ballot schema, readonly
payloads, and an expiry approximately 15 days after the voting deadline. The
runner checks payload bytes, attributes, creator, flags, expiry, indexing, and
the exact Arc reference/hash/revision before recording success.

Private keys and rankings are stored with AES-256-GCM and scrypt in
`demo/.local/urbehub-voters.encrypted.json`, protected by the existing local
keystore password. Keep that file and password backed up. The gitignored
transaction journal saves each signed transaction before broadcast, so repeating
`--broadcast` resumes the same transactions without duplicate sponsorship or gas
transfers. [urbehub-vote-receipts.json](urbehub-vote-receipts.json) lists public
wallet addresses, gas transfers, Arkiv entity keys, and confirmed vote hashes.
[urbehub-vote-verification.json](urbehub-vote-verification.json) records the
independent check of all 20 current Arc references against their Arkiv payloads:
all decrypted to distinct valid rankings, with no transaction-history fallback.

The local rehearsal disables Arkiv network access and uses placeholder entity
keys to exercise the actual Arc reference-voting contracts. Real Arkiv storage
is verified during the live testnet run. Rehearsal expects the pool's initial,
unsponsored state; after the live run starts, use `--broadcast` to resume it.

## Deployment scripts

`cre/scripts/demo.ts` deploys both pool variants and their required contracts from
the local Foundry artifacts. It records each signed transaction before sending,
checks receipts, and resumes completed steps without redeploying them.

```sh
bun cre/scripts/demo.ts --help
bun cre/scripts/demo.ts prepare --organizer 0xYOUR_ORGANIZER_ADDRESS --deadline UNIX_SECONDS
bun cre/scripts/demo.ts deploy
bun cre/scripts/demo.ts status
```

`prepare` uses the locally provisioned `ethonline-demo` encrypted Foundry account
in `demo/.local/keystores/`, its password file `demo/.local/keystore-password`, and
the generated tally master secret. Existing state is preserved; these commands
resume this demo, not a fresh second deployment. The organizer must match that
account. Deployment does not submit proposals or open voting.

## Public Urbe Hub upload and automatic acceptance

The organizer explicitly approved public import and automatic acceptance of all
15 Urbe Hub proposals in the EURC pool. This choice leaves that pool without
private-review enforcement; the USDC pool is unaffected. The following scripts
are restricted to this exact pool and its original 15 proposal documents.

```sh
# Prepare frontend-compatible public JSON documents and deterministic references.
node cre/scripts/upload-public-urbehub.cjs --prepare

# Prompt for the existing Swarm batch signer without echoing it or storing it.
python3 cre/scripts/upload-public-urbehub.py

# Rehearse on a disposable Arc fork before the first live import.
bun cre/scripts/import-public-urbehub.ts --rehearse

# Submit and accept all 15; completed transactions are reused on restart.
bun cre/scripts/import-public-urbehub.ts --broadcast
```

The uploader reuses the existing stamp counters under `cache/swarm/`, reserves
each stamp before sending, and checks downloaded bytes. It fails if those saved
counters are missing or behind the public receipt file. It writes
`demo/urbehub-public-uploads.json`; submission writes
`demo/urbehub-proposal-receipts.json`. Keep both files and the private transaction
journal when resuming. Do not rerun `--prepare` during a partially completed upload.

The importer verifies all documents, original amounts and recipients, organizer,
deadline, public-review setting, available project slots, and any existing
proposals before continuing. It calls `propose` and `acceptProposal` for each
document and leaves voting closed. It backs off after transient RPC errors.

All 30 live submission and acceptance transactions succeeded. The final receipt
check at 2026-09-13 04:58:44 UTC confirmed 15 accepted proposals, project IDs 0–14,
and voting closed. [urbehub-proposal-receipts.json](urbehub-proposal-receipts.json)
contains the terms, Swarm references, and both transaction hashes per proposal.

If the saved Arc endpoint is unavailable, use `--rpc` with an
[official Arc Testnet endpoint](https://docs.arc.io/arc/references/rpc-endpoints).
The importer verifies the existing deployment receipt on the new provider before
rebinding its journal, preserving every signed transaction. A local fork rehearsal
expects the target pool to be empty; after a partial live import, resume the live
journal instead.

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
