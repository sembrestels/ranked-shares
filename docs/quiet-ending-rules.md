# Quiet Ending by tiers: the rules

Draft, 5 October 2026. This replaces the lock-in mechanism of the first Quiet Ending
proposal ("proposals that held are settled, proposals that flipped get an extension").
It keeps that proposal's goal: nobody should win by moving last.

## The idea in short

After the deadline, the tally is run one tier at a time: first everyone's S tier, then
A, then B. Each tier gets its own quiet ending. A tier's result is confirmed only when
two tallies taken some time apart agree; if they do not, voting on that tier continues
for half as long as before. When a tier is confirmed, it is final and the next tier
begins.

The result is the same one the plain Blossom Budgeting tally gives on the ballots as
they stand at the end.

## Terms

- **Tier:** the S, A or B group of proposals on a ballot. Proposals a voter leaves out
  are "unplaced".
- **Tally of a tier:** the normal tally, started from the tiers already confirmed and
  the weight their supporters have left, and stopped once this tier has been counted for
  every voter.
- **Baseline:** the first tally of a tier, which later tallies are compared with.
- **Window:** the time between two tallies of the same tier.
- **Supporter:** a voter who would pay part of a proposal's cost in a given tally.

## The rules

### 1. The roll closes at the deadline

New ballots are accepted until the deadline. After it, only holders who already voted
can change their ballots. Each voter's share is the pool divided by the number of
ballots in at the deadline, and it does not change afterwards.

### 2. Tiers are decided in order, one at a time

S first, then A, then B. A tier's tally only starts when the tier before it is
confirmed. Proposals a voter left unplaced are folded into the B slot: when B is
confirmed, the tally runs on through them to the end, with no window of its own.

### 3. Each tier has its own quiet ending

1. When the tier opens, a baseline tally is taken. For the S tier the baseline is taken
   one day before the deadline; for the others, at the moment the previous tier is
   confirmed.
2. After 24 hours a second tally is taken and compared with the baseline.
3. If the two agree (rule 4), the tier is confirmed.
4. If they do not, voting on that tier continues for 12 hours and a new tally is
   compared with the previous one. Then 6 hours, then 3, and so on, each window half the
   last, down to about one minute.
5. When no window is left, the latest tally is confirmed as it stands.

That is at most 11 windows and always less than two days per tier.

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
still rearrange the tiers that have not been counted yet.

### 7. Supporters of a provisionally funded proposal cannot step back

From the moment a tally of the open tier is taken, a voter who is a supporter of a
proposal that tally funds cannot remove it or give it a worse position until the tier
is confirmed. A revised ballot that does so is refused. The voter can still:

- add proposals to the same tier, and
- move proposals in tiers that have not been counted.

Each new tally renews the list: supporters of proposals it funds are bound, and
supporters of proposals that dropped out are released.

## A round, day by day

Voting lasts 7 days. Times are counted from the deadline.

| When | What happens |
| --- | --- |
| 1 day before | Baseline tally of the S tier. Supporters of the proposals it funds are bound (rule 7). |
| Deadline | The roll closes. Second S tally. A late group has moved two proposals, so the tallies differ: 12 more hours. |
| +12 h | Third S tally. It matches the previous one and the payers are the same: the S tier is confirmed, its proposals are accepted and paid, and S tiers are locked on every ballot. Baseline tally of the A tier. |
| +36 h | Second A tally, 24 hours after its baseline. It matches: the A tier is confirmed. Baseline tally of the B tier. |
| +60 h | Second B tally. It matches: the B tier is confirmed. |

If every tier is given a fixed two-day slot, results are announced on days 2, 4 and 6
after the S baseline, or earlier when a tier is confirmed early.

## Donations

A public donation lowers a proposal's ask. The tally is all or nothing for each
proposal, so it only checks whether the proposal can be funded at its ask at that
moment. A donation therefore counts from the next tally on, like any other change: if
it alters a tier's result, that tier's window is extended. A donation that only makes
the bill smaller does not extend anything, because rule 4 compares shares. Donations to
proposals already accepted change nothing.

## What the rules guarantee

Checked by the tests listed below; none of this is a formal proof.

- **The result is the plain tally of the final ballots.** In every simulated round, and
  in 184,000 small random rounds with heavy revisions, the funded proposals and the
  order they were funded in were exactly those of the plain tally. This is what carries
  the proportionality guarantee over.
- **Weight is never used twice.** A voter's payments never exceed their share, each
  funded proposal is paid exactly its cost, and the pool is never overspent.
- **A late move can be answered.** A change in a tier's result, or a large shift in who
  pays, keeps that tier open.
- **A funded result is final.** Once a tier is confirmed, nothing later can fund or
  unfund its proposals.
- **The round has a known end.** Each tier takes less than two days.

## What they do not do

- **They do not stop a voter from declining to support a proposal before a baseline is
  taken.** That happens in public with at least a full window for others to respond.
- **They do not remove the last window.** A move in the final one-minute window of a
  tier cannot be answered. Reaching it takes ten earlier changes in a row, each a real
  one, and under rule 7 each a commitment. In the simulations no attack reached it.
- **They do not prevent redirecting support.** A voter can add a proposal that is
  funded ahead of one they are bound to, and so carry less of the second one's cost.
  They pay for the first instead. Rule 4 notices it when the shift is large.

## Still to decide

- **Fixed slots or early starts.** Whether a tier that is confirmed early waits for the
  end of its two-day slot before the next one begins.
- **The payment threshold** in rule 4.
- **The first comparison.** The S baseline is taken before the roll closes, when shares
  are larger. The suggestion is to take each tally with the shares of its own moment,
  as the live result showed them.
- **The shortest window.** A ballot only counts once it is recorded on-chain, so
  windows shorter than the time that takes cannot be used by ordinary voters. One
  minute assumes votes can be submitted directly during extensions.
- **Who rule 7 binds.** As written, every supporter of a provisionally funded proposal.

## Evidence

Simulated on the 49 initiatives of TheDAO Security Fund (asks reduced by 25% and capped
at $200,000), a $1,000,000 pool and 200 invented badge holders, 30 rounds each.

| | Result |
| --- | --- |
| Rounds ending on the plain tally of the final ballots | 30 of 30 |
| Time after the deadline | about 84 hours on average |
| Tiers needing an extension | the S tier in nearly every round; A and B almost never |
| A group stepping out of funded proposals, no rules 4 and 7 | its category gains about 21% |
| The same, with rules 4 and 7 | no gain; about 59 ballots refused per round |
| A group flip-flopping to reach the last window, no rule 7 | reaches it in every round |
| The same, with rule 7 | the tier is confirmed in two or three tallies |
| A group pushing a new proposal every window | runs out after 9 windows at most, and loses funding for its own category |

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

The model and tests are in `reference/`: `quiet_ending_steps.py` (`run_daily`),
`quiet_ending_sim.py`, `test_quiet_ending_daily.py` and `test_quiet_ending_scale.py`.
`python3 reference/quiet_ending_sim.py 30` prints the figures.
