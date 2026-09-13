---
status: accepted
date: 2026-09-13
decision-makers: Sem
---

# Encrypt proposals through private review

## Context and decision

Sem requested proposal text and arbitrary attachments that only the original proposer
and organizer can read and edit during review, followed by public access to accepted
final revisions when voting opens. Sem approved publishing the organizer's encryption
public key for the round on-chain and keeping the proposer's public key in Swarm
metadata bound by their submission transaction. This record captures that approved
design and supersedes the public-upload decision of 2026-09-12.

The browser uploads directly through the existing `@snaha/swarm-id` dependency.
Each round deploys a fixed `ProposalPrivacy` companion, discoverable through
`PoolBase.proposalPrivacy()`. The organizer registers their Swarm ID sharing public
key there with their owner wallet. It is locked after the first proposal, including
public proposals, so a round cannot silently change recipients or retrofit privacy.
The key is distinct from the Ethereum account address and the postage signer.

Each revision uses a fresh random 256-bit AES-GCM key and 96-bit nonce. The associated
data binds the encrypted JSON to its chain, pool and original proposer. ACT (Swarm's
Access Control Trie) encrypts that revision key for the proposer and organizer.
The public descriptor is version 2 and contains the ciphertext reference, nonce,
chain/pool/proposer, both sharing public keys, `keccak256(key)`, and the ACT-protected
reference, history reference and publisher public key. It contains no proposal text,
file names, raw document key or ordinary key-bearing encrypted Swarm reference to
the proposal or its document key.

An ordinary public 32-byte Swarm address identifies the descriptor and fits the pool's
`contentRef`. `propose(contentRef, keyHash, cost, recipient)` authenticates its binding
to the wallet. `editProposal(id, expectedRevision, contentRef, keyHash, cost, recipient)`
preserves authorship and changes the key commitment. Both editors preserve the
proposer public key from the existing descriptor. ACT access and contract write
authorization are separate: a connected storage identity does not authorize an edit.

Attachments have independent random AES-GCM keys and nonces. Their ciphertext is
uploaded with a generic filename; original names, types, sizes and keys live inside
the encrypted proposal. A retained attachment keeps its key, while a removed
attachment's key is excluded from subsequent revisions. Existing public references
cannot be reused as supposedly private attachments.

Acceptance freezes the exact revision and records its voting project without exposing
the key. The organizer's browser prepares publication by downloading/decrypting all
accepted final revisions locally. A second, explicitly labeled action sends their
keys to `ProposalPrivacy.openVoting(ids, keys)`. It checks the complete ordered
acceptance list and each key commitment, publishes the keys, and calls the pool's
`openVoting()` atomically. The pool's original entry point cannot bypass publication.
Pending or rejected proposals are excluded and cannot prevent opening voting.

Public project pages, ballot titles, API snapshots and build-time metadata use only
keys released on-chain. API caches distinguish an unpublished reference from the
same reference with its published key. The API never obtains ACT credentials or
decrypts review content. Browser submission recovery persists public descriptor,
commitment, terms and transaction hash; private titles, drafts and keys stay in memory.

## Alternatives and constraints

- Plain Swarm encryption with a secret reference needs a safe way to distribute that
  reference. Publishing its key-bearing form would make review public immediately.
- ACT on the whole proposal protects review well, but the current client download API
  returns plaintext and does not offer a general public-unlock operation. Reuploading
  a public copy before opening voting exposes it early and changes the content reference.
- ACT-wrapped per-revision AES keys preserve a single accepted descriptor, allow
  public readers without Swarm ID after release, and isolate earlier revisions.

No new dependencies or server secrets are introduced. Existing Web Crypto and Noble
implementations provide encryption and compressed-public-key validation; cryptographic
primitives are not reimplemented. The companion keeps all four pool variants within
EIP-170. Its address is set once in constructor storage; there is no replacement method.

## Limits and migration

- This requires new pool deployments. Older pools remain readable; the frontend blocks
  new uploads when private review is unavailable or the organizer key is unregistered.
  Newly deployed pools without a registered key retain an explicit zero-commitment
  public proposal API for tooling, but the frontend never falls back to public upload.
- Keys in a broadcast transaction can be read from the mempool or a reverted
  transaction. Publication is intentional from send time, not guaranteed to begin
  at the confirmed block boundary. The publication button explains this. No timed
  cryptographic release service or background publisher is introduced.
- Authorized readers can copy or disclose content. Access cannot be revoked
  retroactively. Previously uploaded public Markdown files remain public.
- The organizer must retain the registered Swarm identity, including after an owner
  wallet transfer. Key rotation after submissions, account recovery, private comments,
  hiding on-chain submission metadata and storage sponsorship are out of scope.
- Only the final accepted revision's key is released. Its retained attachments become
  public too. Earlier texts and removed attachments keep independent keys.
- No automatic migration, funding, production deployment or live uploads are part of
  this implementation. Postage expiry remains the account holder's responsibility.

## Implementation and verification

Affected paths: `src/PoolBase.sol`, `src/ProposalPrivacy.sol`, `web/app/lib/private-proposals.ts`,
`proposal-publication.ts`, proposal ABIs/hooks, submit/review/setup/vote/project routes,
the API content resolver and snapshot service, and build-time project metadata.
Reuse the existing controls and presentational components; preserve literal text
rendering, safe downloads, preview limits and stale-revision guards.

- [x] Contract tests cover registration, key locking, edit/review authorization,
      commitments, acceptance without disclosure, rejected/pending exclusion,
      failed publication rollback and the complete accepted-list check.
- [x] Real AES-GCM tests cover both reviewers, unauthorized access through an ACT test
      double, ciphertext tampering, context binding, fresh revision keys and attachments.
- [x] Browser/local-chain workflow covers encrypted submission, retry recovery,
      proposer and organizer edits, acceptance/rejection, and setup publication.
- [x] Public API tests keep private content unavailable before release and resolve the
      same reference after its key is published, without serving stale private cache data.
- [x] Frontend typecheck/build, API typecheck/tests, applicable Solidity tests and
      all production contract size limits pass.

Verified locally on 2026-09-13: 314 Forge tests, 108 Vitest tests and 73 Deno API
tests passed. Frontend and API typechecks, API lint and the production build passed.
The largest pool runtime, `NoirRankedShares`, is 24,504 bytes against EIP-170's
24,576-byte limit. Browser workflow tests execute the contracts on local Anvil and
use real Web Crypto encryption with a simulated Swarm transport and ACT access
checks. A live Swarm ID upload/share/download round trip has not been run; these
checks do not establish production service availability or replace that integration
check before deployment.

## Integration correction — 2026-09-13

Swarm ID 0.4.0 encrypts ACT history manifests by default and returns a 128-character
`historyReference`. Applying the 64-character on-chain reference validator to this
field incorrectly rejected successful ACT uploads. Both ACT references now retain
their full 64- or 128-character values in descriptor metadata; only the public
descriptor address is constrained to `bytes32`. The history reference's embedded
key opens ACT metadata, whose access keys remain encrypted for the reviewers. It
does not reveal the proposal's document key.

The transport test double now models the SDK's default encrypted references and
requires the complete history reference on download. Regression coverage includes
encrypted upload, both reviewers' access, outsider denial, publication, legacy
64-character ACT metadata, malformed metadata, and keeping 128-character references
out of the on-chain and proposal payload address fields.

The updated fixture reproduced the reported frontend error before the fix. After
the fix, 21 targeted frontend/workflow tests and 9 API content tests passed, along
with the frontend typecheck and production build.

Sources: [Swarm ACT](https://docs.ethswarm.org/docs/concepts/access-control/) and
[Swarm ID API](https://swarm.snaha.net/docs/api/#act-methods).
