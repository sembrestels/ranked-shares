# Concurrent-round navigation review

Scope: site header, rounds directory, round navigation, URL selection, and links
into projects/ballots. Heuristic estimate before: **4/10**. After: **9/10** for
this navigation slice; this is an expert review, not a user-testing result.

| Finding | Severity | Resolution |
| --- | --- | --- |
| No directory or way to see concurrent rounds | 3 | Searchable directory with active/completed filters and independent status cards |
| Global, participant, and organizer links share one flat header | 3 | Global header, named round context, round tabs, separate action and management groups |
| URL changes can retain a different round's state | 3 | Router-driven selection, Back/Forward support, page remount on pool change |
| Projects, ballots, and balances can leak through links/placeholders | 3 | Pool-bearing links and pool-restricted cache placeholders; late receipts retain their originating pool |
| Global home silently opens the configured round or deployment | 2 | Home always presents the directory; Create round is an explicit global action |
| Browser tabs have indistinguishable overview titles | 2 | Overview title follows the selected round's name |

Verification:

- 175 frontend tests pass, including concurrent rounds, filters, saved labels,
  invalid/unavailable addresses, selection, back/forward, reset form state, late
  transaction receipts, and cache isolation for round/project/voter snapshots.
- Type checking and production prerender build pass.
- Desktop browser check with four local fixture rounds: two voting, one accepting
  proposals, one completed. Selecting another active round updates name, address,
  balance, deadline and every round link together; Back restores the prior round.
- Responsive check at 390px: the selected-round context, native switcher, page tabs
  and action group wrap; measured content width equals viewport width (no horizontal
  overflow). Directory stacks to one column.
- Accessibility spot check: named nav landmarks, current-page indicators, visible
  field labels, native keyboard-selectable switcher, text status, 44px control
  targets, semantic lists, visible focus, and skip-to-content link. Full screen-reader
  testing was not performed.

Remaining validation for 10/10: observe participants switching between similarly
named rounds and finding organizer tools without guidance. No known navigation
blocker remains. Discovery is intentionally limited to configured and browser-saved
rounds; a chain-wide registry is outside this slice.
