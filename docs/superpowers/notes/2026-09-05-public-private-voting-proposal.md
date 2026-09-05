# One pool, two ways to vote

## Where we are stuck

We keep going back and forth on public versus private voting because both are right
about something. Public voting makes the round alive: people see money land, projects
rally their supporters, a leaderboard moves every day. It also brings the well-known
problems: bandwagons, last-minute swings, and the ability to change a vote after seeing
everyone else's. Private voting fixes all of that and gives us a round where nothing
happens for three weeks and then a result appears.

I don't think we have to pick. I think we should let the voter pick, and let the kind of
money decide what the options are.

## The proposal in one paragraph

Everyone votes with weight, and weight is money in the pool. Donors bring their own
money and choose whether their ballot is **public and final** or **private and
replaceable**. Token holders vote with money the organisation sponsored for them, and
their ballots are **always private**. One algorithm, PB-EAR, tallies all of it together
and decides which projects get funded.

## Donors: donate to the pool, not to a project

You proposed direct donations for people and EAR voting for token holders. I want to
keep the spirit of direct donations and drop the mechanism, because the mechanism is a
special case of what PB-EAR already does, and a worse one.

In our model a donation is not sent to a project. It is deposited in the pool, it
becomes the donor's voting weight, and the donor ranks the projects. Then:

- A donor who wants to back exactly one project ranks only that project. That is a
  direct donation. Nothing is lost.
- A donor who ranks several projects gets something a direct donation can't give:
  their money goes to the highest-ranked project that actually needs it. PB-EAR funds a
  project exactly when the weight of its supporters reaches its cost, and it deducts
  exactly the cost, spread proportionally over those supporters. Whatever a donor's
  weight did not have to cover stays theirs and counts for the next project on their
  ballot.

This is the "donate to whoever needs it more" behaviour, and it is not a feature we add
on top. It is what the rule does. Direct donation, by contrast, has two failure modes
we would have to design around by hand:

- **Overfunding.** If a popular project's goal is 5k and it receives 12k in direct
  donations, 7k sits with a project that did not ask for it while a project ranked
  second by the same donors gets nothing. With ranked ballots that 7k flows down.
- **Stranding.** If a project never reaches its goal, direct donations to it are stuck.
  In the pool they were never spent, so they keep supporting the rest of the donor's
  ranking. Only weight whose entire ranking fails stays unspent.

So every donor gets at least what direct donation offers, and most get more. And the
donors and the token holders are voting in the same election under the same rule, so
proportionality holds across the whole pool rather than across two separate pots.

## Donors choose: public and final, or private and replaceable

This is the part that resolves our public-versus-private argument. When a donor casts a
ballot, they pick one of two modes.

**Public.** The ballot is plaintext on-chain, tied to the donor's address and amount,
visible to everyone from the moment it is cast, and it cannot be changed. This is the
signalling vote. A donor who publicly commits 2k behind a project is telling the world
something, and the commitment is credible precisely because it is irrevocable.

**Private.** The ballot is encrypted, replaceable until the deadline, and never revealed.
Not the ranking, not after the tally, not ever. Only the funded set becomes public.
The tally of sealed ballots runs off-chain and comes with a proof, which we already
have in the sealed-seat design.

The trade is symmetric and honest. Visibility costs you flexibility. Flexibility costs
you visibility. Each mode gives up exactly the thing that makes the other mode
exploitable:

- Public ballots can't be changed, so there is no "wait until the last hour and
  switch". What you see on the board is what will be counted.
- Private ballots can't be seen, so there is nothing to bandwagon on or against, and
  no way to prove to a third party how you voted.

The round looks like this from outside: a live board of public commitments per
project, plus one number for how much sealed weight is in the pool. People see the
race and they also see that the race is not the whole story. I think that is more
engaging than either extreme, not less. The public board is real money that is not
going anywhere, and the sealed total is the suspense.

## Token holders: private only

Sponsored seats vote sealed, with no public option. Three reasons.

- **It isn't their money.** A public vote with your own 500 USDC is a signal. A public
  vote with 500 USDC someone else put behind your address is closer to a poll, and
  publishing it mostly serves whoever wants to pressure you.
- **Member protection.** Sponsorships are small groups. If a five-seat sponsorship
  shows five public ballots, everyone knows how each member voted, including the
  sponsor. Sealed and unlinkable means a member can vote against the sponsor's
  favourite without consequence. We decided this already for the sealed-seat design and
  it holds here.
- **Vote buying.** A public, verifiable ballot is a receipt. Sealed ballots have no
  receipt, and replaceability means even a coerced vote can be quietly overwritten
  before the deadline.

The donor's public option does not have this problem because donors are spending their
own money to make the statement, and buying a public donor vote is just donating.

## Summary

| Who | Weight | Modes | Changeable | Revealed |
|---|---|---|---|---|
| Donor | own deposit | public **or** private, donor's choice | public: no, private: until deadline | public: immediately, private: never |
| Token holder | sponsored seats | private only | until deadline | never |

Both flow into one PB-EAR tally. The contract commits to every input at the deadline,
the sealed part is tallied off-chain with a proof, and claims open on the final result.

What I'd like from you: whether you're comfortable dropping direct donation as a
separate path given that "rank one project" reproduces it, and whether the public
board plus a sealed total gives you enough of the engagement you were after.
