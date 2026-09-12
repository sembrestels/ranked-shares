# Jobs to be done

The progress each persona wants to make, in the circumstances where they reach for a
funding round, and the forces that decide whether they hire this product for it. Method:
jobs to be done (Christensen, *Competing Against Luck*), via the `jobs-to-be-done` skill.
Personas: `docs/design/personas.md`. Process: `docs/design/PROCESS.md`.

Job statements never name the product or a mechanism. They describe progress that would
be true whatever tool served it. Untested claims are tagged `[ASSUMPTION]`; claims from
the public-versus-private voting proposal
(`docs/superpowers/notes/2026-09-05-public-private-voting-proposal.md`) are marked
(proposal note).

## Summary

| Persona | Main job, in one line | Biggest competitor |
|---|---|---|
| Donor Dani | Put money behind the projects I believe in so that it does the most good across them, and be seen doing it when I choose | Donating directly to one project |
| Seat-holder Sol | Have a say in where the organisation's money goes without anyone knowing how I used it | Not voting |
| Organiser Ona | Run a round the community accepts as fair, with the least hands-on work between opening and paying out | A form, a chat vote, and a multisig |
| Proposer Pau | Get the work funded in one go by the community that will use it | Applying to a grants programme with a committee |

---

## Donor Dani

### Job statements

1. **Main.** When a community I belong to opens a funding round and I have money I am
   willing to put in, I want my money to reach the projects I rank highest that still
   need it, so I can know it did the most good it could rather than piling onto one
   project or sitting stranded.
2. When I decide how to cast, I want to choose whether my backing is visible or sealed
   and understand what each choice costs me, so I can be public where I want credit
   and private where I do not want pressure.
3. When the round is running, I want to see it move, so I can tell whether my side is
   winning and whether my own ballot counted.

### Three dimensions

| Dimension | Dani wants |
|---|---|
| Functional | Money lands on the highest-ranked project that needs it; the rest flows down the ranking; nothing is stranded |
| Emotional | Confidence that the outcome is fair and proportional, not captured by the loudest or the last (from the persona) |
| Social | Seen by peers as having backed the right projects, on their own terms `[ASSUMPTION]` |

### Forces

| Force | What it is |
|---|---|
| Push | Direct donations strand money in projects that never reach their goal, or overfund the popular one while the second choice gets nothing (proposal note). Public-only votes swing in the last hour; private-only rounds feel dead for weeks (proposal note) |
| Pull | One deposit, a ranking, and the tally does the routing. A public option that shows peers what they backed (proposal note) |
| Anxiety | "Where does my money actually go if the first one is already funded?" Two transactions where one was expected. A signature the flow cannot explain `[ASSUMPTION]`. "Final" for public ballots is irrevocable |
| Habit | Sending tokens straight to a project's address, or backing a friend's project by hand and telling them `[ASSUMPTION]` |

Anxiety is the force to design against: the tally rule has to be explained in one
sentence at the moment of ranking, and the approve-then-contribute pair has to read as
one step.

### Competition for the job

- Donating directly to one project (the incumbent behaviour, and what the proposal note
  argues against)
- A quadratic funding round elsewhere, which also pools and routes but does not rank
- A token-weighted snapshot vote that spends a treasury, where the donor does not put
  in their own money
- Doing nothing: reading the round and not contributing, the largest competitor for a
  donor who is not sure the mechanism will treat their money well `[ASSUMPTION]`

### Big hire and little hire

- **Big hire:** the first contribution in a round. Won or lost on whether the ranking
  screen makes the tally believable.
- **Little hire:** coming back during the window to watch the board, and casting again
  in the next round. Won on whether the board shows movement and whether the donor can
  find their own ballot's status `[ASSUMPTION]`.

---

## Seat-holder Sol

### Job statements

1. **Main.** When an organisation I belong to gives me a say over its money and I hold a
   view it might not like, I want to express that view without anyone being able to
   link it to me, so I can vote honestly and stay in good standing.
2. When I am told I have seats, I want to take them and know how many I hold, so I can
   be sure my vote carries the weight I was promised.
3. When I change my mind before the deadline, I want to replace my vote and be certain
   which one counts, so I can act on new information without fear of voting twice or
   not at all.

### Three dimensions

| Dimension | Sol wants |
|---|---|
| Functional | Seats claimed, a ranking cast, the ballot included in the tally, replaceable until the deadline |
| Emotional | Safety: no consequence for an honest vote; certainty that the vote was included even though it is never revealed |
| Social | Remain a member in good standing whatever they voted; not be seen as the one who went against the sponsor `[ASSUMPTION]` |

### Forces

| Force | What it is |
|---|---|
| Push | A public ballot tells the sponsor exactly how each of five members voted (proposal note). A verifiable public ballot is a receipt that enables vote buying and coercion (proposal note) |
| Pull | A sealed ballot no one, including the sponsor, can read; replaceable until the deadline |
| Anxiety | "Do I have seats now? It says accruing." "Did the old ballot disappear or did I vote twice?" Nothing the voter can recognise as their own vote after encryption `[ASSUMPTION]`. Privacy claims that are not explained in one sentence `[ASSUMPTION]` |
| Habit | Voting the way the sponsor suggests, or not voting at all `[ASSUMPTION]` |

The habit force is strong: Sol did not ask to be in the round. The little hire depends
on the invitation link landing them one step from a cast ballot.

### Competition for the job

- Not voting, which is the sponsor's money left abstaining and the largest competitor
- Voting the sponsor's line publicly, which does the functional job and fails the
  emotional one
- A token-weighted vote on a governance platform, where the vote is public by default
- Telling the sponsor privately what they think, which has no weight at all

### Big hire and little hire

- **Big hire:** claiming seats after following the sponsor's link. Won on whether the
  claim is one transaction and the count is shown.
- **Little hire:** casting the ballot and, if needed, replacing it. Won on whether the
  current ballot's status is visible and the privacy mechanism is stated plainly.

---

## Organiser Ona

### Job statements

1. **Main.** When my organisation has money to give to projects and members who expect
   a say, I want to run a round whose result the members accept as fair and that I
   can point to publicly, so I can spend the money without the outcome being disputed.
2. When I set up the round, I want to configure it in one sitting and open it without a
   mistake I cannot undo, so I can hand members a link and stop touching it.
3. When the deadline passes, I want to see which projects are funded, whether the
   result is proven, and what is left over, so I can close the round and pay out with a
   clear conscience.

### Three dimensions

| Dimension | Ona wants |
|---|---|
| Functional | Pool configured (token, projects, sponsorships, deadline), opened, closed, paid out, swept |
| Emotional | Control before opening and calm after: no irreversible step taken by accident, no dependence on the operator without a status `[ASSUMPTION]` |
| Social | Seen by members as having run a fair process and by project teams as having kept a clear timeline (from the persona) |

### Forces

| Force | What it is |
|---|---|
| Push | Setup as a sequence of contract calls with no view of what has been configured `[ASSUMPTION]`. Members asking why sponsored seats have no public option (proposal note). A round that goes quiet for three weeks (proposal note) |
| Pull | Sponsored seats that let members vote without the organiser seeing how; a public board that keeps the round alive; a funded set with a proof attached |
| Anxiety | Choosing among the three pool variants; understanding what the operator can and cannot see; the round depending on the operator after the deadline `[ASSUMPTION]`; sweep and open being irreversible |
| Habit | A form for proposals, a chat or governance-platform vote, and a multisig payout `[ASSUMPTION]` |

### Competition for the job

- A form, a governance-platform vote, and a multisig, which is the current habit and is
  good enough when nobody disputes the outcome `[ASSUMPTION]`
- A hosted grants round on an existing platform, which handles proposals and payouts
  but does not offer sealed member votes or ranking
- A committee that decides, which is fastest and least fair
- Not running a round: keeping the treasury unspent, the non-consumption case

### Big hire and little hire

- **Big hire:** choosing to run this round at all, and picking a variant. Won on
  whether the variant choice is explained in terms of who can see what.
- **Little hire:** each configuration step, opening, accepting proposals, and closing.
  Won on a checklist view of what is configured and explicit confirmation of the
  irreversible steps.

---

## Proposer Pau

### Job statements

1. **Main.** When I have a specific piece of work with a known cost and a community
   that would benefit from it, I want that community to fund it in full in one go, so
   I can start the work instead of assembling money from several places.
2. When I put the proposal in, I want to know that it was received, whether it was
   accepted, and that the cost and address are exactly what I submitted, so I can
   campaign for it with confidence.
3. When the round closes, I want to know the outcome the moment it is final and receive
   the money without chasing anyone, so I can plan the work or move on.

### Three dimensions

| Dimension | Pau wants |
|---|---|
| Functional | Proposal submitted and accepted with the right cost and recipient; funded at cost; paid |
| Emotional | Certainty at each stage: received, accepted, funded, paid. No silence between stages `[ASSUMPTION]` |
| Social | Judged on the pitch, not on campaigning; stay welcome in the community when not funded `[ASSUMPTION]` |

### Forces

| Force | What it is |
|---|---|
| Push | Grants programmes that decide by committee on their own timeline; direct fundraising that stalls short of the goal and strands what was raised `[ASSUMPTION]` |
| Pull | A fixed cost funded exactly or not at all, decided by the people who will use the work, with a published result |
| Anxiety | Setting the cost: too high loses everything, too low underfunds the work. Silence between submitting and acceptance `[ASSUMPTION]`. "Funded" not meaning "paid" `[ASSUMPTION]`. The pitch stored somewhere a donor may not be able to open `[ASSUMPTION]` |
| Habit | Filling in a grants form and waiting; asking a sponsor directly `[ASSUMPTION]` |

### Competition for the job

- A grants programme with an application form and a committee, the incumbent
- Direct crowdfunding of the project alone, where the goal may not be reached
- Asking the organisation's treasury directly through a governance proposal
- Not applying: doing the work unfunded, smaller, or not at all

### Big hire and little hire

- **Big hire:** submitting a proposal. Won on whether the form makes the all-or-nothing
  rule and the cost choice clear before submission.
- **Little hire:** checking status during the round and claiming afterwards. Won on a
  project page that shows the stage the proposal is in.

---

## Diagnostic

Scored against the skill's quick diagnostic, per persona, out of 10.

| Row | Dani | Sol | Ona | Pau |
|---|---|---|---|---|
| Job stated without the product | yes | yes | yes | yes |
| All four forces mapped | yes | yes | yes | yes |
| Emotional and social dimensions known | assumed | assumed | assumed | assumed |
| Non-obvious competition listed | yes | yes | yes | yes |
| Little hire tracked separately | yes | yes | yes | yes |
| Each feature can name its job | not yet, no features | | | |
| Purchase-timeline interviews done | no | no | no | no |
| Three dimensions evidenced (+1) | partly | partly | partly | no |
| No solution name in the job (+1) | yes | yes | yes | yes |
| Non-consumption in competition (+1) | yes | yes | yes | yes |

Current score: about 7 of 10 for each persona. The two missing rows are the same for
all four: no interviews have been run, and the emotional and social dimensions rest on
assumptions. The interviews planned in the personas file's gaps section close both. The
"each feature can name its job" row is checked when the story map is written: every
story should cite one job statement here.

## History

- 2026-09-12: first draft from the confirmed personas and the proposal note.
