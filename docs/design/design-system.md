# Design system

Principles, token architecture, and the component inventory for the RankedShares
frontend. Method: pattern-driven design systems (Kholmatova, Frost), via the
`design-systems` skill. Tokens: `docs/design/tokens.md`. Hierarchy in code:
`web/app/components/ui` (atoms and molecules), `web/app/components/<feature>`
(organisms), `web/app/routes` (templates and pages as route containers). Visual
direction: the design rationale record of 2026-09-12 in `docs/decisions/`.

## Principles

Each principle answers a pain point from the journey maps and is checked in review.

1. **Show the state, not the storage.** Every value that the chain holds as an
   encoding is shown as what it means: a ranking as an ordered list, weight in the
   token's units, finality as a sentence, a stage as a named step with its dates. No
   byte strings, base-unit integers, or enum numbers reach a screen. (Journey pain 1.)
2. **Nothing waits in silence.** Between any two stages there is a status that says
   what has happened, what happens next, and who does it: submitted to accepted,
   deadline to proof, funded to paid. The stage bar is on every page. (Pain 2, H8.)
3. **One sentence at the moment of choice.** The tally rule, the public-or-sealed
   trade, who can decrypt, and "deposits do not come back" are each one sentence,
   placed where the decision is made, not in a help page. (H1, H2, H3, H5.)
4. **Irreversible means confirmed.** Contribute, a public ballot, open voting, and
   sweep each get an explicit confirmation that names what cannot be undone. Reversible
   actions (a sealed ballot, an edit) say so. (Pain 4.)
5. **The chain is the source of truth, and says so.** Every screen reads from the
   chain or the API's cached snapshot of it, shows when the snapshot was taken, and
   never trusts local state for money, ballots, or status. Content from Swarm is
   untrusted text. (From thedao-rfps and the accepted records.)
6. **Readable without a wallet.** The round, its projects, and the outcome are public
   pages. A wallet is asked for at the first action that needs it, never before.
7. **Quiet chrome, one loud element.** Per screen, one element carries the weight: the
   ranking list, the stage bar's current step, the funded set. Everything else is set in
   the same small scale. Decoration that does not encode information is cut.

## Token architecture

Three tiers, W3C-style names, CSS custom properties as the delivery format. Components
reference the semantic or component tier only; the reference tier is touched only when
the palette or type changes.

| Tier | Prefix | Example | Who changes it |
|---|---|---|---|
| Reference | `--ref-` | `--ref-color-ink-900`, `--ref-space-4` | the visual direction record |
| Semantic | `--color-`, `--space-`, `--font-`, `--text-`, `--radius-`, `--shadow-`, `--duration-` | `--color-text-primary`, `--space-inline-md` | the design system |
| Component | `--<component>-` | `--button-bg-primary`, `--stagebar-step-current` | the component's spec |

Light and dark are two sets of reference-to-semantic mappings; components do not know
which is active. `docs/design/tokens.md` holds the values and the mapping from the
tokens already in `web/app/tokens.css`.

## Component inventory

Levels follow Atomic Design. "Exists" means it is in `web/` on master today. Names are
structural, never content-based. Every component is presentational: data in through
props, events out through callbacks; route containers and hooks do the fetching.

### Atoms

| Name | Purpose | Exists | Notes |
|---|---|---|---|
| Button | one action; variants primary, secondary, danger | yes | states: default, hover, focus, busy, disabled |
| Input, Textarea | one text value | yes | native controls, visible focus |
| Label | names a control | yes | |
| Badge | one word of state (pending, accepted, rejected, proven) | as `Status` | rename to Badge; colour from a status token, never the only signal |
| Notice | one message: info or error | yes | `role="status"` or `role="alert"` |
| Fact | one labelled value | yes | used for cost, recipient, weight |
| Money | an amount in the token's units with symbol and exact formatting | no | wraps the exact parser in `lib/proposals.ts` |
| Address | a checksummed address, shortened with full value on hover and copy | no | |
| Countdown | time remaining to a timestamp | no | updates once a minute; text alternative is the date |
| Rank numeral | the rank in a ballot, including ties | no | the loud element of the ranking screen |
| Icon | one glyph from one set | no | lucide-react as in the sibling projects |
| Skeleton | loading placeholder | no | |

### Molecules

| Name | Purpose | Exists | Notes |
|---|---|---|---|
| Field | Label + control + hint + error | yes | |
| Rule line | one sentence that explains a choice, placed at the point of choice | no | principle 3; content from `data/copy.ts` |
| Stage step | a named step with its dates and state (done, current, next) | no | part of the stage bar |
| Support bar | public commitment relative to cost, with the sealed total as a separate mark | no | never implies sealed weight per project |
| Confirm dialog | names the irreversible action and asks once | no | principle 4 |
| Connect button | wallet state and connect or switch action | partly, in `root.tsx` | extract from the header |
| Pagination | previous and next with a page label | yes, as a class | promote to a component |
| Attachment row | name, size, download | yes, inside the proposal card | extract |
| Ballot mode choice | public and final, or sealed and replaceable, side by side | no | H2 |

### Organisms

| Name | Purpose | Exists | Notes |
|---|---|---|---|
| Site header | brand, navigation, connections | yes | |
| Stage bar | all steps of the round with the current one loud | no | H8; on every page |
| Proposal card | a proposal's content, terms, status, and actions | yes | |
| Submit form | the proposal form | yes | |
| Project summary | project page head: title, cost, support, recipient, status | no | H10 |
| Ranking list | drag-to-order list with ties and unranked, plus the rule line | no | H1; the product's core |
| Cast panel | ballot mode choice, privacy sentence, cast action, confirmation | no | H2, H5 |
| Your ballot | current ballot, cast time, final or replaceable, replace action | no | H6 |
| Contribute panel | amount, one-step approve and contribute, finality sentence, weight after | no | H3 |
| Seats panel | seats held, claim for NFT seats, weight | no | H5 |
| Positions list | v4 positions with eligibility, projected seats, claim, accruing counter | no | H12 |
| Board | projects with support bars, sealed total, voter count, countdown | no | H4 |
| Setup checklist | what is configured, what is missing, open confirmation | no | H7 |
| Outcome | funded projects in order, finality sentence, audit link | no | H8 |

### Templates

| Name | Slots | Used by |
|---|---|---|
| Page | header, stage bar, main, footer | every route |
| Two-column | main and a side card (actions) | `/project/:id`, `/vote` |
| Form page | heading, rules panel, form, status | `/submit`, `/setup` |

## Specification rule

A component gets a spec section in this file's companion, `docs/design/components/`,
before it is built, using the `design-systems` skill's component spec template: name,
purpose, anatomy, variants (at most five), states, behaviour, content, accessibility,
responsive behaviour, tokens used. The R1 organisms above are the queue, in the order
of the story map.

## Governance

One decision-maker, one contributor stream. Changes to the reference tier or a
principle go through a design rationale record. New patterns need a purpose sentence
and use in two screens. The heuristic and accessibility reviews run on component files
before a slice is called done and their findings become stories.

## History

- 2026-09-12: first draft after the Define gate, inventoried against the `web/`
  package that landed the same day.
