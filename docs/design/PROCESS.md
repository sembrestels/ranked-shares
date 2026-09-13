# Frontend design process

How the RankedShares frontend is designed, how decisions are agreed, and where the
artifacts live. Adopted by `docs/decisions/2026-09-05-adopt-the-frontend-design-process.md`.

## Spine: the Double Diamond

Four phases, each ending in a gate where the decision-maker approves the phase output
before the next phase starts. Diverge inside a phase, converge at the gate.

| Phase | Question | Output | Gate |
|---|---|---|---|
| Discover | Who uses this, for what job, and where does it hurt today? | Personas, job statements, current-state journey map | Personas and pain points confirmed |
| Define | What are we betting on, and what is the smallest slice that tests it? | Hypotheses, user story map with a release line, technology records | Release line drawn; technology records accepted |
| Develop | What system of parts delivers the slice? | Design principles, tokens, component hierarchy, user stories with acceptance criteria | Principles, palette, hierarchy, and stories approved |
| Deliver | Does it work for the people in Discover? | Built screens, heuristic and accessibility findings, usability test notes | Findings triaged; blockers fixed before demo |

## Inner loop: Lean UX

Inside every phase:

1. Declare the assumption.
2. Write it as a hypothesis: *we believe [outcome] will happen if [persona] achieves
   [action] with [feature]*, with a signal that would confirm or refute it.
3. Test it with the cheapest artifact that answers the question: a sentence, a sketch, a
   clickable page, a built screen, in that order.
4. Record what was learned. An invalidated hypothesis is removed, not deferred.

## Methods and artifacts

| Step | Method (source) | Skill | Artifact | Location |
|---|---|---|---|---|
| Personas | Proto-personas (Gothelf) | `proto-persona` | One page per persona, assumptions tagged `[ASSUMPTION]` | `docs/design/personas.md` |
| Jobs | Jobs to be done (Christensen) | `jobs-to-be-done` | Job statements and forces per persona | `docs/design/jobs.md` |
| Journey | Customer journey map (alignment diagrams) | `journey-mapping` | Current-state journey, pain points, moments of truth | `docs/design/journey.md` |
| Hypotheses | Lean UX (Gothelf and Seiden) | `lean-ux` | Assumption map and hypothesis list | `docs/design/hypotheses.md` |
| Story map | User story mapping (Patton) | `user-story-mapping` | Backbone, steps, tasks, release line | `docs/design/story-map.md` |
| Stories | User stories (Cohn) with Gherkin criteria | `user-story`, `user-story-splitting` | One story per file or section, one When and one Then each | `docs/design/stories/` |
| Design system | Pattern-driven design systems (Kholmatova, Frost) | `design-systems` | Principles, token architecture, component inventory | `docs/design/design-system.md` |
| Tokens | W3C design tokens, three tiers | `design-tokens` | Reference, semantic, and component tokens, light and dark | `docs/design/tokens.md` and the frontend's token file |
| Components | Atomic Design (Frost) | `atomic-design` | Atoms, molecules, organisms, templates | Frontend source tree |
| Usability review | Nielsen's ten heuristics, Krug | `ux-heuristics`, `nielsen-usability-heuristics` | Severity-rated findings | `docs/design/reviews/` |
| Accessibility review | WCAG 2.2 level AA | `accessibility-audit` | Findings by criterion, fixes | `docs/design/reviews/` |
| Research | UX research methods, continuous discovery | `ux-research` | Interview guide, test plan, findings | `docs/design/research/` |

Skills live in `.agents/skills/` and are pinned in `skills-lock.json`. Re-audit a skill
after updating it.

## Recording decisions

Every decision that is hard to reverse, surprising without context, or the result of a
real trade-off gets one record in `docs/decisions/`.

- **Technical decisions** (framework, wallet library, proving location, hosting,
  routing) are Architecture Decision Records. Use `adr-skill`.
- **UX decisions** (navigation model, how the two ballot modes are presented, what is
  shown during a running tally) are design rationale records. Use
  `develop-design-rationale`.

Both use date-prefixed filenames, the YAML front matter `status`, `date`, and
`decision-makers`, and the lifecycle `proposed` → `accepted` | `rejected` →
`deprecated` | `superseded by [title](file)`. A record is written as `proposed` and
only the decision-maker sets it to `accepted`. Accepted records are not edited; a
change is a new record that supersedes the old one. The index is
`docs/decisions/README.md`.

Specs in `docs/superpowers/specs/` keep describing *what* is built. Records describe
*why* a choice was made. When a spec relies on a decision, it links the record.

## How this connects to the build workflow

The existing workflow (brainstorm → spec → plan → subagent-driven implementation with
tests) is unchanged. The design process feeds it:

- Brainstorming for a frontend feature starts from the personas, journey, and story
  map instead of from nothing.
- The stories for a release slice, with their Gherkin criteria, are the input to the
  spec and the plan.
- The heuristic and accessibility skills run during implementation on component files
  and before a slice is called done. Their findings become new stories.

## Current state

- 2026-09-05: process adopted (record accepted). No personas, journey, or story map
  yet. Personas will start as assumptions; no user interviews have been run.
- 2026-09-12: four proto-personas drafted in `docs/design/personas.md` (donor,
  seat holder, organiser, proposer), confirmed by the decision-maker the same day.
  Job statements and forces in `docs/design/jobs.md`; current-state journey maps in
  `docs/design/journey.md`. Discover gate closed 2026-09-12. Define drafted the same
  day: `docs/design/hypotheses.md`, `docs/design/story-map.md` with a proposed R1
  release line, and four proposed technology records (framework, site and API
  hosting, wallet, proposal storage), written to follow `../fund/thedao-rfps/web` at
  the decision-maker's direction. Define gate closed 2026-09-12: R1 line confirmed,
  four records accepted. Develop drafted the same day: `docs/design/design-system.md`
  (principles, token architecture, component inventory), `docs/design/tokens.md`
  (three tiers, light and dark, mapped from `web/app/tokens.css`), 79 stories under
  `docs/design/stories/`, and a proposed visual direction record. Palette and delivery
  decided the same evening (Blossom brand, Tailwind v4) and landed in `web/app/tokens.css`.
  Develop gate closed 2026-09-12: principles, hierarchy, and stories approved. Deliver
  in progress, first slice: app shell, stage bar, round page, project page. The `web/`
  package on master (proposals, Swarm ID, review, editing) predates the gate; its
  stories are marked built.
- 2026-09-12: first Deliver slice built (round page, project page, stage bar, shell) on
  branch round-pages; heuristic and accessibility reviews recorded in
  `docs/design/reviews/`, with findings routed to stories.
