---
status: accepted
date: 2026-09-12
decision-makers: Sem
---

# Serve the site and a Deno API from one Deno Deploy app

## Context and Problem Statement

Arc has no subgraph. The story map needs the round page to show public commitments per
project and the sealed total, project pages to render a pitch, the LP screen to list a
wallet's v4 positions by scanning PositionManager logs, and the submit form to upload
proposal content somewhere. Where does that work run, and how is the site hosted?

`thedao-rfps/web` answers the same questions with one Deno Deploy app: `server.ts`
serves the built SPA and a Hono API under `/api` on the same origin; Deno KV is the
store; `Deno.cron` runs background sync; the server holds no keys; the chain is the
source of truth and page reads go through the API, which re-reads the chain and caches.

## Decision Drivers

- No server to patch or back up: platform-provided KV and cron.
- One origin for site and API: no CORS, one `.env`, one deploy.
- The chain stays the source of truth; the API only caches and indexes what the chain
  says, and never holds a key.
- The page must move within seconds of a user's own transaction (H3, H4, H6).

## Considered Options

- One Deno Deploy app: SPA plus Hono API with KV and cron, as thedao-rfps
- Static site only, with all reads from the browser
- Static site plus a hosted indexer (Ponder, Envio, The Graph)
- A VPS with a Node or Python server

## Decision Outcome

Chosen option: "One Deno Deploy app: SPA plus Hono API with KV and cron, as
thedao-rfps", because it is the house pattern, needs no operations, and gives the
frontend a place to scan logs, cache reads, and upload to Swarm without exposing
secrets to the browser.

What the API does for RankedShares, all read-only against the chain:

- `GET /api/round`: the pool snapshot the round page needs (phase, deadline,
  budget, projects with cost and recipient and content reference, public commitments
  per project, sealed total, sealed voter count, finality, funded order). Read over RPC,
  cached about 15 seconds, one call set per refresh regardless of viewers.
- `GET /api/project/:id`: the project's slice plus its proposal content resolved from
  Swarm and cached by reference.
- `GET /api/voter/:address`: the address's weight, direct ballot, sealed flag, roster
  inclusion, from `votersFrom` and the voter views.
- `GET /api/positions/:address`: the wallet's v4 positions with eligibility and
  projected seats, from a KV index that a `Deno.cron` fills by scanning
  PositionManager `Transfer` logs and reading pool, range and liquidity per token.
- `POST /api/proposals/content`: upload proposal JSON to Swarm and return the
  reference (see the proposal storage record). The only write, and it writes nothing
  on-chain.
- `GET /healthz`.

Writes are transactions from the user's wallet; the page refetches the API right after
its own transaction confirms, and the API's cache is keyed so that refetch sees the new
block.

### Consequences

- Good, because the round page loads one JSON document instead of dozens of RPC calls
  per viewer.
- Good, because the LP screen works without an indexer service.
- Good, because nothing secret reaches the browser: the Swarm postage batch and any
  paid RPC key live in the API's environment.
- Bad, because there is a second codebase to test (`deno test` against an in-memory
  KV with a scripted fake RPC, as thedao-rfps does).
- Bad, because the API can be stale by its cache interval; the page states when the
  snapshot was taken, as thedao-rfps states its ledger check time.
- Neutral, because no authentication is needed: every action that changes state is an
  on-chain transaction signed by the user. SIWE is added only if a later feature needs
  a server session.

## Implementation Plan

- **Affected paths**: `web/server.ts`, `web/api/main.ts`, `web/api/bootstrap.ts`,
  `web/api/app.ts`, `web/api/config.ts`, `web/api/chain/` (rpc, abi, pool reads,
  position scanning), `web/api/db/` (KV keys, positions index, content cache),
  `web/api/routes/` (round, project, voter, positions, proposals, health),
  `web/api/services/` (swarm, funding snapshot), `web/api/tests/`.
- **Dependencies**: `hono` (jsr), `@std/http`, `@std/ulid`, `@std/assert` as in
  thedao-rfps; `viem` for ABI decoding and RPC; Deno `unstable` `kv` and `cron`.
- **Patterns to follow**: `bootstrap.ts` builds the app with a KV handle and registers
  the cron; routes are thin, services do the work; the chain client has endpoint
  failover; every KV write is a transaction; tests run without a network.
- **Patterns to avoid**: holding any private key; trusting client-supplied amounts or
  addresses over what the chain says; unbounded log scans (time-box with a resume
  cursor, as the Safe sync does).
- **Configuration**: `RPC_URL` (plus public fallbacks), `POOL_ADDRESS`,
  `POSITION_MANAGER_ADDRESS`, `POSITIONS_SYNC_CRON`, `BEE_URL`,
  `BEE_POSTAGE_BATCH_ID`, `WEB_ORIGIN`, `KV_PATH` for local dev, `DB_PREFIX`.
- **Deploy**: Deno Deploy, root `web`, install `deno i`, build `deno task build`,
  entrypoint `server.ts`, environment from `.env.example`.

### Verification

- [ ] `deno task test:api` passes against an in-memory KV with a fake RPC.
- [ ] `GET /api/round` returns the demo pool's snapshot and changes within 20 seconds
      of a contribution.
- [ ] `GET /api/positions/:address` lists a demo wallet's positions after one cron run.
- [ ] `deno task start` serves the SPA and the API from one port; `/healthz` answers.
- [ ] No environment variable holding a secret is `VITE_`-prefixed.

## Pros and Cons of the Options

### One Deno Deploy app, as thedao-rfps

- Good, because it is proven next door and needs no operations.
- Bad, because it is a second codebase and a platform dependency.

### Static site only

- Good, because it is the least to build and host.
- Bad, because every viewer scans logs and hammers the RPC, and Swarm uploads would
  need the postage batch in the browser.

### Static site plus a hosted indexer

- Good, because indexing is someone else's problem.
- Bad, because none of the hosted indexers list Arc testnet today, and self-hosting
  one is more operations than the Deno app.

### A VPS with a server

- Good, because anything runs on it.
- Bad, because thedao-rfps v1 was exactly this and was replaced for the reasons in its
  `docs/v1-to-v2.md`: patching, backups, a disk, a scanner thread.

## More Information

- Reference: `/home/sem/Projects/fund/thedao-rfps/web/api/README.md`,
  `server.ts`, `docs/balance-funding-design-2026-09-12.md` (the cached-balance
  pattern the round snapshot copies).
- Revisit if Arc gains an indexer the team trusts, or if a feature needs a server
  session (then adopt thedao-rfps's SIWE flow as is).

