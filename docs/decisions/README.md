# Decision records

One file per decision that is hard to reverse, surprising without context, or the result
of a real trade-off. Technical decisions are Architecture Decision Records (MADR style,
via the `adr-skill` skill). UX decisions are design rationale records (via the
`develop-design-rationale` skill). Both share the front matter and lifecycle below.
The process that uses them is `docs/design/PROCESS.md`.

## Conventions

- Directory: `docs/decisions`
- Naming:
  - Use date-prefixed files: `YYYY-MM-DD-choose-database.md`
  - If the repo already uses slug-only names, keep that: `choose-database.md`
- Status values: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`

## Workflow

- Create a new ADR as `proposed`.
- Discuss and iterate.
- When the team commits: mark it `accepted` (or `rejected`).
- If replaced later: create a new ADR and mark the old one `superseded` with a link.

## Records

- [Navigate between concurrent rounds](2026-09-13-navigate-between-concurrent-rounds.md) (proposed, 2026-09-13, design rationale)

- [Encrypt proposals through private review](2026-09-13-encrypt-proposals-through-private-review.md) (accepted, 2026-09-13)

- [Allocate LP voting weight proportionally and automate the Arc demo with CRE](2026-09-13-allocate-lp-voting-weight-proportionally-with-cre.md) (accepted, 2026-09-13)

- [Store ballots in Arkiv and calculate live results in the browser](2026-09-13-store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.md) (accepted, 2026-09-13)

- [Adopt the frontend design process](2026-09-05-adopt-the-frontend-design-process.md) (accepted, 2026-09-05)
- [Build the frontend as a React Router single-page app on Deno, following thedao-rfps](2026-09-12-build-the-frontend-as-a-react-router-single-page-app-on-deno-following-thedao-rfps.md) (accepted, 2026-09-12)
- [Serve the site and a Deno API from one Deno Deploy app](2026-09-12-serve-the-site-and-a-deno-api-from-one-deno-deploy-app.md) (accepted, 2026-09-12)
- [Connect wallets with wagmi and viem and the site's own connect button](2026-09-12-connect-wallets-with-wagmi-and-viem-and-the-sites-own-connect-button.md) (accepted, 2026-09-12)
- [Store proposal content in Swarm through the API and bind its reference on-chain](2026-09-12-store-proposal-content-in-swarm-through-the-api-and-bind-its-reference-on-chain.md) (superseded, 2026-09-12)
- [Upload proposal content from the browser through Swarm ID](2026-09-12-upload-proposal-content-from-the-browser-through-swarm-id.md) (superseded, 2026-09-12)
- [Visual direction for the frontend](2026-09-12-visual-direction-for-the-frontend.md) (accepted, 2026-09-12, design rationale)

- [Cast contributions and ballots together; sync Arkiv afterwards](2026-09-13-cast-contributions-and-ballots-together.md)
