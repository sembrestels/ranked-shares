import { type ReactNode, useState } from "react";
import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { isAddress } from "viem";
import { chain, Providers, useRound, useSwarm } from "./context/providers";
import { Button, Field, Input, Notice } from "./components/ui";
import { errorMessage } from "./lib/proposals";
import "./app.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Proposals · RankedShares</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Kulim+Park:wght@400;600;700&family=Lexend+Deca:wght@300;400;500;600&display=swap"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Connections() {
  const { address, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { client, info, error: swarmError, retry } = useSwarm();
  const [error, setError] = useState<string>();
  const [swarmBusy, setSwarmBusy] = useState(false);
  async function connectWallet() {
    setError(undefined);
    try {
      const connector = connectors[0];
      if (!connector) {
        throw new Error(
          "Install or enable a browser wallet to submit proposals.",
        );
      }
      await connectAsync({ connector });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  function connectSwarm() {
    if (!client) return;
    setError(undefined);
    setSwarmBusy(true);
    // Call directly in the click handler, with no await before connect(): keep
    // the browser's user activation for the identity popup.
    const operation = info?.identity ? client.disconnect() : client.connect();
    operation.catch((err) => setError(errorMessage(err))).finally(() =>
      setSwarmBusy(false)
    );
  }
  return (
    <div className="connections">
      <div className="actions">
        <Button
          variant="secondary"
          disabled={isPending}
          onClick={address ? () => disconnect() : connectWallet}
        >
          {address
            ? `Disconnect ${address.slice(0, 6)}…${address.slice(-4)}`
            : isPending
            ? "Connecting wallet…"
            : "Connect wallet"}
        </Button>
        <Button
          variant="secondary"
          disabled={!client || swarmBusy}
          onClick={connectSwarm}
        >
          {swarmBusy
            ? "Connecting…"
            : info?.identity
            ? `Swarm ID: ${info.identity.name} · Disconnect`
            : client
            ? "Connect Swarm ID"
            : swarmError
            ? "Swarm ID unavailable"
            : "Loading Swarm ID…"}
        </Button>
      </div>
      {address && chainId !== chain.id && (
        <div className="actions">
          <Notice>Your wallet is on another network.</Notice>
          <Button
            onClick={() =>
              switchChainAsync({ chainId: chain.id }).catch((err) =>
                setError(errorMessage(err))
              )}
          >
            Switch to {chain.name}
          </Button>
        </div>
      )}
      {info?.identity && !info.canUpload && (
        <Notice>
          {info.uploadUnavailableReason === "stamper-failed"
            ? "Swarm ID could not prepare your storage. Reconnect or check your drive."
            : "Your Swarm ID has no available upload storage. Add storage in Swarm ID, then reconnect."}
          {" "}
          <a
            href={import.meta.env.VITE_SWARM_ID_ORIGIN ||
              "https://swarm-id.snaha.net"}
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage storage ↗
          </a>
        </Notice>
      )}
      {swarmError && (
        <Notice error>
          Swarm ID could not load: {swarmError}{" "}
          <Button variant="secondary" onClick={retry}>Retry Swarm ID</Button>
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}

function RoundPicker() {
  const { pool, setPool } = useRound();
  const [error, setError] = useState<string>();
  return (
    <details className="round-picker" open={!pool} key={pool}>
      <summary>
        <span className="eyebrow">{chain.name} / ROUND</span>
        <code>
          {pool ? `${pool.slice(0, 10)}…${pool.slice(-6)}` : "Choose a pool"}
        </code>
        <span>Change ↗</span>
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(
            new FormData(event.currentTarget).get("pool") || "",
          ).trim();
          if (!isAddress(value)) {
            setError("Enter a valid pool contract address.");
            return;
          }
          setError(undefined);
          setPool(value);
        }}
      >
        <Field id="pool" label="Pool contract address">
          <Input
            id="pool"
            name="pool"
            required
            defaultValue={pool}
            placeholder="0x…"
            spellCheck={false}
          />
        </Field>
        <Button type="submit">Load round</Button>
        {error && <Notice error>{error}</Notice>}
      </form>
    </details>
  );
}

function Shell() {
  const { pool } = useRound();
  const search = pool ? `?pool=${pool}` : "";
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to={`/${search}`}>
            Ranked<span>Shares</span>
            <small>COMMUNITY FUNDING</small>
          </NavLink>
          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to={`/${search}`} end>Proposals</NavLink>
            <NavLink to={`/submit${search}`}>Submit an idea</NavLink>
            <NavLink to={`/setup${search}`}>Organizer</NavLink>
          </nav>
        </div>
      </header>
      <div className="workspace">
        <div className="toolbar">
          <RoundPicker />
          <Connections />
        </div>
        <main id="main">
          <Outlet />
        </main>
        <footer>
          <span>RankedShares</span>
          <p>Community ideas. Shared decisions.</p>
          <span className="hint">Content on Swarm · Decisions on-chain</span>
        </footer>
      </div>
    </>
  );
}

export default function App() {
  return (
    <Providers>
      <Shell />
    </Providers>
  );
}
export function HydrateFallback() {
  return (
    <main className="workspace">
      <h1>RankedShares</h1>
      <Notice>Loading the proposal board…</Notice>
    </main>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="workspace">
      <h1>Unable to load this page.</h1>
      <Notice error>{errorMessage(error)}</Notice>
      <a href="/">Return to proposals</a>
    </main>
  );
}
