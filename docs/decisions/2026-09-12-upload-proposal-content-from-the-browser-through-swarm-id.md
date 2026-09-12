---
status: accepted
date: 2026-09-12
decision-makers: Sem
---

# Upload proposal content from the browser through Swarm ID

## Context and Problem Statement

The same-day record "Store proposal content in Swarm through the API and bind its
reference on-chain" proposed an API route holding a postage batch. Before that record
was accepted, the decision-maker requested, in a parallel session, that uploads go
through Swarm ID, the identity service that holds the proposer's own storage
credentials in its trusted domain. That request was implemented and merged to master
in commit b5cef88 (`web/app/lib/swarm.ts`, `web/app/routes/submit.tsx`,
`web/app/routes/setup.tsx`, `src/PoolBase.sol`, `test/Proposals.t.sol`) with proposer
and owner editing of pending proposals under revision checks. This record states the
decision as built so that the earlier record can be marked superseded rather than
edited.

## Decision Drivers

- No server secret: the postage batch belongs to the proposer, managed in Swarm ID.
- No upload API: the frontend stays a static build for this flow.
- The reference must still fit `bytes32` and bind exactly the submitted content.
- Proposers and the organiser can edit while pending without overwriting each other.

## Considered Options

- Swarm ID from the browser, the proposer's own storage (chosen)
- Swarm through the API with a team-held postage batch (the earlier record)
- IPFS through Pinata from an API (the thedao-rfps precedent)

## Decision Outcome

Chosen option: "Swarm ID from the browser". The public manifest
`{version: 1, title, body, attachments}` is uploaded unencrypted with `uploadData` so
its 64-hex reference fits `bytes32`; attachments are uploaded with `uploadFile` and
referenced from the manifest. `propose(contentRef, cost, recipient)` is open to anyone
in Setup; `editProposal(id, expectedRevision, …)` is allowed to the original proposer
and the current owner while pending; `acceptProposal(id, expectedRevision)` and
`rejectProposal(id, expectedRevision)` are owner-only and lock the proposal. Stale
saves and decisions revert.

### Consequences

- Good, because the frontend holds no secret and needs no API for this flow.
- Good, because content is content-addressed and revisions are attributed on-chain.
- Bad, because a proposer needs a Swarm ID with storage before submitting; the submit
  page must say so before the form, and the demo needs funded identities.
- Bad, because uploads and every revision are public, including rejected ones;
  encrypted private review is not implemented.
- Neutral, because the API record of the same date keeps its other duties (round
  snapshot, LP positions); only its proposal upload route is dropped.

## Implementation Plan

Implemented. Remaining items are stories S1.1 and S1.8 in
`docs/design/stories/01-propose-a-project.md` and the R2 items in the story map.

### Verification

- [x] 267 contract tests and 20 web tests pass on master at b5cef88 (per the commit).
- [ ] A live upload and retrieval with a funded Swarm ID on Arc testnet.

## More Information

- Supersedes: "Store proposal content in Swarm through the API and bind its reference
  on-chain" (2026-09-12).
- Documentation: `web/README.md`, README section "Proposals and Swarm ID".
