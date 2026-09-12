---
status: superseded by [Upload proposal content from the browser through Swarm ID](2026-09-12-upload-proposal-content-from-the-browser-through-swarm-id.md)
date: 2026-09-12
decision-makers: Sem
---

# Store proposal content in Swarm through the API and bind its reference on-chain

> **Implementation update, 2026-09-12:** The decision-maker subsequently requested
> uploads through **Swarm ID**, with unrestricted proposer content and organizer
> acceptance/rejection. That request is implemented in `web/app/lib/swarm.ts`,
> `web/app/routes/submit.tsx`, `web/app/routes/setup.tsx`, and `src/PoolBase.sol`.
> The API-managed postage design below remains a historical proposal; its upload
> route, content allowlist, Bee secrets and caching are not the implemented path.
> The current setup and data format are documented in `web/README.md` and the root
> README. Broader frontend/hosting decisions retain their existing statuses.

## Context and Problem Statement

Today a project is a cost and a recipient address, added by the pool owner. The pitch
lives wherever the organiser collected it, and donors never see it from the round. The
personas and story map need a proposer to submit through the frontend, an organiser to
accept, and a project page that shows the pitch. Where does the proposal content live,
who uploads it, and how does the chain refer to it?

The decision-maker stated the direction on 2026-09-12: a submit form in the frontend,
content in Swarm, its hash stored on-chain, acceptance by the organiser. The house
precedent, `thedao-rfps/web`, uploads files (logos, pictures) from its API to IPFS
through Pinata and stores only the CID; the API holds the Pinata key. This record
follows that shape with Swarm in place of IPFS.

## Decision Drivers

- The pitch must be readable from the project page by anyone.
- The chain must bind a project to exactly the content the proposer submitted, so the
  organiser cannot swap it and the proposer can verify it.
- Proposers submit themselves; the organiser accepts or rejects; the accepted project
  is what `addProject` creates today.
- No secret in the browser: the postage batch that pays for the upload stays in the
  API, as the Pinata key does in thedao-rfps.

## Considered Options

- Swarm through the API, reference on-chain as `bytes32`, acceptance by the owner
- IPFS through Pinata from the API, CID on-chain (the thedao-rfps precedent)
- Swarm uploaded from the browser with a gateway that stamps
- Content on-chain, or an off-chain database with the hash on-chain

## Decision Outcome

Chosen option: "Swarm through the API, reference on-chain, acceptance by the owner".
A Swarm reference is the content's hash, so storing the reference is storing the
commitment: the API resolves it from a Bee node, caches it, and the project page needs
no second hash check. Swarm is the decision-maker's stated choice; Pinata is the
precedent and would be a one-service swap in `api/services/`.

### Consequences

- Good, because the proposal is content-addressed: the on-chain word is both the
  pointer and the proof.
- Good, because the upload path is one API route, mirroring thedao-rfps's uploads,
  and the postage batch never reaches the browser.
- Bad, because someone funds the postage batch: the team for the demo, the organiser
  for a real round (an R2 question).
- Bad, because content availability depends on the swarm keeping it; the API pins on
  a team-run Bee node for the demo and caches resolved content in KV.
- Neutral, because the contract gains a proposal stage before setup completes; the
  README lifecycle table grows by one phase.

## Implementation Plan

- **Affected paths**: `src/PoolBase.sol` (proposals), the three pool variants only
  through `PoolBase`, `test/` (proposal tests), `README.md` (lifecycle table),
  `web/api/routes/proposals.ts`, `web/api/services/swarm.ts`, `web/app/routes/submit.tsx`,
  `web/app/routes/project.tsx`, the organiser's review under `web/app/routes/setup.tsx`.
- **Contract**: in the Setup phase, `propose(bytes32 contentRef, uint256 cost, address
  recipient) returns (uint256 proposalId)` open to anyone, storing `{proposer,
  contentRef, cost, recipient, status}` and emitting `Proposed`; owner-only
  `acceptProposal(uint256 id)` calls the existing `_addProject` path with the
  proposal's cost and recipient and stores the reference on the project, emitting
  `ProposalAccepted(id, projectId)`; owner-only `rejectProposal(uint256 id)` emitting
  `ProposalRejected`. `addProject` stays for rounds without submissions, with an
  optional `contentRef`. Projects expose `contentRefOf(projectId)`.
- **API**: `POST /api/proposals/content` takes the proposal JSON `{title, summary,
  body, links, cost, recipient, version}`, validates it (sizes, https links, no HTML),
  uploads it to `BEE_URL` with `BEE_POSTAGE_BATCH_ID`, and returns the reference; the
  round and project routes resolve `contentRefOf` through a KV-cached fetch and
  serve the JSON.
- **Frontend**: the submit form posts the JSON to the API, then submits the returned
  reference with cost and recipient in one transaction from the wallet; the project
  page and the organiser's review render the JSON as text and sanitised markdown, as
  thedao-rfps renders initiative markdown.
- **Dependencies**: `@ethersphere/bee-js` in the API, pinned.
- **Configuration**: `BEE_URL`, `BEE_POSTAGE_BATCH_ID` (API only); uploads answer 503
  until set, as thedao-rfps does without `PINATA_JWT`.
- **Patterns to avoid**: storing the pitch text on-chain; trusting the node's returned
  reference without checking it matches what the chain later stores; rendering
  proposal content as raw HTML; a postage batch id in any `VITE_` variable.

### Verification

- [ ] `propose`, `acceptProposal`, `rejectProposal` have unit tests including the
      phase checks and that acceptance creates a project with the stored cost and
      recipient.
- [ ] Submitting from the frontend on Arc testnet stores a reference that the project
      page resolves to the submitted content.
- [ ] Editing the content changes the reference; the project page shows the on-chain
      one only.
- [ ] The README lifecycle table includes the proposal stage.
- [ ] `deno task test:api` covers the upload route with a fake Bee.

## Pros and Cons of the Options

### Swarm through the API

- Good, because reference equals hash; one word on-chain; secrets stay server-side.
- Bad, because postage stamps and node availability are operational questions.

### IPFS through Pinata from the API

- Good, because it is the house precedent with working code to copy.
- Bad, because a CID does not fit in `bytes32` without stripping the multihash
  prefix, and it is not the decision-maker's stated choice.

### Swarm from the browser

- Good, because it needs no API route.
- Bad, because the batch id or a stamping gateway's credentials reach the browser.

### Content on-chain, or an off-chain database

- Bad, because gas per proposal, or a server that owns the content.

## More Information

- Editing update (2026-09-12): Sem requested that both the proposer and admin may
  edit during review. `PoolBase.editProposal` now permits the original proposer and
  current owner to revise pending content and terms without changing authorship.
  Revision counters and `ProposalEdited` events preserve edit attribution and prior
  references. Saves and review decisions require the revision being edited/reviewed
  to reject concurrent changes; decisions still lock proposals. The form in
  `web/app/routes/proposal-editor.tsx` retains existing attachments and supports
  adding/removing files, upload/signature retry and conflict recovery. This resolves
  the earlier open question about edits before acceptance. Private encryption and
  voting-time release were researched separately and remain unimplemented; current
  uploads and revision history are public.

- Implementation verification (2026-09-12): shared proposal contract tests cover
  permission checks, deadlines, final review decisions, immutable terms, failed
  acceptance rollback, all pool variants, and voting/payout of an accepted project.
  Frontend tests cover arbitrary text/files, safe display, and a real local-chain
  submission/review flow with a fake Swarm transport. Live Swarm upload verification
  requires an identity with available storage.

- Personas: Proposer Pau in `docs/design/personas.md`; story map activity 1.
- Reference: `/home/sem/Projects/fund/thedao-rfps/web/api/services/pinata.ts` and
  `api/routes/uploads.ts` for the upload route's shape.
- Open for R2: who pays for postage, and whether proposals can be edited before
  acceptance.
- Supersedes the same-day proposal "Store proposal content in Swarm and bind its hash
  on-chain", withdrawn before acceptance.


