# Two-pool proposal import

Original import plan for Arc Testnet (chain ID 5042002). The two pools have since
been deployed with the approved demo organizer and deadline; see the current
[demo instructions](../demo/README.md), [deployment receipts](../demo/deployment.json),
and [deployed import plan](../demo/import-plan.json). The 15 Urbe Hub proposals have since been submitted publicly and accepted in the
EURC pool; see [their receipts](../demo/urbehub-proposal-receipts.json). The six
USDC proposals still await encrypted upload and submission.

The remaining sections record the original planning inputs. The deployed demo plan
supersedes their organizer, proposer, deadline, and deployment-status assumptions.

| New pool | Contract | Proposals | Requested total |
| --- | --- | --- | --- |
| Urbe Hub / EURC | `NoirRankedShares` — sealed Noir | 15 | 32,250 EURC |
| Golem / USDC | `LPCreRankedShares` — liquidity CRE | 6 | 88,000 USDC |

The requested totals are proposal budgets, not amounts to transfer during import.
Noir's bundled default profile allows 16 projects and 256 sealed voters, so all
15 Urbe Hub proposals fit. The two currencies retain their original amounts.

The user confirmed `0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF` as proposer
and payout recipient for every imported proposal. It is also the existing pool's
organizer and the proposed organizer for both new pools.

[pool-import-plan.json](pool-import-plan.json) contains all 21 titles, bodies,
original source paths/checksums, token amounts in base units, and empty slots for
the new pool addresses, private references and confirmed transaction receipts.
The existing deadline, 2026-09-19 03:35 UTC (05:35 Europe/Madrid), is recorded as a
suggestion; the new pools' deadlines are not yet selected.

The organizer's existing Swarm sharing public key can be registered in each new
pool's privacy companion before the first submission. Proposal uploads must use
the connected Swarm ID, and wallet transactions must be signed by the confirmed
proposer. The batch postage signer is not a replacement for either identity.

## Deployment prerequisites checked

- The bundled deployment artifacts match the current contract sources.
- USDC and EURC addresses come from the app's official Arc token configuration.
- `cre whoami` succeeds for the connected account, but reports **Deploy Access:
  Not enabled**.
- No `VITE_TALLY_SERVICE_URL` is configured in the workspace or this process.
- The repository implements the provisioning client, but does not run a live
  tally/prover service. The current workflow configs contain placeholder targets.
- The browser session available to this task has no imported Swarm ID account.

An existing compatible tally/prover service or CRE operator setup is needed before
these can become functioning sealed rounds. The Noir deployment also needs the
matching verifier/prover configuration; the liquidity CRE deployment needs its
Uniswap manager and state-view configuration. Use the existing
[provisioning protocol](../web/docs/tally-provisioning.md) and
[Arc liquidity runbook](../docs/superpowers/notes/2026-09-13-arc-lp-demo-runbook.md).

## Execution after setup

1. Provision each round's actual tally key and workflow, then review and sign the
   deployment transactions with the organizer wallet.
2. Register the organizer's sharing key and verify the deployed token, owner,
   deadline, privacy settings, and active tally monitoring.
3. Encrypt and upload each group's proposals using Swarm ID, retaining durable
   references and verifying downloads before submission.
4. Submit every proposal with its original requested amount and confirmed
   recipient. Record receipts and resume from completed entries after interruption.
5. Leave the proposals pending organizer review. Accept/reject and opening voting
   remain separate actions.
