# Public tally provisioning protocol

The browser integration is implemented in `app/lib/round-configuration.ts` and
`app/lib/round-deployment.ts`. This repository does **not** currently run a service
implementing this protocol or contain live Arc tenant credentials. Configuring a URL
alone does not create a CRE workflow, prover, or monitoring service.

Set `VITE_TALLY_SERVICE_URL` to the operator's public HTTPS base URL (HTTP is allowed
only on localhost). The service must permit the app origin via CORS. Requests omit
cookies and use JSON, a 15-second timeout, and no browser-held API secret. Apply
appropriate abuse controls at the service. Never put tally masters, private keys,
privileged credentials or secret responses in `VITE_` variables, the response, or logs.
The organizer supplies no service addresses or cryptographic configuration.

## Build identity

All requests carry `chainId` (JSON number), `contract`, `buildId`, and `profileId`.
The contract is one of `CreRankedShares`, `NoirRankedShares`, `ZiskRankedShares`, or
`LPCreRankedShares`. The service echoes the identity exactly, and must check that it
actually supports the requested chain/build before reporting readiness.

`buildId` is keccak256 of the bundled round creation bytecode. `profileId` is derived
by `buildIdentity()` from the ordered dependency runtime hashes, the relevant
proof source hashes/profile, LPVoting creation-bytecode hash if applicable, and
recovery policy. The implementation and checked-in `app/lib/artifacts` are the
authoritative format; run `npm run contracts:check` when adopting a build. A service
must not simply echo arbitrary build IDs it does not recognize.

The Noir profile is 256 sealed voters, 16 projects, ingest batch 32. ZisK's program
key is pinned to the committed guest fixture/profile, not a generic default for
all guests. When changing proof programs, regenerate and verify the corresponding
proof artifacts and manifests, then synchronize the service and frontend.

## 1. Check availability

`GET /capabilities?chainId=…&contract=…&buildId=…&profileId=…`

Return the identity (with numeric `chainId`) and `ready: true` only when the matching
workflow/prover, round key provisioning, and monitoring can be provided. Return
`ready: false` or a non-2xx status otherwise. The UI disables sealed deployment
with an explanation. Public rounds do not call this service.

## 2. Reserve a round

`POST /rounds`

The body contains the identity plus:

| Property | Meaning |
| --- | --- |
| `id` | Browser-generated UUID, persisted before the request; the idempotency key. |
| `organizer` | Requested final organizer address. |
| `deployer` | Wallet creating the contracts. |
| `token` | Resolved USDC/EURC address. |
| `votingDeadline` | Unix seconds as a decimal string. |
| `capacity` | Noir only: `{nSealedMax:256,mMax:16,batch:32}`. |

Reserve monitoring and generate a fresh salt. Derive the matching public key using
the actual tallier's key derivation; retain the corresponding secret at the service.
Return the **same reservation and key/salt pair** for retries with the same id and
identical request. Reject reuse of the id with a different request. Reservations
must survive browser reloads, delayed confirmations, and interrupted wallet flows.
Do not invalidate a reservation after on-chain deployment has started.

The JSON response echoes the identity and `id`, with `monitoring: "reserved"` and:

| Property | Scope / contents |
| --- | --- |
| `key` | All: `{salt: "0x…"}` with a fresh, nonzero bytes32 salt. |
| `key.publicKey` | CRE, LP CRE, ZisK: compressed, valid secp256k1 public key (33 bytes). |
| `key.x`, `key.y` | Noir: decimal strings for a valid Grumpkin point. |
| `workflow` | CRE, Noir, LP CRE: `{forwarder, owner, name}` from the deployed tenant workflow. `name` is the registered name, not an encoded hash. Both addresses must be nonzero. The forwarder must have code on this chain. |
| `coordinator` | Noir: nonzero recovery coordinator address controlled by the service. |
| `guest` | ZisK: `{programVK: "0x…"}` matching the pinned guest profile. |
| `dependencies` | Optional known addresses keyed by `Poseidon2`, `IngestVerifier`, `TallyVerifier`, or `ZiskVerifier`. |
| `liquidity` | LP CRE: `{manager, stateView}` from the network's supported Uniswap deployment. Both must have code, share a nonzero pool manager, and support the required unsubscribe gas limit. |

Only whitelisted properties become constructor inputs. Workflow names are SHA-256
hashed, truncated to ten lowercase **hex characters**, then ASCII-encoded as bytes10
as required by `CreMetadata.sol`. Workflow owner and coordinator are never inferred
from the organizer. Proof limits and recovery periods come from the app profile.

Known dependency addresses are checked against the exact bundled runtime; a
mismatch stops deployment before signing. When none is supplied, a matching local
chain/build registry entry is reused, or the wallet deploys the bundled contract.
The service can retain these addresses from the newly registered round for later
reservations. A label, predicted address, or code presence alone is insufficient.
The ZisK root is read directly from `getRootCVadcopFinal()` on the verified contract.

## 3. Activate monitoring

`PUT /rounds/{id}/deployment`

Body: the identity plus `round`, `transactionHash`, and `lpVoting` for LP rounds.
Verify the confirmed deployment on the requested chain, including the full round
configuration and reservation key/salt. For liquidity rounds, verify the module is
attached and the final owner matches `organizer`. Start/resume the real workflow
and prover's monitoring for the new addresses. Handle repeats idempotently.

Return `{id, round, monitoring: "active"}` only after the service is watching the
round. Otherwise use a non-2xx status or a non-active monitoring status. The browser
retains all transaction hashes and offers **Continue deployment**. It does not
redeploy the round or call it ready until monitoring is confirmed.

The local integration tests mock this public protocol and deploy all five round
types on Anvil, including real bundled Noir/ZisK dependencies and LP module setup.
They verify constructor values, hash-based reuse, rejection of incompatible code,
and resuming after receipt or registration failures. They do not prove that a live
CRE workflow or prover is running; that is still operator setup.
