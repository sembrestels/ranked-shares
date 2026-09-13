# Funding tier list review

Reviewed the voting form's tier list against the agreed ranking semantics, Nielsen
interaction heuristics, and relevant accessibility checks. The spec is
[Tier list](../components/tier-list.md).

## Validation

- 32 targeted Vitest tests pass, including tier conversion, component interactions,
  ballot integrity, ballot review, and the voting route on a disposable Anvil chain.
- The route test submits tied priorities (`1, 1, 3, 4, 0`), retains the draft after
  failed storage, resumes after a rejected confirmation, and finalizes the tally.
  It also checks reset on a round change and after successful submission.
- An encrypted Noir ballot decrypts to the same tier-derived ranks. Existing CRE
  and ZisK encryption-vector tests continue to pass.
- Type checking, the production build, and `git diff --check` pass. The build retains
  existing warnings about large bundles, mixed imports of the deployment profile,
  and placeholder prerendering when no default pool is configured.

## Browser and interaction checks

Used the real ballot components with fixture proposal names in a temporary local
preview. Verified desktop drag-and-drop, Enter/Space selection and placement,
Escape cancellation, and focus following the moved proposal. Native buttons and
the destination controls provide the same non-drag flow for touch users.

Checked light and dark themes, 375px and 320px widths, and a long multi-line proposal
title. At 320px the document's measured content width equals its viewport width.
Tier labels stay visible beside the proposal boxes. Fixed an initial table-width
issue and kept destination controls hidden during dragging to avoid layout shifts.

Rows use native table headers; proposal controls expose their selected state; moves
and cancellation have a polite status region; busy state disables all movement.
Focus is visible and returns to the proposal after moving or cancelling. Color is
supplemented by labels, outlines, and the selected check mark.

No remaining blocking issues were found in these checks. This was not a full
screen-reader or physical-device audit; those environments were not exercised.
