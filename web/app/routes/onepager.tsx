import { useMemo } from "react";
import { BLOCS, blocVoters, majorityOutcome, PROPOSALS, SEAT, spendByCamp, tally, TIER_LABELS } from "../lib/onepager";
import { CampKey, PoolBar, Seats, percent, usd } from "../components/onepager/pool-bar";
import { Stepper } from "../components/onepager/stepper";
import { Playground } from "../components/onepager/playground";
import { BlossomMark } from "../components/onepager/blossom-mark";
import { ThemeToggle } from "../components/onepager/theme-toggle";
import "../components/onepager/onepager.css";

const PAPER = "https://ojs.aaai.org/index.php/AAAI/article/view/16646/16453";

export function meta() {
  return [
    { title: "How the vote works · Blossom Budgeting" },
    {
      name: "description",
      content:
        "Blossom Budgeting for TheDAO's Round Two: tiered ballots, a proportional tally, sealed votes. An interactive explainer of the tally with a ballot you can fill in.",
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
  const ballots = BLOCS.reduce((sum, b) => sum + b.seats, 0);
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
          <h1>51% of the voters should not spend the whole pool.</h1>
          <p className="op-standfirst">
            Round Two asks the ETHSecurity Badge holders to allocate TheDAO Security Fund. Under a majority
            rule (Condorcet, Borda, most votes first), the largest like-minded group decides every dollar.
            Blossom Budgeting is a tiered-ballot rule that protects representation for groups with shared
            priorities. Projects first need enough initial backing to cover their ask. Below is the same
            small round, tallied both ways.
          </p>

          <figure className="op-compare">
            <Seats />
            <div className="op-compare-row">
              <figcaption>
                <b>Majority rule</b>
                Auditors cast {percent(auditSeats, ballots)} of the ballots and direct {auditShare(majority)} of the pool.
              </figcaption>
              <PoolBar funded={majority} budget={budget} label="Majority rule" />
            </div>
            <div className="op-compare-row">
              <figcaption>
                <b>Blossom Budgeting</b>
                Auditors cast {percent(auditSeats, ballots)} of the ballots and direct {auditShare(proportional)} of the pool.
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
              Thirty people hold a badge and {ballots} of them submit a ballot. The {usd(budget)} pool is split
              equally among the ballots, so each voter steers {usd(SEAT)}. Nine initiatives ask for{" "}
              {usd(costs.reduce((a, b) => a + b, 0))} between them, each with one deliverable and one price.
            </p>
            <p>
              A ballot sorts the proposals a voter wants into tiers: {TIER_LABELS[0]} for what must be funded,{" "}
              {TIER_LABELS[1]} for what should be, {TIER_LABELS[2]} for what would be nice to have. Proposals in
              the same tier are tied. The voters fall into five groups with different priorities, which is what
              a security community looks like: auditors want auditing tools, wallet teams want phishing
              defence, responders want response capacity. To keep the example small, everyone in a group
              submits the same ballot as their colleagues.
            </p>
          </div>

          <div className="op-ballots">
            {BLOCS.map((bloc) => (
              <article key={bloc.id} className="op-ballot" data-bloc={bloc.id}>
                <h3>{bloc.name}</h3>
                <p className="op-ballot-seats">
                  <span aria-hidden="true">{Array.from({ length: bloc.seats }, (_, i) => <i key={i} className="op-seat" data-bloc={bloc.id} />)}</span>
                  {bloc.seats} identical ballots, {usd(bloc.seats * SEAT)}
                </p>
                <ol className="op-ballot-tiers">
                  {bloc.tiers.map((tier, t) => (
                    <li key={t}>
                      <b>{TIER_LABELS[t]}</b>
                      <ul>
                        {tier.map((id) => (
                          <li key={id}>{PROPOSALS[id].title} <span>{usd(PROPOSALS[id].cost / 1000)}k</span></li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>

          <div className="op-prose">
            <p>
              A majority rule orders the proposals by what most voters prefer and funds from the top. Here
              every auditing proposal beats every other proposal head to head, because the same eleven voters
              outvote whoever is on the other side, and the Borda and vote-count orders come out the same.
              Their four proposals cost exactly {usd(budget)}. Fund from the top and the other nine voters, 45%
              of the electorate, get nothing they asked for.
            </p>
            <p>
              A proportional rule asks a different question: how much of the pool does each group deserve to
              steer? Blossom Budgeting answers it with the{" "}
              <a href={PAPER}>Expanding Approvals Rule for participatory budgeting</a> (PB-EAR), published by
              Haris Aziz and Barton Lee at AAAI 2021.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-tally">
          <h2 id="op-tally">How the tally works</h2>
          <ol className="op-rules">
            <li>
              <b>Money is weight.</b> The pool is split equally among the badge holders who submit a ballot,
              so total voting weight always equals the pool balance.
            </li>
            <li>
              <b>Initial backing must cover the ask.</b> Add the full initial weight of every voter who places
              a proposal in any tier, counting each voter once. Remove proposals whose backing is below their
              ask from every ballot. Check once, before spending; keep every voter and their original weight.
            </li>
            <li>
              <b>Start with each voter's top tier.</b> A proposal is affordable when the voters who have it in
              their highest tier of eligible proposals, usually their S-Tier, hold enough unspent money to cover
              its cost. If several are affordable, the one with the most money behind it goes first.
            </li>
            <li>
              <b>Current supporters pay, in proportion.</b> The proposal's cost is deducted from the voters
              who have it in an open tier, each in proportion to what they still hold. Spent money
              cannot pay for anything else.
            </li>
            <li>
              <b>Widen only when stuck.</b> When nothing is affordable, the tally widens a step and lower tiers
              open: a voter's next tier opens after one step for each proposal in the tiers above it.
              Unplaced eligible proposals count as a tied last tier. It stops when no unfunded eligible
              proposal fits in what is left or no remaining voting weight can pay for one.
            </li>
          </ol>
          <Stepper />
        </section>

        <section className="op-section" aria-labelledby="op-seat">
          <h2 id="op-seat">Cast a ballot</h2>
          <div className="op-prose">
            <p>
              This is the ballot a badge holder fills in: Must fund is the {TIER_LABELS[0]}, Should fund the{" "}
              {TIER_LABELS[1]}, Nice to have the {TIER_LABELS[2]}. You are a twenty-first voter, and to keep
              the numbers round the pool grows so every ballot still steers {usd(SEAT)}. Proposals in the same
              tier are tied. Placing a proposal in any tier counts your share toward its initial backing;
              leaving it unplaced adds no backing. Eligible proposals you leave unplaced still sit below all
              three tiers during the tally and can receive your remaining money. The incident
              responders hold $15,000 and their war room costs $20,000. The researchers hold $10,000 and their
              course costs $15,000. Your one ballot can make either eligible. A direct public donation can also
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
              counted toward its representation. The wallet teams cast 20% of the ballots and all put their
              $20,000 blocklist in their S-Tier, so it passes the filter and is funded whatever the other 80% do.
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
                Each ballot is encrypted in the voter's browser to the round operator's public key. Only the
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
                TheDAO Security Fund sponsors the pool to the ETHSecurity Badge collection. The pool is split
                equally among the badge holders who submit a ballot, so holders who do not vote steer nothing:
                if 30 people hold a badge and 20 of them vote, each voter steers $5,000 of a $100,000 pool. The
                public does not vote. Anyone can donate directly to an initiative, and every dollar donated is a dollar that
                initiative no longer asks from the pool. A well-supported initiative gets cheaper for the badge
                holders to pass, which is the market signal Round Two is built around.
              </dd>
            </div>
            <div>
              <dt>Co-sponsors could also participate in the vote</dt>
              <dd>
                The mechanism allows it if the curators want it. A co-sponsor would deposit tokens into
                the same pool and name who votes with that money: its own address, a list of addresses, or an
                NFT collection. A wallet company could sponsor $50k voted by its security team, an L2 could
                sponsor its builders. Those voters' initial weights would count toward eligibility, and their
                tiers would guide spending among eligible proposals like any other ballot.
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
              <dt>Everything published</dt>
              <dd>
                A public retrospective and as much round data as can be released: how the badge holders voted,
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
              their voting weight, in one transaction. The proposals they place in a tier count toward the
              initial eligibility check, then the same proportional tally spends among eligible proposals.
              Their remaining money can reach unplaced eligible proposals as a tied last tier. Badge holders
              and contributors would each sort into tiers how they want their share spent.
            </p>
            <p>
              Curators could choose this instead of encouraging direct donations: the public votes with its
              money. A ballot that places a single project works much like a direct donation to it. The reason
              to do it is that a donor gets more than one choice: they can place several projects in tiers, and
              if their top pick falls short their money moves to the next tier. The crowd then steers the round
              in proportion to what it gives, under the same rule as the badge holders.
            </p>
          </div>
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
            Blossom Budgeting is an implementation of the rule in the first paper above. The example round on
            this page is invented for illustration; its proposals and voters are not real applicants. Contact
            Blossom Labs at{" "}
            <a href="https://blossom.software">blossom.software</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
