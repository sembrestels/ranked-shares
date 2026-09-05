---
status: accepted
date: 2026-09-05
decision-makers: Sem
---

# Adopt the frontend design process

## Context and Problem Statement

RankedShares has contracts, circuits, a prover, and a Chainlink CRE workflow, but no
frontend beyond the browser proving page in `prover/src/web/`. Every design spec so far
(`docs/superpowers/specs/`) names the Arc frontend as out of scope. The product has two
ballot modes with different user journeys (public and final, private and replaceable),
three pool variants (on-chain, Noir, ZisK), and a hackathon deadline. Frontend work is
about to start.

Two things were asked for before any screen is built:

- Every design decision is agreed explicitly, not made implicitly in code.
- The methods used are ones other organisations use and can name, so contributors and
  judges recognise them.

Until now the repo has recorded design reasoning inside specs. That works for a
contract's data model but not for UX decisions, which are more numerous, smaller, and
more often revisited.

## Decision

Adopt the process described in `docs/design/PROCESS.md`. In summary:

- **Spine:** the Double Diamond (Discover, Define, Develop, Deliver) with a review gate
  at the end of each phase.
- **Inner loop:** Lean UX. Assumptions are declared, turned into hypotheses with a
  success signal, and tested with the lowest-fidelity artifact that can answer them.
- **Requirements:** personas and jobs-to-be-done feed a user story map (Patton); the
  release slice becomes user stories (Cohn format) with Gherkin acceptance criteria.
- **UI structure:** Atomic Design on top of design tokens (W3C token format, three
  tiers: reference, semantic, component).
- **Quality gates:** Nielsen's ten heuristics for usability review and WCAG 2.2 level AA
  for accessibility, applied before a screen is considered done.
- **Decision records:** technical frontend decisions are Architecture Decision Records
  in MADR style; UX decisions are design rationale records. Both live in
  `docs/decisions/`, use date-prefixed filenames, carry the same YAML front matter
  (`status`, `date`, `decision-makers`), and follow the lifecycle proposed, accepted,
  rejected, deprecated, superseded.
- **Tooling:** the agent skills that implement these methods are vendored under
  `.agents/skills/` and pinned in `skills-lock.json`. They were audited for prompt
  injection on 2026-09-05 and must be re-audited after any update.

Non-goals of this record:

- It does not choose a frontend framework, wallet library, hosting, or whether proving
  runs in the browser or through the prove API. Each of those gets its own record.
- It does not commit to a user research programme. Personas and journeys start as
  assumptions, are tagged as such, and are validated when interviews happen.
- It does not change how contract and circuit specs are written.

## Consequences

- Good, because each frontend decision has one file that states the alternatives and
  the reason, so it is not relitigated.
- Good, because the artifacts (personas, journey, story map, stories) give the existing
  spec-and-plan workflow a validated input instead of a blank page.
- Good, because the methods have public names and literature, so a new contributor can
  read the source material rather than a bespoke convention.
- Bad, because the Discover and Define phases add roughly two working sessions before
  the first screen is built.
- Bad, because a second document type (decision records) now sits next to specs, and
  the boundary between them must be kept: specs describe what is built, records
  describe why a choice was made.
- Risk: the process is followed for the first feature and then skipped under deadline
  pressure. Mitigation: the phase gates are short (one approval each) and the review
  gates run as skills that trigger on component files.

## Implementation Plan

- **Affected paths**: `docs/design/PROCESS.md` (new), `docs/decisions/` (new, with
  `README.md` index), `.agents/skills/` and `skills-lock.json` (new, vendored skills),
  `docs/design/` for personas, journey map, story map, design system, and tokens as
  they are produced.
- **Dependencies**: none in the build. The skills are Markdown plus three Node scripts
  under `.agents/skills/adr-skill/scripts/` that use only `node:fs` and `node:path`.
- **Patterns to follow**: date-prefixed filenames as in `docs/superpowers/specs/`; one
  decision per record; a record starts as `proposed` and is set to `accepted` by the
  decision-maker, using `set_adr_status.js`; the index in `docs/decisions/README.md` is
  updated with every record (`new_adr.js --update-index`).
- **Patterns to avoid**: recording design reasoning only inside a spec or a commit
  message; batching several decisions in one record; editing an accepted record's
  decision text instead of superseding it; hard-coding colours or spacing in components
  once tokens exist.
- **Order of work**: Discover (personas, jobs, journey), Define (hypotheses, story map,
  technology records), Develop (design system, tokens, component hierarchy, stories),
  Deliver (build per story, heuristic and accessibility review). The gates are listed in
  `docs/design/PROCESS.md`.

### Verification

- [ ] `docs/design/PROCESS.md` exists and names the phases, gates, artifacts, and their
      locations.
- [ ] `docs/decisions/README.md` lists this record.
- [ ] Every skill in `skills-lock.json` has a matching directory under `.agents/skills/`.
- [ ] The first technology record (frontend framework) exists before any frontend
      package is added to the repo.
- [ ] The first design rationale record exists before the first screen is merged.
- [ ] No component under the future frontend source tree contains a raw colour or
      spacing value once `docs/design/tokens` is defined.

## Alternatives Considered

- **Keep using specs only.** Rejected: specs are the right size for a contract or a
  circuit, but UX decisions are smaller and more frequent, and burying them in specs
  makes them hard to find and easy to relitigate.
- **A single method such as a five-day Design Sprint.** Rejected: a sprint answers one
  big question once; the frontend needs a standing process that survives several
  features.
- **An RFC process with comment periods.** Rejected: one decision-maker and a hackathon
  timeline make comment periods ceremony without benefit. Records with a proposed to
  accepted transition give the same audit trail.
- **Design Thinking as the spine instead of Double Diamond.** Rejected as a naming
  choice only. The phases are equivalent; Double Diamond is the more common label in
  product and government design teams and maps more cleanly onto four gates.

## More Information

- Process: `docs/design/PROCESS.md`
- Skills audit and selection: conversation of 2026-09-05; the installed set is
  enumerated in `skills-lock.json`.
- Revisit this record if the team grows beyond one decision-maker (the RFC
  alternative becomes worth reconsidering), or once user interviews replace the
  assumption-based personas.
- Source methods: Design Council Double Diamond; Gothelf and Seiden, *Lean UX*; Patton,
  *User Story Mapping*; Cohn, *User Stories Applied*; Frost, *Atomic Design*; W3C
  Design Tokens Community Group format; Nielsen, *10 Usability Heuristics*; W3C WCAG
  2.2; Nygard, *Documenting Architecture Decisions*; MADR.

