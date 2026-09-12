---
status: accepted
date: 2026-09-12
decision-makers: Sem
---

# Visual direction for the frontend

A design rationale record (UX decision), via the `develop-design-rationale` skill.

## Decision Summary

Choose the reference tier of the design tokens (palette, typefaces, the one loud
element per screen) that every component inherits. Decided: the Blossom brand palette
and typefaces from blossom.software, delivered through Tailwind v4.

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

**D. Blossom brand (chosen).** The palette and typefaces of blossom.software, the
team that builds RankedShares: four greens (`#2C4A34`, `#617767`, `#678A74`,
`#AFC7B9`), two pinks (`#FF6A6A`, `#FD8C8C`), peach (`#FFEADB`), off-white
(`#FAFAF9`); Lexend Deca for body, Kulim Park for headings. Green carries structure and
actions; pink is the one signal colour, reserved for sealed things and the current
stage; flat surfaces with borders, no drop shadows, as on the brand site. The loud
element per screen stays the rank numeral and the support bar, set in Kulim Park.

## Evaluation

Criteria, in order: grounded in the subject; distinct from generated defaults;
contrast and legibility at small sizes (WCAG 2.2 AA); cost to adopt given what is
built; kinship with the decision-maker's other sites.

| Criterion | A | B | C | D |
|---|---|---|---|---|
| Grounded in the subject | weak (generic editorial) | strong (ledger, ballot) | none (another product's brand) | medium (the maker's brand; green and growth read as funding) |
| Distinct from defaults | weak | strong | medium | strong (an existing, specific identity) |
| Contrast at small sizes | good | good | good on dark, weaker for long text | good with green ink; sage reserved for large text and fills |
| Cost to adopt | none | reference tier only, one day | reference tier plus dark-first layout | reference tier plus two web fonts, one day |
| Kinship with siblings | none | shared components, own look | full | full with blossom.software |

## Decision Rationale

D was chosen by the decision-maker on 2026-09-12: RankedShares is a Blossom Labs
product and should look like one, and the brand already has a palette and type
system in use. It meets the distinctness criterion because it is a real identity, not
a default, and the token tiers make it a reference-tier change. B remains the
recommendation for the loud element (rank numerals, support bars) and for reserving
one signal colour, both carried over into D. A is dropped. C is rejected: RankedShares
is a product other organisations will run, not a TheDAO site.

## Trade-offs Accepted

- Two web fonts to load (Lexend Deca, Kulim Park); self-hosted, subset to Latin.
- Sage green fails 4.5:1 on white for small text, so it is limited to large text,
  borders and fills; green-ink and green-muted carry body and meta text.
- Pink as the only signal means public and sealed are distinguished by label and
  position as well as colour, which accessibility requires anyway.
- The brand's warmth (peach, salmon) is used sparingly: peach as the sunken surface,
  salmon only in dark mode.

## Reversibility

High. Only `--ref-` tokens change; components reference the semantic tier.

## Follow-up Considerations

- Tailwind v4 `@theme` is the delivery, confirmed with this decision.
- Run the H1 and H2 clickable tests in this direction, not before.
- Dark mode values in `docs/design/tokens.md` are derived from the greens, not brand
  values; check them against blossom.software if it ever ships a dark theme.
- Confirm the font licences allow self-hosting (both are Google Fonts, OFL).

## Supporting Materials

- `docs/design/tokens.md`, `docs/design/design-system.md`, `web/app/tokens.css`.
- `frontend-design` skill's calibration list (vendored plugin).

## Decision History

- 2026-09-12: proposed after the `web/` package landed with direction A in code.
- 2026-09-12: accepted as D, the Blossom brand, with Tailwind v4 delivery, by the
  decision-maker.
