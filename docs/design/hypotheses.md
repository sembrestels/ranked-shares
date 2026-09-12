# Assumptions and hypotheses

The bets the frontend makes, each written so it can be refuted. Method: Lean UX
(Gothelf and Seiden), via the `lean-ux` skill. Inputs: the confirmed personas
(`docs/design/personas.md`), the jobs (`docs/design/jobs.md`), and the journey maps'
cross-cutting pain points and moments of truth (`docs/design/journey.md`). Output: the
story map (`docs/design/story-map.md`) cites these by id.

Format: *we believe [outcome] will happen if [persona] achieves [action] with
[feature]*, with a signal that confirms or refutes it and the cheapest artifact that can
produce the signal. An invalidated hypothesis is removed from this file and its stories
are removed from the map, not deferred.

## Assumption map

Prioritised by risk (how much the design breaks if wrong) and uncertainty (how little
we know). High and high is tested first.

| # | Assumption | Risk | Uncertainty | Source |
|---|---|---|---|---|
| A1 | A donor can rank projects correctly without understanding the tally rule, if the rule is stated in one sentence at the ranking step | high | high | journey pain 1, Dani MoT |
| A2 | Donors want the public option; it is not only there to make the round look alive to observers | high | high | personas gaps |
| A3 | A seat holder will cast a sealed ballot if told in one sentence who can decrypt it and when | high | medium | Sol persona, proposal note |
| A4 | Approve-then-contribute presented as one step removes the "something went wrong" feeling | medium | low | Dani persona |
| A5 | A visible stage indicator across the round (open, closing, proving, proven, paid) removes most "what is happening" questions | medium | medium | journey pain 2 |
| A6 | Encryption in the browser is acceptable to seat holders; nobody wants to run a CLI | medium | low | journey pain 3, specs |
| A7 | The organiser prefers a checklist that shows what is configured over a step-by-step wizard | medium | medium | Ona persona |
| A8 | A proposer who sees the all-or-nothing rule before the cost field sets a cost they can live with | medium | medium | Pau persona |
| A9 | A per-project page is what a proposer shares to campaign, and the entry point most donors arrive through | medium | high | Pau journey |
| A10 | Liquidity providers understand "seats accrue while the liquidity stays" from a live counter | medium | high | Uniswap spec Part B, Sol LP variant |
| A11 | The demo audience (judges) follows a four-minute walkthrough without narration of contract state | high | medium | Ona goals |
| A12 | The operator stays on the command line for the hackathon; the frontend only shows the operator's progress | low | low | personas |

## Hypotheses

Each hypothesis names its screen so the story map can trace back to it. Test artifacts
in order of cost: sentence, sketch, clickable page, built screen.

### H1. Ranking without the rulebook (A1)

We believe donors will cast a ballot that matches their intent without reading the
README if Dani ranks projects with a drag-to-order list that states the tally rule in
one sentence and shows what a tie and an unranked project mean.
**Signal:** in a five-person usability test with the clickable page, at least four cast
the ballot they describe out loud, with no help.
**Test artifact:** clickable page of the ranking screen.
**Screen:** Rank and cast.

### H2. Choosing public or sealed at the moment of casting (A2)

We believe donors will choose the ballot mode deliberately, not by default, if Dani
sees the two modes side by side at cast time with one line each: visible and final,
sealed and replaceable.
**Signal:** every participant can say afterwards which mode they chose and why; the
public option is chosen by at least one participant who gives a reason other than "it
was first". If nobody chooses public with a reason, A2 is invalidated and the public
option becomes a secondary path.
**Test artifact:** the same clickable page as H1.
**Screen:** Rank and cast.

### H3. One step to contribute (A4)

We believe fewer donors will stop between approving and contributing if Dani sees
approve and contribute as one action with two signatures announced up front, and is
told before the first signature that deposits do not come back.
**Signal:** no participant asks why there are two transactions; no participant is
surprised afterwards that deposits are final.
**Test artifact:** built screen against Arc testnet.
**Screen:** Contribute.

### H4. The board keeps the round alive (A2, A5)

We believe donors will return during the voting window if the round page shows public
commitments per project, the sealed total, the number of sealed voters, and a countdown
to the deadline.
**Signal:** in the demo round, at least half of the wallets that contributed open the
round page again before the deadline (page views per address, no tracking beyond the
address already on-chain). Judges can say which project is leading without being told.
**Test artifact:** built screen.
**Screen:** Round.

### H5. One sentence on who can decrypt (A3, A6)

We believe seat holders will cast a sealed ballot in the browser if Sol reads, on the
cast screen, one sentence naming who holds the decryption key and when it is used, and
sees the ballot encrypted locally before signing.
**Signal:** every participant states correctly who can read their ballot; at least four
of five cast without asking a privacy question.
**Test artifact:** clickable page, then built screen.
**Screen:** Rank and cast, sealed variant.

### H6. The current ballot is visible (A3)

We believe seat holders will replace a ballot without fear of voting twice if Sol sees
"your current ballot, cast at T, replaceable until the deadline" and a replace action
that says the previous one is discarded.
**Signal:** no participant asks whether the old ballot still counts.
**Test artifact:** sketch, then built screen.
**Screen:** Your ballot.

### H7. A checklist, not a wizard (A7)

We believe the organiser will open a correctly configured pool on the first attempt if
Ona sees a checklist of what is set, what is missing, and a confirmation that
summarises projects, token, and deadline before the irreversible open.
**Signal:** the demo pool is opened with the intended configuration on the first
attempt; the organiser can list what is configured without reading the chain.
**Test artifact:** sketch, then built screen.
**Screen:** Set up.

### H8. A stage indicator answers "what is happening" (A5, A11)

We believe fewer status questions will be asked in the community chat, and judges will
follow the demo without narration, if every persona sees the round's stage (proposals,
setup, open, closing, proving, proven or provisional or abandoned, paid) with the
dates that bound it.
**Signal:** judges name the current stage unprompted during the walkthrough; the
demo needs no spoken explanation of contract state.
**Test artifact:** sketch, then built component used on every screen.
**Screen:** all; the stage bar.

### H9. The rule before the cost (A8)

We believe proposers will set a cost they can live with if Pau reads "funded at exactly
this amount or not at all" before the cost field and sees a status after submitting:
received, accepted, rejected.
**Signal:** every participant states the all-or-nothing rule after submitting; nobody
asks whether a partial award is possible.
**Test artifact:** clickable page.
**Screen:** Submit a proposal.

### H10. The project page is the link people share (A9)

We believe proposers will share a project page rather than a pool address, and donors
will arrive through it, if Pau has a page per project with the pitch from Swarm, the
cost, its public support, and a rank-this-project entry point.
**Signal:** in the demo round, more than half of first visits by contributing wallets
land on a project page rather than the round page.
**Test artifact:** built screen.
**Screen:** Project.

### H11. Funded and paid are two states (A8)

We believe proposers will not chase anyone for payment if Pau sees funded and paid as
separate states on the project page with a claim action when funded and unpaid.
**Signal:** no participant asks "when do we get paid" after seeing the funded state.
**Test artifact:** sketch, then built screen.
**Screen:** Project.

### H12. Seats that accrue can be understood from a counter (A10)

We believe liquidity providers will claim seats and keep their position if the LP
variant of Sol sees eligible positions with "about N seats if held to the deadline",
and after claiming a counter of seats so far and projected, with the sentence "seats
accrue while the liquidity stays; claiming early earns more".
**Signal:** a v4 liquidity provider explains back, in their own words, why claiming
early is better; the demo shows one counter accruing and one stopping.
**Test artifact:** sketch reviewed with one liquidity provider, then built screen.
**Screen:** Your positions.

## Learning log

| Date | Hypothesis | Result | What changed |
|---|---|---|---|
| 2026-09-12 | H9 | partly built, untested | the submit, board, review and edit screens landed in `web/`; the rule-before-cost panel (S1.1) is still to build; no participant has been tested |

## Diagnostic

Scored against the skill's eight rows: assumptions declared, yes; hypotheses with
pre-committed signals, yes; lowest-fidelity artifact per hypothesis, yes; whole-team
design, not applicable with one decision-maker; weekly research, no; outcomes over
outputs, yes, every signal is a behaviour; dual-track with the build workflow, yes
through the story map; a recently invalidated hypothesis, none yet. About 7 of 10. The
missing rows are closed by running the H1, H2, and H5 clickable tests with five people
and recording the first result in the learning log.

## History

- 2026-09-12: first draft after the Discover phase.
