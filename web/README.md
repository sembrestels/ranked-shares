# RankedShares proposals

A React Router SPA for public proposal uploads through Swarm ID and owner review.
The on-chain pool is the source of truth for submission revisions, terms and decisions.

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
```

The integration test launches a temporary Anvil chain on port 8573. Run `forge build`
at the repository root first; `forge`, `anvil`, and local socket access are needed.
The test drives the actual rendered forms, real contract reads/writes and receipts,
and a fake Swarm transport. It covers submission, a rejected wallet request followed
by reload/retry, edits by both roles, an edit signature retry without re-upload,
concurrent edit conflicts, owner acceptance and rejection, and wallet changes.
The fake transport's references are test identifiers, not actual Swarm content hashes.

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
`app/tokens.css` supplies the shared visual tokens. The screens use native form
controls, visible focus, descriptive labels, text status badges, and live error and
progress announcements; attached files are never embedded in the document.
