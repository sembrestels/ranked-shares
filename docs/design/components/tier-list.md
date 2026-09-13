# Tier list

Purpose: let voters express equal funding priorities without entering numeric ranks.
The user confirmed this pattern and its ranking semantics on 2026-09-13.

## Anatomy and composition

- Proposal box: native button containing the proposal title and a decorative grip.
- Proposal group: wrapping list of boxes, empty-state text, and a destination button.
- Tier list: an unplaced group followed by a semantic table with row headings
  **Must fund**, **Should fund**, and **Nice to have**; helper text and move status.
- Ballot form: tier list plus the existing voting-mode and submission controls.

The route owns assignments by project ID. The tier list receives titles and
assignments through props and emits assignment callbacks. It only owns transient
selection, drag feedback, announcements, and focus management.

## States and behavior

All proposals start under **Unplaced proposals**. A proposal appears exactly once,
and boxes within each group follow project-ID order. Desktop users can drag boxes
between all four groups. Click or tap a box to select it, then activate **Move here**
in another group. Selecting again or pressing Escape cancels. A completed move
clears selection and returns focus to the moved box. Invalid/external drops and
drops into the existing group do not change assignments. Busy forms disable all
movement. Empty groups remain available as destinations.

Tiers express preference, not guaranteed funding. Proposals in a tier are tied.
An occupied tier has competition rank 1 plus the number of proposals in higher
tiers; empty tiers consume no ranks. Unplaced proposals encode as 0, meaning tied
below all placed proposals, and are still eligible under the existing tally rules.
An all-unplaced ballot remains valid. Switching wallet/round or successfully storing
a ballot resets the draft; failed storage retains it. Changing titles or ballot
privacy mode does not change assignments. Ballot encoding and storage are unchanged.

## Content, accessibility, and responsiveness

Use full titles as text, wrap long names without truncation, and retain the existing
`Project N` fallback. No content is interpreted as HTML. Instructions explain drag
and select-to-move controls, ties, and the priority of unplaced proposals.

Use native buttons with pressed state, labelled destination buttons, native table
row headers, and a polite status region for moves and cancellation. Tab navigates;
Enter/Space activate; Escape cancels. Selection uses an outline and a check mark as
well as color. Touch targets are at least the existing 44px control-height token.
The full task works without dragging. Focus remains visible after reparenting.

Use the existing Blossom heading/body fonts and semantic color, spacing, border,
radius, focus, and motion tokens. The top tier uses inverse colors, the middle tier
uses the information surface, and the lower tier uses the sunken surface. Labels
remain visible beside wrapping boxes on desktop and narrow screens. Light and dark
themes inherit their semantic palettes. Reduced motion follows existing tokens.

Related patterns: Button, ballot mode choice, pending ballot, and ballot review.
