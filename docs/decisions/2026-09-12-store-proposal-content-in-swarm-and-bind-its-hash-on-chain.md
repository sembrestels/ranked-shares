---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Store proposal content in Swarm and bind its hash on-chain

## Context and Problem Statement

Today a project is a cost and a recipient address, added by the pool owner. The pitch
lives wherever the organiser collected it, and donors never see it from the round. The
personas and story map need a proposer to submit through the frontend, an organiser to
accept, and a project page that shows the pitch. Where does the proposal content live,
and how does the chain refer to it?

The decision-maker stated the direction on 2026-09-12: a submit form in the frontend,
content in Swarm, its hash stored on-chain, acceptance by the organiser. This record
writes that down with the alternatives, so that it can be accepted or revised, and
gives the contract and frontend changes it implies.

## Decision Drivers

- The pitch must be readable from the project page by anyone, with no server of ours.
- The chain must bind a project to exactly the content the proposer submitted, so the
  organiser cannot swap it and the proposer can verify it.
- Proposers submit themselves; the organiser accepts or rejects; the accepted project
  is what `addProject` creates today.
- Hackathon scope: one contract addition, one upload path, no indexer.

## Considered Options

- Swarm for content, its reference stored on-chain as `bytes32`, acceptance by the owner
- IPFS for content, a CID stored on-chain
- Content on-chain as a string or as calldata in an event
- An off-chain database with the hash on-chain

## Decision Outcome

Chosen option: "Swarm for content, its reference stored on-chain, acceptance by the
owner". A Swarm reference is the content's hash, so storing the reference is storing
the commitment: the project page fetches the content by reference from a Bee gateway
and needs no second hash check. Swarm is the decision-maker's stated choice; IPFS is the
closest alternative and would work the same way with a CID.

### Consequences

- Good, because the proposal is content-addressed: the on-chain word is both the
  pointer and the proof.
- Good, because the frontend has no backend; upload goes to a Bee gateway, read comes
  from a Bee gateway.
- Bad, because uploading to Swarm needs a postage stamp; someone funds the batch. For
  the demo, a gateway that stamps uploads or a batch owned by the team; for R2, this is
  the organiser's cost and needs a decision.
- Bad, because content availability depends on the swarm keeping it; a pinned
  reference on a team-run node covers the demo.
- Neutral, because the contract gains a proposal stage before setup completes; the
  lifecycle table in the README grows by one phase.

## Implementation Plan

- **Affected paths**: `src/PoolBase.sol` (proposals), the three pool variants only
  through `PoolBase`, `test/` (proposal tests), `README.md` (lifecycle table),
  `frontend/src/` (submit form, organiser review, project page).
- **Contract**: in the Setup phase, `propose(bytes32 contentRef, uint256 cost, address
  recipient) returns (uint256 proposalId)` open to anyone, storing `{proposer,
  contentRef, cost, recipient, status}` and emitting `Proposed`; owner-only
  `acceptProposal(uint256 id)` calls the existing `_addProject` path with the
  proposal's cost and recipient and stores the reference on the project, emitting
  `ProposalAccepted(id, projectId)`; owner-only `rejectProposal(uint256 id)` emitting
  `ProposalRejected`. `addProject` stays for rounds without submissions, with
  `contentRef` optional. Projects expose `contentRefOf(projectId)`.
- **Frontend**: the submit form serialises `{title, summary, body, links, cost,
  recipient, version}` as JSON, uploads it to the configured Bee gateway, and submits
  the returned reference with cost and recipient in one transaction; the project page
  and the organiser's review fetch by reference and render the JSON, treating it as
  untrusted text (no HTML).
- **Dependencies**: `@ethersphere/bee-js` in the frontend, pinned.
- **Configuration**: `VITE_BEE_GATEWAY_URL`; for uploads, either a gateway that stamps
  or `VITE_BEE_POSTAGE_BATCH_ID` for a team-run node.
- **Patterns to avoid**: storing the pitch text on-chain; trusting the gateway's
  response without checking that the returned reference matches the on-chain word;
  rendering proposal content as HTML.

### Verification

- [ ] `propose`, `acceptProposal`, `rejectProposal` have unit tests including the
      phase checks and that acceptance creates a project with the stored cost and
      recipient.
- [ ] Submitting from the frontend on Arc testnet stores a reference that the project
      page resolves to the submitted content.
- [ ] Editing the content changes the reference; the project page shows the on-chain
      one only.
- [ ] The README lifecycle table includes the proposal stage.

## Pros and Cons of the Options

### Swarm with the reference on-chain

- Good, because reference equals hash; one word on-chain.
- Good, because it is the decision-maker's stated choice and fits a no-backend site.
- Bad, because postage stamps and gateway availability are operational questions.

### IPFS with a CID on-chain

- Good, because pinning services are plentiful and CIDs are widely understood.
- Bad, because a CID does not fit in `bytes32` without stripping the multihash
  prefix, and pinning is a paid service either way.

### Content on-chain

- Good, because availability equals the chain's.
- Bad, because a pitch of a few kilobytes costs real gas on every proposal and
  bloats the contract's storage or logs.

### Off-chain database with the hash on-chain

- Good, because it is the simplest to build.
- Bad, because it requires a server we said we would not run, and the content
  disappears with it.

## More Information

- Personas: Proposer Pau in `docs/design/personas.md`; story map activity 1.
- Open for R2: who pays for postage, and whether proposals can be edited before
  acceptance (a new reference, a new proposal id, or a replace call).
- Revisit if the site itself moves to Swarm, in which case the gateway becomes the
  site's host too.
