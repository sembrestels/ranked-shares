# RankedShares — Arkiv verification evidence

Verified **13 September 2026, 07:12:36 UTC** on **Tiramisu (chain 7738577)**.
All **80 real entities** were available at query block **387597**. Creation
receipts, creators, current owners, payload hashes and accepted Arc references
were checked against live RPC responses. These records are not fixtures.

Network reference: [Arkiv's Tiramisu documentation](https://docs.arkiv.network/networks/tiramisu/).
Public explorer: [Tiramisu explorer](https://tiramisu.explorer.arkiv.network).
The transaction hashes below can also be checked directly through the public RPC
using the reproduction script; individual explorer pages were not verified.

## Submission status

| Mission | What is evidenced | Remaining gap |
| --- | --- | --- |
| Decommission | Ballot payload storage/read path moved from EVM contract state to Arkiv; 80 live entities, authenticated reads and browser tally code | This replaced an EVM storage/read path, not a conventional backend database. Judges must assess whether that meets the mission. |
| Built to expire | Native expiry flags/heights on all 80 entities; passing tests for the query and UI transition | No recorded live before/after **natural expiration** yet. Local expiration results are fixture-only. |
| Live wire | HTTP query and polling code can be inspected | Arkiv WebSocket subscription, two-client live update demo and reconnect evidence are not implemented/provided. Do not claim this mission. |

**Publication is still required.** This index, the new receipt bundles and the
current implementation are local work. The repository's remote `master` was
checked at `b5cef883607a14c72b88c840f365cef7c1c41f59`; local `HEAD` is
`48641293613ed913466323dda0c43de10775e5b3` (82 commits ahead), plus uncommitted
changes. Do not submit links to these newer files as already public until the
intended code and evidence have been committed and pushed. Relative source links
below resolve within the repository once that version is published. Public chain
addresses and transaction hashes can already be verified independently.

**Video:** no published recording or timestamps have been supplied. None are
invented here. The recording checklist at the end identifies missing evidence.

## Wallet addresses used to create Arkiv entities

One creator address per line, with its role. Current owner equals creator for all
80 records at verification time; no transfer to a different current owner was
observed. The `creator` and `currentOwner` fields are recorded separately in the
manifest. These are technical verification addresses, not prize-payment details.
All demo voter wallets are controlled by the project operator.

```text
0x5A57DB3F5c9469534f76EF279193B502F77F2860 — organizer and background Arkiv writer; creator/current owner of 60 entities across EURC-v2, USDC-v2 and EURC-short.
0x0d74F572b14A25D623C29F476AFd544C9673fc96 — controlled demo voter 01; creator/current owner of one historical EURC-legacy entity.
0x288c7E888d389dDdF22aeb059F37BddAcbeEF60F — controlled demo voter 02; creator/current owner of one historical EURC-legacy entity.
0xCa028CF96d0174D3412B21081bF2FC7f4D52D093 — controlled demo voter 03; creator/current owner of one historical EURC-legacy entity.
0x1e0E45cF8A4dc4872Fd38144bfc05FD206153610 — controlled demo voter 04; creator/current owner of one historical EURC-legacy entity.
0xEA45704b0C0d9c5405778245E1c68CFE39b21dC0 — controlled demo voter 05; creator/current owner of one historical EURC-legacy entity.
0x9ed33420546F45544f3f081778F298251be75f44 — controlled demo voter 06; creator/current owner of one historical EURC-legacy entity.
0xd81A85B5Aa3be5A8f31D386C2e2C65e8E10E858C — controlled demo voter 07; creator/current owner of one historical EURC-legacy entity.
0xbbE0b6685154d64109404A094CCb1f1b33E0ee44 — controlled demo voter 08; creator/current owner of one historical EURC-legacy entity.
0xD75Bc06b5e31a19AC981C666b5F2EA504e0f7184 — controlled demo voter 09; creator/current owner of one historical EURC-legacy entity.
0xe305fbD98ec178f971915D918cfDFec8852D14BC — controlled demo voter 10; creator/current owner of one historical EURC-legacy entity.
0xADc705D10B9bDb59f17Ca6970CC0AE46EF1D90c5 — controlled demo voter 11; creator/current owner of one historical EURC-legacy entity.
0xb9413869857827F5252aDad7673Dae1206B3bbD4 — controlled demo voter 12; creator/current owner of one historical EURC-legacy entity.
0x6bB3117d1E95d4977a7d7Be145a153a094a1C090 — controlled demo voter 13; creator/current owner of one historical EURC-legacy entity.
0x0C64C9bd2641D928e009542e3FA4A828DEa49DFe — controlled demo voter 14; creator/current owner of one historical EURC-legacy entity.
0xb75dCd8e57b7dA63C964b8783e1b4Bae679D4A49 — controlled demo voter 15; creator/current owner of one historical EURC-legacy entity.
0xF3E76B3112d77FabB6D0D20e7262BB721E790Fe8 — controlled demo voter 16; creator/current owner of one historical EURC-legacy entity.
0x4D63E8A84B1DB26F3Ffb1CAA583390A6f5d6B241 — controlled demo voter 17; creator/current owner of one historical EURC-legacy entity.
0xB79deEEe18F941115C0cE7Fd5727fF569d50D622 — controlled demo voter 18; creator/current owner of one historical EURC-legacy entity.
0xf73BAa22e3cd01B4f42fe6cE63303b96E19A0164 — controlled demo voter 19; creator/current owner of one historical EURC-legacy entity.
0x6f8b00cD16B95D03cf138711979520ef2fcB8B32 — controlled demo voter 20; creator/current owner of one historical EURC-legacy entity.
```

In the current version, the organizer pays Arkiv storage fees and creates the
entity after the voter's Arc transaction. The entity's typed `voter` attribute is
the voter; its **creator is the storage writer**, not that voter. Historical
EURC-legacy ballots used a separate Arkiv transaction signed by each voter.

## On-chain creation evidence

The full mapping is [evidence.json](evidence.json): **80 unique entity keys and
creation transactions**, across 21 creator wallets. Each row includes the pool,
voter, creator, current owner, Arc vote hash, Arkiv creation hash, creation/expiry
blocks, payload hash, flags and typed attributes.

[creation-receipts.json](creation-receipts.json) preserves all **80 successful
Tiramisu creation receipts**, including the `EntityCreated` log from engine
`0x4400000000000000000000000000000000000044`. Receipt data is public chain data;
no private keys, seeds, passwords, access keys or credential-bearing RPC URLs are
included. Saved receipts prove creation; they do not by themselves prove a later
natural-expiry transition or continued data availability.

| Dataset | Arc pool | Arkiv entities |
| --- | --- | --- |
| EURC-v2 | `0x1fb1595b7330296e4d55e759209a2783ce4cfd36` | 20: 2 public, 18 encrypted |
| USDC-v2 | `0x56e4c0836f694bbbcf705c440feafea22dbfd18f` | 20: 2 public, 18 encrypted |
| EURC-short | `0x70387e2963bc7fd796545988edb8ea08449f9b96` | 20: 2 public, 18 encrypted |
| EURC-legacy | `0x35a7915dc29c67805b7323e5a0384f919c9cf210` | 20 encrypted |

These **seven representative records** are the default verifier selection:

### EURC-v2 / public

- Creator/current owner: Organizer writer above.
- Entity key: `0xadaee0fda285665e1e2e262f4af8688e49da7171682ae1e59b0756b5e4e6ac22`
- Creation transaction: `0x6189f1ba078ced3fc72ad7ba5d6c2bfbe8fe55016de83cdade87d71cda771f9c`
- Creation block: **386112**; current expiry block: **1041389**.

### EURC-v2 / encrypted

- Creator/current owner: Organizer writer above.
- Entity key: `0x9bb0f39383ad3fde5b26c2e46d67d4eb8bfdd11fdd181d20f34f25028c09903a`
- Creation transaction: `0x6c470bb186aa8e1da943afcbe9211d2a68e09d45b36efdeeb8a7d2dbae240184`
- Creation block: **386069**; current expiry block: **1041389**.

### USDC-v2 / public

- Creator/current owner: Organizer writer above.
- Entity key: `0xfc82ad6e793e88bf594a8a791f90e4d30fccf17a11d37d2a0c33ff563d4a8676`
- Creation transaction: `0xca8f8af391707cd698545d1c06b816a1dcbda1f29ea8d9d0b1bd4b3238667783`
- Creation block: **386161**; current expiry block: **1041389**.

### USDC-v2 / encrypted

- Creator/current owner: Organizer writer above.
- Entity key: `0x6d7231b2379474fc5f07c73e1b5dbf28398f68815e7527ed14965d378b8b420a`
- Creation transaction: `0x7a7d35467008c0655e5a7bb96eb5a7e6a25b35bb7f9985378d435da6b271375d`
- Creation block: **386117**; current expiry block: **1041389**.

### EURC-short / public

- Creator/current owner: Organizer writer above.
- Entity key: `0x2a9a9fca49139183c1e0b7537f4d00b433d41ac4768a63729c27c2291242ad28`
- Creation transaction: `0x773d76177dd0bda5382128d73ff66b69abc05b8f8620bf23f45478b9836b8f56`
- Creation block: **387401**; current expiry block: **1035512**.

### EURC-short / encrypted

- Creator/current owner: Organizer writer above.
- Entity key: `0x2993538e397eb1db0ac27613128c44cab0317508fe7eb146f6a39c2ccc39f910`
- Creation transaction: `0xa3adc2295b3c07c9344420e4b92dead24dbfed8ad90eaf841a6b3f69b62d8d3f`
- Creation block: **387356**; current expiry block: **1035512**.

### EURC-legacy / encrypted

- Creator/current owner: Demo voter 01 (`0x0d74F572b14A25D623C29F476AFd544C9673fc96`).
- Entity key: `0x3be460fa6b48c5fadc0dd95db77f69ba8405b8aec259dac710f1f4023aad8d49`
- Creation transaction: `0xc73e448e7697cc0620c9ed7b2bd5fc8b0eeb8c5ddaa784b984d3bb8367215d1a`
- Creation block: **384371**; current expiry block: **1041389**.

## Reproduce the live evidence without a wallet

The short round's representative public-ballot creation receipt can be retrieved
immediately, without this repository or any credentials:

```sh
curl --fail-with-body -sS \
  https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x773d76177dd0bda5382128d73ff66b69abc05b8f8620bf23f45478b9836b8f56"]}'
```

Expected receipt: `status: "0x1"`, with the organizer's `from` address and an
`EntityCreated` log for the listed short-round entity.

From a checkout containing this index and its linked files, with Bun installed:

```sh
cd cre
bun install --frozen-lockfile
# Verify one entity per dataset and mode: seven representatives.
bun scripts/verify-arkiv-evidence.ts
# Verify every recorded entity.
bun scripts/verify-arkiv-evidence.ts --all
```

Exact source: [verify-arkiv-evidence.ts](../cre/scripts/verify-arkiv-evidence.ts).
This script uses only public read clients: no account, local keystore, signatures
or gas. It checks both chain IDs, successful creation receipt and transaction
sender, the matching `EntityCreated` log, creator, current owner, live query at a
pinned Tiramisu block, native expiry/creation flags, payload hash, and the accepted
Arc reference/revision. For version 2 ballots it also recomputes the deterministic
ballot ID from typed attributes and payload. It has no transaction-history
fallback for missing Arkiv payloads.

Expected current result: `Verified 80 real Tiramisu entities. No fixture data or
write transactions were used.` Availability is time-sensitive: after expiry,
owner deletion, a new accepted revision or an RPC outage, live verification may
fail. Compare the error with the dated manifest and saved receipts; an RPC failure
or missing entity is not proof of natural expiry.

To deliberately refresh the two local evidence files after another full live
check, use `bun scripts/verify-arkiv-evidence.ts --all --write`. This writes local
JSON files only; it sends no blockchain transactions.

The underlying judge query is:

```ts
arkiv.select({ key: true, payload: true, attributes: true })
  .where(eq("$key", key(entityKey)))
  .atBlock(head.number)
  .limit(1)
  .fetch();
```

The UI uses the broader accepted-reference/typed-alias queries linked below,
including cursor pagination and hash verification. An arbitrary entity with a
matching-looking metadata field cannot authorize a vote.

## Decommission: before and after the migration

Before-migration commit: **`1f0a09ce502379767ef3030c5452f00f52878684`**.
Migration commit: **`d51466dfb8107e61672a71a55e840a683126d099`**.

Before, sealed pool contracts retained direct ballot bytes and encrypted ballots
in contract storage and exposed them through `directBallotOf`, `sealedOf` and
`votersFrom`. The Noir prover read packed ballots/ciphertexts from those EVM
roster pages. Inspect the exact historical implementation without checking out or
changing the working tree:

```sh
git show 1f0a09ce502379767ef3030c5452f00f52878684:src/SealedPool.sol
git show 1f0a09ce502379767ef3030c5452f00f52878684:src/noir/NoirRankedShares.sol
git show 1f0a09ce502379767ef3030c5452f00f52878684:prover/src/core/chain.ts
git diff 1f0a09ce502379767ef3030c5452f00f52878684 d51466dfb8107e61672a71a55e840a683126d099 -- src/ArkivBallots.sol src/SealedPool.sol src/noir/NoirRankedShares.sol prover/src/core/arkiv.ts prover/src/core/chain.ts
```

Current source/read path:

| Step | Exact source and entry point |
| --- | --- |
| Accept vote and bind hash/revision on Arc | [PoolBase.sol](../src/PoolBase.sol), `castBallot`; [ArkivBallots.sol](../src/ArkivBallots.sol), `_storeBallot` / `ballotRefOf` |
| Store accepted bytes and typed metadata in Arkiv | [ballot-storage.ts](../cre/scripts/lib/ballot-storage.ts), `ballotStorageWorker` / `syncPool`; [sync-ballots.ts](../cre/scripts/sync-ballots.ts), resumable CLI |
| Authenticate Arkiv aliases and payloads | [cre/src/lib/arkiv.ts](../cre/src/lib/arkiv.ts), `ballotId`, `ballotAlias`, `checkedPayload`, `payloadQuery` |
| Query Arkiv in the browser | [web/app/lib/arkiv.ts](../web/app/lib/arkiv.ts), `loadPayloads` |
| Resolve accepted roster and read payloads | [prover/src/core/arkiv.ts](../prover/src/core/arkiv.ts), `readArkivVoters` / `fetchPayloads` |
| Calculate public provisional results in the browser | [use-arkiv-public.ts](../web/app/hooks/use-arkiv-public.ts), `useArkivPublic`; [shared/pbear.ts](../shared/pbear.ts), `pbearTranscript` |
| Read metadata/final outcome from Arc | [web/api/chain/read.ts](../web/api/chain/read.ts); Arkiv-mode public live results are computed in the browser |

Read [web README: Arkiv voting](../web/README.md#arkiv-voting), the
[storage migration decision](../docs/decisions/2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md),
and the [combined contribution/vote decision](../docs/decisions/2026-09-13-cast-contributions-and-ballots-together.md).
The first migration's separate upload/confirmation flow was superseded by the
current `castBallot` transaction and background storage worker.

For the app demonstration, use [web README: Run locally](../web/README.md#run-locally):

```sh
cd web
npm ci
# On a fresh checkout only; preserve an existing local configuration.
test -f .env || cp .env.example .env
deno task dev
```

Then open these local pages (Arc Testnet and Tiramisu public RPCs are preconfigured;
a wallet is not needed to inspect results):

- `/round?pool=0x70387e2963bc7fd796545988edb8ea08449f9b96` — closed and **Proven**, 11 funded projects, **19.05 test EURC** allocated from 20.
- `/vote?pool=0x70387e2963bc7fd796545988edb8ea08449f9b96` — post-close ballot review reads current Arkiv data.
- `/round?pool=0x1fb1595b7330296e4d55e759209a2783ce4cfd36` — public provisional results while this longer EURC round is open (deadline 13 September, 10:25:32 UTC).

The short round's UI was checked after finalization: its overview showed
**Proven / 11 of 15 projects funded / 19.05 EURC allocated**, and its ballot review
showed **20 of 20 accepted ballots available** at Arkiv block **387769**, without
a connected wallet. This is an observed browser check, not a recorded video.

Recorded transactions and replay/resume commands are in
[the short-round demo](../demo/short-round.md),
[its public receipt](../demo/short-round-deployment.json), and
[the two longer rounds](../demo/new-flow.md). The live verifier above is the
read-only judge entry point. Operator deployment/upload scripts require a funded
operator account and private configuration and are not needed to inspect existing
entities.

**Scope limitation:** this demonstrates replacing EVM ballot-state reads with
Arkiv storage/query reads. It does not demonstrate decommissioning PostgreSQL,
Supabase or another conventional backend database. Arc still stores commitments,
revision references and final results. Version 2 `BallotPublished` events and
transaction calldata retain accepted bytes; the tally reader can recover
hash-checked bytes from that history if Arkiv is unavailable. Arkiv is therefore
not the sole historical copy. Legacy contract paths remain for older pools.

## Built to expire: implemented behavior and missing live proof

All 80 verified entities have `readonly: true` and
`permissionlessExtension: false`. Expiry is a native Arkiv block height computed
from the fixed voting deadline plus approximately **15 days**, rather than a
browser timer or deletion job. The receipt's actual height is authoritative; the
calendar estimate depends on block cadence. Representative heights are listed
above, and every entity's actual height is in [evidence.json](evidence.json).

Sources:

- [ballot-retention.ts](../web/app/lib/ballot-retention.ts): `ballotExpiry` and `ballotRetentionUntil`.
- [ballot-storage.ts](../cre/scripts/lib/ballot-storage.ts): current writer applies expiry/creation flags.
- [ballot-review.ts](../web/app/lib/ballot-review.ts): `readBallotReview` repeats the accepted-reference query at a fresh pinned Arkiv block.
- [use-ballot-review.ts](../web/app/hooks/use-ballot-review.ts): refreshes every 15 seconds and drops review payloads when leaving the page.
- [voting components](../web/app/components/voting/index.tsx): `BallotReview` removes unavailable contents while final funded results remain visible.

**Fixture-only reproduction, not live natural-expiration evidence:**

```sh
cd web
npx vitest run test/ballot-retention.test.ts test/ballot-review.test.tsx
```

These **12 tests passed** on 13 September 2026. Exact tests:
[ballot-retention.test.ts](../web/test/ballot-retention.test.ts) and
[ballot-review.test.tsx](../web/test/ballot-review.test.tsx). In the latter, the test
`native expiry removes public and encrypted contents while final results stay visible`
executes the same query at mocked blocks 100 and 101, with no delete call, then
asserts that ballot contents disappear and the final funded result remains.
The tests also cover owner extension, unknown absence, altered bytes, RPC failure,
pagination and replacement revisions.

**Not yet recorded on Tiramisu:** the same query before and after an entity's
natural expiry, the intervening block heights, and the resulting live app change.
All 80 entities were still live when checked. Their scheduled retention runs into
late September; this submission must not claim that local fixtures already prove
natural expiration on Tiramisu.

Owners can still extend, transfer or delete their entities. A fresh browser cannot
infer whether an unseen entity expired or was deleted. Expiration removes data
from normal Arkiv queries, but is not an erasure guarantee for Arc calldata,
events or separately saved copies.

## Live wire: not implemented or claimed

The app uses Arkiv **HTTP** clients and query refreshes. See
[the client in arkiv.ts](../web/app/lib/arkiv.ts),
[use-snapshot.ts](../web/app/hooks/use-snapshot.ts), and
[use-ballot-review.ts](../web/app/hooks/use-ballot-review.ts).
The storage worker also polls every 15 seconds.

There is no Arkiv WebSocket subscription client, recorded two-client WebSocket
update, or observed reconnect/backfill behavior to link. The Uniswap LP module's
`subscribe`/`unsubscribe` methods are unrelated to Arkiv event subscriptions.
Polling and fixture tests should not be presented as completing Live wire.

## Recording checklist and known demo limitations

No video URL or timestamps are currently available. Before publishing a recording:

1. Show a listed entity's creation receipt, creator/current owner, and live query;
   run the seven-record verifier and show its result. Add the actual timestamp.
2. Show the before-migration source and the current Arkiv read path, then the
   closed short-round page and its ballot review. Add the actual timestamp.
3. For Built to expire, separately capture the **same query** before and after
   natural expiry on Tiramisu, with creation/expiry/head heights and no delete,
   followed by the app's changed review state. This evidence is still missing.
4. Claim Live wire only after implementing and recording real Arkiv WebSocket
   subscriptions in two clients, plus a disconnect/reconnect observation.

The short round was open for 7 minutes 36 seconds, used scaled requests and
20 operator-controlled wallets, and reached Noir **Proven** finality at
07:12:24 UTC. Its public transcript audit passed. Allocations are awaiting payout;
funded does not mean paid. CRE report delivery used the explicitly approved local
simulator forwarder without workflow-owner/name authentication; it is a testnet
demo, not an authenticated DON run. The subsequent Noir proofs were verified by
the deployed verifier contracts. All amounts are test assets.
