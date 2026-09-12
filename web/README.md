# RankedShares proposals and voting

A React Router SPA for public proposal uploads through Swarm ID and owner review.
The on-chain pool is the source of truth for submission revisions, terms and decisions.

## Arkiv voting

Open `/vote?pool=0x…` for public/encrypted ballots and live public results. All four
pool implementations are supported: RankedShares, Noir, CRE and ZisK. Deploy the
updated contracts, then connect the owner wallet and **Enable Arkiv ballot storage**
before calling `openVoting()`. Existing deployed pools cannot be upgraded in place.
This does not move old votes, proposals or funds to a new round automatically.

Proposal content remains in Swarm. Arkiv stores ballot bytes and typed searchable
metadata; the pool binds each accepted revision to its entity key and payload hash.
The frontend fetches every accepted public ballot and runs the shared PB-EAR tally
every fifteen seconds. Encrypted ballots stay encrypted and are excluded from the
public projection. Final proof/attestation verification remains on-chain.

1. Connect a wallet with eligible contribution or sponsored-seat weight.
2. Rank accepted projects. The form fetches their titles from Swarm.
3. **Store ballot in Arkiv** switches to Tiramisu (chain 7738577). Fund that wallet
   with testGLM using the [Arkiv faucet](https://hub.arkiv.network/faucet).
4. **Confirm ballot in the round** switches back to the pool's configured network
   and submits the checked payload/reference. Only this successful transaction counts.

An interrupted flow resumes from the local draft. It contains public ranks or sealed
ciphertext and transaction hashes, never plaintext sealed ranks or an encryption key.
A declined pool signature can be retried without paying for another upload. A draft
can be discarded, but that does not undo an upload or cancel a sent transaction.

After the deadline, **Advance pool tally** drives the public implementation with
hash-checked ballot witnesses. For the sealed variants, **Prepare next batch for final
tally** advances `closeArkiv`; the existing CRE/proof flow then finalizes the result.
Results cannot be calculated from a partial set of accepted ballots. If an entity is
missing, browser/prover readers try the original vote transaction in its recorded block.

`VITE_ARKIV_RPC_URL` can override the default Tiramisu endpoint. It is public
configuration; no backend key, tally service or result snapshots are needed.
New Arkiv ballots are readonly and expire approximately **15 days after the voting
deadline**, for all pool implementations. This is a fixed deadline, not 15 days
from each upload or from the tally. The publisher converts the target timestamp
to a block using Arkiv's current block timestamp and nominal two-second cadence;
the receipt's actual expiry block is displayed and checked. No browser clock,
cleanup job, automatic deletion, review copy or result snapshot sets the cutoff.

New entities disable permissionless extension. Their owner can still extend,
transfer or delete them. Existing entities keep their original lifetime and flags;
legacy pending drafts can still be confirmed. Expiry cannot be shortened in place.

After voting closes, **Ballot review** displays current public ranks and encrypted
payloads directly from Arkiv. Each refresh checks the current on-chain references,
hashes and native expiry heights at one Arkiv block. When records disappear, their
contents disappear from this view. It does not use the tally reader's calldata
fallback, and does not treat a missing ballot as an abstention. RPC errors hide
cached review contents. Previously observed expiry metadata distinguishes a passed
expiry from unknown absence; a fresh browser cannot prove why a missing record is
gone. Final funded results remain readable from the pool after all ballots expire.

Finish closing and tallying before expiry. A tally delayed beyond retention can
need transaction recovery or a separately preserved archive; the CRE workflow's
normal Arkiv reads cannot revive expired data. Pools with an abandonment window
longer than 15 days show a notice. No contract redeployment is required for this
frontend retention change on a pool that already supports Arkiv ballots.

Ballot bytes also occur in the original pool transaction calldata; this is not
exclusive off-chain storage or automatic erasure. See the
[storage decision](../docs/decisions/2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md)
for query fields, recovery limits and the migration API.
The [Arkiv feedback report](../arkiv/feedback.md) records integration findings and
the remaining live-submission evidence. For an expiry demo, use a short-lived test
record and record the same query before and after its native expiry block; passing
local simulated tests alone does not establish mission completion.

## Uniswap LP demo

The CRE LP pool adds `/liquidity?pool=0x…`. It displays sponsored budgets, accepted
price timestamps, per-wallet accumulated shares and projected final weights.
Connect an LP wallet to register its PositionManager NFT with one subscription
transaction. An eligible registered wallet can vote privately before weight is
finalized. **Stop accruing** retains previously earned credit. After the deadline,
the page offers permissionless chunked finalization if the CRE workflow needs help.

Use a newly deployed `LPCreRankedShares` with its `LPVoting` module attached.
`VITE_LP_FROM_BLOCK` should be the PositionManager deployment block: discovery scans
Transfer logs in 2,000-block chunks, capped at 100,000 blocks. Manual NFT ID lookup
remains available for older positions or RPC log limits. This is not a chain-wide
Uniswap NFT indexer. The public price source is the sponsored pool itself, not an
independent oracle. The
[signing runbook](../docs/superpowers/notes/2026-09-13-arc-lp-demo-runbook.md)
contains all Arc and CRE configuration.

## Run

```sh
cp .env.example .env
# Set VITE_RPC_URL, VITE_CHAIN_ID, VITE_CHAIN_NAME, VITE_NATIVE_SYMBOL,
# and VITE_POOL_ADDRESS for a newly deployed pool with proposal support.
deno task dev
```

Open `http://localhost:5174/submit`. A `?pool=0x…` query parameter or the round
picker overrides the configured pool address; the configured chain and RPC stay
fixed. Use `/setup` with the pool owner's wallet for acceptance and rejection.
The default configuration uses a local Anvil chain. No live contract is preselected.

The npm equivalents are `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`,
`npm run build`, and `npm run preview`. npm installs need dev dependencies included.

```sh
deno task typecheck
deno task test
deno task build
deno task preview
deno task dev:api           # the read API on http://localhost:8000
deno task test:api          # deno test: fake pool transport, plus Anvil when installed
deno task check:api         # type-check the API and the site server
deno task start             # the deployed server: API under /api plus build/client
```

The integration test launches a temporary Anvil chain on port 8573. Run `forge build`
at the repository root first; `forge`, `anvil`, and local socket access are needed.
The test drives the actual rendered forms, real contract reads/writes and receipts,
and a fake Swarm transport. It covers submission, a rejected wallet request followed
by reload/retry, edits by both roles, an edit signature retry without re-upload,
concurrent edit conflicts, owner acceptance and rejection, and wallet changes.
The fake transport's references are test identifiers, not actual Swarm content hashes.

## The read API

`api/` is a Deno + Hono API that reads one consistent snapshot of a pool (every
view pinned to one block) and serves it as JSON: `GET /api/round` (projects with
their public commitment, the sealed total and count, the stage bar's steps, the
outcome), `GET /api/project/:id` (a project with its pitch resolved from Swarm by
reference through `BEE_URL`), `GET /api/voter/:address` (weight, ballot presence,
roster membership), and `GET /healthz`. `?pool=0x…` overrides `POOL_ADDRESS`;
`?after=<block>` is accepted by all three routes and forces a re-read at or past
that block, for after the caller's own transaction. Reads are pinned to one block
across the several `RPC_URL`s used for failover, so point them at the same provider
or at replicas of it — a failover to a node that has not caught up to that block
yet is not otherwise detected. A public commitment is the direct weight of voters
whose public ballot ranks the project first; Noir pools report
`commitmentsAvailable: false`. A pool reporting more than 255 projects or 10,000
voters is rejected with `400 { error: "pool too large" }` rather than read in full.
Content that fails to resolve from `BEE_URL` is remembered as unavailable for 60
seconds before another gateway fetch is attempted. On a pool with Arkiv ballot
storage enabled the API reports `ballots: "arkiv"`, `commitmentsAvailable: false`,
and zero commitments: public results are computed in the browser from Arkiv
(decision of 2026-09-13); the API still serves the stage, projects, titles,
weights, and roster membership through `voterRefsFrom`. `server.ts` serves the
API and `build/client` from one port for Deno Deploy (root `web`, build `deno task
build`, entrypoint `server.ts`). Design: `docs/superpowers/specs/2026-09-12-round-pages-design.md`.

## Storage and deployment

The default identity service is `https://swarm-id.snaha.net`; set
`VITE_SWARM_ID_ORIGIN` for a compatible development deployment. The library initializes
in the browser, then the Connect Swarm ID button opens the identity popup directly
from the user's click. The upload button requires both an identity and `canUpload`.
Downloads work without an identity. The user manages postage/storage in Swarm ID;
never configure postage credentials as `VITE_` variables.

Serve `build/client/` as static files, with unknown app paths falling back to
`index.html`. The preview command is for local review, not production hosting.
Keep the proposal app separate from the browser prover's isolated origin: do not add
the prover's `Cross-Origin-Opener-Policy: same-origin` or
`Cross-Origin-Embedder-Policy: require-corp` headers to this app. If you configure CSP,
allow the configured identity origin in `frame-src`.

Both proposal text and file attachments are public. Encrypted private review and
publication at voting start are not implemented yet. The organizer accepts the exact
on-chain revision, reference, cost and recipient; they can reject any pending submission. No
content restrictions are imposed during upload. The UI treats all resolved content
as untrusted: React text rendering, validated attachment references, binary downloads,
and no raw HTML or embedded attachments. Preview limits do not restrict uploads.

## Editing during review

The original proposer and current pool owner can choose **Edit proposal** on a pending
submission in `/` or `/setup`. The form loads the current title, text, amount, recipient
and attachments. Existing files can be retained or removed, and new files can be added;
retained files are not uploaded again. The editor needs their own connected Swarm ID
with storage to upload the new revision, and their authorized wallet to save it on-chain.

Every save keeps the original proposer and increments the revision. The board shows
the revision and last editor; `ProposalEdited` events preserve previous references,
new references and terms. Swarm uploads are immutable, so removing a file from a new
revision does not delete the old file or revision.

Edits, acceptance and rejection include the expected revision. If another editor saves
first, the transaction fails and the form retains the draft for comparison. Refresh
the board to read the latest proposal; **Discard edits and load latest revision**
explicitly replaces the draft. A declined edit signature can be retried without uploading
again while the editor stays open. Drafts are held in memory and are lost on navigation,
reload or wallet change. Acceptance/rejection locks the proposal; opening voting or
reaching the deadline closes all pending edits as well.

Deploy a new pool for the revised API: `acceptProposal(id, expectedRevision)` and
`rejectProposal(id, expectedRevision)` now require the version being reviewed.

The integration was verified with SDK mocks and a local chain. A funded Swarm ID and
a browser wallet are needed to validate a live upload and its retrieval on Swarm.

## Component structure

`app/components/ui` contains shared controls and field/status patterns;
`app/components/proposals` composes them into presentational forms and review cards.
Route containers and `app/hooks` own queries and mutations. `app/lib` holds the
Swarm adapter, contract ABI, exact token parsing, and transaction guards.
`app/tokens.css` supplies the shared visual tokens as a Tailwind v4 `@theme` block (the Blossom brand palette and typefaces, light and dark), documented in `docs/design/tokens.md`; the first version's variable names remain as aliases until each component is rebuilt. The screens use native form
controls, visible focus, descriptive labels, text status badges, and live error and
progress announcements; attached files are never embedded in the document.
