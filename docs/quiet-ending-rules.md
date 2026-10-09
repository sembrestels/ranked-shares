# Quiet Ending and Slow Quiet Ending: the rules

Draft, 6 October 2026. This replaces the lock-in mechanism of the first Quiet Ending
proposal ("proposals that held are settled, proposals that flipped get an extension").
It keeps that proposal's goal: nobody should win by moving last.

There are two systems here. **Quiet Ending** extends a round only when a tier's result
changed. **Slow Quiet Ending** is an optional switch on top of it: every tier gets a
pause of its own, so the result is always revealed in three parts. Rules 1 to 7
describe Quiet Ending; the section after them says what the switch changes.

## The idea in short

A day before the deadline the round takes a first tally of every tier. At the deadline
it tallies again and compares the two, one tier at a time: first everyone's S tier,
then A, then B. A tier whose two tallies agree is confirmed and the comparison moves
on. If they all agree, the round ends on its deadline.

The first tier that does not agree stops the comparison. The tiers above it are
final and are published as partial results. Voting continues on that tier and the ones
below it, for half as long each time, until two tallies in a row agree.

The result is the same one the plain Blossom Budgeting tally gives on the ballots as
they stand at the end.

## Terms

- **Tier:** the S, A or B group of proposals on a ballot. Proposals a voter leaves out
  are "unplaced".
- **Tally of a tier:** the normal tally, started from the tiers above it and the weight
  their supporters have left, and stopped once this tier has been counted for every
  voter.
- **Open tier:** a tier that is not confirmed yet.
- **Window:** the time between two tallies that are compared.
- **Supporter:** a voter who would pay part of a proposal's cost in a given tally.

## The rules

### 1. The roll closes at the deadline

New ballots are accepted until the deadline. After it, only holders who already voted
can change their ballots. Each voter's share is the pool divided by the number of
ballots in at the deadline, and it does not change afterwards.

### 2. Every tally covers all the open tiers, in order

A tally counts S first, then A, then B, each tier starting from what the tiers above
it would fund in that same tally. The first tally is taken one day before the
deadline, the second at the deadline, and one more at the end of every extension.
Proposals a voter left unplaced are folded into the B slot: when B is confirmed, the
tally runs on through them to the end, with no comparison of their own.

### 3. Tiers are confirmed in order, and the first one that changed stops the round

1. Each tally is compared with the previous one, tier by tier, starting with the first
   open tier.
2. If the two agree on a tier (rule 4), that tier is confirmed and the comparison
   moves on to the next one.
3. If every tier is confirmed, the round ends. When this happens at the deadline, the
   round has no extension at all.
4. If the two do not agree on a tier, the comparison stops there. Nothing from that
   tier or the ones below it is confirmed. Voting continues for 12 hours, and a new
   tally is compared with the previous one in the same way.
5. A tier that fails again gets half the time: 6 hours, then 3, and so on down to
   about one minute. Every tier starts its own count at 12 hours.
6. When a tier has no window left, its latest tally is confirmed as it stands, and the
   comparison moves on.

That is at most 10 extensions and always less than a day per tier, so a round with
three tiers ends less than three days after its deadline.

### 4. Two tallies agree when both the result and the payers are the same

A tier is confirmed when:

- both tallies fund the same proposals in that tier, and
- for those proposals, no more than a set amount of cost has changed hands (suggested:
  2% of the pool).

The second condition compares each voter's share of each proposal's cost, not the
amount they pay. It catches a group that stops supporting a proposal which still
passes, leaving others to pay for it. It is not triggered by a donation that lowers a
proposal's ask and leaves everyone paying in the same proportions.

### 5. A confirmed tier is accepted whole, from the latest tally

Nothing in a tier is paid while the tier is still open. When it is confirmed, all its
funded proposals are accepted together, and each is paid by its supporters in the
latest tally. Earlier tallies are only used for comparison and charge nobody.

### 6. Confirmed tiers are locked

Once a tier is confirmed, no voter can change that tier on their ballot. Voters can
still rearrange the open tiers.

### 7. Supporters of a provisionally funded proposal cannot step back

From the moment a tally is taken, a voter who is a supporter of a proposal that tally
funds in an open tier cannot remove it or move it to a lower tier until that tier is
confirmed. A revised ballot that does so is refused. The voter can still:

- add proposals to a tier, and
- move the proposals they are not bound to.

Each new tally renews the list: supporters of proposals it funds are bound, and
supporters of proposals that dropped out are released. The first tally binds from one
day before the deadline.

## Slow Quiet Ending

With the switch on, rules 1 and 4 to 7 stay as they are. Rules 2 and 3 are replaced:

### 2S. Tiers are tallied one at a time

A tally covers the first open tier only. Every tier has a slot of two days, and the
slots are fixed before the round opens: they do not overlap, and the S slot starts one
day before the deadline. A tier's first tally is taken at the start of its slot,
whenever the tier before it was confirmed. The unplaced proposals are folded into the
B slot as in rule 2.

### 3S. A tier is settled by the first quiet window that ends as it began

With fixed slots nothing is extended, so here every window is called a quiet window
and named by its length: the 24h quiet window, the 12h quiet window, the 6h one, and so
on. A tier that is confirmed is called settled.

1. A tier's first tally opens a quiet window of 24 hours. At its end the tier is
   tallied again, and the two tallies are compared.
2. If they agree (rule 4), the tier is settled. The next tier gets its first tally
   when its own slot starts.
3. If they do not, a new quiet window opens, half as long: 12 hours, then 6, then 3,
   and so on, with the halving and the minimum of rule 3.
4. When no quiet window is left, the latest tally is settled as it stands.

That is at most 11 quiet windows and always less than two days per tier, so a tier is
always settled before its slot ends. Its winners are presented in public at the end of
the slot, on a date known in advance; since every tally is public, the result is known
from the moment the tier is settled, up to a day earlier. With the slots back to back,
a round in which nothing moves ends four days after its deadline, and no round ends
later than five days after it.

Rule 7 then binds the supporters of one tier at a time, since only one tier has a
tally.

## The two side by side

| | Quiet Ending | Slow Quiet Ending |
| --- | --- | --- |
| First tally, a day before the deadline | Every tier | The S tier |
| After a tier is confirmed | The next tier is compared at once | The next tier gets its first tally when its slot starts, and waits 24 hours |
| A round with a quiet last day ends | At the deadline | 4 days after it, with the slots back to back |
| Latest possible end | Less than 3 days after the deadline | Less than 5 days after it |
| Results are announced | All at once, or tier by tier if something moved | Presented in three parts, on fixed dates |
| Time a lower tier has after the one above is final | None if it stood still in the last window; otherwise its own extensions | At least 24 hours |

## A round, day by day

Voting lasts 7 days. Times are counted from the deadline. In both rounds a late group
moves two proposals of the S tier on the last day, and nothing else changes.

Quiet Ending:

| When | What happens |
| --- | --- |
| 1 day before | First tally of S, A and B. Supporters of the proposals it funds are bound (rule 7). |
| Deadline | The roll closes. Second tally. The S tier differs, so nothing is confirmed: 12 more hours, with every tier open. |
| +12 h | Third tally. S matches the previous one and the payers are the same: the S tier is confirmed, its proposals are accepted and paid. A and B match too, so they are confirmed, the tally runs through the unplaced proposals, and the round ends. |

Slow Quiet Ending:

| When | What happens |
| --- | --- |
| 1 day before | First tally of the S tier. Its supporters are bound. |
| Deadline | The roll closes. The 24h quiet window ends with a second S tally. It differs: a 12h quiet window opens. |
| +12 h | Third S tally. It matches: the S tier is settled. |
| +1 day | The S slot ends and the S tier's winners are presented. The A slot starts: first tally of the A tier. |
| +2 days | The 24h quiet window ends with a second A tally. It matches: the A tier is settled. |
| +3 days | The A tier's winners are presented. The B slot starts: first tally of the B tier. |
| +4 days | The 24h quiet window ends with a second B tally. It matches: the B tier is settled and the round ends. |
| +5 days | The B tier's winners are presented. |

With the slots back to back, winners are presented on days 2, 4 and 6 after the first
S tally. The slots can also be set further apart, to put each presentation on a chosen
date.

## Donations

A public donation lowers a proposal's ask. The tally is all or nothing for each
proposal, so it only checks whether the proposal can be funded at its ask at that
moment. A donation therefore counts from the next tally on, like any other change: if
it alters a tier's result, that tier is not confirmed. A donation that only makes the
bill smaller does not extend anything, because rule 4 compares shares. Donations to
proposals already accepted change nothing.

## What the rules guarantee

Checked by the tests listed below, for both systems; none of this is a formal proof.

- **The result is the plain tally of the final ballots.** In every simulated round, and
  in the small random rounds with heavy revisions (24,000 for Quiet Ending, 184,000
  for Slow Quiet Ending), the funded proposals and the order they were funded in were
  exactly those of the plain tally. This is what carries the proportionality guarantee
  over.
- **Weight is never used twice.** A voter's payments never exceed their share, each
  funded proposal is paid exactly its cost, and the pool is never overspent.
- **A late move can be answered.** A change in a tier's result, or a large shift in who
  pays, keeps that tier open.
- **A funded result is final.** Once a tier is confirmed, nothing later can fund or
  unfund its proposals.
- **The round has a known end.** Each tier takes less than a day of extensions with
  Quiet Ending, and less than two days in all with Slow Quiet Ending.
- **Quiet Ending costs nothing when the last day is quiet.** The round ends at its
  deadline with the plain result.

## What they do not do

- **They do not stop a voter from declining to support a proposal before the first
  tally.** That happens in public with at least a full window for others to respond.
- **They do not remove the last window.** A move in the final one-minute window of a
  tier cannot be answered. Reaching it takes a real change in every window before it,
  and under rule 7 each one is a commitment. In the simulations no attack reached it
  with rule 7 in force.
- **They do not prevent redirecting support.** A voter can add a proposal that is
  funded ahead of one they are bound to, and so carry less of the second one's cost.
  They pay for the first instead. Rule 4 notices it when the shift is large.
- **Quiet Ending does not give a lower tier time of its own unless it moved.** A and B
  can be confirmed in the same tally that settles S, if they stood still through the
  last window, however short that window was. Slow Quiet Ending always gives them a
  day with the tiers above already final.

## Still to decide

- **Who rule 7 binds.** As written, the supporters of every open tier. Binding only the
  first open tier is simpler to explain but lets a group step back from A and B
  proposals on the last day.
- **Whether the halving restarts for each tier** (as written) or runs once for the
  whole round, which would end every round less than a day after its deadline and
  leave lower tiers very short windows.
- **The payment threshold** in rule 4.
- **The first comparison.** The first tally is taken before the roll closes, when
  shares are larger. The suggestion is to take each tally with the shares of its own
  moment, as the live result showed them.
- **The shortest window.** A ballot only counts once it is recorded on-chain, so
  windows shorter than the time that takes cannot be used by ordinary voters. One
  minute assumes votes can be submitted directly during extensions.

## Evidence

Simulated on the 49 initiatives of TheDAO Security Fund (asks reduced by 25% and capped
at $200,000), a $1,000,000 pool and 200 invented badge holders, 30 rounds each. Unless
it says otherwise, a late group votes during the last day, which moves the S tier in
every round.

| | Quiet Ending | Slow Quiet Ending |
| --- | --- | --- |
| Rounds ending on the plain tally of the final ballots | 30 of 30 | 30 of 30 |
| Time after the deadline, nothing moving on the last day | none | about 73 hours |
| Time after the deadline, with the late group | about 17 hours on average, 30 at most | about 85 hours on average, 96 at most |
| A group stepping out of funded proposals, no rules 4 and 7 | its category gains about 22% | its category gains about 21% |
| The same, with rules 4 and 7 | no gain; about 51 ballots refused per round | no gain; about 59 ballots refused per round |
| A group flip-flopping to reach the last window, no rule 7 | 45 tiers closed by the schedule in 30 rounds | the S tier closed by the schedule in every round |
| The same, with rule 7 | no tier closed by the schedule; five tallies at most | the tier is confirmed in two or three tallies |
| A group pushing a new proposal every window | runs out after 10 tallies at most, and loses funding for its own category | runs out after 9 windows at most, and loses funding for its own category |
| A group stepping out of A and B proposals on the last day | the crude version tried lost the group funding; it is refused in full only if rule 7 binds every open tier | cannot happen: A and B have no tally yet |

The model gives the unplaced proposals a window of their own in Slow Quiet Ending,
which rule 2S does not. It also takes a tier's first tally at the moment the tier
before it is confirmed, not at the start of a fixed slot, so its times for Slow Quiet
Ending are not the ones the rule gives.

Alternatives that were tried and set aside:

- **Locking individual proposals in or out** (the first proposal). Locked-out proposals
  could not be funded however much support they gained, and the result depended on how
  locked-in costs were charged.
- **Accepting proposals one by one inside a tier.** It usually gave the plain result
  but not always, because it fixes the order of payment before the tier is settled.
- **Letting new voters join after the deadline.** It moved the result away from the
  plain tally and lengthened the S tier.
- **Sealing the last day's ballots with a hard deadline.** A group stepping out gained
  about as much as with public ballots.

The model and tests are in [`reference/`](https://github.com/sembrestels/ranked-shares/tree/quiet-ending/reference):

- Quiet Ending is `run_on_time` in [`quiet_ending_steps.py`](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/quiet_ending_steps.py),
  tested in [`test_quiet_ending_on_time.py`](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_on_time.py).
- Slow Quiet Ending is `run_daily` in the same file, tested in
  [`test_quiet_ending_daily.py`](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_daily.py) and
  [`test_quiet_ending_scale.py`](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/test_quiet_ending_scale.py).
- [`quiet_ending_sim.py`](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/reference/quiet_ending_sim.py) is the simulator:
  `python3 reference/quiet_ending_sim.py 30` prints the figures for both.

The proposal these rules belong to is [Quiet Ending · Blossom Budgeting](https://github.com/sembrestels/ranked-shares/blob/quiet-ending/docs/quiet-ending.md).
