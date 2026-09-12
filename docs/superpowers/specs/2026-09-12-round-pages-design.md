# Round pages: the app shell, the stage bar, the round page, the project page

Status: draft 2026-09-12. First Deliver slice of the frontend design process
(`docs/design/PROCESS.md`). Implements the stories of activity 5 and the stage bar,
outcome, and closing stories of activity 6 in `docs/design/stories/`; builds on the
`web/` package (React Router SPA, Tailwind v4 tokens) and the accepted records of
2026-09-12 in `docs/decisions/`.

## 1. Goal and scope

Two plans, each shippable on its own:

- **Plan A, the API** (`docs/superpowers/plans/2026-09-12-round-pages-a-api.md`): a
  Deno + Hono API under `web/api/`, served with the built SPA by `web/server.ts` as
  one Deno Deploy app. Three read routes: `GET /api/round`, `GET /api/project/:id`,
  `GET /api/voter/:address`, plus `GET /healthz`. No writes, no keys, no database.
- **Plan B, the SPA** (`docs/superpowers/plans/2026-09-12-round-pages-b-spa.md`): the
  app shell in the brand look, the stage bar on every route, the round page at `/`,
  the project page at `/project/:id`, and the proposals board moved to `/proposals`.

Stories covered: S5.1 to S5.7, S5.9 to S5.12 (S5.8, "rank this project", waits for
the `/vote` route of the next slice), S6.1 to S6.13, S1.1 (the rules panel on the
submit page, a one-component change), S1.8 (add a project directly, on `/setup`).

Out of scope: contributing, seats, ranking, casting, LP positions, sweep and claim
actions (the next slices), Deno KV and cron (not needed until positions), SIWE.

## 2. Decisions taken in this spec

Each is a ruling the decision-maker can reverse; the cost of each if wrong is one
function or one label.

1. **Public commitment per project** = the sum of the direct (public) weight of every
   voter whose public ballot gives that project competition rank 1, ties included.
   Rationale: the proposal note describes a public ballot as "committing 2k behind a
   project"; first-choice weight is the number a donor recognises as their commitment.
   Any-rank sums would exceed the budget and mislead. The label on the page is
   "public commitment", never "support" alone, and the sealed weight is one separate
   number for the whole pool, never per project.
2. **Noir pools** report `commitmentsAvailable: false` and zero commitments in this
   slice: the Noir ballot is a packed field element whose unpacking is not ported to
   the API yet. The demo targets the zisk and cre variants (Arc runbook).
3. **Stage model.** Seven steps: proposals, setup, open, closing, proving, proven,
   paid. During the contract's Setup phase both proposals and setup are marked current
   (they run together). For the plain pool the proving step is labelled "Counting" and
   the closing step exists as "waiting for the tally to start" between the deadline and
   `startTally`. The proven step's label follows finality: Proven, Provisional
   (`Attested`), Abandoned, Counted (plain). Paid is current once the pool is done and
   `claimedTotal < spent`; it is done when `claimedTotal == spent`; after abandonment
   it stays next.
4. **Variant detection** by probing: `kind()` returns "cre" or "zisk"; otherwise
   `profileId()` succeeds for Noir; otherwise plain. Detected once per snapshot.
5. **Pool selection.** The API serves the pool in `POOL_ADDRESS`; `?pool=0x…` on any
   route overrides it, so the SPA's existing `?pool=` round picker keeps working. Each
   pool has its own cache entry.
6. **Snapshot consistency.** One block number is read first and every contract read
   for that snapshot is pinned to it. The snapshot carries `block` and `at`; the SPA
   shows "Updated N seconds ago" from `at`.
7. **Freshness after the user's own transaction.** The SPA refetches all three routes
   with `?after=<receipt block>`; the API re-reads when its cached block is older.
   Cache TTL 15 seconds, single-flight per pool.
8. **Proposal content** is read by the API from a Bee node or gateway (`BEE_URL`,
   optional) at `/bytes/<reference>`, parsed with the same `parseContent` the browser
   uses, and cached forever by reference (content-addressed). Unset `BEE_URL` gives
   `contentStatus: "unavailable"` with a reason; the page then offers the Swarm ID
   download path the proposals board already has.
9. **No KV, no cron, no auth** in this slice. `bootstrap.ts` keeps the fund's shape so
   both can be added without moving code.
10. **Prerender** `/`, `/proposals`, `/submit`, `/submit/thanks`, and `/project/:id`
    for every project id read from `POOL_ADDRESS` at build time; when the pool is
    unset or unreachable the build logs a warning and prerenders the fixed routes only.
11. **Copy** is fixed here and reused verbatim (design principle 3):
    - Proven: "the sealed ballots were proven against their commitments and the public
      ballots can be replayed from chain data"
    - Provisional: "the operator's report was accepted after the proof grace period
      without a proof; the funded set stands"
    - Abandoned: "no result arrived before the abandonment deadline; no project is
      funded and the organiser can sweep the pool"
    - Counted (plain): "the tally ran on-chain and can be replayed from chain data"
    - Not cast: "Your ballot: not cast. Money without a ballot funds nothing."
    - No pitch: "No pitch was published for this project"
    - Pitch failed: "The pitch could not be loaded; try again"
    - Audit link label: "check this result yourself", pointing at the repository
      README's audit section.

## 3. The API

### 3.1 Layout (mirrors `thedao-rfps/web/api`)

```
web/server.ts                 Deno Deploy entrypoint: /api and /healthz to Hono, else build/client with SPA fallback
web/api/main.ts               API alone (dev)
web/api/bootstrap.ts          createServer(): config, client, services, app
web/api/config.ts             loadConfig(env): pure
web/api/app.ts                createApp(deps): Hono app, CORS, error handler, routes
web/api/deps.ts               Deps type
web/api/chain/abi.ts          plainAbi, sealedAbi (cre, zisk), noirAbi, erc20Abi
web/api/chain/client.ts       createClient(): viem public client with fallback transport
web/api/chain/kind.ts         detectKind()
web/api/chain/read.ts         readRound(): the per-variant reads into a RoundFacts
web/api/services/commitments.ts  commitmentsFrom(): pure aggregation
web/api/services/stage.ts     stageOf(): pure
web/api/services/snapshot.ts  createSnapshots(): cache + single-flight over readRound + stageOf
web/api/services/content.ts   createContent(): Bee fetch + parseContent + cache
web/api/routes/health.ts, round.ts, project.ts, voter.ts
web/api/tests/                deno test: fake pool transport, pure-function tests, route tests, anvil integration
```

### 3.2 Types

```ts
type Kind = "plain" | "cre" | "zisk" | "noir";
type PhaseName = "setup" | "open" | "closing" | "tally" | "done";
type Finality = "proven" | "attested" | "abandoned" | "counted";
type StepKey = "proposals" | "setup" | "open" | "closing" | "proving" | "proven" | "paid";

interface ProjectView {
  id: number; cost: string; recipient: Address; contentRef: Hex;
  commitment: string; funded: boolean; claimed: boolean;
  title: string | null;   // the pitch's title resolved by reference, null when none or unavailable
}
interface Stage {
  current: StepKey;
  steps: { key: StepKey; state: "done" | "current" | "next"; label: string }[];
}
interface RoundSnapshot {
  pool: Address; kind: Kind; chainId: number; block: number; at: number;
  token: { address: Address; symbol: string; decimals: number };
  phase: PhaseName; votingDeadline: number;
  totalWeight: string; spent: string; claimedTotal: string;
  projects: ProjectView[]; fundedOrder: number[];
  proposalCount: number; voterCount: number;
  sealed: { total: string; count: number; commitmentsAvailable: boolean };
  closing: { closed: boolean; cursor: number } | null;
  proving: { accepted: number; total: number | null } | null;
  finality: Finality | null;
  graces: { abandonFrom: number | null; provisionalFrom: number | null };
  stage: Stage;
}
interface ProjectResponse {
  project: ProjectView; round: Pick<RoundSnapshot, "pool"|"kind"|"block"|"at"|"token"|"phase"|"finality"|"stage">;
  contentStatus: "ok" | "none" | "unavailable"; content: ProposalContent | null; reason: string | null;
}
interface VoterResponse {
  address: Address; block: number;
  weight: { direct: string; seats: string; total: string };
  ballot: { public: { ranks: number[] } | null; sealed: boolean };
  inRoster: boolean;
}
```

Bigints are decimal strings; addresses checksummed; bytes as `0x` hex; times are unix
seconds.

### 3.3 Reads per variant (from the contract survey of 2026-09-12)

Common (`PoolBase`): `token`, `owner`, `votingOpen`, `votingDeadline`, `totalWeight`,
`spent`, `claimedTotal`, `projectCount`, `cost(id)`, `recipientOf(id)`,
`contentRefOf(id)`, `funded(id)`, `claimed(id)`, `fundedProjects()`, `proposalCount`,
`voterCount`. Token: `symbol`, `decimals` (symbol falls back to "tokens").

| | plain | cre and zisk | noir |
|---|---|---|---|
| phase | `phase()` 0..3 Setup, Open, Tally, Done | `phase()` 0..4 Setup, Open, Closing, Tally, Done | same as cre |
| finality | none; `tallyDone` gives "counted" | `finality()` 0 None, 1 Proven, 2 Attested, 3 Abandoned | same |
| closing | none | `closed`, `closeCursor` | same |
| proving | `rankLevel`, funded count | none | `ingestCursor`, `numBatches`, `resultReported`, `reportedAt` |
| graces | none | `abandonGrace` from `votingDeadline` | `abandonGrace`; `proofGrace` from `reportedAt` |
| roster | `voterAt(i)`, `ballotOf(a)` bytes, `weightOf(a)` | `votersFrom(start,n)` → who, direct, seats, ballots, cts | `votersFrom` → who, direct, ballots(uint), seats, cts, hasDirect |
| sealed | none | `totalSeatWeight`; count = ballots with non-empty ct | `totalSeatWeight`, `sealedCount` |
| voter | `weightOf`, `ballotOf` | `directWeight`, `seatWeight`, `directBallotOf`, `sealedOf` (bytes) | `directWeight`, `seatWeight`, `hasDirect`, `directBallotOf` (uint), `sealedOf` (rx, ry, c) |

Commitments: plain from `ballotOf` and `weightOf` per voter; cre and zisk from
`votersFrom` pages of `ROSTER_PAGE` (default 200); noir none (decision 2).

### 3.4 Errors

`400` for a malformed address or id; `404` for an unknown project; `502` with
`{ error: "rpc unavailable" }` when every RPC endpoint fails; `500` otherwise. The SPA
shows the error's text in a Notice and keeps the last good snapshot on screen.

### 3.5 Configuration (`web/.env.example` gains these; secrets never `VITE_`)

```
PORT=8000
RPC_URL=http://127.0.0.1:8545          # comma-separated for failover; falls back to VITE_RPC_URL
CHAIN_ID=31337                         # falls back to VITE_CHAIN_ID
POOL_ADDRESS=                          # falls back to VITE_POOL_ADDRESS
WEB_ORIGIN=http://localhost:5174
BEE_URL=                               # optional Bee node or gateway for proposal content
SNAPSHOT_TTL_MS=15000
ROSTER_PAGE=200
```

## 4. The SPA

### 4.1 Routes

```
/                 round page (board, sealed totals, your ballot, outcome)
/project/:id      project page
/proposals        the proposals board (today's `/`)
/submit, /submit/thanks, /setup   unchanged, restyled by the shell
```

### 4.2 Components (from `docs/design/design-system.md`)

Atoms added: Money (exact formatting from `lib/proposals.ts`, symbol after the number,
thin space, at most two decimals shown with the full value in a `title`), Address
(checksummed, shortened `0x1234…abcd`, full value in `title`, copy control with
"Copied" status), Countdown ("2 days 3 hours", updates once a minute, text alternative
is the absolute date), Badge (renamed from Status; colour from a status token, text
always present), Skeleton.

Molecules added: Stage step, Support bar (commitment over cost as a filled bar with the
percentage in text; the sealed total is never drawn per project), Rule line.

Organisms added: Stage bar (S6.1 to S6.7: current step, bounding date, closing progress
and "close next batch" button when closing and a wallet is connected, proving progress
or "waiting for the first proof", grace dates), Board (S5.1 to S5.4), Your ballot
status (S5.9, S5.10), Outcome (S6.8 to S6.12), Project summary (S5.5 to S5.7, S6.13).

Shell: header with the wordmark, navigation (Round, Proposals, Submit an idea,
Organizer), connections (wallet, Swarm ID) as today but restyled with the tokens;
footer with "check this result yourself" link and the chain name. Tailwind utilities
on new components; the old class names stay on untouched screens until each is
rebuilt.

### 4.3 Data

`app/lib/api.ts`: `fetchRound(pool?, after?)`, `fetchProject(id, pool?)`,
`fetchVoter(address, pool?)` against `VITE_API_URL || ""` (same origin). Hooks
`useRoundSnapshot`, `useProject`, `useVoter` with `refetchInterval` 15 s while
visible; `useAfterTransaction(receipt)` invalidates with `after = receipt.blockNumber`.

### 4.4 Prerender and meta

`react-router.config.ts` prerenders the fixed routes and `/project/:id` for ids
`0..projectCount-1` read at build time (decision 10). Each project page's `meta`
returns `<title>`, `og:title` (the pitch title if the manifest resolves within 5 s at
build time, else "Project N"), `og:description` naming the cost, and a canonical URL
from `VITE_SITE_URL`.

## 5. Testing

- API: `deno test -A api/` with a fake pool transport (viem `custom` transport that
  decodes `eth_call` data with the variant ABI and answers from a state object) for
  every variant and phase; pure tests for `commitmentsFrom` and `stageOf`; route tests
  through `app.fetch`; one Anvil integration test that deploys `MockERC20` and the
  plain `RankedShares` from `out/`, contributes and votes with two wallets, and checks
  `/api/round` and `/api/voter/:address` against real chain state.
- SPA: vitest component tests for every new organism with fixture snapshots; the
  existing workflow test keeps passing; `deno task build` prerenders; a fetch of a
  prerendered project page contains the meta tags (S5.11, S5.12).
- Before the slice is called done: the heuristic and accessibility skills run on the
  new component files; findings become stories.

## 6. Files that change outside `web/`

`README.md` gains a "Web app and API" paragraph; `docs/design/stories/` statuses flip to
built in the landing commits; `docs/design/PROCESS.md` current state.
