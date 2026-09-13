# Deployment field audit

Status: implemented in the deployment form and automatic deployment flow on
2026-09-13. All five round types were deployed in local Anvil integration tests.
Live sealed deployment remains unavailable until a real Arc tally service is
configured; the form states this explicitly. No Arc transactions were sent.

The form now exposes three main choices, collapsed organizer/voting-minimum options,
and read-only capacity/recovery information. The custom artifact flow remains separate.
Shared dependencies are resolved by chain and pinned runtime hash, checked before
reuse, or deployed through the wallet. Liquidity voting is attached before completion.
Saved transaction hashes allow interrupted setup to resume without duplicate sends.
See [service integration](../../../web/docs/tally-provisioning.md) for the public
provisioning contract and the remaining operator setup.

Validation: frontend type-check and production build pass; 135 frontend tests pass,
including real Anvil deployments, custom artifacts, organizer overrides, amount
conversion, service availability, verifier reuse and interrupted-deployment recovery.
The form was checked in the browser at desktop and 390px mobile width. On mobile,
the required choices precede the deployment summary. Form usability: 9/10 in this
heuristic review; no major field-discovery issues remain. The highest-impact
remaining limitation is operational: connect a real supported tally service to
make sealed deployment available. This score is not a claim of user-tested usability.

The normal round form should have three visible decisions. Constructor requirements
do not imply organizer inputs. “Not necessary” below means unnecessary as a form
field; the application still has to supply the correct constructor value.

## Necessary

| Field | Scope | Treatment |
| --- | --- | --- |
| Contract type | All | Keep the choice of public, sealed CRE, sealed Noir, sealed ZisK, or liquidity CRE. Describe ballot privacy and verification behavior. |
| Funding token (`token`) | All | USDC/EURC selector; resolve the token address for the configured chain. USDC is the default. |
| Voting deadline (`votingDeadline` / `deadline`) | All | Local date/time picker. Encode Unix seconds automatically. |

## Optional: organizer decisions with a useful reason to override

Put these in a collapsed **Round options** section. Do not add a second set of
technical controls labeled “advanced.”

| Field | Scope | Default and reason to offer it |
| --- | --- | --- |
| Organizer (`owner`) | All | Connected wallet. Offer “Use a different organizer” for a multisig or another responsible wallet. The default must follow wallet changes until explicitly overridden. |
| Minimum direct vote (`minDirectVote`) | CRE, Noir, ZisK, liquidity CRE | Propose zero additional minimum: the existing contracts still require positive eligible voting weight. An organizer may impose a participation threshold. Display currency amounts, not raw base units. |
| Minimum sealed vote (`minSealedVote`) | Noir | Propose zero additional minimum. Keep separate only because the contract applies this threshold to sponsored-seat weight. Describe that distinction in the label; use the selected currency's units. |

## Not necessary as organizer inputs

| Field | Scope | Application-owned source or action |
| --- | --- | --- |
| Tallier public key (`tallierPk`) | CRE, ZisK, liquidity CRE | Obtain from the configured tally service's round provisioning response, paired with its key salt. The service retains the corresponding secret. |
| Tallier key X (`tallierPkX`) | Noir | Obtain from that service's Noir public key. |
| Tallier key Y (`tallierPkY`) | Noir | Obtain from the same Noir public key. |
| Key salt (`keySalt`) | All sealed | Generate a fresh salt during service provisioning and return the public key derived for that exact salt. Never independently substitute a new salt after deriving the key. |
| CRE forwarder (`forwarder`) | CRE, Noir, liquidity CRE | Resolve from the configured tenant/network workflow deployment and verify code on the selected chain. |
| Workflow owner (`workflowOwner`) | CRE, Noir, liquidity CRE | Read the workflow deployment identity. This is not necessarily the round organizer. |
| Workflow name hash (`workflowName`) | CRE, Noir, liquidity CRE | Derive from the registered workflow name using `src/lib/CreMetadata.sol`: SHA-256 the name, take the first ten lowercase hex characters, encode their ASCII bytes as bytes10. |
| Coordinator (`coordinator`) | Noir | Use the tally service's configured recovery coordinator. Do not silently substitute the organizer wallet. |
| Poseidon (`poseidon`) | Noir | Reuse a deployment of the exact pinned Poseidon2 build, verifying its runtime bytecode. If absent, deploy that build once, obtain its address from the receipt, and record it by chain and build. |
| Ingest verifier (`ingestVerifier`) | Noir | Resolve or deploy the pinned production ingest verifier, as part of the same circuit profile as the tally verifier and limits. |
| Tally verifier (`tallyVerifier`) | Noir | Resolve or deploy the matching pinned production tally verifier. |
| Maximum sealed voters (`nSealedMax`) | Noir | Read the compiled proof profile. Current default: 256. Present as a capacity limit, not a free integer input. |
| Maximum projects (`mMax`) | Noir | Same profile. Current default: 16. |
| Proof batch size (`batch`) | Noir | Same profile. Current default: 32. |
| Proof grace (`proofGrace`) | Noir | Use the application's supported tally/recovery policy. Retain the current one-day wait after a provisional result before fallback recovery, shown in the round summary. |
| Abandonment grace (`abandonGrace`) | All sealed | Use that recovery policy. Retain the current seven-day default, shown as the wait before an unfinished round can be abandoned. Keep it longer than proof grace. |
| ZisK verifier (`verifier`) | ZisK | Resolve or deploy the pinned ZisK verifier and verify its runtime/version. |
| Program verification key (`programVK`) | ZisK | Use the public manifest of the exact deployed tally guest build. `zisk/fixtures/main-calldata.json` identifies the committed guest's key, but must not be reused for a different guest build. |
| Circuit root (`rootC`) | ZisK | Call `getRootCVadcopFinal()` on the resolved verifier, as `script/DeployZisk.s.sol` already does. |

The normal form has 24 distinct constructor fields across its variants (counting
the two deadline aliases as one): two necessary, three optional, nineteen
application-owned. The contract-type selector is the third necessary decision.

## Custom contract inputs

The earlier request to deploy arbitrary contracts still needs a separate developer
flow. It should not determine the ordinary round form.

| Field | Category | Treatment |
| --- | --- | --- |
| Compiled artifact upload | Necessary only for custom deployment | Preferred single import containing ABI and creation bytecode. |
| Artifact / ABI JSON | Necessary only if using paste instead of upload | Alternative import path, hidden behind “Paste ABI and bytecode.” |
| Creation bytecode | Necessary only when absent from the imported artifact | Never ask for it again when the artifact already includes it. |
| Custom constructor arguments | Contract-dependent | Generate from the imported ABI. Their business meaning cannot safely be inferred from an arbitrary parameter name. |
| Native payment | Optional for payable custom constructors | Default zero; expose only when the constructor permits a payment. |

Network, gas currency, deploying wallet and contract build remain read-only context.
Connecting the wallet and signing transactions remain explicit user actions.

## Resolving shared infrastructure

Maintain a deployment registry indexed by chain ID, dependency name and pinned
build hash. Check runtime bytecode before reuse; a matching name alone is not
enough. Arc lists a CREATE2 factory at
`0x4e59b44847b379578588920cA78FbF26c0B4956C`, so addresses can also be deterministic
for a versioned salt and exact creation bytecode. A predicted address is not proof
of a deployed contract. Check its code first.

If a shared dependency is absent, the deploy action can install it with the
connected wallet and use its confirmed address. Show the required wallet
transactions before starting, retain their hashes for recovery, and do not resend
on receipt lookup failure. No organizer should paste Poseidon/verifier addresses.

LPVoting is an additional post-deployment dependency for liquidity rounds. Resolve
PositionManager and StateView from the network's Uniswap deployment, reuse the
workflow configuration, deploy LPVoting with the new round address, and attach it
before calling the round ready for voting. These are also platform configuration,
not new organizer fields.

## Findings and remaining platform setup

- The repository has the exact Poseidon2, production Noir verifiers and ZisK
  verifier source/builds, so their implementation is known.
- Its saved broadcast records contain an Anvil LP rehearsal, not Arc deployment
  records. This does not prove no compatible contracts exist on Arc; it means no
  verified Arc addresses can be inferred from those local receipts.
- `cre/workflows/sealed/config.staging.json` has a placeholder pool address. The
  LP configuration also has a placeholder module. These are not evidence of a live
  round provisioning/discovery service.
- No tally master, forwarder, workflow owner or coordinator is configured in this
  task's environment. Public keys and workflow identities therefore cannot be
  derived here from an existing live service. Never replace them with fixture keys,
  zero authorization addresses, or newly generated keys whose secrets the tallier
  does not possess.
- Provisioning must deliver the public key/salt pair from the real tallier and
  arrange for new rounds to be monitored. Missing service setup should make a
  sealed deployment unavailable with a concise explanation, rather than returning
  a form full of addresses to an organizer.

## Sources

- `web/app/lib/artifacts/*.json`: actual constructor fields.
- `noir/ingest-default/src/main.nr`: 256 voters, 16 projects, batch 32.
- `script/DeployNoirVerifiers.s.sol`: matching production verifier deployment.
- `src/lib/CreMetadata.sol`: workflow name derivation and authorization.
- `cre/src/lib/sealed.ts`, `cre/src/lib/lp.ts`: master/salt key derivation.
- `script/DeployZisk.s.sol`, `src/zisk/ZiskVerifier.sol`: verifier root discovery.
- `docs/superpowers/notes/2026-09-13-arc-lp-demo-runbook.md`: tenant-specific CRE
  configuration and the boundary between local rehearsal and live deployment.
- [Arc contract directory](https://docs.arc.io/arc/references/contract-addresses):
  official token and CREATE2 factory addresses.
