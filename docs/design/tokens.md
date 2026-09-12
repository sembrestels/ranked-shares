# Design tokens

Three tiers of CSS custom properties, light and dark, and the mapping from the tokens
already in `web/app/tokens.css`. Method: W3C design tokens format, three tiers, via
the `design-tokens` skill. The reference tier's values follow the visual direction
record of 2026-09-12; until that record is accepted the values below are the ones in
`web/app/tokens.css` today, so nothing built changes on its own.

Rules: components reference semantic or component tokens only; every colour, space,
size, radius, shadow, and duration in a component comes from a token; a token used
once should be a more general token instead; light and dark differ only in the
reference-to-semantic mapping.

## Reference tier

The raw palette. Prefix `--ref-`. Values from `web/app/tokens.css` (right column: the
name used there today).

| Token | Value | Today |
|---|---|---|
| `--ref-color-paper-100` | `#fffcf5` | `--surface` |
| `--ref-color-paper-200` | `#f4f1e9` | `--paper` |
| `--ref-color-paper-300` | `#e7ecdf` | `--notice` |
| `--ref-color-paper-400` | `#f6e8df` | `--error-bg` |
| `--ref-color-line-300` | `#d0cec1` | `--line` |
| `--ref-color-line-600` | `#858779` | `--line-strong` |
| `--ref-color-ink-600` | `#66685c` | `--muted` |
| `--ref-color-ink-900` | `#262e29` | `--ink` |
| `--ref-color-accent-500` | `#993f2b` | `--accent` |
| `--ref-color-accent-600` | `#7b301f` | `--accent-hover` |
| `--ref-color-accent-200` | `#e4b69d` | `--brand-muted` |
| `--ref-color-green-700` | `#37573e` | `--green` |
| `--ref-font-body` | Verdana, Geneva, sans-serif | `--font-body` |
| `--ref-font-display` | Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif | `--font-display` |
| `--ref-font-mono` | SFMono-Regular, Consolas, monospace | `--font-mono` |
| `--ref-space-1` to `--ref-space-12` | 0.25, 0.5, 0.75, 1, 1.5, 2, 3.5 rem | `--space-1` to `--space-12` |
| `--ref-size-1` to `--ref-size-7` | 0.7, 0.8, 0.95, 1.8, 2, 3, clamp(3.3rem, 6vw, 5.6rem) rem | `--text-tiny` to `--text-hero` |

Dark reference values, new (no dark mode exists today):

| Token | Value |
|---|---|
| `--ref-color-night-900` | `#15191a` |
| `--ref-color-night-800` | `#1f2526` |
| `--ref-color-night-700` | `#2a3233` |
| `--ref-color-night-600` | `#3a4446` |
| `--ref-color-chalk-100` | `#ecebe4` |
| `--ref-color-chalk-400` | `#a9aba0` |
| `--ref-color-accent-400` | `#c9694f` |
| `--ref-color-green-400` | `#7ea886` |

## Semantic tier

Purpose-named. Light maps to paper and ink; dark maps to night and chalk. Components
use these.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg-page` | paper-200 | night-900 | page ground |
| `--color-bg-surface` | paper-100 | night-800 | cards, forms |
| `--color-bg-sunken` | paper-300 | night-700 | notices, wells |
| `--color-bg-inverse` | ink-900 | chalk-100 | header |
| `--color-text-primary` | ink-900 | chalk-100 | body |
| `--color-text-secondary` | ink-600 | chalk-400 | hints, meta |
| `--color-text-inverse` | paper-200 | night-900 | on inverse |
| `--color-border-default` | line-300 | night-600 | rules, inputs |
| `--color-border-strong` | line-600 | chalk-400 | emphasised rules |
| `--color-border-focus` | accent-500 | accent-400 | focus ring |
| `--color-action-primary` | accent-500 | accent-400 | primary button, links in text |
| `--color-action-primary-hover` | accent-600 | accent-500 | |
| `--color-action-muted` | accent-200 | night-600 | secondary emphasis |
| `--color-status-success` | green-700 | green-400 | accepted, funded, proven |
| `--color-status-error` | accent-600 | accent-400 | rejected, abandoned, errors |
| `--color-status-error-bg` | paper-400 | night-700 | |
| `--color-status-info-bg` | paper-300 | night-700 | pending, closing, proving |
| `--font-family-body` | ref-font-body | same | |
| `--font-family-display` | ref-font-display | same | h1, h2, rank numerals |
| `--font-family-mono` | ref-font-mono | same | addresses, references |
| `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-display` | size-1 to size-7 | same | |
| `--line-height-body` | 1.65 | same | |
| `--line-height-heading` | 1.07 | same | |
| `--tracking-tight` | -0.035em | same | display only |
| `--space-xs` to `--space-3xl` | space-1 to space-12 | same | `--space-inline-*` and `--space-stack-*` alias these where direction matters |
| `--radius-sm` | 2px | same | controls |
| `--radius-full` | 999px | same | badges |
| `--rule-width` | 1px | same | |
| `--rule-width-accent` | 3px | same | the one loud rule per screen |
| `--focus-ring-width` | 2px | same | |
| `--control-height` | 44px | same | touch target |
| `--width-page` | 1120px | same | |
| `--width-reading` | 820px | same | |
| `--width-copy` | 38rem | same | under 80 characters of body |
| `--opacity-disabled` | 0.6 | same | |
| `--duration-fast` | 150ms | same | state changes |
| `--duration-normal` | 250ms | same | reveals |
| `--easing-default` | cubic-bezier(0.4, 0, 0.2, 1) | same | |
| `--shadow-raised` | none | none | the direction has no drop shadows; a border carries elevation |

Motion respects `prefers-reduced-motion: reduce` by setting both durations to 0ms.

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

`web/app/tokens.css` becomes three blocks in this order: `:root` reference tier;
`:root` light semantic tier; `:root[data-theme="dark"]` and
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` dark semantic
tier; component tokens live in each component's stylesheet. The existing names
(`--paper`, `--ink`, `--accent`, and the rest) are kept as aliases of the semantic
tokens for one release so nothing in `web/` breaks, then removed.

The accepted framework record names Tailwind v4 with tokens under `@theme` as the
delivery format, following thedao-rfps. The package on master uses plain CSS custom
properties and class names instead. The semantic tier above is the same either way:
under Tailwind it is declared inside `@theme` and consumed as utilities, under plain
CSS it is consumed with `var()`. Whether to add Tailwind is an open question for the
decision-maker, noted in the visual direction record.

## History

- 2026-09-12: first draft, mapped from `web/app/tokens.css`, dark tier added.
