# Quiet Ending · Blossom Budgeting

Oct 4, 2026 · @Sem

> **Public results, all the way.** We had two ways to stop a round being decided in its last minutes. One was to seal the ballots. We chose the other: keep every ballot and the running result public from start to finish, and make that openness safe.
>
> With Quiet Ending nobody wins by moving last. If the last day is quiet, the round ends on its deadline with the full result. If something moves late, the tally stops at the tier that moved: the tiers above it are confirmed, and voting on the rest stays open so everyone can answer.
>
> The round only runs longer when it has to. A quiet round costs no extra time. A contested one is settled tier by tier: first the proposals funded from everyone's S tier, then A, then B. Each tier is announced as soon as it has stood unchanged, while voters can still change the tiers below it. Curators who want the winners revealed in three parts whatever happens can switch on Slow Quiet Ending.

## The last ballot should not get the last word.

Blossom Budgeting closes at a fixed deadline. Whoever moves last can change which proposals are funded, and nobody has time to answer. A coalition that waits until the final hours wins by timing, not by support.

We propose Quiet Ending for one reason: when something big changes late, voters need time to react. There are two reactions the round has to leave room for.

- **Backing what is about to lose.** A proposal a voter cares about is suddenly not going to pass. With time, they can move it up their ballot.
- **Noticing who left.** Other supporters have walked away from a proposal. It still passes, but its cost now falls on the few who stayed, and for someone managing a budget that can be far more than they agreed to. With time, they can see the new bill and decide whether it is still worth it.

Quiet Ending is an optional extension for curators. A round whose last day is quiet closes on its deadline. Otherwise the tally stops at the first tier that changed, and that tier gets a quiet ending of its own. If a tier's result changes in its last stretch, voting on that tier stays open a little longer. Every new extension is half as long as the one before, so each tier, and the round, always ends.

## What a quiet ending is

A quiet ending asks one thing of a vote: its final stretch must be quiet. If the result at the deadline is the same as it was when the final stretch began, the vote closes on time. If the result changed, the vote runs longer so everyone else can see it and respond.

Online auctions solve the same problem with a soft close: a bid in the last minutes pushes the closing time back, so nobody wins by sniping. Tao Voting, an Aragon voting app built by Blossom Labs, brought the idea to on-chain governance for single yes-or-no proposals.

Blossom Budgeting is not a yes-or-no vote. Every proposal has its own result, funded or not funded, and the results are tied together: funding one proposal spends money another could have used. So Quiet Ending here works tier by tier. The tally counts everyone's S tier first, then A, then B, and it only goes on to the next tier when the one before has ended quietly.

## No extension unless something moved

A round whose last day is quiet ends on its deadline. The tally runs through S, A, B and the proposals voters left unplaced, and the whole result is final at once.

The round runs longer only when a tier's result at the deadline differs from the first tally. The tally stops at that tier. The tiers above it are confirmed and published as partial results. The tier that changed and the ones below it stay open, and those are the only parts of a ballot voters can still change.

During an extension the provisional result of the open tier is public: which proposals it would fund, and what each voter would pay for them. Everyone can check the bill: that the cost of each proposal falls on the people who backed it all along, not on whoever was left holding it after a move in the last minute. A tier is confirmed and paid only when two tallies in a row show the same proposals and the same payers.

## How it works

1. **The quiet window opens.** One day before the deadline, the round takes a first tally of every tier: which proposals S, A and B would fund, and who would pay for them. Voting carries on as usual, and ballots can still be submitted or replaced.
2. **At the deadline, the roll closes.** No new ballots come in after it, and each voter's share of the pool is fixed.
3. **Compare, tier by tier.** The round is tallied again and compared with the first tally, starting with S. A tier is quiet if both tallies fund the same proposals and each proposal's cost is shared among the same voters in the same proportions.
4. **A quiet tier is confirmed.** All its funded proposals are accepted together and paid by their supporters in the latest tally. The tier is locked on every ballot, and the comparison moves on to the next tier.
5. **If every tier is quiet, the round closes.** The tally runs on through the proposals voters left unplaced, and the round ends on its deadline, with no extension.
6. **The first tier that changed stops the tally.** The tiers confirmed so far are published as partial results. Voting continues for 12 hours, only on the tier that changed and the ones below it.
7. **After the extension, compare again.** The open tiers are tallied and compared with the previous tally, in the same order. Quiet tiers are confirmed. A tier that changed again gets another extension, half as long: 6 hours, then 3. When the next window would be shorter than the minimum, the latest tally is confirmed as it stands. Each tier starts its own count at 12 hours.
8. **Supporters cannot step back.** While a tier is open, a voter who is helping to fund a proposal in its latest tally cannot take it off their ballot or move it down. They can still add proposals and rearrange the tiers below.

## A round in miniature

Take the same nine proposals as the Blossom Budgeting example. Voting lasts 7 days, the quiet window is the last day, and the first extension is 12 hours. The moves below are invented to show the rule, not computed from the example ballots.

| Time | What happens |
| --- | --- |
| Day 6 | Quiet window opens. First tally of every tier: S would fund Fuzzing, Retainer, Blocklist and Simulation, and A would fund Findings DB. |
| Day 6.3 | A late ballot briefly pulls Compiler bug bounty into the S result. |
| Day 6.6 | That voter replaces the ballot and Bounty drops out again. |
| Day 6.8 | Two badge holders who had not voted put the Incident war room in their A tier. It is funded and pushes Findings DB out. |
| Day 7 | Deadline. The roll closes. The S tier matches the first tally, since Bounty's brief flip does not count. S is confirmed: Fuzzing, Retainer, Blocklist and Simulation are accepted and paid, and published as partial results. The A tier differs, so the tally stops there. A and B stay open until day 7.5. |
| Day 7.2 | Supporters of Findings DB add it to their A tier. It is funded again and the war room drops out. |
| Day 7.5 | The A result differs from day 7. Another extension, half as long: A and B stay open until day 7.75. |
| Day 7.75 | The A result matches day 7.5 and the same voters pay. The A tier is confirmed and Findings DB is accepted and paid. The B tier matches too, so the tally runs on through B and the unplaced proposals, and the round closes. |

Had nothing moved on the last day, the whole round would have closed at day 7. As it was, the S tier was confirmed at day 7 and nothing that happened afterwards could touch it. Even if the two contested proposals had kept trading places, the A tier would have closed before day 8, and no round with these settings runs past day 10.

## Why each extension is half the last

With equal extensions, two evenly matched groups could keep a tier open forever by switching their ballots back and forth. Halving makes that impossible. A first extension of 12 hours is followed by 6, then 3, and the total never reaches a day. However the voting goes, every tier closes less than a day after the tier above it, and everyone knows the latest closing time on day one.

Shorter windows also change the incentives. Each counter-move has less time to organise than the move before it, so waiting to strike late stops paying. The safest strategy is to submit a sincere ballot early.

The contest narrows in scope as well as time. Confirmed tiers never reopen, so a late fight can only move the proposals of the tier that is still open. A minimum extension, such as one minute, closes the tier once the next window would be too short to be useful.

## What the rule guarantees

When the end is quiet, nothing changes. If no tier's result changes during the quiet window, every tier is confirmed at the deadline, and the round ends on time with exactly the result plain Blossom Budgeting would give.

A late move can be answered. Any tier whose result changes in its final stretch gets an extension, and every voter can respond during it. Only a move in the very last, shortest window goes unanswered, and reaching that window takes a real change in every window before it.

A confirmed tier is final. Once a tier is confirmed, no later ballot or donation can fund or unfund its proposals. A late fight in one tier cannot ripple back into tiers that were already decided.

The round has a known end. The latest possible closing time is fixed when the round opens: less than a day of extensions for each tier.

The result is the plain tally of the final ballots. Nothing in a tier is paid until the tier is confirmed, and then it is paid from the latest tally, so the proportionality guarantee carries over as it is. Payouts, and the verified tally, follow the actual closing time, not the original deadline.

## Slow Quiet Ending

Slow Quiet Ending is a switch on top of Quiet Ending. It puts a pause after every tier, so the result is revealed in three parts whether or not anything moved.

With the switch on, each tally covers one tier only, and each tier has a slot of two days, fixed before the round opens. A tier's first tally is taken at the start of its slot and opens a quiet window of one day. If the result is the same when the window ends, the tier is settled. If it changed, a new quiet window opens, half as long: 12 hours, then 6, then 3. With fixed slots nothing is extended, so these are all called quiet windows and named by their length. They always add up to less than two days, so every tier is settled before its slot ends, and its winners are presented in public at the end of the slot, on a date known in advance. Because every tally is public, the result is known from the moment the tier is settled, up to a day before it is presented. Everything else stays the same: the comparison, the halving, the locked tiers and the rule that supporters cannot step back.

| | Quiet Ending | Slow Quiet Ending |
| --- | --- | --- |
| First tally, a day before the deadline | Every tier | The S tier only |
| After a tier is confirmed | The next tier is compared at once | The next tier gets its first tally when its slot starts, and waits a full quiet window |
| A 7-day round with a quiet ending closes | On day 7 | On day 11, with the slots back to back |
| Latest possible close | Before day 10 | Before day 12 |
| Results are announced | All at once, or tier by tier if something moved | Presented in three parts, on fixed dates: S, then A, then B |

The pause buys two things. Every tier is settled with the tiers above it already final, so voters know exactly how much money is left when they decide on A and B, and they always get a full day to do it. And the last days of the round become something to follow: first the proposals funded from everyone's S tier, then A, then B, while voters can still change the tiers that are not confirmed yet.

The price is time. A round in which nothing moves still closes four days after its deadline. The guarantees above hold either way; only the closing times change.

## How it fits with the rest of the mechanism

**Results are already public.** Ballots are pseudonymous and the running result is public for the whole round. Quiet Ending reveals nothing new: anyone can follow the snapshot, the result at each deadline and which proposals flipped.

**Every checkpoint is verified.** The same verifier that proves the final tally also proves each checkpoint: that the snapshot and the comparison at each deadline were computed from the ballots committed at that time. Nobody has to trust the operator to decide when the round is extended.

**Every extension names what is open.** The round announces that it is extended, until when, and which tier is still open. Since results are public anyway, this costs no secrecy and tells voters where a response matters.

**Voters can still act.** During an extension, badge holders who voted before the deadline can change the tiers that are not confirmed yet. No new ballots come in after the deadline, so every voter's share of the pool stays the same. Public donations still lower a proposal's ask. Each tally only checks whether a proposal can be funded at its ask at that moment, so a donation counts from the next tally on; donations to proposals that are already accepted change nothing about the result. The comparison looks at each voter's share of a proposal's cost, not the amount, so a donation that only makes everyone's bill smaller does not keep a tier open. One that changes the result does.

## Settings curators choose

Three durations, one amount and one switch, all fixed before the round opens.

| Setting | Meaning | Example |
| --- | --- | --- |
| Quiet window | How long before the deadline the first tally is taken. With Slow Quiet Ending, also how long each later tier waits before its first comparison | 1 day |
| First extension | Length of the first extension; each one after is half the last | 12 hours |
| Minimum extension | Shortest extension worth running; below it, the tier closes | 1 minute |
| Payment tolerance | How much of the cost may change hands, counting each voter's share of each proposal, before a tier is kept open | 2% of the pool |
| Slow Quiet Ending | Whether every tier gets a pause of its own before it is compared | Off |

With these values, a 7-day round with three tiers closes on day 7 if its last day is quiet and never later than day 10. With Slow Quiet Ending on and the slots back to back, it closes on day 11 if nothing moves and never later than day 12.

## Rules and simulations

Everything behind this page is public, for people and agents who want to check it.

- [The rules](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/docs/quiet-ending-rules.md): both systems rule by rule, what they guarantee, what they do not, and the simulation results.
- [The model](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/quiet_ending_steps.py), in Python: `run_on_time` is Quiet Ending and `run_daily` is Slow Quiet Ending.
- [The simulator](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/quiet_ending_sim.py): rounds on 49 real initiatives with 200 invented voters. `python3 reference/quiet_ending_sim.py 30` prints the figures.
- The tests: [Quiet Ending](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_on_time.py), [Slow Quiet Ending](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_daily.py) and [both at scale](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_scale.py).

## Sources

- [Tao Voting](https://github.com/BlossomLabs/tao-voting-aragon-app), Blossom Labs: the quiet-ending mechanism for single yes-or-no votes.
- [How the vote works · Blossom Budgeting](https://blossom.software/budgeting/), Blossom Labs: the tiered ballots and proportional tally this extension builds on.
- Aziz, H., and Lee, B. E. 2021. [Proportionally Representative Participatory Budgeting with Ordinal Preferences.](https://ojs.aaai.org/index.php/AAAI/article/view/16646/16453) Proceedings of AAAI 2021.

Quiet Ending for Blossom Budgeting is a proposed extension. The example round is invented for illustration.
