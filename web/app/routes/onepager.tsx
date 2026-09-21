import { useMemo } from "react";
import { BLOCS, blocVoters, majorityOutcome, PROPOSALS, SEAT, spendByCamp, tally } from "../lib/onepager";
import { CampKey, PoolBar, Seats, percent, usd } from "../components/onepager/pool-bar";
import { Stepper } from "../components/onepager/stepper";
import { Playground } from "../components/onepager/playground";
import { BlossomMark } from "../components/onepager/blossom-mark";
import { ThemeToggle } from "../components/onepager/theme-toggle";
import "../components/onepager/onepager.css";

const PAPER = "https://ojs.aaai.org/index.php/AAAI/article/view/16646/16453";
const REPO = "https://github.com/sembrestels/ranked-shares";

export function meta() {
  return [
    { title: "How the vote works · Blossom Budgeting" },
    {
      name: "description",
      content:
        "Blossom Budgeting for TheDAO's Round Two: ranked ballots, a proportional tally, sealed votes. An interactive explainer of the PB-EAR rule with a ballot you can fill in.",
    },
  ];
}

const costs = PROPOSALS.map((p) => p.cost);

export default function Onepager() {
  const { budget, majority, proportional } = useMemo(() => {
    const voters = blocVoters();
    const result = tally(costs, voters);
    return { budget: result.budget, majority: majorityOutcome(costs, voters), proportional: result.funded };
  }, []);
  const auditSeats = BLOCS.filter((b) => b.id.startsWith("audit")).reduce((sum, b) => sum + b.seats, 0);
  const auditShare = (funded: number[]) => percent(spendByCamp(funded).audit, budget);

  return (
    <div className="onepager">
      <header className="op-hero">
        <div className="op-wrap">
          <div className="op-masthead">
            <p className="op-brand">Blossom Budgeting <span>a voting mechanism for Round Two, by <BlossomMark /> Blossom Labs</span></p>
            <ThemeToggle />
          </div>
          <h1>51% of the seats should not spend the whole pool.</h1>
          <p className="op-standfirst">
            Round Two asks the ETHSecurity Badge holders to allocate TheDAO Security Fund. Under a majority
            ranking (Condorcet, Borda, most votes first), the largest like-minded group decides every dollar. Blossom Budgeting is a ranked-ballot
            rule that protects representation for groups with shared priorities. Projects first need enough
            initial backing to cover their ask. Below
            is the same small round, tallied both ways.
          </p>

          <figure className="op-compare">
            <Seats />
            <div className="op-compare-row">
              <figcaption>
                <b>Majority ranking</b>
                Auditors hold {percent(auditSeats, 20)} of the seats and direct {auditShare(majority)} of the pool.
              </figcaption>
              <PoolBar funded={majority} budget={budget} label="Majority ranking" />
            </div>
            <div className="op-compare-row">
              <figcaption>
                <b>Blossom Budgeting</b>
                Auditors hold {percent(auditSeats, 20)} of the seats and direct {auditShare(proportional)} of the pool.
              </figcaption>
              <PoolBar funded={proportional} budget={budget} label="Blossom Budgeting" />
            </div>
            <CampKey />
          </figure>
        </div>
      </header>

      <main className="op-wrap">
        <section className="op-section" aria-labelledby="op-miniature">
          <h2 id="op-miniature">A round in miniature</h2>
          <div className="op-prose">
            <p>
              Twenty badge seats, each sponsored with {usd(SEAT)} of the fund, make a {usd(budget)} pool. Nine
              initiatives ask for {usd(costs.reduce((a, b) => a + b, 0))} between them, each with one deliverable
              and one price. The voters fall into five groups with different priorities, which is what a
              security community looks like: auditors want auditing tools, wallet teams want phishing defence,
              responders want response capacity.
            </p>
          </div>

          <div className="op-ballots">
            {BLOCS.map((bloc) => (
              <article key={bloc.id} className="op-ballot" data-bloc={bloc.id}>
                <h3>{bloc.name}</h3>
                <p className="op-ballot-seats">
                  <span aria-hidden="true">{Array.from({ length: bloc.seats }, (_, i) => <i key={i} className="op-seat" data-bloc={bloc.id} />)}</span>
                  {bloc.seats} seats, {usd(bloc.seats * SEAT)}
                </p>
                <ol>
                  {bloc.ranking.map((id) => (
                    <li key={id}>{PROPOSALS[id].title} <span>{usd(PROPOSALS[id].cost / 1000)}k</span></li>
                  ))}
                </ol>
              </article>
            ))}
          </div>

          <div className="op-prose">
            <p>
              A majority ranking orders the proposals by what most voters prefer and funds from the top. Here
              every auditing proposal beats every other proposal head to head, because the same eleven seats
              outvote whoever is on the other side, and the Borda and vote-count orders come out the same.
              Their four proposals cost exactly {usd(budget)}. Fund from the top and the other nine seats, 45% of the
              electorate, get nothing they asked for. Quadratic funding softens this with matching but still
              rewards whatever is most popular. Any rule that asks “what do most voters prefer?” and then
              spends the whole pool on the answer has the same shape.
            </p>
            <p>
              A proportional rule asks a different question: how much of the pool does each group deserve to
              steer? The answer used here was published by Haris Aziz and Barton Lee at AAAI 2021 as the{" "}
              <a href={PAPER}>Expanding Approvals Rule for participatory budgeting</a>, PB-EAR. We add one
              eligibility check before that algorithm: the initial budget shares of voters who explicitly
              rank a proposal must cover its ask. PB-EAR then runs unchanged on the eligible proposals.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-tally">
          <h2 id="op-tally">How the tally works</h2>
          <ol className="op-rules">
            <li>
              <b>Money is weight.</b> Every sponsored seat carries an equal share of the pool, so total voting
              weight always equals the pool balance.
            </li>
            <li>
              <b>Initial backing must cover the ask.</b> Add the full initial weight of every voter who places
              a proposal in any tier, counting each voter once. Remove proposals whose backing is below their
              ask from every ballot. Check once, before spending; keep every seat and its original weight.
            </li>
            <li>
              <b>Start with eligible first choices.</b> A proposal is affordable when the voters who rank it first hold
              enough unspent money to cover its cost. If several are affordable, the one with the most money
              behind it goes first.
            </li>
            <li>
              <b>Current supporters pay, in proportion.</b> The proposal's cost is deducted from the voters
              whose expanded rankings include it, each in proportion to what they still hold. Spent money
              cannot pay for anything else.
            </li>
            <li>
              <b>Widen only when stuck.</b> When nothing is affordable, the tally also counts second choices, then
              third, and so on. Unplaced eligible proposals count as tied last choices. It stops when no
              unfunded eligible proposal fits in what is left or no remaining voting weight can pay for one.
            </li>
          </ol>
          <div className="op-prose">
            <p>
              A proposal asking for 10% of the pool needs explicit backing from at least 10% of the voting
              weight. Passing this check makes it eligible, not guaranteed funding. Step through the example:
              the filter runs first, followed by the same PB-EAR tally code the pool contract is fuzz-tested against.
            </p>
          </div>
          <Stepper />
        </section>

        <section className="op-section" aria-labelledby="op-seat">
          <h2 id="op-seat">Take a seat</h2>
          <div className="op-prose">
            <p>
              This is the ballot a badge holder fills in. You are a twenty-first seat with {usd(SEAT)}. Proposals
              in the same tier are tied. Placing a proposal in any tier counts your seat toward its initial
              backing; leaving it unplaced adds no backing. Eligible proposals you leave unplaced still rank
              below all three tiers during the tally and can receive your remaining money. The incident
              responders hold $15,000 and their war room costs $20,000. The researchers hold $10,000 and their
              course costs $15,000. Your one seat can make either eligible. A direct public donation can also
              lower its ask to meet the threshold, which you can try under the ballot.
            </p>
          </div>
          <Playground />
        </section>

        <section className="op-section" aria-labelledby="op-guarantee">
          <h2 id="op-guarantee">What the rule guarantees</h2>
          <div className="op-prose">
            <p>
              The paper calls it Inclusion PSC, proportionality for solid coalitions. That guarantee applies
              to the eligible proposals: groups that agree on their top choices receive representation
              according to their share, subject to project costs and ties. A group cannot be left short of
              another jointly preferred proposal if its share can cover that proposal plus the funded projects
              counted toward its representation. The wallet teams hold 20% of the seats and all rank their
              $20,000 blocklist first, so it passes the filter and is funded whatever the other 80% do.
            </p>
            <p>
              The filter guarantees that every funded proposal had enough explicit initial backing to cover
              its ask. That backing is not reserved money: the same voters can back several proposals. The
              tally may eventually use a voter's remaining money for an eligible proposal they left unplaced.
              Eligibility is a collective support threshold, not an individual veto on spending.
            </p>
            <p>
              Proposals are funded whole or not at all. The responders alone cannot make a $20,000 war room
              eligible with $15,000 of backing; they need an ally or a donation. Removed proposals have no
              funding guarantee. Any money the tally leaves unspent goes back to the funder.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-round">
          <h2 id="op-round">What comes with the mechanism</h2>
          <dl className="op-features">
            <div>
              <dt>Sealed ballots</dt>
              <dd>
                Each ranking is encrypted in the voter's browser to the round operator's public key. Only the
                ciphertext goes on-chain, and a ballot can be replaced until the deadline. A ballot shown to a
                vote buyer proves nothing, and there is no last-hour bandwagon, while running public totals
                keep the round visible.
              </dd>
            </div>
            <div>
              <dt>A tally nobody has to trust</dt>
              <dd>
                The result is verified on-chain by one of three interchangeable verifiers: a Chainlink CRE
                confidential-compute attestation, chained Noir proofs of every tally batch, or a single ZisK
                zkVM proof that every committed ballot was decrypted with the published key and that the funded
                set follows the rule.
              </dd>
            </div>
            <div>
              <dt>Badge holders vote, the public donates</dt>
              <dd>
                TheDAO Security Fund sponsors the pool to the ETHSecurity Badge collection. Each badge is one
                seat that its current holder claims, around $5,000 per seat on a $1M pool. The public does not
                vote. Anyone can donate directly to an initiative, and every dollar donated is a dollar that
                initiative no longer asks from the pool. A well-supported initiative gets cheaper for the badge
                holders to pass, which is the market signal Round Two is built around.
              </dd>
            </div>
            <div>
              <dt>Co-sponsors choose their voters</dt>
              <dd>
                A co-sponsor deposits stablecoins into the same pool and names who votes with that money: its own
                address, a list of addresses, or an NFT collection. A wallet company can sponsor $50k voted by
                its security team, an L2 can sponsor seats for its builders. Those voters' initial weights count
                toward eligibility, and their rankings guide spending among eligible proposals. Unplaced
                eligible proposals remain tied last choices that can receive their money.
              </dd>
            </div>
            <div>
              <dt>Priced deliverables, paid in full</dt>
              <dd>
                Every proposal states one deliverable, one price in dollars and one recipient. It is funded in
                full or not at all, so each payout matches a concrete scope. Funds go to Safe multisigs
                controlled by TheDAO's operational signers.
              </dd>
            </div>
            <div>
              <dt>Abstaining costs the fund nothing</dt>
              <dd>
                A seat that never votes is not spent on anyone's behalf. Its weight is swept back to the funder
                with whatever else the tally leaves over.
              </dd>
            </div>
            <div>
              <dt>Everything published</dt>
              <dd>
                A public retrospective and as much round data as can be released: how the badge holders ranked,
                what the public donated, and where the two disagreed.
              </dd>
            </div>
          </dl>
        </section>

        <section className="op-section" aria-labelledby="op-variant">
          <h2 id="op-variant">A possible modification: voting with your own money</h2>
          <div className="op-prose">
            <p>
              The same contract can also let the public vote. In that variant anyone deposits their own funds
              into the pool during the voting window, and the deposit is both a donation to the round and
              their voting weight, in one transaction. Their explicit rankings count toward the initial
              eligibility check, then the same proportional tally spends among eligible proposals. Their
              remaining money can reach unplaced eligible proposals as tied last choices. Badge holders and
              contributors would each rank how they want their share spent.
            </p>
            <p>
              We are not proposing it for Round Two, where direct donations fit the round's design better. It
              is there if the curators want the crowd to rank as well as give.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-status">
          <h2 id="op-status">Where it stands</h2>
          <div className="op-prose">
            <p>
              The contracts, the sealed-ballot verifiers, the proposal flow, this voting interface and the
              operator runbooks are written and running on a testnet with live demo rounds. The on-chain tally
              is checked by a differential fuzz against a Python reference of the published algorithm. It was
              built in ten days for ETHOnline 2026 under the name RankedShares. The prototype implements
              deposit-and-rank voting. This page previews the initial-backing filter and donations that lower
              an initiative's ask; both still need integration into the production contracts and verifiers.
              It has not run a round with real
              money: Round Two would be the first production run of proportional participatory budgeting
              on-chain.
            </p>
            <p>
              Blossom Labs has spent five years building funding tools other communities run in production:
              conviction voting for 1Hive Gardens, EVMcrispr for DAO operations, and CouncilHaus for the budget
              allocation used by Superfluid and Octant. We would run the round at a pool of $250,000 to
              $2,000,000, ideally $500,000. At $250,000 with proposals capped at 15% of the pool, the round
              funds roughly 10 to 25 projects, enough for the proportional rule to matter.
            </p>
          </div>
          <ul className="op-links">
            <li><a href="/">Open the live demo rounds</a></li>
            <li><a href={REPO}>Read the source, specs and decision records</a></li>
            <li><a href={`${REPO}/blob/master/demo/presentation.pdf`}>View the slide deck</a></li>
            <li><a href="https://ethglobal.com/showcase/rankedshares-pdt8y">Watch the ETHOnline 2026 showcase</a></li>
          </ul>
        </section>
      </main>

      <footer className="op-footer">
        <div className="op-wrap">
          <h2>Sources</h2>
          <p>
            Aziz, H., and Lee, B. E. 2021. <a href={PAPER}><cite>Proportionally Representative Participatory
            Budgeting with Ordinal Preferences.</cite></a> Proceedings of the Thirty-Fifth AAAI Conference on
            Artificial Intelligence, 5110 to 5118.
          </p>
          <p>
            Aziz, H., and Lee, B. E. 2020. <cite>The Expanding Approvals Rule: Improving Proportional
            Representation and Monotonicity.</cite> Social Choice and Welfare 54(1), 1 to 45.
          </p>
          <p className="op-footer-note">
            Blossom Budgeting is the new name of RankedShares. The example round on this page is invented for
            illustration; its proposals and voters are not real applicants. Contact Blossom Labs at{" "}
            <a href="https://blossom.software">blossom.software</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
