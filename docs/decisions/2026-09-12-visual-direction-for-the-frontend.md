---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Visual direction for the frontend

A design rationale record (UX decision), via the `develop-design-rationale` skill.

## Decision Summary

Choose the reference tier of the design tokens (palette, typefaces, the one loud
element per screen) that every component inherits. Proposed: a "ledger and ballot"
direction grounded in what the product is; the direction already in `web/` is the
alternative, acceptable if the decision-maker prefers it.

## Context

The `web/` package merged on 2026-09-12 carries a visual direction chosen in code:
warm cream paper (`#f4f1e9`), a serif display face (Iowan Old Style, Palatino), Verdana
body, and a terracotta accent (`#993f2b`) with hairline rules and 2px radii. It was not
recorded as a decision. The `frontend-design` guidance vendored with the design
process names exactly this combination, cream ground plus high-contrast serif display
plus terracotta accent, as the most common default of generated pages, a look that
reads as templated rather than chosen. The process requires perceptual patterns to be
a recorded choice. Constraints: one decision-maker, a hackathon demo, and semantic
tokens (`docs/design/tokens.md`) that make the reference tier cheap to swap.

## Options Considered

**A. Paper, serif, terracotta (as built).** Editorial, warm, print-like. One serif
display, a sans body, rust accent, no shadows.

**B. Ledger and ballot (proposed).** The subject is money as weight, ranked lists, and
sealed ballots. Cool off-white ground (`#f6f6f1`), green-black ink (`#1b2321`) like a
ledger's, a single signal colour reserved for sealed things and primary actions, a
deep violet (`#3d3a8c`), and a dry green (`#2f6b4a`) for funded and proven. One type
family with tabular numerals for the whole site, IBM Plex Sans with Plex Mono for
addresses and references, so ranks, weights, and costs line up in columns. The loud
element is the rank numeral and the support bar; everything else is set small. Rules
encode structure (a ballot's ranked rows, a ledger's columns), not decoration.

**C. House style from TheDAO Security Fund.** Dark blue panels, Inter, green and red
signals, as in `thedao-rfps/web`. Same components, immediate visual kinship with the
sibling sites.

## Evaluation

Criteria, in order: grounded in the subject; distinct from generated defaults;
contrast and legibility at small sizes (WCAG 2.2 AA); cost to adopt given what is
built; kinship with the decision-maker's other sites.

| Criterion | A | B | C |
|---|---|---|---|
| Grounded in the subject | weak (generic editorial) | strong (ledger, ballot) | none (another product's brand) |
| Distinct from defaults | weak | strong | medium |
| Contrast at small sizes | good | good | good on dark, weaker for long text |
| Cost to adopt | none | reference tier only, one day | reference tier plus dark-first layout |
| Kinship with siblings | none | shared components, own look | full |

## Decision Rationale

B is recommended because it is the only option whose choices come from what
RankedShares is, and because the token tiers make it a reference-tier change: no
component moves. A stays available if the decision-maker prefers the built look; the
record then simply names it as chosen. C is rejected: RankedShares is a product other
organisations will run, not a TheDAO site.

## Trade-offs Accepted

- B loses the warmth of A; the ground is cooler and the display less ornamental.
- One type family means headings carry less contrast; weight and size do the work.
- A single signal colour means public and sealed are distinguished by label and
  position as well as colour, which accessibility requires anyway.

## Reversibility

High. Only `--ref-` tokens change; components reference the semantic tier.

## Follow-up Considerations

- Whether to deliver tokens through Tailwind v4 `@theme`, as the framework record
  says, or keep the plain CSS custom properties the package uses. Either carries the
  same semantic tier. The decision-maker decides before the next component is built.
- Run the H1 and H2 clickable tests in the chosen direction, not before.
- Dark mode values in `docs/design/tokens.md` are drafted for B and need a pass for A
  if A is chosen.

## Supporting Materials

- `docs/design/tokens.md`, `docs/design/design-system.md`, `web/app/tokens.css`.
- `frontend-design` skill's calibration list (vendored plugin).

## Decision History

- 2026-09-12: proposed after the `web/` package landed with direction A in code.
