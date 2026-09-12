# Design tokens

Three tiers of design tokens, light and dark, delivered through Tailwind v4's `@theme`.
Method: W3C design tokens format, three tiers, via the `design-tokens` skill. The
reference tier is the Blossom brand palette per the visual direction record of
2026-09-12.

Rules: components reference semantic or component tokens only; every colour, space,
size, radius, shadow, and duration in a component comes from a token; a token used
once should be a more general token instead; light and dark differ only in the
reference-to-semantic mapping.

## Reference tier

The raw palette is the Blossom brand, taken from blossom.software on 2026-09-12 at the
decision-maker's direction (source: the site's Tailwind theme in the `blossomlabs.eth`
project, `src/styles/global.css`). Names are the brand's own so the two sites share a
vocabulary. Under Tailwind v4 these are declared in `@theme` and also produce utilities
(`bg-green-sage`, `text-green-dark`).

| Token | Value | Brand name |
|---|---|---|
| `--color-green-dark` | `#2C4A34` | green dark |
| `--color-green-muted` | `#617767` | green muted |
| `--color-green-sage` | `#678A74` | green sage |
| `--color-green-light` | `#AFC7B9` | green light |
| `--color-pink-coral` | `#FF6A6A` | pink coral |
| `--color-pink-salmon` | `#FD8C8C` | pink salmon |
| `--color-peach` | `#FFEADB` | peach |
| `--color-offwhite` | `#FAFAF9` | off-white |
| `--color-white` | `#FFFFFF` | white |
| `--font-body` | "Lexend Deca", sans-serif | body |
| `--font-heading` | "Kulim Park", sans-serif | headings and navigation (the brand's `--font-nav`) |
| `--font-mono` | ui-monospace, SFMono-Regular, Consolas, monospace | addresses and references (added) |

Added for dark mode and for states the brand site does not need (none of these are
brand colours; they are derived from the greens and pinks):

| Token | Value | Role |
|---|---|---|
| `--color-green-night` | `#16261B` | dark page ground |
| `--color-green-deep` | `#1E3627` | dark surface |
| `--color-green-ink` | `#1A2B20` | body text on light |
| `--color-pink-deep` | `#D94F4F` | coral on light backgrounds where 4.5:1 contrast is needed for text |
| `--color-peach-dark` | `#3B2E29` | error background in dark |

Spacing, sizes, radii and durations keep the scale already in `web/app/tokens.css`
(0.25 to 3.5 rem steps, 44px controls, 2px radius, 150 and 250 ms), now as Tailwind's
`--spacing`, `--text-*`, `--radius-*` and custom properties.

## Semantic tier

Purpose-named, declared in `@theme` so they are utilities too (`bg-page`,
`text-primary`, `border-edge`). Light maps to off-white and green ink; dark maps to
night greens and off-white text. Components use these, never the brand names directly.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-page` | offwhite | green-night | page ground |
| `--color-surface` | white | green-deep | cards, forms |
| `--color-sunken` | peach | green-dark | notices, wells, the sealed total's mark |
| `--color-inverse` | green-dark | offwhite | header, footer |
| `--color-primary` | green-ink | offwhite | body text |
| `--color-secondary` | green-muted | green-light | hints, meta |
| `--color-on-inverse` | offwhite | green-dark | text on inverse |
| `--color-on-accent` | white | green-night | text on accent |
| `--color-edge` | green-light | green-muted | rules, inputs (border) |
| `--color-edge-strong` | green-sage | green-light | emphasised rules (border) |
| `--color-focus` | pink-coral | pink-salmon | focus ring |
| `--color-accent` | green-sage | green-light | primary action, links, the loud element |
| `--color-accent-hover` | green-dark | green-sage | |
| `--color-signal` | pink-coral | pink-salmon | sealed things, the current stage, one per screen |
| `--color-signal-text` | pink-deep | pink-salmon | signal used as text |
| `--color-success` | green-dark | green-light | accepted, funded, proven |
| `--color-error` | pink-deep | pink-salmon | rejected, abandoned, errors |
| `--color-error-bg` | peach | peach-dark | |
| `--color-info-bg` | green-light at 30% | green-deep | pending, closing, proving |
| `--font-body`, `--font-heading`, `--font-mono` | as reference | same | body; h1, h2, rank numerals; addresses |
| `--text-xs` … `--text-display` | 0.7, 0.8, 0.95, 1.8, 2, 3 rem, clamp(3.3rem, 6vw, 5.6rem) | same | |
| `--leading-body`, `--leading-heading` | 1.55, 1.1 | same | Lexend Deca is wide; body leading a little tighter than the serif had |
| `--tracking-tight` | -0.02em | same | display only |
| `--radius-sm`, `--radius-full` | 2px, 999px | same | controls; badges |
| `--rule-width`, `--rule-width-accent` | 1px, 3px | same | the one loud rule per screen |
| `--focus-ring-width`, `--control-height` | 2px, 44px | same | |
| `--width-page`, `--width-reading`, `--width-copy` | 1120px, 820px, 38rem | same | |
| `--opacity-disabled` | 0.6 | same | |
| `--duration-fast`, `--duration-normal` | 150ms, 250ms | same | 0ms under reduced motion |
| `--easing-default` | cubic-bezier(0.4, 0, 0.2, 1) | same | |
| `--shadow-raised` | none | none | a border carries elevation, as on blossom.software's flat cards |

Contrast checks (WCAG 2.2 AA, 4.5:1 for text): green-ink on offwhite 12.9:1; green-muted
on offwhite 4.6:1; green-sage on white 3.7:1, so sage is used for large text, borders
and fills, never for small text; pink-deep on offwhite 4.5:1; offwhite on green-dark
9.8:1; pink-coral is a focus ring and a fill, never small text on light. Values are
computed from the hex pairs above and re-checked in the accessibility review.

## Component tier

Declared next to the component's spec, referencing semantic tokens. The first set,
for the organisms the stories need:

| Token | References | Component |
|---|---|---|
| `--button-bg-primary` | `--color-action-primary` | Button |
| `--button-bg-primary-hover` | `--color-action-primary-hover` | Button |
| `--button-fg-primary` | `--color-text-inverse` | Button |
| `--button-border-secondary` | `--color-border-strong` | Button |
| `--button-bg-danger` | `--color-status-error` | Button |
| `--badge-bg-pending` | `--color-status-info-bg` | Badge |
| `--badge-bg-accepted` | `--color-status-success` | Badge |
| `--badge-bg-rejected` | `--color-status-error-bg` | Badge |
| `--stagebar-step-current` | `--color-action-primary` | Stage bar |
| `--stagebar-step-done` | `--color-text-secondary` | Stage bar |
| `--stagebar-rule` | `--rule-width-accent` | Stage bar |
| `--supportbar-fill` | `--color-status-success` | Support bar |
| `--supportbar-track` | `--color-bg-sunken` | Support bar |
| `--supportbar-sealed-mark` | `--color-border-strong` | Support bar |
| `--rank-size` | `--text-2xl` | Rank numeral |
| `--rank-font` | `--font-family-display` | Rank numeral |
| `--field-gap` | `--space-xs` | Field |
| `--notice-bg-info` | `--color-status-info-bg` | Notice |
| `--notice-bg-error` | `--color-status-error-bg` | Notice |

## Delivery

Tailwind v4, as the framework record says and as the decision-maker confirmed on
2026-09-12. `web/app/app.css` starts with `@import "tailwindcss"` and one `@theme`
block holding the reference and semantic tiers; dark overrides sit in
`:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)
{ :root:not([data-theme="light"]) }` outside the theme block; component tokens live in
each component's stylesheet or as utilities on the element. The previous names
(`--paper`, `--ink`, `--accent`, and the rest of `tokens.css`) are kept as aliases of
the semantic tokens for one release so the existing screens keep working, then removed
as each component is rebuilt from the inventory.

## History

- 2026-09-12: first draft, mapped from `web/app/tokens.css`, dark tier added.
- 2026-09-12: reference tier replaced by the Blossom brand palette and typefaces;
  delivery set to Tailwind v4, both at the decision-maker's direction.
