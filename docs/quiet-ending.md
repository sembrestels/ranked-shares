# Quiet Ending · Blossom Budgeting

Oct 4, 2026 · @Sem

> **Public results, all the way.** We had two ways to stop a round being decided in its last minutes. One was to seal the ballots. We chose the other: keep every ballot and the running result public from start to finish, and make that openness safe.
>
> With Quiet Ending nobody wins by moving last. After the deadline the result is settled tier by tier, and a tier is only confirmed once it has stood in public, unchanged, for at least a day. If something moves late, voting on that tier stays open so everyone can answer.
>
> It also makes the last week worth following. The winners are announced in three parts, one every two days: first the proposals funded from everyone's S tier, then A, then B. Between announcements, voters can still change the tiers that are not confirmed yet. The round stays alive to the end, with the guarantees of a quiet ending behind every result.

## The last ballot should not get the last word.

Blossom Budgeting closes at a fixed deadline. Whoever moves last can change which proposals are funded, and nobody has time to answer. A coalition that waits until the final hours wins by timing, not by support.

We propose Quiet Ending for one reason: when something big changes late, voters need time to react. There are two reactions the round has to leave room for.

- **Backing what is about to lose.** A proposal a voter cares about is suddenly not going to pass. With time, they can move it up their ballot.
- **Noticing who left.** Other supporters have walked away from a proposal. It still passes, but its cost now falls on the few who stayed, and for someone managing a budget that can be far more than they agreed to. With time, they can see the new bill and decide whether it is still worth it.

Quiet Ending is an optional extension for curators. After the deadline the tally runs one tier at a time, and each tier gets a quiet ending of its own. If a tier's result changes in its last stretch, voting on that tier stays open a little longer. Every new extension is half as long as the one before, so each tier, and the round, always ends.

## What a quiet ending is

A quiet ending asks one thing of a vote: its final stretch must be quiet. If the result at the deadline is the same as it was when the final stretch began, the vote closes on time. If the result changed, the vote runs longer so everyone else can see it and respond.

Online auctions solve the same problem with a soft close: a bid in the last minutes pushes the closing time back, so nobody wins by sniping. Tao Voting, an Aragon voting app built by Blossom Labs, brought the idea to on-chain governance for single yes-or-no proposals.

Blossom Budgeting is not a yes-or-no vote. Every proposal has its own result, funded or not funded, and the results are tied together: funding one proposal spends money another could have used. So Quiet Ending here works tier by tier. The tally counts everyone's S tier first, then A, then B, and each tier has to end quietly before the next one is counted.

## A pause after every tier

Every time a tier is tallied, the round stops for at least a day. The provisional result is public for that whole day: which proposals the tier would fund, and what each voter would pay for them.

The day is there for two things. Voters can still change the parts of their ballot that have not been counted. And everyone can check the bill: that the cost of each proposal falls on the people who backed it all along, not on whoever was left holding it after a move in the last minute.

Only when a second tally, a day later, shows the same proposals and the same payers is the tier confirmed and paid. What the round pays for is what stood in public for a full day.

## How it works

1. **The quiet window opens.** One day before the deadline, the round takes a first tally of the S tier: which proposals everyone's top tier would fund, and who would pay for them. Voting carries on as usual, and ballots can still be submitted or replaced.
2. **At the deadline, the roll closes.** No new ballots come in after it, and each voter's share of the pool is fixed. From here on, voters can only change the tiers that are not confirmed yet.
3. **Compare.** The S tier is tallied again and compared with the first tally. The tier is quiet if both fund the same proposals and each proposal's cost is shared among the same voters in the same proportions.
4. **A quiet tier is confirmed.** All its funded proposals are accepted together and paid by their supporters in the latest tally. The tier is locked on every ballot, and the next tier gets its first tally.
5. **A tier that changed gets an extension.** Voting on that tier continues for half as long as the window before: 12 hours, then 6, then 3. Each new tally is compared with the previous one. When the next window would be shorter than the minimum, the latest tally is confirmed as it stands.
6. **Supporters cannot step back.** While a tier is open, a voter who is helping to fund a proposal in its latest tally cannot take it off their ballot or move it down. They can still add proposals and rearrange the tiers below.
7. **Then the next tier.** A and B go through the same steps, each with a full day before its first comparison. When B is confirmed, the tally runs on through the proposals voters left unplaced, and the round closes.

## A round in miniature

Take the same nine proposals as the Blossom Budgeting example. Voting lasts 7 days, the quiet window is the last day, and the first extension is 12 hours. The moves below are invented to show the rule, not computed from the example ballots.

| Time | What happens |
| --- | --- |
| Day 6 | Quiet window opens. First tally of the S tier: Fuzzing, Retainer, Blocklist and Simulation would be funded. |
| Day 6.3 | A late ballot briefly pulls Compiler bug bounty into the S result. |
| Day 6.6 | That voter replaces the ballot and Bounty drops out again. |
| Day 6.8 | Two badge holders who had not voted put the Incident war room in their S tier. It is funded and pushes Simulation out. |
| Day 7 | Deadline. The roll closes. War room and Simulation differ from the first tally. Bounty matches it, so its brief flip does not count. The S tier stays open until day 7.5. |
| Day 7.2 | Wallet teams add Simulation to their S tier. Simulation is funded again and the war room drops out. |
| Day 7.5 | The result differs from day 7. Another extension, half as long: the S tier stays open until day 7.75. |
| Day 7.75 | The result matches day 7.5 and the same voters pay. The S tier is confirmed: Fuzzing, Retainer, Blocklist and Simulation are accepted and paid. First tally of the A tier: Findings DB would be funded. |
| Day 8.75 | The A tally is the same a day later. The A tier is confirmed, and the B tier gets its first tally. |
| Day 9.75 | The B tally is the same a day later. The round closes. |

At day 7.75 the S tier was confirmed, and nothing that happened afterwards could touch it. Even if the two contested proposals had kept trading places, the S tier would have closed before day 8, and the whole round before day 12.

## Why each extension is half the last

With equal extensions, two evenly matched groups could keep a tier open forever by switching their ballots back and forth. Halving makes that impossible. A first window of 1 day is followed by 12 hours, then 6, then 3, and the total never reaches 2 days. However the voting goes, every tier closes less than two days after its first tally, and everyone knows the latest closing time on day one.

Shorter windows also change the incentives. Each counter-move has less time to organise than the move before it, so waiting to strike late stops paying. The safest strategy is to submit a sincere ballot early.

The contest narrows in scope as well as time. Confirmed tiers never reopen, so a late fight can only move the proposals of the tier that is still open. A minimum extension, such as one minute, closes the tier once the next window would be too short to be useful.

## What the rule guarantees

When the end is quiet, nothing changes. If no tier's result changes during its window, each tier is confirmed at its first comparison, and the round ends with exactly the result plain Blossom Budgeting would give.

A late move can be answered. Any tier whose result changes in its final stretch gets an extension, and every voter can respond during it. Only a move in the very last, shortest window goes unanswered, and reaching that window takes a real change in every window before it.

A confirmed tier is final. Once a tier is confirmed, no later ballot or donation can fund or unfund its proposals. A late fight in one tier cannot ripple back into tiers that were already decided.

The round has a known end. The latest possible closing time is fixed when the round opens: less than two days for each tier.

The result is the plain tally of the final ballots. Nothing in a tier is paid until the tier is confirmed, and then it is paid from the latest tally, so the proportionality guarantee carries over as it is. Payouts, and the verified tally, follow the actual closing time, not the original deadline.

## How it fits with the rest of the mechanism

**Results are already public.** Ballots are pseudonymous and the running result is public for the whole round. Quiet Ending reveals nothing new: anyone can follow the snapshot, the result at each deadline and which proposals flipped.

**Every checkpoint is verified.** The same verifier that proves the final tally also proves each checkpoint: that the snapshot and the comparison at each deadline were computed from the ballots committed at that time. Nobody has to trust the operator to decide when the round is extended.

**Every extension names what is open.** The round announces that it is extended, until when, and which tier is still open. Since results are public anyway, this costs no secrecy and tells voters where a response matters.

**Voters can still act.** During an extension, badge holders who voted before the deadline can change the tiers that are not confirmed yet. No new ballots come in after the deadline, so every voter's share of the pool stays the same. Public donations still lower a proposal's ask. Each tally only checks whether a proposal can be funded at its ask at that moment, so a donation counts from the next tally on; donations to proposals that are already accepted change nothing about the result. The comparison looks at each voter's share of a proposal's cost, not the amount, so a donation that only makes everyone's bill smaller does not keep a tier open. One that changes the result does.

## Settings curators choose

Three durations and one amount, all fixed before the round opens.

| Setting | Meaning | Example |
| --- | --- | --- |
| Quiet window | How long a tier waits between its first tally and its first comparison | 1 day |
| First extension | Length of the first extension; each one after is half the last | 12 hours |
| Minimum extension | Shortest extension worth running; below it, the tier closes | 1 minute |
| Payment tolerance | How much of the cost may change hands, counting each voter's share of each proposal, before a tier is kept open | 2% of the pool |

With these values, a 7-day round with three tiers closes on day 9 if every tier is quiet and never later than day 12.

## Sources

- [Tao Voting](https://github.com/BlossomLabs/tao-voting-aragon-app), Blossom Labs: the quiet-ending mechanism for single yes-or-no votes.
- [How the vote works · Blossom Budgeting](https://blossom.software/budgeting/), Blossom Labs: the tiered ballots and proportional tally this extension builds on.
- Aziz, H., and Lee, B. E. 2021. [Proportionally Representative Participatory Budgeting with Ordinal Preferences.](https://ojs.aaai.org/index.php/AAAI/article/view/16646/16453) Proceedings of AAAI 2021.

Quiet Ending for Blossom Budgeting is a proposed extension. The example round is invented for illustration.
