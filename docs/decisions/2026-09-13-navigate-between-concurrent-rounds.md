---
status: proposed
date: 2026-09-13
decision-makers: [Sem]
---

# Navigate from a directory into a clearly identified round

## Decision Summary

Use a rounds directory as the home page, with global navigation above a selected
round's identity, switcher, pages, and separate action group. Implemented for review
in response to the request to fix navigation for concurrent rounds.

## Context

The user reported that the header had no hierarchy and assumed one active round.
The header mixed discovery, voting, submitting, and organizing. The provider read
the query only at mount, project/ballot links omitted the round, and query
placeholders could display a previous pool's data during a switch.

Donors and seat holders need to find a round and follow its state; proposers and
organizers need actions within that round. Existing contracts have no shared
on-chain registry. Keep the current brand, query URLs, and read API.

## Options Considered

1. Add a selector to the existing flat header. Smallest change and little space,
   but leaves role-based actions competing with site navigation and no overview of
   simultaneous rounds.
2. A permanent sidebar listing every round and all actions. Makes frequent switching
   immediate, but consumes reading width and scales poorly on mobile.
3. Directory plus contextual navigation (selected). Adds a useful discovery screen,
   preserves the round identity throughout a task, and fits the existing page width.
   Introduces a distinction between global and round pages that must stay consistent.

## Evaluation

Highest priority: clear location, correct round on every action, concurrent status
visibility, working browser history, and keyboard/mobile access. Next: visual
continuity and incremental implementation. Option 3 meets these criteria without
requiring a new indexing service. The user report is the research input; no user
testing was conducted to establish preference between these alternatives.

## Decision Rationale

The hierarchy is All rounds → named round → Overview / Proposals / Vote / Liquidity.
Submit an idea and Manage round are separate actions; management contains Setup &
review and Import proposals. A switch always opens the destination overview so a
project ID or form from another round cannot be silently reused.

The URL controls selection on every render. Page state resets on a pool change,
cached placeholders are restricted to the same pool, and transaction refresh
requirements stay tied to the pool that originated the transaction.

## Trade-offs Accepted

The directory combines configured rounds with browser-local visited addresses;
it does not claim to discover every round on the chain. Labels and saved rounds
are local to this device. Live values and statuses come from the read API. Filtering
unknown statuses requires returning to All rounds to retry unavailable entries.
The switcher uses a native select; a large catalogue can be searched in the directory.

## Reversibility

Reversible without contract changes. Legacy `/?pool=` links redirect to
`/round?pool=`; other existing query-based deep links continue to work. Directory
sources can later be supplied by an index without changing the navigation hierarchy.

## Follow-up Considerations

Watch whether participants can identify their current round and return to another
without asking for help. A growing shared catalogue would justify a registry or
indexing service. Multi-network discovery would need an explicit network dimension;
today all featured rounds belong to the site's configured chain.

## Supporting Materials

- [Component specification](../design/components/round-navigation.md)
- [Navigation review](../design/reviews/2026-09-13-concurrent-round-navigation.md)
- [Design system](../design/design-system.md)
- [Existing personas](../design/personas.md)

## Decision History

2026-09-13: implemented for review following the user's navigation-fix request.
