---
status: accepted
date: 2026-09-13
decision-makers: Sem
---

# Cast contributions and ballots together; sync Arkiv afterwards

Sem rejected the four-transaction voting flow and explicitly chose a new flow,
ignoring existing pools. This supersedes the voter-upload and explicit-confirmation
steps in [the earlier Arkiv decision](2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md).
It preserves Arkiv storage, browser encryption, pool authorization, and the tally rules.

The user ranks proposals, chooses a contribution, and presses **Contribute and vote**.
New pools expose `castBallot(amount, isSealed, payload, expectedRevision, permit)`.
It deposits tokens and validates/registers the ballot atomically. A rejected ballot
reverts the deposit, weight, and any permit used in that transaction. Amount zero
uses existing weight. Sponsored encrypted ballots require amount zero.

The browser uses an existing allowance or an EIP-2612 signature whose domain matches
the token's on-chain DOMAIN_SEPARATOR. The signature is not a transaction and is
not saved in the draft. Unsupported tokens need an approval transaction followed
automatically by the combined vote. No network switch to Arkiv or testGLM is required
from the voter. A permit rejected by the user does not fall back to a paid approval.

The accepted `BallotRef.entityKey` for this entry point is a deterministic **ballot ID**,
not a native Arkiv entity key. It is keccak256(abi.encode(chainId, pool, voter,
isSealed, revision, keccak256(payload))). `BallotPublished` emits the accepted bytes
and ID. Public votes contain public ranks; encrypted votes contain only ciphertext.
The event also permits witness recovery for smart-wallet calls when Arkiv is unavailable.

A funded operator runs `cre/scripts/sync-ballots.ts --pools <addresses> --watch`.
The worker only reads the configured pools' accepted references, verifies emitted
payloads against their hashes and IDs, and creates readonly Arkiv entities carrying
the same typed ballot metadata plus `ballot_id`. It journals signed transactions
before broadcasting and resumes the same transaction after interruptions. Storage
expires approximately 15 days after the pool deadline. The operator can extend or
delete its entities; event history remains available. Running the worker is an
operational requirement, and the UI reports storage separately from vote acceptance.

Browser, prover, review, and CRE readers resolve a native key or `ballot_id`. An alias
is accepted only if its typed context and payload reproduce that ID. An uploader
cannot replace an accepted ballot by forging metadata. The pool reference remains
authoritative. Live public results and Noir witness recovery use the accepted event
while storage is catching up; CRE reads retry until the worker has indexed the data.

We rejected hiding four transactions behind a button, which does not reduce wallet
transactions. We also rejected requiring wallet-specific batching or making Arkiv
availability a prerequisite for recording a vote. Existing upload-first entry points
remain for historical integrations, but the new frontend uses the combined method.
No deployed contracts or historical votes are migrated by this code change.

## Implementation and verification

- PoolBase and all concrete pools: combined atomic entry point, exact permit allowance,
  deterministic ID and accepted-payload event; preserve final public ballots and
  replaceable encrypted ballots in sealed pools.
- Frontend: one submission action, exact amount validation, chain/account checks,
  persistent transaction hashes, receipt-only resumption, asynchronous storage status.
- Storage worker: allowlisted pools, durable signing journal, read-back verification.
- Shared Arkiv readers: authenticated aliases and event recovery; review still only
  displays live entities and never reconstructs expired data.
- Test permit execution/front-running, invalid ballots and rollback, insufficient funds,
  finality, replacements, single-transaction UI, interrupted receipts, forged aliases,
  storage retry, contract sizes, deployment artifacts, and existing tally/proof suites.

Constructor-only Noir proof/configuration values use storage without setters to keep
runtime code within EIP-170. Forwarder/workflow authentication values are also constructor-only, with no setters. Noir and
liquidity CRE use the size-oriented IR compiler profile. This trades read gas for
runtime size; deployment checks must enforce the 24,576-byte limit.
