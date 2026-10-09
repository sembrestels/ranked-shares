import { useMemo } from "react";
import { BLOCS, blocVoters, majorityOutcome, PROPOSALS, SEAT, spendByCamp, tally, TIER_LABELS } from "../lib/onepager";
import { CampKey, PoolBar, Seats, percent, usd } from "../components/onepager/pool-bar";
import { Stepper } from "../components/onepager/stepper";
import { Playground } from "../components/onepager/playground";
import { QuietEnding } from "../components/onepager/quiet-ending";
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
        "Blossom Budgeting for Round Two of TheDAO Security Fund: tiered ballots, a proportional tally, public votes anyone can recount. An interactive explainer of the tally with a ballot you can fill in.",
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
  const majoritySpent = majority.reduce((sum, id) => sum + costs[id], 0);

  return (
    <div className="onepager">
      <header className="op-hero">
        <div className="op-wrap">
          <div className="op-masthead">
            <p className="op-brand">Blossom Budgeting <span>a proportional budgeting mechanism, by <span className="op-brand-maker"><BlossomMark /> Blossom Labs</span></span></p>
            <ThemeToggle />
          </div>
          <h1>51% of the voters should not spend the whole pool.</h1>
          <p className="op-standfirst">
            In its second round, TheDAO Security Fund asks the ETHSecurity Badge holders to decide which
            initiatives it funds. Under a majority
            rule (Condorcet, Borda, most votes first), the largest like-minded group decides every dollar.
            Blossom Budgeting is a tiered-ballot rule that protects representation for groups with shared
            priorities. Below is the same small round, tallied both ways.
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
              Their four proposals cost {usd(majoritySpent)}, and nothing else fits in the{" "}
              {usd(budget - majoritySpent)} that is left. Fund from the top and the other nine voters, 45% of
              the electorate, get nothing they asked for.
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
              <b>Start with each voter's top tier.</b> A proposal is affordable when the voters who have it in
              their {TIER_LABELS[0]} hold enough unspent money to cover its cost. If several are affordable,
              the one with the most money behind it goes first.
            </li>
            <li>
              <b>Current supporters pay, in proportion.</b> The proposal's cost is deducted from the voters
              who have it in an open tier, each in proportion to what they still hold. Spent money
              cannot pay for anything else.
            </li>
            <li>
              <b>Widen only when stuck.</b> When nothing is affordable, lower tiers open:
              a voter's next tier opens one step later for each proposal above it. Unplaced proposals never
              open. When no tier can fund anything more, what voters still hold goes back to TheDAO.
            </li>
          </ol>
          <Stepper />
          <div className="op-prose">
            <p>
              <b>Place what you would like to see funded, even in a low tier.</b> Transaction simulation
              warnings is the last proposal funded, and it only just passes. It asks for $10,000. The wallet
              teams had spent their whole share on the blocklist, so the incident responders were left with
              $9,000 behind it, $1,000 short. The researchers' {TIER_LABELS[2]} closes the gap: they pay
              $1,127 and the responders $8,873.
            </p>
            <p>
              Had the researchers left it off their ballot, it would not have passed, and $13,000 would
              have gone back to TheDAO instead of $3,000. Money only pays for what its voter placed. A
              $1,000 donation from the public could still have funded it. So a ballot should hold more than
              a voter's own priorities: use the lower tiers for proposals you would be glad to see funded.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-seat">
          <h2 id="op-seat">Cast a ballot</h2>
          <div className="op-prose">
            <p>
              This is the ballot a badge holder fills in: Must fund is the {TIER_LABELS[0]}, Should fund the{" "}
              {TIER_LABELS[1]}, Nice to have the {TIER_LABELS[2]}. You are a twenty-first voter, and to keep
              the numbers round the pool grows so every ballot still steers {usd(SEAT)}. Proposals in the same
              tier are tied. Your share only pays for proposals you place in a tier; whatever you have left
              after your tiers goes back to TheDAO. The incident responders hold $15,000 and their war room
              costs $20,000. The researchers hold $10,000 and their course costs $15,000. Your one ballot can
              fund either. A direct public donation can also lower an ask until its backers can afford it,
              which you can try under the ballot.
            </p>
          </div>
          <Playground />
        </section>

        <section className="op-section" aria-labelledby="op-guarantee">
          <h2 id="op-guarantee">What the tally guarantees</h2>
          <div className="op-prose">
            <p>
              The paper calls it Inclusion PSC, proportionality for solid coalitions. Groups that agree on
              their top choices receive representation
              according to their share, subject to project costs and ties. A group cannot be left short of
              another jointly preferred proposal if its share can cover that proposal plus the funded projects
              counted toward its representation. The wallet teams cast 20% of the ballots and all put their
              $20,000 blocklist in their S-Tier, so it is funded whatever the other 80% do.
            </p>
            <p>
              A voter's money only ever pays for proposals they placed in a tier, so every funded proposal
              is paid in full by voters who asked for it.
            </p>
            <p>
              Voters will be able to choose to spend their remaining money on other proposals of the round
              instead of returning it. With that option they can still withhold it from the proposals they
              discarded.
            </p>
            <p>
              Proposals are funded whole or not at all. The responders alone cannot fund a $20,000 war room
              with $15,000; they need an ally or a donation. Any money the tally leaves unspent goes back to
              TheDAO.
            </p>
          </div>
        </section>

        <section className="op-section" aria-labelledby="op-quiet">
          <h2 id="op-quiet">A slow quiet ending: the last ballot should not get the last word</h2>
          <div className="op-prose">
            <p>
              With a hard deadline, whoever moves last can change what is funded and nobody has time to
              answer. So the round closes with a slow quiet ending, one tier at a time. Each tier gets two
              days. They start with a first tally of the tier and a quiet window of 24 hours. If the result
              is the same when the window ends, the tier is settled. If it changed, a new quiet window
              starts, half as long, so everyone can answer, and so on until one of them ends as it began.
            </p>
            <p>
              The quiet windows always add up to less than two days, so every tier is settled within its
              two days and its winners can be presented on a day fixed in advance. In this example the{" "}
              {TIER_LABELS[0]} is presented on December 3, the {TIER_LABELS[1]} on December 7 and the{" "}
              {TIER_LABELS[2]} on December 10. A settled tier is final, and voters can still rearrange the
              tiers below it. Below, one late move is followed to the end: scroll down to see it happen.
            </p>
          </div>
          <QuietEnding />
        </section>

        <section className="op-section" aria-labelledby="op-round">
          <h2 id="op-round">The rest of the mechanism</h2>
          <dl className="op-features">
            <div>
              <dt>Public ballots</dt>
              <dd>
                Every ballot is recorded on-chain, and a voter can replace theirs while the round is open.
                Badge holders vote from pseudonymous addresses: a ballot is public, but it is tied to an
                address, not to a name. The running result is public from start to finish, so everyone votes
                knowing where things stand and anyone can follow the round as it happens.
              </dd>
            </div>
            <div>
              <dt>A tally anyone can run again</dt>
              <dd>
                The result is computed with an open reference implementation of the rule, which will be
                published soon. The ballots and the asks are on-chain, so anyone will be able to run the same
                program on the same data and check that they get the same funded proposals.
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
                holders to pass, which is the market signal the round is built around. If other sponsors add
                to the pool, it grows, and every voter's share grows with it.
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
              <dt>Everything in the open</dt>
              <dd>
                Ballots, donations and the tally are all public. Anyone can see how the badge holders voted,
                address by address, what the public donated, and where the two disagreed.
              </dd>
            </div>
          </dl>
          <div className="op-prose">
            <p>
              This page explains the mechanism. The specific rules of the round are announced by TheDAO.
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
