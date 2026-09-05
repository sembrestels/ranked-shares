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

- [Adopt the frontend design process](2026-09-05-adopt-the-frontend-design-process.md) (accepted, 2026-09-05)