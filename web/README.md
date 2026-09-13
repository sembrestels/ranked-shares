# RankedShares proposals and voting

A React Router SPA for encrypted proposal uploads through Swarm ID, private review,
and publication of accepted revisions when voting opens.
The on-chain pool is the source of truth for submission revisions, terms and decisions.

## Round and project pages

`/` is the rounds directory, with search, active/completed filters, and an address
lookup. Feature several rounds using `VITE_ROUNDS`, a JSON array of
`{"pool":"0x…","name":"Community grants"}` entries on `VITE_CHAIN_ID`.
`VITE_POOL_ADDRESS` remains a featured round; `VITE_ROUND_NAME` labels only that
address. Opened rounds and optional labels are saved in this browser per chain.
The directory is not a chain-wide registry. No wallet is needed to browse it.

The site header contains **All rounds** and **Create round**. Inside a round,
a named switcher and round tabs separate browsing/voting from submission and
organizer tools. Switching rounds opens its overview and resets temporary page
state. The URL controls selection, including browser Back/Forward.

`/round?pool=0x…` shows the round page (legacy `/?pool=0x…` links redirect here): every project with its public commitment, the sealed total
and voter count, the stage bar, and the outcome once the round is done, all read from
the API (`GET /api/round`). `/project/:id` shows one project's pitch, cost, support,
and recipient, read from `GET /api/project/:id`. `VITE_ROUND_NAME`, `VITE_SITE_URL`,
`VITE_REPO_URL`, and `VITE_CLOSE_CHUNK` shape the copy and links on these pages (the
round's display name, the canonical site URL used in shared links, the linked
repository, and the roster chunk size the close-and-prove flow suggests). Project
pages are prerendered at build time when `VITE_POOL_ADDRESS` is set, one page per
known project (see `deno task build` below).

## Arkiv voting

Open `/vote?pool=0x…` for public/encrypted ballots and live public results. All four
pool implementations are supported: RankedShares, Noir, CRE and ZisK. Deploy the
updated contracts, then connect the owner wallet and **Enable Arkiv ballot storage**
before calling `openVoting()`. Existing deployed pools cannot be upgraded in place.
This does not move old votes, proposals or funds to a new round automatically.

Proposal content remains in Swarm. Arkiv stores ballot bytes and typed searchable
metadata; the pool binds each accepted revision to a deterministic ballot ID and
payload hash. Arkiv entities carry a verified alias for that ID.
The frontend fetches every accepted public ballot and runs the shared PB-EAR tally
every fifteen seconds. Encrypted ballots stay encrypted and are excluded from the
public projection. Final proof/attestation verification remains on-chain.

1. Connect a wallet and rank accepted projects. Titles load from public Swarm reads.
2. Enter a contribution for a public vote, or use existing contribution/sponsored-seat weight.
3. Press **Contribute and vote** (or **Vote** with existing weight). With existing
   allowance or an EIP-2612 permission signature, one `castBallot` transaction
   deposits the contribution and records the ballot atomically. Unsupported tokens
   need an approval transaction first; the combined vote follows automatically.
4. The vote counts immediately. The operator's funded
   [background Arkiv worker](../demo/README.md#new-contribution-and-vote-flow-version-2-pools)
   stores the accepted bytes and metadata afterwards. Voters stay on the pool network
   and do not need Arkiv gas or another storage/confirmation transaction.

An interrupted flow resumes from the local draft. It contains public ranks or sealed
ciphertext and transaction hashes, never plaintext sealed ranks or an encryption key.
Known transaction hashes are checked on resume without another contribution or vote.
Unsent drafts can be discarded. A reverted vote rolls back its contribution and permit.

After the deadline, **Advance pool tally** drives the public implementation with
hash-checked ballot witnesses. For the sealed variants, **Prepare next batch for final
tally** advances `closeArkiv`; the existing CRE/proof flow then finalizes the result.
Results cannot be calculated from a partial set of accepted ballots. If an entity is
missing, browser/prover readers try the original vote transaction in its recorded block.

`VITE_ARKIV_RPC_URL` can override the default Tiramisu endpoint. It is public
configuration. The storage worker uses a separate operator key, never a `VITE_`
secret. Public live results do not require a tally service or result snapshots.
New Arkiv ballots are readonly and expire approximately **15 days after the voting
deadline**, for all pool implementations. This is a fixed deadline, not 15 days
from each upload or from the tally. The publisher converts the target timestamp
to a block using Arkiv's current block timestamp and nominal two-second cadence;
the receipt's actual expiry block is displayed and checked. No browser clock,
cleanup job, automatic deletion, review copy or result snapshot sets the cutoff.

New entities disable permissionless extension. Their owner can still extend,
transfer or delete them. Existing entities keep their original lifetime and flags;
historical references remain readable. The new form only submits to version 2 pools.
Expiry cannot be shortened in place.

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

## Deploy a contract from the browser

Choose **Create round** in the site header or open `/deploy`. Arc Testnet is the
default network for the browser, prerender and read API. Connect a browser wallet
and get gas from the [Circle faucet](https://faucet.circle.com/). The network details
follow the [Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc).
Explicit `VITE_` and API network overrides still work; set chain ID `31337`, the
local RPC, name `Anvil` and symbol `ETH` for local development.

The normal round form asks for **round type, funding token and voting deadline**.
It supports public RankedShares, CRE, Noir, ZisK and liquidity CRE. Funding is limited
to USDC/EURC, with official Arc addresses and USDC selected by default. Other chains
use `VITE_USDC_ADDRESS` / `VITE_EURC_ADDRESS`; unavailable currencies are disabled.
Deadlines use local date/time and become Unix seconds. **Round options** is collapsed
and contains an organizer override and the applicable voting minimums. The organizer
follows the connected wallet until explicitly overridden. Minimums default to zero
and use currency amounts with up to six decimals (e.g. `1.25` USDC), not base units.

All encryption, workflow, verifier and recovery settings are application-owned.
Sealed deployment requires `VITE_TALLY_SERVICE_URL` to point to a real service
implementing [the public provisioning protocol](docs/tally-provisioning.md). No live
service is configured in this repository: sealed types show an unavailable message
until setup is complete; public deployment remains available. The frontend never
generates a replacement tallier secret or substitutes fixture authorization settings.

The service supplies a per-round public key/salt pair, authenticated workflow identity
and optional known dependency addresses. The browser checks the exact build/profile,
validates required contracts and reuses matching runtime bytecode, or deploys the
pinned dependencies through the wallet. Noir capacity comes from the bundled circuit
profile (256 sealed voters / 16 projects / batch 32); recovery is one day after a
provisional report and abandonment after seven days from the voting deadline. ZisK's
program key must match the committed guest profile; its root is read from the verifier.
Liquidity deployment creates and attaches LPVoting automatically. If the organizer
differs from the deployer, ownership transfers after attachment as a fourth transaction.
Each sealed round becomes ready only after the service confirms active monitoring.

**Custom contract** accepts a Foundry/Hardhat/solc contract artifact, or a JSON ABI
plus creation bytecode. It supports scalar constructor inputs, nested tuples, JSON
arrays, and native payment for payable constructors. Put large integers in quotes
inside JSON arrays. Link libraries before importing. Runtime-only bytecode and ABI
alone are not deployable artifacts. No Solidity compiler or private key runs in the
browser: the connected wallet signs the deployment after gas estimation.

A confirmed round becomes the selected pool and offers **Set up this round**.
Custom deployments show their address without replacing the active pool. Pending
transaction hashes are kept in local storage so `/deploy` can resume receipt checks
after a reload; a receipt lookup failure never automatically resends a deployment.

Bundled rounds and dependency builds are lazy-loaded from `app/lib/artifacts`.
After changing Solidity, run `npm run contracts:sync` in `web` (requires Foundry)
and commit the generated JSON. Proof changes also require regenerating the matching
verifiers/guest proof export before syncing; copying source hashes does not prove a
new proof build is valid. `npm run contracts:check` checks Solidity and proof-profile
source hashes without a compiler. Hosted builds do not require Foundry. Browser
integration tests use local Anvil and compiled test fixtures (`forge build` first).

## Run locally

```sh
cp .env.example .env
# Arc Testnet is preconfigured. Deploy a round at /deploy after starting the app.
deno task dev
```

Open `http://localhost:5174/` for the rounds directory (`/project/:id` for one project,
`/proposals` for the proposals board, `/submit` to submit, `/setup` for the
organizer). The stage bar under the round navigation shows progress on round pages.
A `?pool=0x…` query parameter overrides the configured pool address; the configured chain and RPC stay
fixed. Use `/setup` with the pool owner's wallet for acceptance and rejection.
The default configuration uses Arc Testnet. No live contract is preselected.

`deno task build` prerenders `/`, `/project/:id` for every known project (a
placeholder `/project/0` when no pool is configured yet), and the other fixed
routes, each with `<title>`/`og:title`/description/canonical meta so shared
links unfurl. Set `VITE_SITE_URL` to the deployed site's own URL so canonical
links and `og:url` are correct rather than `http://localhost:5174`, and
`VITE_BEE_URL` (or reuse the API's `BEE_URL`) so prerendered project pages can
resolve the real pitch title instead of falling back to "Project N".

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
Published proposal downloads work without an identity. Private review requires the
proposer's or registered organizer's Swarm ID. The user manages postage/storage in Swarm ID;
never configure postage credentials as `VITE_` variables.

Serve `build/client/` as static files, with unknown app paths falling back to
`index.html`. The preview command is for local review, not production hosting.
Keep the proposal app separate from the browser prover's isolated origin: do not add
the prover's `Cross-Origin-Opener-Policy: same-origin` or
`Cross-Origin-Embedder-Policy: require-corp` headers to this app. If you configure CSP,
allow the configured identity origin in `frame-src`.

Enable **Private review** in `/setup` before inviting proposals. The organizer signs
the registration of their Swarm ID sharing public key in the round's fixed
`ProposalPrivacy` companion contract (`pool.proposalPrivacy()`). The first proposal
locks that key. Keep that identity available after any organizer wallet transfer.
The proposer's key lives in public Swarm metadata bound by the submission transaction.

Text and attachments are AES-GCM encrypted in the browser. Each revision has a fresh
key shared through ACT with the original proposer and organizer. The public descriptor
contains the ACT-protected access information, ciphertext reference, context and
`keccak256(key)`; it contains no plaintext pitch or raw key. Attachment names and keys
stay inside the encrypted document. The organizer accepts the exact
on-chain revision, reference, cost and recipient; they can reject any pending submission. No
content restrictions are imposed during upload. The UI treats all resolved content
as untrusted: React text rendering, validated attachment references, binary downloads,
and no raw HTML or embedded attachments. Preview limits do not restrict uploads.

After review, choose **Prepare voting**, then **Publish accepted proposals and open
voting**. Preparation checks all accepted final revisions locally. The second action
sends their keys to `ProposalPrivacy.openVoting(ids, keys)`, which verifies the entire
ordered acceptance list and key commitments before opening the pool atomically.
Only accepted final revisions become public, along with attachments retained in them.
Rejected proposals and previous drafts remain encrypted. Public project pages, API
snapshots and ballot titles resolve released keys from the chain, without ACT credentials.

Publication cannot be undone: keys are visible once sent to an RPC or broadcast,
including in pending/reverted transactions. This is an explicit organizer action,
not a timed release service. Readers can copy any content they were allowed to read.
Previously public Markdown uploads cannot be made private retroactively.

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

Deploy a new pool for the revised API: `propose(contentRef, keyHash, cost, recipient)`
and `editProposal(id, expectedRevision, contentRef, keyHash, cost, recipient)` now bind
a revision key commitment. `acceptProposal(id, expectedRevision)` and
`rejectProposal(id, expectedRevision)` retain their revision guard. Old deployments
remain readable, but the frontend blocks new uploads when private review is unavailable.

The integration is tested with real AES-GCM, an ACT transport/identity test double,
and a local chain, including edits by both participants and public release through
the setup page. These tests do not claim to validate the live Swarm ID service.

## Component structure

`app/components/ui` contains shared controls and field/status patterns;
`app/components/proposals` composes them into presentational forms and review cards.
Route containers and `app/hooks` own queries and mutations. `app/lib` holds the
Swarm adapter, contract ABI, exact token parsing, and transaction guards.
`app/tokens.css` supplies the shared visual tokens as a Tailwind v4 `@theme` block (the Blossom brand palette and typefaces, light and dark), documented in `docs/design/tokens.md`; the first version's variable names remain as aliases until each component is rebuilt. The screens use native form
controls, visible focus, descriptive labels, text status badges, and live error and
progress announcements; attached files are never embedded in the document.
