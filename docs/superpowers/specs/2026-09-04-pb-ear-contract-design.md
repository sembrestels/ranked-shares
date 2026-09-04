# RankedShares: on-chain PB-EAR participatory budgeting

## Context

Build a Solidity implementation of the **PB Expanding Approvals Rule (PB-EAR)** from
Aziz & Lee, *Proportionally Representative Participatory Budgeting with Ordinal
Preferences* (AAAI-21, `aziz2021.pdf`), whose reweighting scheme comes from Aziz & Lee,
*The expanding approvals rule* (Social Choice and Welfare 2019, `aziz2019.pdf`).
PB-EAR takes weak ordinal rankings over costed projects and a budget, and selects a set
of projects satisfying **Inclusion PSC (IPSC)**, a proportional-representation axiom,
in polynomial time.

Decisions already made with the user:

- EVM / Solidity, Foundry. One round per deployment.
- **Contribution-weighted**: money deposited into the pool is both the budget and the
  source of voting weight. Voting weight of an address = its own contributions + the
  seats organisations sponsored for it. One ballot per address, applied to its whole
  weight; weight is maintained live and frozen when the tally starts.
- Organisations sponsor a group by depositing and naming either an explicit address
  list or an ERC-721 collection. `seats` is optional for NFTs: 0 means "use
  `totalSupply()`" (revert if unsupported).
- Fully on-chain, stepwise tally: anyone calls `step()`; each call funds one project or
  advances the rank level.
- Ballots are weak rankings (ties allowed). Unranked projects form the last tier.
- Tie-break among eligible projects: highest current weighted support, then **lowest
  cost**, then lowest project id.
- After the tally: funded projects' recipients pull their cost; leftover stays in the
  pool and is sweepable by the owner.
- Single ERC-20 asset fixed at deployment.
- Two contracts: an abstract algorithm engine `PBEAR` and a thin pool `RankedShares`,
  plus a Python reference implementation used by fuzz tests through `ffi`.

Working directory: `/home/sem/Projects/ranked-shares` (currently only the two PDFs, no
git repo).

---

## Part A: Specification

### A1. Mapping the paper to the contract

Paper symbol | Contract
---|---
`L` budget limit | `budget` = `totalWeight` frozen at `startTally`
`b_i` voter weight | `weight[i]` = contributions + sponsored seat shares (token units)
`n = Σ b_i` | `totalWeight` = Σ of **all deposits** (contributions + sponsorship amounts), maintained at deposit time, independent of ballots
`w(c)` project cost | `cost[c]`
threshold `n·w(c)/L` | exactly `cost[c]`, because `totalWeight == budget` always
`A_i^(j)` | `{ c : rank_i(c) ≤ j }` where `rank_i` is a competition rank (see A2)
reweighting | uniform fractional (2019 paper), integer-exact via cumulative rounding (A4)

**Invariant: `totalWeight == budget`.** Every token deposited is one unit of voting
weight, whether or not its holder ever votes. Money that is never attached to a ballot
(addresses without a ballot, unclaimed NFT seats, per-seat division dust) is "abstaining
weight": it counts in `n`, never supports any project, and is therefore never spent. It
stays in the pool for `sweep`. A project is funded when the unspent weight of voters
whose ballot ranks it within the current level reaches its cost, and exactly its cost is
then deducted from them. No rounding occurs anywhere except the `perSeat` division.

Consequences: IPSC (Definition 5) holds for every coalition of actual voters, with the
same proof as the paper's Proposition 7. Exhaustiveness holds only when all weight is
behind ballots; otherwise the tally can end with affordable but unsupported projects
unfunded, which is the intended reading of "unvoted money is not spent".

### A2. Ballot encoding

A ballot is `bytes` of length `m` (number of projects). Byte `c` is the rank of project
`c`: `1 + number of projects the voter strictly prefers to c`. Tied projects share a
rank; `0` means unranked. Examples for `a ≻ b ∼ c ≻ d`: `[1,2,2,4]`. Empty preference
(indifferent between all): all zeros.

Validation (`InvalidBallot` otherwise):
- length == `m`;
- every non-zero rank ≤ `m`;
- competition-ranking property: for every rank value `r` that is used,
  `r == 1 + (number of projects with a non-zero rank < r)`. Checked in O(m) with a
  memory count array.

Effective rank used by the tally: the stored rank if non-zero, else
`defaultRank = 1 + numberRanked`, precomputed per voter when the ballot is set. Every
effective rank is ≤ `m`, so at `j = m` every voter with a ballot approves every project.

### A3. Engine state (`PBEAR.sol`, abstract)

```
uint256[] internal _costs;                    // project id = index, m ≤ 255
address[] internal _voters;                   // every address that ever got weight or a ballot
mapping(address => bool)    internal _isVoter;
mapping(address => uint256) internal _weight; // live before tally, "unspent" during tally
mapping(address => bytes)   internal _ballot; // length m, or length 0 = no ballot
mapping(address => uint8)   internal _defaultRank;

uint256 public totalWeight;   // Σ of all weight ever added minus removed; == budget
uint256 public budget;        // L = totalWeight frozen at _startTally
uint256 public rankLevel;     // j, starts at 1
uint256 public spent;         // Σ cost of funded projects
mapping(uint256 => bool) public funded;
uint256[] public fundedOrder;
bool public tallyStarted;
bool public tallyDone;
```

Internal API for the pool:
- `_addProject(uint256 cost) returns (uint256 id)` — reverts on zero cost or `m == 255`.
- `_increaseTotalWeight(uint256)` — adds deposited money to `totalWeight`. The pool
  calls it for every deposit, so `totalWeight` is the sum of all deposits.
- `_grantWeight(address, uint256)` / `_revokeWeight(address, uint256)` — register voter
  if new; move weight to or from a voter **without** changing `totalWeight`. Invariant
  `Σ _weight ≤ totalWeight` is asserted. Weight not granted to anyone is abstaining.
- All three revert once `tallyStarted`.
- `_setBallot(address, bytes ranks)` — validate; register voter if new. Does not touch
  `totalWeight`. Reverts once `tallyStarted`.
- `_startTally()` — reverts if already started or no projects; sets
  `budget = totalWeight`, `rankLevel = 1`, `tallyStarted = true`, emits `TallyStarted`;
  marks `tallyDone` immediately if `_isExhausted()` (nothing affordable).

Public API:
- `step()` — one iteration (A4). Reverts unless `tallyStarted && !tallyDone`.
- `run(uint256 maxSteps)` — calls `step()` until done or `maxSteps` reached.
- Views: `projectCount()`, `cost(id)`, `voterCount()`, `weightOf(addr)`,
  `ballotOf(addr)`, `effectiveRank(addr, id)`, `abstainingWeight()`, `isExhausted()`,
  `fundedProjects()`.

Events: `ProjectFunded(uint256 id, uint256 support, uint256 rankLevel)`,
`RankAdvanced(uint256 rankLevel)`, `TallyStarted(uint256 budget, uint256 totalWeight)`,
`TallyDone(uint256 spent)`.

### A4. `step()` algorithm

```
support = new uint256[m] (memory)
// pass 1: weighted j-approval scores
for each voter i:
    w = _weight[i]; if w == 0 continue
    b = _ballot[i]; if b.length == 0 continue        // no ballot: not a voter
    d = _defaultRank[i]
    for c in 0..m-1: if !funded[c] and effRank(b, d, c) ≤ rankLevel: support[c] += w

// eligibility and choice (threshold(c) == cost[c] because totalWeight == budget;
// support ≤ remaining weight == budget - spent, so an eligible project always fits)
best = NONE
for c in 0..m-1:
    if funded[c] continue
    if support[c] < cost[c] continue
    if best == NONE
       or support[c] > support[best]
       or (support[c] == support[best] and cost[c] < cost[best])   // lower id wins on full tie
       then best = c

if best == NONE:
    if rankLevel >= m: tallyDone = true; emit TallyDone; return
        // every ballot already approves everything; what is left is abstaining weight
    rankLevel += 1; emit RankAdvanced; return

// pass 2: exact uniform fractional reweighting of best's supporters
T = support[best]; thr = cost[best]
cum = 0
for each voter i (same order):  if supporter of best at rankLevel:
    w = _weight[i]
    newCum = cum + w
    deduct = mulDiv(newCum, thr, T) - mulDiv(cum, thr, T)   // Σ deduct == thr exactly, each ≤ w
    _weight[i] = w - deduct; cum = newCum
funded[best] = true; fundedOrder.push(best); spent += cost[best]
emit ProjectFunded
if _isExhausted(): tallyDone = true; emit TallyDone
```

`_isExhausted()`: no unfunded project with `cost ≤ budget - spent` (O(m)).

Termination: at most `m` fundings and `m - 1` rank advances. The tally ends either
exhausted, or at `rankLevel == m` with nothing eligible, which happens exactly when the
remaining affordable projects are backed only by abstaining weight.

Complexity per `step()`: two passes over voters, each O(m) cheap ops and roughly two
SLOADs per voter (weight + packed ballot, one slot when `m ≤ 31`). Number of steps
≤ `m` fundings + `m` rank advances.

### A5. Pool (`RankedShares.sol`, `is PBEAR, Ownable`)

Constructor: `(IERC20 token, address owner, uint64 votingDeadline)`.

Phases: `Setup → Open → Tally → Done`; `phase()` derives `Done` from `tallyDone`.

Owner, Setup only:
- `addProject(uint256 cost, address recipient) returns (uint256 id)`.
- `openVoting()` — requires ≥ 1 project and `block.timestamp < votingDeadline`.

Anyone, Open and `block.timestamp < votingDeadline`:
Every deposit path does `safeTransferFrom` then `_increaseTotalWeight(amount)`, so
`totalWeight` is always the sum of deposits; the paths differ only in who is granted it:
- `contribute(uint256 amount)` — `_grantWeight(msg.sender, amount)`.
- `sponsor(uint256 amount, address[] members)` — `perSeat = amount /
  members.length`; `_grantWeight(member, perSeat)` for each entry (duplicates simply get
  multiple seats). Division dust stays abstaining. Returns `sponsorshipId`.
- `sponsorNFT(uint256 amount, IERC721 nft, uint256 seats)` — if `seats == 0` call
  `IERC721Enumerable(nft).totalSupply()` (revert `SeatsUnknown` if the call fails or
  returns 0); store `{sponsor, amount, perSeat, seats, claimed, nft}`. Nothing is
  granted yet: the whole amount is abstaining until seats are claimed.
- `claimSeat(uint256 sponsorshipId, uint256 tokenId)` — requires
  `nft.ownerOf(tokenId) == msg.sender`. `prev = seatHolder[id][tokenId]`. If
  `prev == msg.sender` revert `AlreadyHeld`. If `prev == 0`: require
  `claimed < seats` (`NoSeatsLeft`), `claimed++`; else `_revokeWeight(prev, perSeat)`.
  Then `_grantWeight(msg.sender, perSeat)`, `seatHolder[id][tokenId] = msg.sender`.
- `vote(bytes ranks)` — `_setBallot(msg.sender, ranks)`. Allowed even with zero weight.

Anyone:
- `startTally()` — Open and `block.timestamp ≥ votingDeadline`; requires
  `token.balanceOf(address(this)) ≥ totalWeight` (fails for fee-on-transfer tokens);
  `_startTally()`. Tokens sent directly to the contract are not part of the budget and
  are swept with the leftover.
- `step()` / `run()` inherited.
- `claim(uint256 projectId)` — requires `tallyDone`, `funded`, `!claimed`; mark claimed,
  `claimedTotal += cost`, `safeTransfer(recipient, cost)`.

Owner, Done only:
- `sweep(address to)` — transfers `balance - (spent - claimedTotal)`.

No withdrawals of contributions. Fee-on-transfer and rebasing tokens are unsupported
(documented). Reentrancy: state is updated before every transfer; payouts are pull-based.

Custom errors: `WrongPhase`, `DeadlinePassed`, `DeadlineNotReached`, `NoProjects`,
`ZeroCost`, `ZeroAmount`, `TooManyProjects`, `InvalidBallot`, `SeatsUnknown`,
`NoSeatsLeft`, `NotTokenOwner`, `AlreadyHeld`, `NotFunded`, `AlreadyClaimed`,
`TallyNotDone`, `TallyAlreadyStarted`.

Events: `ProjectAdded`, `VotingOpened`, `Contributed`, `Sponsored(id, sponsor, amount,
seats, nft)`, `SeatClaimed`, `Voted`, `Claimed`, `Swept`.

### A6. Reference implementation (`reference/pbear.py`)

Pure Python, stdlib only:
- `pbear(costs, voters, abstaining=0)` where `voters = [(weight, ranks)]`, `ranks` a
  list of ints with 0 = unranked, and `budget = Σ weight + abstaining`. Same integer
  arithmetic (`//`), same tie-break, same cumulative rounding, same voter order.
  Returns the funded ids in order.
- `is_exhaustive(costs, budget, funded)`.
- `is_ipsc(costs, budget, voters, funded)` — brute force over all voter subsets `N'`
  and all candidate subsets `C'` solidly supported by `N'` (every voter in `N'` ranks
  every `c ∈ C'` weakly above every `c ∉ C'`), periphery-set
  `P = ∪_{i∈N'} { c : rank_i(c) ≤ |C'| }`, violation iff some
  `c* ∈ C' \ (P∩W)` has `cost[c*] + cost(P∩W) ≤ b(N')` (since `n == L`).
  Intended for `n ≤ 7, m ≤ 5`.
- CLI: `python3 reference/pbear.py <json>` prints the ABI encoding of `uint256[]`
  (hand-rolled: offset word, length word, items) so Foundry's `vm.ffi` returns bytes
  that `abi.decode` can read.

### A7. Known limits (document in README)

- `step()` gas is O(voters × projects); target is tens to low hundreds of voters. A
  chunked `step` is a possible later extension.
- Weight is proportional to money; a single large contributor can fund any project
  costing at most their deposit by ranking it first. This is the paper's model.
- NFT seats are per token, not per person.
- Money not attached to a ballot (non-voters, unclaimed seats, per-seat dust) is never
  spent; it stays in the pool for `sweep`. Exhaustiveness is therefore only guaranteed
  when every unit of weight is behind a ballot. IPSC holds exactly in all cases.

---

