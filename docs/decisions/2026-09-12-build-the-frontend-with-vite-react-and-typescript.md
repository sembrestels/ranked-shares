---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Build the frontend with Vite, React and TypeScript

## Context and Problem Statement

The frontend has to serve the R1 demo slice of `docs/design/story-map.md` on Arc
testnet by the ETHOnline deadline, then a first real round. Which framework and build
tool should it use?

Constraints the story map imposes:

- The page must read pool state and event logs directly from the chain. Arc has no
  subgraph, and the Uniswap spec's Part B scans PositionManager logs client-side.
- Sealed ballots are encrypted in the browser with the module the cre and zisk
  variants share (`RankedShares/sealed/secp256k1`, secp256k1 via `@noble/curves`).
- The Noir coordinator page in `prover/src/web/` already exists as a single Vite page in
  plain TypeScript with viem, and needs COOP and COEP headers for `bb.js`. It stays a
  separate page; the frontend does not prove.
- One decision-maker, a hackathon timeline, and static hosting with no server of our
  own (the prove service is the operator's, not the frontend's).

## Decision Drivers

- Reuse what the repo already builds with: Vite, TypeScript, viem, vitest.
- Static output that any host can serve, including Swarm if the site itself is later
  published there.
- Component model that fits Atomic Design and design tokens (the Develop phase).
- Ecosystem for wallet connection on a custom chain (see the wallet record).
- Speed to a working demo over long-term framework features.

## Considered Options

- Vite, React and TypeScript, static build
- Next.js
- SvelteKit
- Plain TypeScript with Vite, as `prover/src/web/` does

## Decision Outcome

Chosen option: "Vite, React and TypeScript, static build", because it reuses the
repo's toolchain, produces a static site, and has the widest wallet-library support for
a custom chain. React is chosen over the plain-TypeScript page because the R1 slice has
about fifteen screens sharing a stage bar, a ranking list, and wallet state, which a
component model handles and manual DOM code does not.

### Consequences

- Good, because `vite`, `vitest`, `viem`, `@noble/curves`, and the sealed-ballot module
  are already dependencies of `prover/`; the frontend adds React and a wallet library.
- Good, because the build is static: no server to run at the demo, no server to keep
  after it.
- Good, because the Atomic Design hierarchy maps one to one onto React components and
  tokens onto CSS custom properties.
- Bad, because client-side log scanning for positions and events is slower than an
  indexer; acceptable for a demo round with tens of voters, to be revisited for R2.
- Neutral, because React brings no router or state library; the implementation plan
  names the minimum set.

## Implementation Plan

- **Affected paths**: new `frontend/` package (`frontend/src/`, `frontend/index.html`,
  `frontend/vite.config.ts`, `frontend/package.json`); the sealed-ballot module is
  imported from the shared TypeScript source, not copied.
- **Dependencies**: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`,
  `typescript`, `vitest`, `@testing-library/react`, `viem`; the wallet library per its
  own record. Pin exact versions as `prover/package.json` does.
- **Patterns to follow**: the `prover/` package layout and scripts (`dev`, `build`,
  `test`); chain reads through viem public clients as in `prover/src/core/chain.ts`;
  ABIs generated from `out/` by a script, not hand-written.
- **Patterns to avoid**: a server-side rendering framework; a global state library
  before a screen needs one; raw colours or spacing in components once tokens exist.
- **Configuration**: chain id, RPC URL, pool addresses, and the Swarm gateway as Vite
  environment variables with an `.env.example`; the Arc testnet chain defined once.
- **Migration steps**: none; `prover/src/web/` is untouched and keeps its own headers.

### Verification

- [ ] `cd frontend && npm run build` produces a static `dist/` that serves the round
      page from a plain file server.
- [ ] `cd frontend && npm test` runs component tests under vitest.
- [ ] The sealed-ballot encryption test vectors pass in the frontend's test suite
      against the shared fixtures.
- [ ] No server process is required to run the demo beyond an RPC endpoint and the
      Swarm gateway.

## Pros and Cons of the Options

### Vite, React and TypeScript, static build

- Good, because the toolchain is already in the repo.
- Good, because wallet libraries target React first.
- Bad, because React is the heaviest of the client-only options.

### Next.js

- Good, because it has routing and a large ecosystem.
- Bad, because it defaults to a server and its static export removes most of what
  distinguishes it; nothing here needs server rendering.
- Bad, because it is a second build system next to Vite.

### SvelteKit

- Good, because it is light and its static adapter is simple.
- Bad, because the wallet ecosystem for custom chains is thinner and the vendored
  design skills' examples assume React.

### Plain TypeScript with Vite

- Good, because it is what the coordinator page already does with zero framework.
- Bad, because fifteen screens with shared state and a reusable component hierarchy
  are not tractable with manual DOM updates.

## More Information

- Story map and release line: `docs/design/story-map.md`.
- Related records: the wallet connection record and the proposal storage record of the
  same date.
- Revisit if the frontend needs an indexer (R2 scale) or if the site is to be served
  from Swarm, which affects routing (hash-based routes).
