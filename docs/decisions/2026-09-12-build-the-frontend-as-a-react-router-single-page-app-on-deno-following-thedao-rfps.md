---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Build the frontend as a React Router single-page app on Deno, following thedao-rfps

## Context and Problem Statement

The frontend has to serve the R1 demo slice of `docs/design/story-map.md` on Arc
testnet by the ETHOnline deadline, then a first real round. Which framework, build, and
runtime should it use?

The decision-maker maintains other frontends and asked on 2026-09-12 that this one
follow their architecture, in particular `../fund/thedao-rfps/web` (the TheDAO Security
Fund board, v2). Its shape, from that repo's `README.md`, `api/README.md`, and
`docs/v1-to-v2.md`:

- React Router v7 in framework mode with `ssr: false`; fixed pages are prerendered as a
  static shell for first paint and meta tags, everything else renders client-side.
- Vite, TypeScript, Tailwind v4 with the design tokens declared in `app/app.css` under
  `@theme`, shared components in `app/components/ui`, TanStack Query for data.
- Run, built, tested, linted and formatted with Deno tasks (vitest under jsdom for the
  app, `deno test` for the API).
- One Deno Deploy app serves the built SPA and an API on the same origin (its own
  record, "Serve the site and a Deno API from one Deno Deploy app").

The sibling frontends `octocash` and `thedao-frontend` use the same React Router,
Tailwind v4, Radix and wagmi stack, so this is the house architecture, not one project's
choice.

Constraints from this repo: sealed ballots are encrypted in the browser with the module
the cre and zisk variants share; the Noir coordinator page in `prover/src/web/` stays a
separate Vite page with its own COOP and COEP headers; the frontend does not prove.

## Decision Drivers

- One architecture across the decision-maker's projects, so patterns, components, and
  operational knowledge carry over.
- A prerendered shell for the round page and project pages, so shared links unfurl and
  paint before JavaScript (story map activity 5, H10).
- Tailwind v4 tokens as the carrier for the Develop phase's design tokens.
- Speed to a working demo over long-term framework features.

## Considered Options

- React Router v7 SPA on Deno, following thedao-rfps/web
- Vite, React and TypeScript as a plain static build (the earlier proposal of this date)
- Next.js
- Plain TypeScript with Vite, as `prover/src/web/` does

## Decision Outcome

Chosen option: "React Router v7 SPA on Deno, following thedao-rfps/web", because it is
the architecture the decision-maker's other projects already use, it gives routes,
prerendered shells, and a token-based design system out of the box, and its API half
(separate record) answers the story map's need to scan logs and cache pool reads
without a subgraph on Arc.

### Consequences

- Good, because `thedao-rfps/web` is a worked example for every layer: routes, hooks,
  API client, wagmi config, tokens, tests, deploy.
- Good, because prerendered project pages carry their own meta, which H10 needs.
- Good, because the Atomic Design hierarchy maps onto `app/components/ui` (atoms and
  molecules) and feature folders (organisms), and tokens onto `@theme`.
- Bad, because the repo gains a Deno toolchain next to bun (`cre/`) and npm
  (`prover/`); each package keeps its own.
- Bad, because the sealed-ballot module is imported across packages; its import path
  must be stable and its test vectors run in the frontend's suite.
- Neutral, because the coordinator page is unchanged; the frontend links to it.

## Implementation Plan

- **Affected paths**: new `web/` package mirroring thedao-rfps: `web/app/` (`root.tsx`,
  `routes.ts`, `routes/`, `components/ui`, `components/<feature>`, `context/`,
  `hooks/`, `lib/`, `data/`, `app.css`), `web/api/` (per the API record),
  `web/server.ts`, `web/deno.json`, `web/package.json`, `web/vite.config.ts`,
  `web/react-router.config.ts`, `web/.env.example`, `web/test/setup.ts`.
- **Dependencies**: `react`, `react-dom`, `react-router`, `@react-router/dev`,
  `@react-router/node`, `vite`, `vite-tsconfig-paths`, `tailwindcss`,
  `@tailwindcss/vite`, `tw-animate-css`, `clsx`, `tailwind-merge`, `lucide-react`,
  `@tanstack/react-query`, `viem`, `wagmi`, `vitest`, `jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom`, `typescript`. Pin as
  thedao-rfps pins.
- **Routes** (from the story map): `/` round page; `/project/:id`; `/vote` (rank and
  cast, with the sealed variant chosen by weight); `/ballot` (your ballot); `/join`
  (contribute, claim seats); `/positions` (LP seats); `/submit`, `/submit/thanks`;
  `/setup` (organiser checklist, review proposals, open, sweep). Prerender `/`,
  `/submit`, `/submit/thanks`, and `/project/:id` for the projects known at build
  time; the rest from the SPA fallback.
- **Patterns to follow**: `react-router.config.ts` with `ssr: false` and a prerender
  list; `app/routes.ts` as the route table; data hooks in `app/hooks` over an
  `app/lib/api.ts` client with typed responses in `app/lib/api-types.ts`; polling via
  `refetchInterval` and an immediate refetch after the user's own transaction confirms;
  tokens only in `app.css`; the stage bar as one component used by `root.tsx`.
- **Patterns to avoid**: server rendering; reading the chain from the page except in
  the write path; raw colours or spacing in components; a second state library.
- **Configuration**: `VITE_SITE_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`,
  `VITE_WALLETCONNECT_PROJECT_ID` (optional), `VITE_POOL_ADDRESS`; API variables per
  its record. One `.env.example` for both.
- **Migration steps**: none; `prover/src/web/` is untouched.

### Verification

- [ ] `cd web && deno task build` produces `build/client` with a prerendered `/` that
      paints the round page's shell without JavaScript.
- [ ] `deno task test`, `deno task typecheck`, and `deno task lint` pass.
- [ ] The sealed-ballot encryption test vectors pass in the frontend's suite against
      the shared fixtures.
- [ ] A project page's meta tags name the project when fetched with `curl`.

## Pros and Cons of the Options

### React Router v7 SPA on Deno, following thedao-rfps/web

- Good, because it is the house architecture with a worked example next door.
- Good, because prerendered shells and client routing come with the framework.
- Bad, because it adds Deno to a repo that already has bun and npm packages.

### Vite, React and TypeScript as a plain static build

- Good, because it is the smallest toolchain and reuses `prover/`'s.
- Bad, because it has no routes, no prerendering, and no API, so log scanning and
  Swarm uploads would run in the browser or not at all.
- Bad, because it diverges from every other frontend the decision-maker runs.

### Next.js

- Good, because it has routing and a large ecosystem.
- Bad, because it is a second framework next to the house one and defaults to a
  server this project does not need.

### Plain TypeScript with Vite

- Good, because it is what the coordinator page does.
- Bad, because fifteen screens with shared state are not tractable without a
  component model.

## More Information

- Reference: `/home/sem/Projects/fund/thedao-rfps/web` (`README.md`, `api/README.md`,
  `docs/v1-to-v2.md`), `/home/sem/Projects/octocash`,
  `/home/sem/Projects/thedao-frontend`.
- Related records of the same date: the API and hosting record, the wallet record, the
  proposal storage record.
- Supersedes the same-day proposal "Build the frontend with Vite, React and
  TypeScript", withdrawn before acceptance.
