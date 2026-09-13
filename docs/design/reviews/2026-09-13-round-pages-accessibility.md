# Round pages accessibility audit

Scope: a WCAG 2.2 level AA audit, read from code only (no browser, no axe run),
of the `round-pages-spa` branch. Reviewed: `app/root.tsx`,
`app/components/stage/stage-bar.tsx`, `app/components/round/*`,
`app/components/project/*`, `app/components/ui/*`, `app/routes/round.tsx`,
`app/routes/project.tsx`, `app/app.css`, and `app/tokens.css`. Contrast ratios
are computed from the hex values in `app/tokens.css` using the WCAG relative
luminance formula. File paths are relative to `web/`. Companion reviews on this
branch: `2026-09-13-round-pages-heuristics.md`.

## Findings

| id | criterion | level | file:line | finding | severity | fix |
|---|---|---|---|---|---|---|
| A1 | 1.4.11 Non-text contrast / 2.4.7 Focus visible | AA | `app/app.css:75-78`, rendered in `app/root.tsx:236-250` | `:focus-visible` outlines with `--accent` (green-sage), not the dedicated `--color-focus` token (pink-coral). Green-sage on the inverse header background (green-dark) is 2.56:1, under the 3:1 minimum, so a keyboard user tabbing the header nav links or the "RankedShares" home link sees a low-contrast ring. | Serious | Use `var(--color-focus)` for the outline, or give `:focus-visible` inside the header a higher-contrast override. |
| A2 | 1.4.3 Contrast (minimum) | AA | `app/components/ui/badge.tsx:6`, rendered in `app/components/round/outcome.tsx:13` | Badge tone "error" (pink-deep text on peach background) is 3.48:1, under the 4.5:1 minimum for the badge's small (`text-xs`) type. Shown for the "abandoned" outcome and anywhere else `tone="error"` is used. | Serious | Darken the error text token for this pairing, or drop `bg-error-bg` under this tone and keep text on the page/surface colour. |
| A3 | 1.4.3 Contrast (minimum) | AA | `app/components/ui/badge.tsx:7`, rendered in `app/components/round/outcome.tsx:18` and `app/components/project/project-summary.tsx:16` | Badge tone "info" (green-muted text on `--color-info-bg`, a 30% `color-mix` of green-light into off-white) computes to roughly 3.99:1 by an sRGB approximation of that mix, under 4.5:1 for the badge's small type. The exact oklab-mixed value needs a rendered check, but the approximation is close enough to the threshold to flag. | Moderate | Confirm the rendered ratio; if under 4.5:1, use `--color-primary` or a darker green for this tone's text. |
| A4 | 2.5.8 Target size (minimum) | AA | `app/components/ui/address.tsx:25-31` | The "Copy"/"Copied" control is a bare `<button>` with `text-sm` and no padding or `min-height`, unlike the shared `Button` component (which sets `min-height: var(--control-height)`, 44px). At `text-sm` (0.8rem) and body line-height, the clickable box is under 24 CSS px tall. It sits next to a `<code>` chip, not inline in running text, so the inline-text exception does not clearly apply. | Moderate | Give the copy control `min-height`/`min-width` of at least 24px (padding is enough), or route it through the shared `Button` component. |
| A5 | 4.1.3 Status messages | AA | `app/components/ui/skeleton.tsx:1-9`, consumed at `app/routes/round.tsx:47`, `app/routes/project.tsx:62`, `app/components/stage/stage-bar-container.tsx:38` | `Skeleton` is `aria-hidden="true"` with no sibling live region, so while a round, project, or stage bar is loading, a screen reader user gets no announcement at all (sighted users see pulsing bars). | Moderate | Add a visually-hidden `role="status"` sibling (e.g. "Loading the round…") wherever `Skeleton` stands in for content. |
| A6 | 2.3.3 Animation from interactions | AAA | `app/components/ui/skeleton.tsx:5` | The skeleton uses Tailwind's `animate-pulse`, which is not scoped to `prefers-reduced-motion`; the reduced-motion query in `app/tokens.css:141-146` only zeroes the `--duration-*` tokens, which `animate-pulse` does not use. | Minor | Wrap the pulse animation in `@media (prefers-reduced-motion: no-preference)`, or swap to a static placeholder under reduced motion. |
| A7 | 1.3.1 Info and relationships (best practice) | AA | `app/components/ui/countdown.tsx:3-9` | `<time dateTime={isoDate(to)}>` carries the deadline instant in `dateTime`, but the visible text is a duration ("2 hours 15 minutes"); the exact deadline is only reachable via the `title` tooltip, which is not exposed to keyboard-only or touch users and is inconsistently announced by screen readers. | Minor | Show the absolute deadline as visible text near the countdown (the stage bar's own `When` component already does this alongside `Countdown` in most steps), not only in `title`. |
| A8 | 2.4.4 Link purpose (best practice) | A | `app/root.tsx:148` ("Manage storage ↗") and `app/root.tsx:189` ("Change ↗") | Link/summary text ends with a decorative arrow glyph appended to the accessible name; screen readers may spell it out ("up-right arrow") since it is not marked `aria-hidden`. | Minor | Wrap the glyph in `<span aria-hidden="true">` or drop it and rely on the verb ("Manage storage", "Change"). |

Severity counts: blocker 0, serious 2 (A1, A2), moderate 3 (A3, A4, A5), minor 3
(A6, A7, A8).

## Computed contrast ratios

| pair | use | ratio | requirement | result |
|---|---|---|---|---|
| green-ink on off-white | body text | 14.26:1 | 4.5:1 | pass |
| green-muted on off-white | hints, meta (`text-secondary`) | 4.63:1 | 4.5:1 | pass, narrow |
| green-sage on white | large text and borders only | 3.84:1 | 3:1 (large) | pass; fails 4.5:1 if ever used at normal size (not observed in scope) |
| pink-deep on off-white | documented semantic pair | 3.88:1 | 4.5:1 | fails; the `docs/design/tokens.md` note of "pink-deep on offwhite 4.5:1" does not match this computation |
| off-white on green-dark | header/footer text (light) | 9.41:1 | 4.5:1 | pass |
| off-white on green-night | body text (dark, page) | 15.15:1 | 4.5:1 | pass |
| off-white on green-deep | body text (dark, surface) | 12.47:1 | 4.5:1 | pass |
| green-light on green-night | secondary text (dark, page) | 8.81:1 | 4.5:1 | pass |
| green-light on green-deep | secondary text (dark, surface) | 7.25:1 | 4.5:1 | pass |
| pink-salmon on green-night | signal text (dark, page) | 7.01:1 | 4.5:1 | pass |
| pink-salmon on green-deep | signal text (dark, surface) | 5.77:1 | 4.5:1 | pass |
| green-dark on off-white | inverse header text (dark mode) | 9.41:1 | 4.5:1 | pass |
| green-muted on white | `dt` labels on surface cards (Board, ProjectSummary) | 4.84:1 | 4.5:1 | pass |
| green-sage on green-dark | focus outline on the inverse header (see A1) | 2.56:1 | 3:1 (non-text) | fail |
| pink-deep on peach | badge tone "error" text (see A2) | 3.48:1 | 4.5:1 | fail |
| green-muted on info-bg (approx.) | badge tone "info" text (see A3) | ~3.99:1 | 4.5:1 | fail (approximate) |

## Passes

- Skip link (`app/root.tsx:230-235`) targets `#main`, is keyboard-reachable, and
  becomes visible on focus.
- Landmarks are named and distinct: `<nav aria-label="Main">` in the header and
  `<nav aria-label="Round stage">` in the stage bar do not collide.
- Heading order is a clean h1 to h2 on both routes: `RoundHeading`/
  `ProjectSummary` hold the page's one `<h1>`; `Outcome`, `Board`,
  `SealedPanel`, and `Pitch` each add one `<h2>` with no skipped levels.
- `StageStep` marks the active step with `aria-current="step"` and pairs the
  colour cue with bold text and a top rule, so state is not colour-only.
- `SupportBar`'s `role="meter"` carries `aria-valuemin`/`max`/`now` and a full
  `aria-label`, and is always shown next to a percentage or "cost covered"
  sentence, so support level is not colour-only either.
- `Address`'s copy action announces "Address copied" through a screen-reader-
  only `role="status"` region that already exists in the DOM before the
  update.
- The "Download {file.name}" and "Try again" buttons carry descriptive
  `aria-label`/visible text; no empty buttons or links found in scope.
- `<html lang="en">` is set; every route reuses the shared `Shell`, so no page
  is missing it.
- The `.toolbar` grid and the stage bar's `ol` both collapse to fewer columns
  under Tailwind's default breakpoints, and `Address`'s `<code>` uses
  `break-all`, so long values wrap instead of forcing horizontal scroll.
- Buttons built from the shared `Button` component (Close next batch, Try
  again, Download, Connect wallet, Switch network) all inherit `.button`'s
  `min-height: var(--control-height)` (44px), clearing the 24px target-size
  minimum with room to spare.

## Needs a rendered check

- The exact contrast of badge tone "info" (A3), since `--color-info-bg` is a
  `color-mix(in oklab, …)` value that a hand computation can only approximate
  in sRGB.
- Reflow at 320 CSS px for the round page's two-column layout
  (`lg:grid-cols-[2fr_1fr]` in `app/routes/round.tsx:55`), the stage bar's
  "closing" column (status line, button, and possible error notice stacked in
  one grid cell), and the `dl` label/value pairs in `Board` and
  `ProjectSummary`, all of which are only specified as CSS here.
- Whether the focus ring in A1 reads as genuinely low-contrast against the
  actual rendered header (font smoothing and anti-aliasing can shift perceived
  contrast slightly from a flat hex computation).
- Screen reader behaviour of the `title`-only deadline in `Countdown` (A7)
  across VoiceOver and NVDA, since `title` announcement is inconsistent
  between screen readers and platforms.
- Whether `RoundPicker`'s `<summary>` disclosure marker, not just its full
  clickable row, meets the 24 by 24 px target independent of the row's
  overall size.
- Actual keyboard focus order across the header, round picker, connections,
  stage bar, and page body, which can only be walked in a live page.
