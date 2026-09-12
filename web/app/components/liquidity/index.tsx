import { Link } from "react-router";
import { Button, Fact, Field, Input, Notice, Status } from "../ui";
import { type LPData, money, sharePercent } from "../../lib/lp";
import type { Address } from "viem";
import type { FormEvent } from "react";

export function CampaignCard(
  { campaign: c, data, busy, onFinalize }: {
    campaign: LPData["campaigns"][number];
    data: LPData;
    busy: boolean;
    onFinalize: () => void;
  },
) {
  const stale = data.timestamp - c.updatedAt > 300n && data.phase === 1;
  return (
    <article className="lp-campaign">
      <div className="lp-card-heading">
        <div>
          <p className="eyebrow">SPONSORSHIP {Number(c.id) + 1}</p>
          <h2>Liquidity valued in {c.stableSymbol}</h2>
        </div>
        <Status>
          {c.finalized
            ? "Finalized"
            : data.phase === 1
            ? "Accruing"
            : "Closing"}
        </Status>
      </div>
      <dl className="facts">
        <Fact label="Sponsored budget">
          {money(c.amount, data.decimals)} {data.symbol}
        </Fact>
        <Fact label="Your accumulated share">
          {sharePercent(c.projection[0], c.projection[1])}
        </Fact>
        <Fact
          label={c.finalized
            ? "Your final voting weight"
            : "Your projected voting weight"}
        >
          {money(c.finalized ? c.allocated : c.projection[2], data.decimals)}
          {" "}
          {data.symbol}
        </Fact>
        <Fact label="Reference price updated">
          {new Date(Number(c.updatedAt) * 1000).toLocaleString()}
        </Fact>
      </dl>
      <p className="hint">
        Your share grows with liquidity value and time. Projections assume the
        current prices and liquidity stay unchanged.
      </p>
      <details>
        <summary>Pool and valuation details</summary>
        <p className="hint">
          Pool ID <code>{c.poolId}</code>
        </p>
        <p className="hint">
          Minimum registration value: {money(c.minimumValue, c.stableDecimals)}
          {" "}
          {c.stableSymbol}. All position ranges are eligible. Uncollected fees
          are excluded.
        </p>
        <p className="hint">
          CRE samples this pool’s finalized price every two minutes. Updates
          apply from delivery onward. {c.sourceBlock === 0n
            ? "Awaiting the first CRE update."
            : `Last source block: ${c.sourceBlock}.`}
        </p>
        <p className="hint">
          The reference comes from this pool’s market price. It can be
          influenced by swaps and is not an independent price oracle.
        </p>
      </details>
      {stale && (
        <Notice>
          The reference price has not updated in over five minutes. Accrual
          continues at the last accepted price.
        </Notice>
      )}
      {data.phase === 2 && !c.finalized && (
        <Button disabled={busy} onClick={onFinalize}>
          Advance finalization
        </Button>
      )}
    </article>
  );
}

export function PositionCard(
  { position: p, busy, onClaim, onStop }: {
    position: LPData["positions"][number];
    busy: boolean;
    onClaim: () => void;
    onStop: () => void;
  },
) {
  return (
    <article className="lp-position">
      <div>
        <p className="eyebrow">UNISWAP V4 POSITION</p>
        <h3>#{p.id.toString()}</h3>
        <p>{p.reason}</p>
      </div>
      <div className="actions">
        {p.canClaim && (
          <Button disabled={busy} onClick={onClaim}>
            Start earning voting weight
          </Button>
        )}
        {p.canStop && (
          <Button variant="secondary" disabled={busy} onClick={onStop}>
            Stop accruing
          </Button>
        )}
      </div>
    </article>
  );
}

export function PositionLookup(
  { onSubmit, busy }: {
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    busy: boolean;
  },
) {
  return (
    <form className="lp-lookup" onSubmit={onSubmit}>
      <Field
        id="position-id"
        label="Find a position by NFT ID"
        hint="Use the NFT ID from the demo deployment or your Uniswap position."
      >
        <div className="lp-lookup-controls">
          <Input
            id="position-id"
            aria-describedby="position-id-hint"
            name="positionId"
            inputMode="numeric"
            pattern="[0-9]+"
            required
          />
          <Button type="submit" variant="secondary" disabled={busy}>
            Load position
          </Button>
        </div>
      </Field>
    </form>
  );
}

export function SponsorForm(
  { data, busy, onSubmit }: {
    data: LPData;
    busy: boolean;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  },
) {
  return (
    <details className="lp-sponsor">
      <summary>Sponsor another Uniswap pool</summary>
      <form onSubmit={onSubmit} className="proposal-form">
        <p>
          Identify the pool using one of its position NFTs. You fund the voting
          budget; LPs keep their liquidity. All fields are required.
        </p>
        <Field id="sponsor-position" label="Position NFT ID">
          <Input
            id="sponsor-position"
            name="positionId"
            inputMode="numeric"
            pattern="[0-9]+"
            required
          />
        </Field>
        <Field
          id="valuation-token"
          label="Valuation token address"
          hint="Choose one of this pool’s currencies, for example USDC or EURC."
        >
          <Input
            id="valuation-token"
            aria-describedby="valuation-token-hint"
            name="stable"
            placeholder="0x…"
            required
          />
        </Field>
        <Field id="lp-budget" label={`Voting budget (${data.symbol})`}>
          <Input id="lp-budget" name="amount" inputMode="decimal" required />
        </Field>
        <Field
          id="lp-minimum"
          label="Minimum position value"
          hint="In units of the valuation token. This controls registration eligibility, not voting-weight increments."
        >
          <Input
            id="lp-minimum"
            aria-describedby="lp-minimum-hint"
            name="minimum"
            inputMode="decimal"
            defaultValue="1"
            required
          />
        </Field>
        <Button type="submit" disabled={busy}>Approve budget & sponsor</Button>
        <p className="hint">
          Your wallet requests token approval if needed, then confirms the
          sponsorship.
        </p>
      </form>
    </details>
  );
}

export function LiquidityHeader(
  { pool, account }: { pool: Address; account?: Address },
) {
  return (
    <header className="lp-header">
      <p className="eyebrow">LIQUIDITY → COMMUNITY FUNDING</p>
      <h1>
        Your liquidity.<br />
        <em>Your voice.</em>
      </h1>
      <p>
        Register a Uniswap v4 position to earn a share of a sponsored voting
        budget. Start early, keep providing liquidity, and rank the projects you
        want to fund.
      </p>
      <div className="actions">
        <Link to={`/vote?pool=${pool}`}>Vote privately ↗</Link>
      </div>
      {!account && (
        <Notice>
          Connect your wallet to find your positions and see your share.
        </Notice>
      )}
    </header>
  );
}
