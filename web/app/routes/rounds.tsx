import { useState } from "react";
import { replace, useLocation, useNavigate } from "react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getAddress, isAddress } from "viem";
import type { Route } from "./+types/rounds";
import { useRoundDirectory } from "../context/rounds";
import { chain } from "../context/providers";
import { RoundCard } from "../components/rounds/round-card";
import { Button, Field, Input, Notice } from "../components/ui";
import { fetchRound } from "../lib/api";
import { roundHref, roundName } from "../lib/round-directory";
import { errorMessage } from "../lib/proposals";
import { useNow } from "../hooks/use-now";

export function meta() { return [{ title: "Funding rounds · RankedShares" }, { name: "description", content: "Find and follow funding rounds on RankedShares." }]; }
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const pool = new URL(request.url).searchParams.get("pool");
  return pool && isAddress(pool) ? replace(roundHref(getAddress(pool))) : null;
}
clientLoader.hydrate = true as const;

export default function RoundsPage() {
  const { rounds, remember } = useRoundDirectory();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const now = useNow(60_000);
  const snapshots = useQueries({ queries: rounds.map((entry) => ({
    queryKey: ["round", entry.pool, 0], queryFn: () => fetchRound(entry.pool), staleTime: 15_000, refetchInterval: 60_000, retry: 1,
  })) });
  const entries = rounds.map((entry, index) => ({ entry, snapshot: snapshots[index] }));
  const visible = entries.filter(({ entry, snapshot }) => {
    const matches = `${roundName(entry)} ${entry.pool}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === "all" || (snapshot.data && (filter === "completed" ? snapshot.data.phase === "done" : snapshot.data.phase !== "done")));
  });
  async function openRound(event: React.FormEvent) {
    event.preventDefault();
    const value = address.trim();
    if (!isAddress(value)) { setError("Enter a valid round contract address (0x followed by 40 hexadecimal characters)."); return; }
    setOpening(true); setError(undefined);
    try {
      const pool = getAddress(value);
      const snapshot = await fetchRound(pool);
      queryClient.setQueryData(["round", pool, 0], snapshot);
      remember({ pool, name: name.trim().slice(0, 100) || undefined });
      navigate(roundHref(pool));
    } catch (err) { setError(`Could not open this round on ${chain.name}. Check the address and try again. ${errorMessage(err)}`); }
    finally { setOpening(false); }
  }
  return <div className="rounds-page">
    <header className="rounds-heading">
      <p className="eyebrow">RankedShares / {chain.name}</p>
      <h1>Funding rounds</h1>
      <p>Find a round, follow its progress, and help decide what gets funded.</p>
    </header>
    {new URLSearchParams(search).has("pool") && <Notice error>The round address in this link is invalid. Open a round below.</Notice>}
    <div className="rounds-layout">
      <section className="rounds-results" aria-label="Funding rounds">
        <Field id="round-search" label="Find a round"><Input id="round-search" type="search" placeholder="Search by name or address" value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <div className="round-filters" role="group" aria-label="Filter rounds">
          {([ ["all", "All rounds"], ["active", "Active"], ["completed", "Completed"] ] as const).map(([value, label]) => <Button key={value} variant="secondary" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
        </div>
        <a className="round-open-shortcut" href="#open-round">Open a round by address ↓</a>
        <p className="hint" role="status">{visible.length} {visible.length === 1 ? "round" : "rounds"}{snapshots.some((s) => s.isPending) ? " · Loading round statuses…" : ""}</p>
        {filter !== "all" && snapshots.some((s) => s.isError && !s.data) && <Notice>Some round statuses are unavailable. Select All rounds to find them and retry.</Notice>}
        {visible.length ? <ul className="round-list">{visible.map(({ entry, snapshot }) => <RoundCard key={entry.pool} entry={entry} snapshot={snapshot.data} failed={snapshot.isError} now={now} onRetry={() => { void snapshot.refetch(); }} />)}</ul> : <div className="empty">
          <h2>{rounds.length ? "No matching rounds" : "Your rounds start here"}</h2>
          <p>{rounds.length ? "Try another name or address, or view all rounds." : "Open a round by its address, or create a new round. You can follow several at once."}</p>
          {rounds.length > 0 && <Button variant="secondary" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</Button>}
        </div>}
      </section>
      <aside className="rounds-open-panel" id="open-round" tabIndex={-1} aria-label="Open a round by address">
        <h2>Open a round</h2>
        <p className="hint">Have a round address? Add it to your list.</p>
        <form className="stack" onSubmit={openRound}>
          <Field id="round-address" label="Round address" hint={`Contract address on ${chain.name}`}><Input id="round-address" value={address} placeholder="0x…" required spellCheck={false} autoCapitalize="none" aria-describedby="round-address-hint" onChange={(event) => setAddress(event.target.value)} /></Field>
          <Field id="round-name" label="Name (optional)" hint="A label for this browser"><Input id="round-name" value={name} maxLength={100} aria-describedby="round-name-hint" placeholder="e.g. Community grants" onChange={(event) => setName(event.target.value)} /></Field>
          {error && <Notice error>{error}</Notice>}
          <Button type="submit" disabled={opening}>{opening ? "Opening round…" : "Open round"}</Button>
        </form>
        <p className="hint round-directory-note">This list includes rounds featured by this site and rounds opened in this browser. Saved rounds stay on this device.</p>
      </aside>
    </div>
  </div>;
}
