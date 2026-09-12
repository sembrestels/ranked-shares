# Proto-personas

Working profiles of the people the RankedShares frontend is built for. These are
hypotheses assembled from the product notes and specs, not from interviews. Every claim
that has not been checked with a real person is tagged `[ASSUMPTION]`. Quotes are
drafted to sound like the persona and are tagged `[DRAFTED]`; replace them with real
ones as interviews happen. Method: proto-personas (Gothelf, *Lean UX*), via the
`proto-persona` skill. Process: `docs/design/PROCESS.md`.

Sources used: `README.md`, the public-versus-private voting proposal
(`docs/superpowers/notes/2026-09-05-public-private-voting-proposal.md`), the sealed
ballot and Uniswap LP seat specs, and the ETHOnline hackathon notes.

## Who is in the room

| Role | Weight | Ballot | Frontend need | Persona |
|---|---|---|---|---|
| Donor | own deposit | public and final, or private and replaceable | contribute, rank, choose mode, watch the round | **Donor Dani** (primary) |
| Seat holder | sponsored seats (address list, NFT, or Uniswap v4 LP position) | private only, replaceable | claim seats, rank privately, confirm the ballot landed | **Seat-holder Sol** (secondary) |
| Organiser | none, or sponsor's treasury | none | create pool, add projects, sponsor seats, open voting, sweep | **Organiser Ona** (secondary) |
| Proposer | none, unless they also donate | none as proposer | get listed with the right cost and recipient, campaign, follow support, learn the outcome, receive the funds | **Proposer Pau** (secondary) |
| Operator | none | none | run the tally and the proof | runbook and CLI, not the frontend |
| Observer | none | none | public board, sealed total, proof status | same screens as Dani, read-only |

The frontend is designed for the four named personas. Observer needs are covered by
screens those personas already use. The operator stays on the command line for the
hackathon `[ASSUMPTION]`.

---

## Donor Dani (primary)

### Bio and context
- Puts their own money into a funding round because they care which projects win, in
  amounts from tens to a few thousand USDC `[ASSUMPTION]`
- Has used a wallet before and holds USDC, but does not read contracts; has been burned
  by a confusing approval flow at least once `[ASSUMPTION]`
- Follows the round from a phone as often as from a laptop, checks in several times
  during a voting window `[ASSUMPTION]`
- Belongs to the community behind the round (a DAO, a grants programme, an
  association) and knows some of the project teams personally `[ASSUMPTION]`

### Quotes
- "If I put 500 in, I want people to see I backed this project. That is half the point."
  `[DRAFTED]`
- "I ranked three projects. Where does my money actually go if the first one is
  already funded?" `[DRAFTED]`
- "Can I change my mind? What does 'final' mean here, exactly?" `[DRAFTED]`

### Pains
- Direct donations strand money in projects that never reach their goal, or overfund
  the popular one while the second choice gets nothing (from the proposal note)
- Public votes invite bandwagons and last-hour swings; private votes make the round
  feel dead for three weeks (from the proposal note)
- Cannot predict what a ranked ballot does to their money without understanding the
  tally rule `[ASSUMPTION]`
- Two transactions where one was expected (approve, then contribute) feels like
  something went wrong `[ASSUMPTION]`

### What Dani is trying to accomplish
- Get their money to the highest-ranked project that still needs it, with the
  remainder flowing down the ranking
- Choose, per ballot, between a visible irrevocable commitment and a sealed
  replaceable one, and understand the trade before signing
- See the round move: public commitments per project, the sealed total, and whether
  their own ballot counted

### Goals
- Feel that the outcome was fair and proportional, not captured by whoever shouted
  last
- Be seen by peers as having backed the right projects, when they choose to be seen
- Spend a few minutes, not an evening, on the whole flow

### Attitudes and influences
- **Decision-making authority:** full, it is their own money
- **Decision influencers:** project teams they know, the public board itself, the
  community chat `[ASSUMPTION]`
- **Beliefs and attitudes:** trusts what is on-chain more than what a website says;
  suspicious of "your vote is private" claims unless told plainly who can decrypt
  `[ASSUMPTION]`; will abandon a flow that asks for a signature it cannot explain
  `[ASSUMPTION]`

---

## Seat-holder Sol (secondary)

### Bio and context
- Votes with money an organisation put behind their address: a member on a sponsor's
  list, a holder of the sponsor's NFT, or a liquidity provider in the DAO's Uniswap v4
  pool who claims seats from a position
- Did not choose to be in the round; was told about it by the sponsor `[ASSUMPTION]`
- May hold a view the sponsor would not like, and knows the sponsor can see the chain
  `[ASSUMPTION]`
- The LP variant is more technical than the member variant and already manages
  positions in a v4 interface `[ASSUMPTION]`

### Quotes
- "It's not my money, so why should anyone see how I voted?" `[DRAFTED]`
- "I clicked claim. Do I have seats now? How many? It says accruing." `[DRAFTED]`
- "If I send a new ballot, does the old one disappear, or did I just vote twice?"
  `[DRAFTED]`

### Pains
- In a five-seat sponsorship, a public ballot tells the sponsor exactly how each member
  voted (from the proposal note)
- A public verifiable ballot is a receipt that enables vote buying and coercion (from
  the proposal note)
- Seats that accrue over time are hard to reason about: the number changes and the
  reason is not visible `[ASSUMPTION]`
- Encryption happens in the browser and produces nothing the voter can recognise as
  their vote afterwards `[ASSUMPTION]`

### What Sol is trying to accomplish
- Claim the seats they are entitled to in one transaction and see the count
- Cast a ranking that no one, including the sponsor, can link back to them
- Replace the ballot before the deadline without doubt about which one counts

### Goals
- Vote honestly without social or financial consequence
- Be confident the ballot was included in the tally even though it is never revealed
- Not have to understand ciphertexts, hashes, or proofs to trust the result

### Attitudes and influences
- **Decision-making authority:** over the ranking only; the weight and the sponsorship
  are the sponsor's
- **Decision influencers:** the sponsor's stated preference, fellow members
  `[ASSUMPTION]`
- **Beliefs and attitudes:** privacy claims are believed only when the mechanism is
  explained in one sentence `[ASSUMPTION]`; "replaceable until the deadline" is
  reassuring only if the UI shows the current ballot's status `[ASSUMPTION]`

---

## Organiser Ona (secondary)

### Bio and context
- Runs the round on behalf of a DAO, foundation, or association; often also the
  sponsor whose treasury funds seats for members or LPs
- Comfortable with a wallet and a block explorer; has deployed or configured contracts
  through a UI before but does not write Solidity `[ASSUMPTION]`
- Accountable to members for a fair process and to project teams for a clear
  timeline `[ASSUMPTION]`
- For the hackathon demo, this is also the presenter walking judges through the flow

### Quotes
- "I need to add eight projects with costs and recipients, open voting, and tell people
  when it closes. Then I should not have to touch it." `[DRAFTED]`
- "Members must be able to vote against my favourite without me knowing." `[DRAFTED]`
- "What happens to the money nobody voted with?" `[DRAFTED]`

### Pains
- Setup is a sequence of contract calls with no view of what has been configured so
  far `[ASSUMPTION]`
- Choosing between the three pool variants (on-chain, Noir, ZisK) and, for sealed
  pools, understanding what the operator can and cannot see
- Explaining to members why sponsored seats have no public option (from the proposal
  note)
- After the deadline the round depends on the operator delivering a tally and a proof;
  the organiser has no control and needs to know the status `[ASSUMPTION]`

### What Ona is trying to accomplish
- Configure a pool (token, projects with costs and recipients, sponsorships, deadline)
  and open it without mistakes
- Give members and LPs a link that gets them from nothing to a cast ballot
- Close the round, see the funded set with the proof status, and sweep what is left

### Goals
- A round that members regard as fair and that the organisation can point to publicly
- Running the next round with less effort than the first
- A demo that a judge understands in four minutes

### Attitudes and influences
- **Decision-making authority:** full over pool parameters; treasury spending may
  need a governance vote first `[ASSUMPTION]`
- **Decision influencers:** members, project teams, the operator's advice on variant
  choice `[ASSUMPTION]`
- **Beliefs and attitudes:** prefers a checklist to a wizard `[ASSUMPTION]`; wants
  irreversible actions (open voting, sweep) confirmed explicitly `[ASSUMPTION]`

---

## Proposer Pau (secondary)

### Bio and context
- Leads a small team, or works alone, asking the round for a fixed amount to do one
  specific thing; sets the cost themselves and names the address that receives it
  `[ASSUMPTION]`
- Applies off-chain: pitches to the organiser, who lists the project. Has no contract
  action of their own until the pool is done (from the contract: only the owner adds
  projects; anyone may trigger the payout)
- Knows several donors personally and campaigns in the community chat during the
  voting window `[ASSUMPTION]`
- Applies to more than one round or grants programme at a time and treats each as a
  grant application with a deadline and a decision date `[ASSUMPTION]`
- Cares about whether and when the money arrives far more than about how the tally
  works `[ASSUMPTION]`

### Quotes
- "We asked for 4k because that is what it costs. If we get 3.9k we get nothing? Then
  say so up front." `[DRAFTED]`
- "The board shows 1.2k public behind us and 'sealed: 18k in total'. Are we close or
  not?" `[DRAFTED]`
- "Voting closed two days ago. Who presses the button, and when do we get paid?"
  `[DRAFTED]`

### Pains
- Funding is exactly the cost or nothing: a cost set too high loses everything and one
  set too low leaves the work underfunded (from the README and the contract spec)
- The cost and recipient are fixed once listed; a typo in the address or a wrong
  number cannot be corrected after voting opens (from the contract: no edit function)
- During the window, public commitments show per project but sealed support is only a
  pool-wide total, so the proposer cannot tell how close they are (from the proposal
  note)
- After the deadline the result waits on the operator's tally and, for sealed pools, a
  proof; the proposer has no lever and no status `[ASSUMPTION]`
- On-chain a project is just a cost and an address; the pitch lives in a form or a chat
  message, so donors see nothing about the work unless the frontend carries it
  `[ASSUMPTION]`

### What Pau is trying to accomplish
- Get listed with the right cost and the right recipient address, and check both before
  voting opens
- Get donors and seat holders to rank the project, using a link that lands on it
- Learn the outcome the moment it is final and receive the funds without chasing anyone

### Goals
- Fund the work in one round rather than piecing it together across programmes
- Be judged on the pitch, not on who campaigned last `[ASSUMPTION]`
- Keep the relationship with the organiser and the community when not funded, so the
  next application is easier `[ASSUMPTION]`

### Attitudes and influences
- **Decision-making authority:** over the cost and the recipient address only; whether
  the project is listed is the organiser's call and whether it is funded is the voters'
- **Decision influencers:** the organiser's guidance on a reasonable ask, the costs
  funded in previous rounds, other proposers `[ASSUMPTION]`
- **Beliefs and attitudes:** reads "funded" as "paid" and is confused by any gap
  between the two `[ASSUMPTION]`; trusts a sealed tally only if the proof status is
  visible next to the result `[ASSUMPTION]`; will share the round's link widely if the
  project page presents the work well `[ASSUMPTION]`

---

## Gaps and validation plan

- No persona has been checked with a real person. The first interviews should be two
  donors and two sponsored members from a community that has run a grants round.
- The LP flavour of Sol is the least understood; one conversation with a v4 liquidity
  provider would test the "one click, seats accrue" expectation.
- Whether donors actually want the public option, or whether it exists to make the
  round feel alive for observers, is the assumption with the largest design impact.
- The operator is excluded from the frontend on the assumption that the hackathon
  operator is the team itself.
- Pau is drafted from the contract's view of a project (a cost and a recipient) and
  from how grants rounds usually run. One conversation with a team that applied to a
  grants round would test whether they want live support figures during the window or
  whether that mainly invites campaigning, which is the assumption with the largest
  impact on the project screen.
- Whether the frontend should carry the pitch (title, description, links) alongside the
  on-chain cost, and where that text lives, is open.

## History

- 2026-09-05: first draft from repo notes, all assumptions untested.
- 2026-09-12: added Proposer Pau, the project that receives the funds, as a secondary
  persona.
