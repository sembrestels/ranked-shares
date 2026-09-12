---
status: accepted
date: 2026-09-13
decision-makers: Sem
---

# Store ballots in Arkiv and calculate live results in the browser

## Context and decision

Sem requested Arkiv ballot storage for **all pool implementations**, with live
public results calculated in the frontend. Proposal documents already use
[Swarm ID](2026-09-12-upload-proposal-content-from-the-browser-through-swarm-id.md).
They remain there; accepted project IDs, costs and recipients remain on the pool.
This records the implementation requested in that conversation. It supersedes the
live-result/snapshot calculation part of the
[Deno API decision](2026-09-12-serve-the-site-and-a-deno-api-from-one-deno-deploy-app.md).
There is no result-snapshot service or Arkiv result entity.

New contracts offer owner-only `enableArkivBallots()` during Setup, before the
deadline. A round cannot change its storage mode once voting opens. Keeping legacy
mode makes existing integrations and test fixtures usable; deployed contracts are
immutable and cannot be upgraded by this change. This is a migration path for new
rounds, not a rewrite of historical votes or a transfer of existing pool funds.

An Arkiv entity contains one raw ballot, with typed attributes for schema version,
pool chain, pool address, voter, pool kind, public/sealed mode, revision, project
count, and payload hash. Public ranks are one byte per project; sealed payloads keep
the existing Grumpkin encoding (Noir) or SEC1/ECDH encoding (CRE and ZisK). Only
ciphertext and public metadata leave the browser for a sealed vote.

The pool stores the accepted entity key, `keccak256(payload)`, revision and vote
block. The voter uploads, verifies the payload and its indexed attributes, then
calls `voteArkiv` or `voteSealedArkiv`. The contract validates the bytes in calldata
but does **not** persist them in ballot storage. Thus the original vote transaction
also contains the payload. Arkiv is the normal query/read layer, not the exclusive
data-availability layer; this change does not promise cheaper transactions or
removal of historical ballot data. The contract does not attest Arkiv availability
or the entity's metadata. Its hash and voter authorization are authoritative.

The frontend reads a complete roster at one pool block and resolves only its current
references. It checks every payload hash, preserves roster order (integer deductions
depend on it), and runs `shared/pbear.ts`. It refreshes every 15 seconds. A public-only
projection excludes encrypted rankings and is explicitly provisional. Once on-chain
public tallying starts, it shows the pool's progress rather than replaying already
reduced weights. Final proof/attestation checks are unchanged.

## Alternatives and consequences

- **Keep all bytes in contract storage:** one transaction and simpler availability,
  but no Arkiv ballot queries and persistent per-voter payload state.
- **Use Arkiv references without calldata validation:** smaller pool transactions,
  but accepting malformed ballots and losing data can strand a tally. We retain
  validation and transaction recovery instead.
- **Store aggregated snapshots after every vote:** cheaper result reads at scale,
  but adds a writer, freshness rules and another result to trust. The user chose
  browser calculation for this version; reads and computation scale with voters.

Two networks and wallet transactions are required. Arkiv Tiramisu (7738577) uses
testGLM, while the pool retains its configured EVM network. The UI records hashes as
soon as they are returned and can resume receipt/confirmation checks. An upload
without an accepted pool transaction is not a vote. Discarding a draft neither
cancels a transaction nor deletes its Arkiv entity.

Entities are created readonly, with permissionless expiry extension, for the round's
deadline plus its abandon grace plus thirty days (at least thirty days). Expiry is
measured in Arkiv blocks and is approximate in wall time. Readonly does not prevent
an owner deleting an entity. The browser and Noir prover can recover direct wallet
votes from `BallotStored` in the recorded block and verify the original transaction
payload. Smart-account/wrapper transactions require an external payload archive if
Arkiv becomes unavailable. Missing accepted bytes are errors, never abstentions.
The CRE workflow uses DON HTTP reads; if Arkiv is unavailable it retries on later
runs. The existing proof/abandon paths remain available.

Public ballots retain each pool's semantics: replaceable in `RankedShares`, final
in the three sealed variants. Encrypted seat ballots remain replaceable. Ballot
references use an expected revision to reject concurrent replacements. No plaintext
sealed ranks, ephemeral scalar, secret key or signature is persisted in the draft.

## Implementation and migration

- `src/ArkivBallots.sol`, `PoolBase.sol`, `RankedShares.sol`, `SealedPool.sol`, and
  `noir/NoirRankedShares.sol`: opt-in reference storage and validated witness APIs.
- Public tally: `startTally()`, then `runArkiv(maxSteps, ballots)` with the full roster.
  Sealed tally: `closeArkiv(expectedCursor, BallotData[])` with the next contiguous
  range. CRE report kind 3 carries that same cursor and witness range. Legacy
  `close`/ballot getters reject Arkiv mode rather than return misleading empty data.
- `cre/src/lib/arkiv.ts` defines the wire format and pure checks;
  `prover/src/core/arkiv.ts` supplies browser/Node reads and transaction recovery.
  The CRE workflow uses its synchronous HTTP capability, never native `fetch`.
- `shared/ranks.ts` and `shared/pbear.ts` are the single ranking/tally implementation
  used by the browser, CRE and prover. Cryptographic and proof formats are unchanged.
- `web/app/lib/arkiv.ts`, `ballots.ts`, and `/vote`: SDK 0.8.0, Noble 2.4.0,
  Poseidon2 0.6.2; explicit pool network reads, wallet checks and resumable drafts.
- `foundry.toml` compiles Noir and its importers with IR to fit EIP-170. Generated
  verifier artifacts are built separately with their existing compiler settings.
- Deploy new contracts, configure `VITE_POOL_ADDRESS`/pool network, optionally set
  `VITE_ARKIV_RPC_URL` to another Tiramisu endpoint, then have the owner enable Arkiv
  before opening voting. No automatic production deployment or historical backfill.

## Verification

- [x] Solidity fixtures preserve commitments, funded orders and existing real proofs.
- [x] Missing, altered, stale and out-of-order witnesses fail; revisions/counts match.
- [x] Browser encryption matches the Python SEC1/ECDH vectors.
- [x] Read pagination and hash checks preserve canonical ballots, including all-zero ranks.
- [x] Rejected/interrupted confirmation retains the draft and does not resend a known transaction.
- [x] CRE reads reconstruct the fixture and produce the same tally; kind 3 closes Arkiv rounds.
- [ ] Live end-to-end signing with a funded Tiramisu wallet and a deployed pool.

## References

- [ETHRome hacker manual](https://www.ethrome.org/hackermanual)
- [Arkiv SDK source, version 0.8.0](https://github.com/Arkiv-Network/arkiv-sdk-js)
- [Foundry compiler profiles](https://getfoundry.sh/reference/config/solidity-compiler)
