# Arkiv feedback — RankedShares

Recorded on 2026-09-13 (Europe/Madrid), while integrating Arkiv into public,
Noir, CRE and ZisK voting pools. This is a local feedback report for the hackathon
submission. It has not been sent through the MCP or submitted to the organizers.

## Environment and evidence

- Arkiv TypeScript SDK **0.8.0**, viem **2.56.3**, Tiramisu **7738577**.
- React 19 / React Router 7 frontend, Solidity 0.8.28 contracts, a browser/Node
  prover reader, and a Chainlink CRE workflow compiled to WASM.
- Surfaces used: the TypeScript SDK and its source, official documentation,
  ETHRome Hub instructions, the Arkiv ETHRome documentation MCP, and public RPC
  reads. We have not evaluated faucet onboarding, explorer UX or production load.
- The original integration at commit `d51466d` passed 416 local tests across the
  contracts, frontend, CRE and prover. The frontend tests use a simulated Arkiv
  transport and real local EVM transactions; they do not prove live Arkiv writes.
- A read-only SDK query reached Tiramisu and returned the expected chain ID and
  an empty result for the selected schema. That establishes connectivity and that
  query's execution, not funded publication, expiry or a deployed end-to-end demo.
- Source-level observations and design requests below are identified separately
  from reproduced behavior. No live multisig, permission or EEZ transaction was
  attempted.
- Retention follow-up: all **48 frontend tests** passed, including 12 dedicated
  expiry/review tests and the rendered voting flow extended through finalization
  and simulated natural expiry. Typechecking and the production frontend build
  also passed. A live read-only query selecting `key`, `payload` and `expiresAt`
  at Tiramisu block **373814** returned that same block and zero rows for an unused
  key. This verifies the query shape and block pinning, not a live expiry event.

## Application context

Proposal documents stay on Swarm. Each Arkiv ballot has raw public ranks or
encrypted bytes, plus indexed attributes identifying the pool network, pool,
voter, mode and revision. The EVM pool authorizes the vote and commits to the
entity key and payload hash. The frontend reads accepted ballots and computes
provisional public results; the pool records the final funded order.

Code: [ballot publisher](../web/app/lib/arkiv.ts),
[canonical reader](../prover/src/core/arkiv.ts),
[contract references](../src/ArkivBallots.sol), and
[architecture decision](../docs/decisions/2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md).

## What worked well

**Agent observations, supported by local integration tests and source inspection.**

Typed attributes make the ballot model explicit, while the opaque payload lets us
reuse the existing encryption formats. Query pagination is available in the SDK;
we can resolve accepted references without introducing a separate indexer. The
Ethereum transaction/receipt model also fits our viem tooling. Saving transaction
hashes before waiting for receipts makes the two-network voting flow resumable.

The ETHRome MCP was useful for finding the current missions, distinguishing old
event instructions from current guidance, and pointing out SDK-specific behavior.
Its distinction between documentation examples and executed checks is valuable.

## Smart-contract ownership and permissions are a major design limitation

**Developer feedback, with the platform constraint confirmed in documentation.**

Not having smart contracts limits the application design substantially. We want a
DAO's contract-based multisig to own its entities, assign different permissions
to publishers and maintainers, and enforce a lifecycle without handing control to
one ordinary signing account.

Arkiv's documented engine does not execute EVM bytecode. Consequently, a Safe-style
multisig cannot simply be deployed there to authorize entity operations. Assigning
an owner address is not equivalent to making that contract's authorization logic
executable. This observation does not rule out an external threshold-signing
service that presents a normal signing account.

The documented owner model also does not give us arbitrary roles such as “may
publish ballots,” “may extend retention until finalization,” and “may never delete
accepted ballots.” `readonly` protects contents, but the owner can still delete,
transfer or extend. Permissionless extension gives everybody extension authority;
it cannot express our round's rules.

**Impact:** ownership and authorization must be split between the EVM pool and
Arkiv. A multisig governing the pool does not automatically govern the data in the
same way. Retention and availability need additional application coordination.

**Requested improvement:** contract-wallet authorization, native multisig support,
or a documented permission mechanism with scoped and revocable capabilities.
A worked DAO ownership example would help even if the intended solution does not
involve general-purpose contracts.

Sources: [Arkiv architecture](https://docs.arkiv.network/start-here/fundamentals/#a-chain-with-a-database-engine-instead-of-the-evm)
and [ownership and creation flags](https://docs.arkiv.network/typescript-sdk/mutating-data/#fix-properties-at-creation-with-flags).

## Retention relative to a later application event is difficult

**Agent observation of documented behavior and developer product requirement.**

Our initial requested feature was a limited ballot-review period after the final tally.
The completion time is unknown when voters first publish their ballots.
An expiry can move later, but cannot move earlier, so we cannot initially choose
a conservative long lifetime and then reduce it when tallying finishes.
Expiry helpers use nominal two-second blocks, which also means a duration in days
is an estimate rather than an exact wall-clock cutoff.

**Minimal design reproduction:** create a ballot with a 30-day lifetime; finalize
its round the following day; try to express expiry 15 days after that finalization.
The desired target is earlier than the existing expiry and is disallowed by the
documented rules. This is a documented restriction, not a failed transaction we
have reproduced on Tiramisu.

**Impact:** applications must choose between a deadline known in advance,
coordinated short leases, and new review records created after finalization.
Letting anybody extend also prevents a guaranteed cutoff. Changing that flag to
false limits extension to the owner but does not remove the owner's authority.

**Requested improvement:** a lifecycle recipe for retention measured from an
external event, including delayed finalization and signer/owner coordination;
ideally a permission policy that can enforce a final expiry.

**Chosen application workaround:** the developer selected expiry 15 days after the
voting deadline instead. This avoids creating duplicate review records or adding
an extra publication step. The new publisher uses the Arkiv head timestamp to
calculate the target block; it does not trust the browser's clock. Owners can still
extend, and already-published records retain their original longer lifetime.

Source: [expiry rules and extension](https://docs.arkiv.network/typescript-sdk/mutating-data/#expiry-rules).

## Natural expiry needs explicit handling in clients

**Agent observation of the SDK and documentation.**

SDK 0.8.0 does not provide an `onEntityExpired` event. A natural expiry makes an
entity unavailable to normal queries; `EntityDeleted` represents an explicit
deletion. Our UI therefore needs to distinguish actual expiry from RPC errors,
missing data and stale cached results. A browser countdown alone does not prove
the network has expired a record.

**Requested improvement:** a first-party React example that tracks expiry heights,
clears cached payloads and reconciles extensions and reconnects. It should clearly
separate expiry observation from the entity-change WebSocket stream.

Our review view now checks live entities at one Arkiv block and removes missing
payloads from its displayed state. It preserves only the last observed expiry
metadata for classifying absence, and reports unknown absence separately from a
passed expiry. It cannot prove that a fresh browser's missing entity expired
rather than being deleted. Tally witness recovery is separate from this view.

Source: [Arkiv live events](https://docs.arkiv.network/typescript-sdk/live-events/).

## Cross-network publication creates a second confirmation step

**Observed in the implemented flow and local tests.**

A voter signs an Arkiv write, switches network, then signs the pool transaction.
The Arkiv upload may succeed while the vote is rejected, delayed or superseded.
We journal the hashes and resume confirmation, rather than assuming an upload is
an accepted vote. The pool's current reference and hash remain authoritative.

**Impact:** more wallet prompts, two fee balances and orphaned uploads. The second
transaction still carries the ballot bytes so the contract can validate them.
The reader can recover a direct-wallet ballot from that calldata if Arkiv is
unavailable. Thus expiration is not a promise of erasing every historical copy.

**Requested improvement:** an official cross-chain write/acceptance recipe showing
partial success, retries, account changes and how to authenticate Arkiv data from
an application contract.

## Ethereum Economic Zone would be a valuable addition

**Developer proposal; not an existing or verified Arkiv integration.**

Ethereum Economic Zone (EEZ) support would be a major addition to the network.
The useful capability is synchronous composability: an application on a
participating blockchain could request specific Arkiv data, receive an
authenticated response and use it within the same transaction.

For RankedShares, this could remove redundant ballot copies. A voting or tally
contract could obtain the committed ballot from Arkiv during transaction
execution instead of requiring a caller to resubmit the payload. Before our Arkiv
migration the contract stored ballot bytes; the current implementation removes
that payload storage, but still duplicates the bytes in transaction calldata.
The opportunity is to avoid both forms of duplication where the execution and
availability guarantees support it. Accepted revisions, hashes and voting rules
would still need an authoritative representation.

Gnosis describes EEZ's goal as atomic calls between Ethereum and participating
rollups. Applying it to Arkiv would additionally require Arkiv participation and
an authenticated, callable query interface. An arbitrary HTTP/RPC query does not
become safe for contract execution just because a chain joins EEZ. Expiration,
snapshot consistency, query limits, fees and failure handling would need defined
execution semantics.

**Requested improvement:** explore an EEZ-compatible Arkiv query primitive or
adapter, with an example of an EVM contract consuming a specific entity in the
same atomic transaction. This is a request for future capability, not a claim
that every blockchain or existing Arkiv endpoint supports it today.

Reference: [Gnosis — Why we are building EEZ](https://www.gnosis.io/blog/we-re-building-the-ethereum-economic-zone-heres-why).

## Submission evidence still needed

Before claiming a mission is complete, attach a public deployment and actual
Tiramisu transaction/entity references. For natural expiry, record the applied
expiry block, the same query before and after expiry, and the resulting UI change.
Local simulated transport tests do not replace that live evidence. No personal
information, private keys or credential-bearing RPC URLs belong in this report.
