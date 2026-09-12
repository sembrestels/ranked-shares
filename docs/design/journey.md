# Current-state journey maps

How each persona gets through a round today, before any frontend exists. Every
touchpoint is a shell command, a deploy script, the prover CLI, a block explorer, or a
chat message. Method: customer journey map (alignment diagrams), via the
`journey-mapping` skill. One map per persona along the pool's shared stages.
Personas: `docs/design/personas.md`. Jobs: `docs/design/jobs.md`.

**Based on:** the README lifecycle tables, the Arc runbook
(`docs/superpowers/notes/2026-09-05-zisk-arc-runbook.md`), the sealed-ballot specs, and
the confirmed proto-personas. No interviews; feelings and thoughts are inferred and
inherit the personas' `[ASSUMPTION]` status. Map type: current state.

Syntax: actions start with a verb, thoughts are questions, feelings are adjectives with
a sentiment from `--` to `++`, pain points start with a gerund, opportunities start with
a change verb. Moments of truth are marked **MoT**.

## The shared timeline

| Stage | Who acts | What happens on-chain | How long |
|---|---|---|---|
| 1 Propose | proposer, organiser | nothing yet; the intended flow is a submit form, content in Swarm, hash on-chain, organiser accepts | days to weeks |
| 2 Set up | organiser | deploy the pool, add projects with cost and recipient, open voting | one sitting, if nothing goes wrong |
| 3 Fund and claim | donor, sponsor, seat holder | approve and contribute; sponsor an address list or an NFT collection; claim seats | minutes each |
| 4 Rank and cast | donor, seat holder | a public final ballot, or an encrypted replaceable one | minutes, repeated for replacements |
| 5 Wait | everyone | the public board moves; the sealed total grows; deadline approaches | the voting window, typically weeks |
| 6 Close and tally | anyone, then the operator | close the roster in chunks; fetch, prove, submit; or step the on-chain tally | tens of minutes to hours after the deadline `[ASSUMPTION]` |
| 7 Pay out | anyone, owner | claim per funded project; sweep the leftover | minutes, whenever someone triggers it |

---

## Donor Dani

**Scenario:** hears about a round in the community chat, contributes, ranks, watches, and
sees whether the projects they backed were funded.
**Scope:** the invitation → the funded set announced.

### Stage 3: Fund

- **Goal:** get money into the pool as voting weight.
- **Actions:** find the pool address in chat; approve the token with `cast`; call
  `contribute`; check the explorer to see the balance moved.
- **Touchpoints:** community chat, a wallet or `cast`, the block explorer.
- **Thinking:** "Is this the right address?" "Why are there two transactions?" "Can I get
  it back if I change my mind?" (no: there are no withdrawals)
- **Feeling:** wary, `-`.
- **Pain points:** copying an address from chat; signing an approval with no explanation;
  learning after the fact that deposits are final.
- **Opportunities:** show the pool, its token, and its deadline before asking for money;
  present approve-and-contribute as one step; state that deposits do not come back
  before the first signature.
- **MoT:** the first signature. This is the big hire.

### Stage 4: Rank and cast

- **Goal:** turn the deposit into a ranking that routes money the way Dani means it to.
- **Actions:** read the ballot encoding in the README; hand-build a byte string such as
  `0x01020300`; call `vote`; decide beforehand whether it is public and final or, on a
  sealed pool, run the prover CLI's `encrypt` and call `voteSealed`.
- **Touchpoints:** the README, `cast`, the prover CLI for sealed ballots.
- **Thinking:** "Which byte is which project?" "What does a tie do?" "If my first choice
  gets funded without me, where does my money go?" "What does final mean?"
- **Feeling:** lost, `--`.
- **Pain points:** encoding a ranking by hand; choosing public versus sealed with no
  explanation of the trade; needing a native CLI to encrypt; getting no confirmation
  that the ballot was accepted beyond a transaction hash.
- **Opportunities:** replace the byte string with a drag-to-rank list; explain the tally
  rule in one sentence at the ranking step; explain public versus sealed at the moment
  of choice; encrypt in the browser; show the cast ballot back to the voter.
- **MoT:** pressing cast. The most important screen in the product.

### Stage 5: Wait

- **Goal:** see the round move and know the ballot counted.
- **Actions:** call `votersFrom` or read the explorer's event log; ask in chat.
- **Touchpoints:** block explorer, chat.
- **Thinking:** "Is my side winning?" "Did my vote register?" "When does it close?"
- **Feeling:** disengaged, `-`.
- **Pain points:** reading raw events to see support; getting no per-project view at
  all; seeing no deadline countdown.
- **Opportunities:** publish a board with public commitments per project, the sealed
  total, and the deadline; show the voter's own ballot status.

### Stage 6 and 7: Result

- **Goal:** learn what was funded and whether the result is trustworthy.
- **Actions:** wait for the operator; call `finality` and `fundedProjects`; read the
  `Finalized` event on the explorer.
- **Touchpoints:** explorer, chat announcement.
- **Thinking:** "Who ran the tally?" "Can I check it?" "Did my money end up where I
  ranked it?"
- **Feeling:** relieved if funded, suspicious if not, `-` to `+`.
- **Pain points:** waiting with no status between deadline and result; reading a
  finality code as a number; having no way to see where their own weight went.
- **Opportunities:** show the funded set with the proof status in words; show what each
  voter's weight funded; link to the audit path.
- **MoT:** seeing the result. The ultimate moment, where Dani becomes an advocate or not.

---

## Seat-holder Sol

**Scenario:** the sponsor tells Sol they have seats and sends a link; Sol claims, votes
sealed, and replaces the ballot once.
**Scope:** the sponsor's message → the ballot replaced and confirmed.

### Stage 3: Claim seats

- **Goal:** take the seats and know how many.
- **Actions:** receive the sponsorship id and pool address from the sponsor; for an NFT
  sponsorship call `claimSeat` with a token id, for an address list do nothing; read
  `weightOf` to find the weight.
- **Touchpoints:** sponsor's message, `cast`, explorer.
- **Thinking:** "Do I have seats now?" "How many?" "It says accruing, what does that
  mean?"
- **Feeling:** confused, `-`.
- **Pain points:** not knowing whether an address-list seat needs claiming (it does
  not); needing the sponsorship id and token id from someone else; reading weight as a
  raw integer in token base units.
- **Opportunities:** land the sponsor's link on a page that says "you have N seats" or
  "claim your seats"; make the claim one transaction; show weight in the token's units.
- **MoT:** the claim. The big hire for someone who did not ask to be in the round.

### Stage 4: Cast sealed

- **Goal:** rank honestly and be certain no one can read it.
- **Actions:** run the prover CLI's `encrypt` with the tallier's public key, their
  address and ranks; call `voteSealed` with the ciphertext; to replace, do it again.
- **Touchpoints:** a native CLI, `cast`.
- **Thinking:** "Who holds the decryption key?" "Is the sponsor able to read this?" "Did
  the old ballot disappear or did I vote twice?"
- **Feeling:** exposed, `--`.
- **Pain points:** installing a Rust toolchain to encrypt a vote; trusting a privacy
  claim with no explanation of who can decrypt; getting a ciphertext back that looks
  like nothing; not seeing which ballot currently counts.
- **Opportunities:** encrypt in the browser from the same rank list donors use; state in
  one sentence who can decrypt and when; show "your current ballot was cast at T,
  replaceable until the deadline"; make replacement explicit.
- **MoT:** pressing cast. Same screen as Dani's, with the privacy sentence added.

### Stage 5 to 7: Wait and result

- **Goal:** know the ballot was included without it ever being revealed.
- **Actions:** nothing to do; read the `Finalized` event; ask the sponsor.
- **Touchpoints:** explorer, sponsor.
- **Thinking:** "Was mine counted?" "Can the sponsor tell from the result how I voted?"
- **Feeling:** uncertain, `-`.
- **Pain points:** having no inclusion signal for a ballot that is never opened; seeing
  the result without knowing what the proof covers.
- **Opportunities:** show the sealed voter count and that this address is in it; explain
  in one line what "proven" covers.

---

## Organiser Ona

**Scenario:** runs a round for a DAO: collects proposals, deploys and configures a
sealed pool, opens it, waits, and closes it.
**Scope:** deciding to run a round → the leftover swept.

### Stage 1: Propose

- **Goal:** collect projects with a cost and a recipient each.
- **Actions:** post a call for proposals in chat or a form; collect costs and addresses
  by hand; decide which to list.
- **Touchpoints:** chat, a form, a spreadsheet.
- **Thinking:** "Is this address right?" "Is this cost reasonable for the budget?"
- **Feeling:** busy, `0`.
- **Pain points:** retyping recipient addresses; keeping the pitch somewhere donors will
  never see it; having no record of what was accepted or rejected.
- **Opportunities:** accept proposals from the submit form with the content in Swarm and
  the hash on-chain, so acceptance is a click and the pitch travels with the project.

### Stage 2: Set up

- **Goal:** configure the pool once, correctly, and open it.
- **Actions:** choose a variant; deploy the verifier once per chain; make a key salt and
  a tallier key with the prover CLI; run the deploy script with a dozen environment
  variables; call `addProject` per project; call `openVoting`.
- **Touchpoints:** `forge script`, the prover CLI, `cast`, the runbook.
- **Thinking:** "Which variant?" "What can the operator see?" "Did I set the deadline in
  the right units?" "Have I added all eight?" "What happens if I open with a typo?"
- **Feeling:** anxious, `--`.
- **Pain points:** assembling a dozen environment variables by hand; getting no view of
  what has been configured before opening; opening being irreversible with no
  confirmation; explaining the variant choice to nobody but themselves.
- **Opportunities:** replace the environment block with a checklist that shows what is
  set and what is missing; explain the variants by who can see what; confirm opening
  explicitly with a summary of projects, deadline, and token.
- **MoT:** opening voting. Irreversible, and the first thing members see.

### Stage 3 and 5: Sponsor and wait

- **Goal:** put treasury money behind members and let the round run.
- **Actions:** call `sponsor` with an address list, or `sponsorNFT` with a collection;
  send members the pool address and instructions; answer questions in chat.
- **Touchpoints:** `cast`, chat.
- **Thinking:** "Have members claimed?" "Is anyone voting?" "Why can't members vote
  publicly?"
- **Feeling:** exposed to questions, `-`.
- **Pain points:** writing voting instructions for a CLI flow; watching claim and vote
  counts through raw events; fielding the "why is my vote sealed" question repeatedly.
- **Opportunities:** give members a link that lands one step from a ballot; show the
  organiser claimed seats and cast counts; answer the sealed-only question on the page.

### Stage 6: Close and tally

- **Goal:** get a result the members accept, with a proof.
- **Actions:** call `close` in chunks until `closed`; hand over to the operator; wait
  about thirty minutes; check `finality`.
- **Touchpoints:** `cast`, the operator, the explorer.
- **Thinking:** "Who calls close?" "Is the operator running?" "What if the proof never
  arrives?" (the grace paths: provisional acceptance or abandonment)
- **Feeling:** dependent, `-`.
- **Pain points:** closing in gas-limited chunks by hand; having no status while the
  operator proves; understanding the grace paths only from the README.
- **Opportunities:** show the pool's phase and the tally's progress; let the frontend or
  the workflow drive `close`; explain the grace paths as a timeline with dates.
- **MoT:** the proof arriving. Where Ona's promise of fairness is kept or not.

### Stage 7: Pay out

- **Goal:** pay the funded projects and recover the leftover.
- **Actions:** call `claim` per funded project, or wait for someone to; call `sweep`.
- **Touchpoints:** `cast`.
- **Thinking:** "Has every funded project been paid?" "How much is left, and why?"
- **Feeling:** finished, `+`.
- **Pain points:** triggering claims one by one; explaining abstaining weight to members.
- **Opportunities:** claim all funded projects in one action; show the leftover with its
  reason (abstaining weight, unfunded projects); confirm sweep explicitly.

---

## Proposer Pau

**Scenario:** has a piece of work costed; applies to the round; campaigns; gets funded
or not; gets paid.
**Scope:** the call for proposals → the payout received.

### Stage 1: Propose

- **Goal:** get the project into the round with the right cost and address.
- **Actions:** answer the organiser's call in chat or a form; send a cost and a recipient
  address; wait.
- **Touchpoints:** chat, a form.
- **Thinking:** "Did they get it?" "Is it in?" "Should I have asked for less?" "If we get
  3.9k of 4k, do we get nothing?" (yes, nothing)
- **Feeling:** hopeful then uneasy, `0` to `-`.
- **Pain points:** waiting in silence between submission and acceptance; learning the
  all-or-nothing rule too late to set the cost with it in mind; having no way to check
  that the listed address is theirs.
- **Opportunities:** submit through a form that states the all-or-nothing rule before
  the cost field; store the pitch in Swarm and bind its hash on-chain; show a status
  (received, accepted, rejected) with the listed cost and address to verify.
- **MoT:** submission. The big hire; the cost chosen here decides everything.

### Stage 5: Campaign and wait

- **Goal:** get donors and seat holders to rank the project.
- **Actions:** post the pool address and a project id in chat; explain to supporters how
  to vote with `cast`; watch the explorer.
- **Touchpoints:** chat, explorer.
- **Thinking:** "How do I even tell people to vote for us?" "Is anyone doing it?"
- **Feeling:** frustrated, `-`.
- **Pain points:** having no link that lands on the project; explaining a CLI to
  supporters; seeing only what everyone sees, which today is raw events.
- **Opportunities:** give every project a page with the pitch from Swarm, its cost, its
  public support, and a rank-this-project entry point; make the page the thing Pau
  shares.

### Stage 6 and 7: Result and payout

- **Goal:** learn the outcome the moment it is final and get paid.
- **Actions:** watch for the `Finalized` event; check `fundedProjects`; call `claim` or
  wait for someone else to.
- **Touchpoints:** explorer, `cast`, chat.
- **Thinking:** "Who presses the button?" "Funded means paid?" "When?"
- **Feeling:** anxious then relieved, `-` to `++`.
- **Pain points:** finding out from chat rather than from the round; reading funded as
  paid when claim has not been triggered; triggering the claim themselves.
- **Opportunities:** notify or show the outcome on the project page the moment finality
  is set; show funded and paid as two states; let the recipient claim from the page.
- **MoT:** the payout landing. The ultimate moment for Pau.

---

## Moments of truth across the four maps

| Moment | Persona | Why it decides the relationship |
|---|---|---|
| First signature (approve and contribute) | Dani | Irreversible deposit; the big hire |
| Pressing cast | Dani, Sol | The ranking and the public-or-sealed choice are the product |
| Claiming seats | Sol | First contact for someone who did not ask to be here |
| Opening voting | Ona | Irreversible; the first thing members see |
| The proof arriving | Ona | The fairness promise kept or broken |
| Submitting the proposal | Pau | The cost chosen here decides all or nothing |
| Seeing the result and the payout | Dani, Pau | The ultimate moment; advocacy or not |

## Pain points that cut across personas

1. **Encoding by hand.** Ballots are byte strings, weights are base-unit integers,
   finality is a number. Every persona reads or writes a raw encoding at least once.
2. **No status between stages.** Submitted-to-accepted, deadline-to-proof,
   funded-to-paid. Each gap is silent and each persona fills it by asking in chat.
3. **Native tooling for a browser task.** Sealed ballots need the prover CLI; the specs
   already plan browser encryption for the cre and zisk variants.
4. **Irreversible steps with no confirmation.** Contribute, vote (public), open voting,
   sweep. Each is one `cast send` away.
5. **The pitch lives nowhere the voter looks.** On-chain a project is a cost and an
   address; the intended Swarm-and-hash flow fixes this.

These five, with the moments of truth above, are the input to the Define phase's
hypotheses and story map.

## History

- 2026-09-12: first draft from the runbook, the README, and the confirmed personas.
  Awaiting the decision-maker's confirmation of the pain points, which closes the
  Discover gate.
