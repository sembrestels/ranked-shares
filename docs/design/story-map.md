# User story map

The round as the personas live it, left to right, with the work needed at each step
stacked by priority and a release line drawn under the demo slice. Method: user story
mapping (Patton), via the `user-story-mapping` skill. Inputs: personas, jobs, journey
maps, and hypotheses in `docs/design/`. Output: the stories under `docs/design/stories/`
are written from the tasks above the release line.

**Segment:** communities that give money to projects and want members to decide:
DAOs, grants programmes, associations.
**Personas:** Donor Dani (primary), Seat-holder Sol, Organiser Ona, Proposer Pau.
**Narrative:** a community funds the projects its members rank highest, from the call
for proposals to the payout, with every step visible and every ballot honest.

## Releases

| Release | What it is | Bound |
|---|---|---|
| **R1 Demo** | What the ETHOnline submission shows and judges click: one round on Arc testnet, end to end, with sealed seat ballots and Uniswap LP seats | mainnet-ready by 2026-09-30 |
| **R2 First real round** | What a community needs to run a round unattended | after the hackathon |
| **Later** | Everything else the map surfaced | unscheduled |

Tasks are tagged with the release, the persona, and the hypothesis they test. Items
marked **on the line** are in R1 only if their dependency lands; the decision-maker
draws the final line.

## Backbone

| 1 Propose a project | 2 Set up the round | 3 Join with money or seats | 4 Rank and cast | 5 Follow the round | 6 Close and prove | 7 Get paid and close out |
|---|---|---|---|---|---|---|
| Pau, Ona | Ona | Dani, Sol, Ona | Dani, Sol | everyone | Ona, operator | Pau, Ona |

Every screen carries the stage bar (H8): proposals, setup, open, closing, proving,
proven or provisional or abandoned, paid, with the dates that bound the current stage.

---

## 1. Propose a project

**Steps:** write the proposal → submit it → wait for acceptance → verify the listing.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Read the round's rules on the submit page: the all-or-nothing funding rule, the token, the deadline for proposals | R1 | Pau | H9 |
| Fill in title, summary, pitch, cost, and recipient address; see the cost formatted in the token's units | R1 | Pau | H9 |
| Publish the proposal content to Swarm and submit its hash with cost and recipient in one transaction | R1, on the line: needs the proposal contract change (decision record) | Pau | H9, H10 |
| See the proposal's status: received, accepted, rejected | R1, on the line | Pau | H9 |
| Organiser reviews pending proposals with the pitch rendered from Swarm and accepts or rejects each | R1, on the line | Ona | H7 |
| Verify the listed cost and recipient against what was submitted | R1 | Pau | H9 |
| Organiser adds a project directly, without a proposal, for rounds that do not take submissions | R1 | Ona | H7 |
| Edit and resubmit a proposal before acceptance | R2 | Pau | |
| Rejection with a reason shown to the proposer | R2 | Ona, Pau | |
| Read others' proposals before the round opens | Later | Dani | |

## 2. Set up the round

**Steps:** choose the variant → deploy → configure → open.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Choose the pool variant from a comparison in terms of who can see what and who runs the tally | R2 | Ona | H7 |
| Deploy from the frontend with token, deadline, and variant parameters | R2 | Ona | H7 |
| See a setup checklist: token, deadline, projects with cost and recipient, sponsorships, tallier key, what is missing | R1 | Ona | H7 |
| Add a sponsorship: address list, NFT collection, or Uniswap LP pool, with the amount | R1 | Ona | H7 |
| Confirm opening with a summary of projects, token, budget so far, and deadline; state that it is irreversible | R1 | Ona | H7 |
| Copy an invitation link per sponsorship that lands members on their claim screen | R1 | Ona | H5 |
| Preview the round page as members will see it before opening | R2 | Ona | |

For R1 the deploy itself stays in the runbook's scripts; the frontend takes over from
the setup checklist onward.

## 3. Join with money or seats

**Steps:** arrive → connect → contribute or claim → see the weight.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Land on the round page from a shared link; see projects, budget, deadline, stage, without a wallet | R1 | Dani, Sol | H4, H10 |
| Connect a wallet; be told when it is on the wrong chain and switched to Arc | R1 | all | |
| Contribute: enter an amount, see approve and contribute as one action with two signatures, read that deposits are final before the first | R1 | Dani | H3 |
| See own weight after contributing, in the token's units | R1 | Dani | H3 |
| Claim address-list seats: see "you have N seats" with nothing to do, or claim NFT seats in one transaction | R1 | Sol | H5 |
| List the connected wallet's v4 positions, mark eligible ones with the projected seats, say why others are not | R1 | Sol (LP) | H12 |
| Claim LP seats in one transaction and see the accruing counter with the plain sentence | R1 | Sol (LP) | H12 |
| Stop accruing (unsubscribe) with a warning of what is lost | R2 | Sol (LP) | H12 |
| Contribute with a swap-in from another token | Later | Dani | |
| Contribute on behalf of another address | Later | Ona | |

## 4. Rank and cast

**Steps:** rank → choose the mode → cast → see the ballot.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Drag projects into order, allow ties, leave projects unranked; read the one-sentence tally rule and what tie and unranked mean | R1 | Dani, Sol | H1 |
| Choose public and final or sealed and replaceable, side by side with one line each; sealed is the only option for seat weight | R1 | Dani | H2 |
| Cast a public ballot; confirm that it is final before signing | R1 | Dani | H2 |
| Encrypt in the browser and cast a sealed ballot; read who holds the key and when it is used | R1 | Sol, Dani | H5 |
| See "your current ballot", when it was cast, and whether it is final or replaceable until the deadline | R1 | Dani, Sol | H6 |
| Replace a sealed ballot; be told the previous one is discarded | R1 | Sol | H6 |
| Show the ballot as the voter ranked it, decoded from chain for public ballots and from local storage for sealed ones | R2 | Dani, Sol | H6 |
| Preview where the weight would go under the current public board | Later | Dani | H1 |

## 5. Follow the round

**Steps:** open the round page → read the board → check own ballot → share.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Round page: public commitments per project, the sealed total, the sealed voter count, the countdown | R1 | everyone | H4 |
| Project page: pitch from Swarm, cost, public support, recipient, rank-this-project entry | R1, on the line for the pitch; cost and support without it | Pau, Dani | H10 |
| Own ballot status on the round page: cast or not, included in the sealed roster or not | R1 | Dani, Sol | H6 |
| Share a project page or the round page with a link that unfurls | R1 | Pau, Dani | H10 |
| Organiser view: claimed seats and cast counts per sponsorship | R2 | Ona | H7 |
| Activity feed of contributions and public ballots | Later | everyone | H4 |

## 6. Close and prove

**Steps:** deadline passes → close the roster → the tally runs → the result is set.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Stage bar shows closing, with the roster progress, and lets anyone call close in chunks | R1 | Ona | H8 |
| Stage bar shows proving with the operator's progress as reported, and the grace timeline with dates | R1 | Ona, everyone | H8 |
| Show the outcome: funded projects in order, the finality in words, what "proven" covers, a link to the audit path | R1 | everyone | H8 |
| Show provisional and abandoned outcomes with what they mean and what happens next | R1 | Ona | H8 |
| Drive close from the workflow so nobody has to press it | R2 | operator | |
| Show the operator's progress live from the prove service | R2 | Ona | H8 |

## 7. Get paid and close out

**Steps:** see the outcome → claim → sweep → look back.

| Task | Release | Persona | Tests |
|---|---|---|---|
| Project page shows funded and paid as two states, with a claim action when funded and unpaid | R1 | Pau | H11 |
| Claim all funded projects in one action | R2 | Ona | |
| Sweep with an explicit confirmation showing the leftover and why it is left (abstaining weight, unfunded projects) | R1 | Ona | H7 |
| Show each voter where their own weight went | R2 | Dani | H4 |
| Round summary page suitable for a public link after the round | R2 | Ona | |

---

## The R1 slice in one line per persona

- **Pau:** submits a proposal, shares the project page, sees funded then paid, claims.
- **Ona:** finishes setup from a checklist, opens with a confirmation, adds sponsorships,
  watches the stage bar through close and proof, sweeps.
- **Dani:** arrives by link, contributes in one action, ranks, chooses a mode, casts,
  watches the board, sees the outcome.
- **Sol:** arrives by the sponsor's link, claims seats or LP seats, casts sealed in the
  browser, replaces once, sees the outcome.

## Gaps the map surfaced

- The deploy step stays outside the frontend in R1; the organiser still needs the
  runbook for it. Acceptable for the demo, not for R2.
- The proposal flow depends on a contract change that no spec describes yet. Its
  decision record is proposed alongside this map.
- Nothing on the map serves the observer explicitly; the round page does, by being
  readable without a wallet.
- The operator's progress in R1 is whatever the chain shows; live progress needs the
  prove service to expose it (R2).
- The frontend follows the architecture of the decision-maker's other projects
  (`../fund/thedao-rfps/web`): a React Router single-page app plus a small Deno API on
  one Deno Deploy app. The API caches pool reads, indexes LP positions, and uploads
  proposal content; see the four proposed records of 2026-09-12.

## History

- 2026-09-12: first draft with a proposed release line. The decision-maker confirmed the
  R1 line as drawn, including the three on-the-line proposal items, and accepted the
  four technology records the same day. Define gate closed.
