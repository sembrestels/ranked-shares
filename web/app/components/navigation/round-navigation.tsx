import { Link, NavLink } from "react-router";
import type { RoundEntry } from "../../lib/round-directory";
import { roundHref, roundName } from "../../lib/round-directory";

const tabClass = ({ isActive }: { isActive: boolean }) => `round-tab${isActive ? " is-active" : ""}`;

export function RoundNavigation({ selected, rounds, pathname, onSwitch }: {
  selected: RoundEntry;
  rounds: RoundEntry[];
  pathname: string;
  onSwitch: (pool: string) => void;
}) {
  const managing = pathname === "/setup" || pathname === "/import";
  return <section className="round-navigation" aria-label="Selected round">
    <div className="round-context">
      <div className="round-identity">
        <nav aria-label="Breadcrumb"><Link to="/">All rounds</Link><span aria-hidden="true"> / </span><span>{roundName(selected)}</span></nav>
        <p className="round-identity-name">{roundName(selected)}</p>
        <code className="hint">{selected.pool}</code>
      </div>
      <div className="round-switcher field">
        <label htmlFor="round-switcher">Switch round</label>
        <select id="round-switcher" className="input" value={selected.pool} onChange={(event) => onSwitch(event.target.value)}>
          {rounds.map((entry) => <option key={entry.pool} value={entry.pool}>{roundName(entry)}{entry.name ? ` · ${entry.pool.slice(0, 6)}…${entry.pool.slice(-4)}` : ""}</option>)}
        </select>
        <Link className="hint" to="/">Find or open another round</Link>
      </div>
    </div>
    <div className="round-nav-row">
      <nav aria-label="Round pages" className="round-tabs">
        <NavLink to={roundHref(selected.pool)} className={pathname.startsWith("/project/") ? "round-tab is-active" : tabClass} aria-current={pathname.startsWith("/project/") ? "location" : undefined}>Overview</NavLink>
        <NavLink to={roundHref(selected.pool, "/proposals")} className={tabClass}>Proposals</NavLink>
        <NavLink to={roundHref(selected.pool, "/vote")} className={tabClass}>Vote</NavLink>
        <NavLink to={roundHref(selected.pool, "/liquidity")} className={tabClass}>Liquidity</NavLink>
      </nav>
      <nav aria-label="Round actions" className="round-tabs round-tools">
        <NavLink to={roundHref(selected.pool, "/submit")} className={tabClass}>Submit an idea</NavLink>
        <Link to={roundHref(selected.pool, "/setup")} className={`round-tab${managing ? " is-active" : ""}`} aria-current={managing ? "location" : undefined}>Manage round</Link>
      </nav>
    </div>
    {managing && <nav aria-label="Manage round" className="round-management round-tabs">
      <span className="hint">Organizer tools</span>
      <NavLink to={roundHref(selected.pool, "/setup")} className={tabClass}>Setup & review</NavLink>
      <NavLink to={roundHref(selected.pool, "/import")} className={tabClass}>Import proposals</NavLink>
    </nav>}
  </section>;
}
