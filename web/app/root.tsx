import { type ReactNode, useState } from "react";
import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useLocation,
  useNavigate,
  Link,
} from "react-router";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain, Providers, useRound, useSwarm } from "./context/providers";
import { Button, ErrorPopup, Notice } from "./components/ui";
import { AUDIT_LABEL, AUDIT_URL } from "./lib/copy";
import { errorMessage } from "./lib/proposals";
import { useRoundDirectory } from "./context/rounds";
import { RoundNavigation } from "./components/navigation/round-navigation";
import { roundHref } from "./lib/round-directory";
import "./app.css";

/** Fallback for routes without their own `meta` export (e.g. /proposals,
 * /vote, /liquidity, /submit, /setup); routes/round.tsx and routes/project.tsx
 * define their own `meta` and take over the <title> for that route. */
export function meta() {
  return [{ title: "RankedShares" }];
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
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

function Connections({ showSwarm = true }: { showSwarm?: boolean }) {
  const { address, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { client, info, error: swarmError, retry } = useSwarm();
  const [error, setError] = useState<string>();
  const [swarmBusy, setSwarmBusy] = useState(false);
  const [dismissedSwarmError, setDismissedSwarmError] = useState<string>();
  const [requestedSwarm, setRequestedSwarm] = useState(false);
  function retrySwarm() {
    setRequestedSwarm(true);
    setDismissedSwarmError(undefined);
    retry();
  }
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
        {showSwarm && <Button
          variant="secondary"
          disabled={(!client && !swarmError) || swarmBusy}
          onClick={!client && swarmError ? retrySwarm : connectSwarm}
        >
          {swarmBusy
            ? "Connecting…"
            : info?.identity
            ? `Swarm ID: ${info.identity.name} · Disconnect`
            : client
            ? "Connect Swarm ID"
            : swarmError
            ? "Retry Swarm ID"
            : "Loading Swarm ID…"}
        </Button>}
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
      {showSwarm && info?.identity && !info.canUpload && (
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
            Manage storage
          </a>
        </Notice>
      )}
      <div className="connection-popups">
        {showSwarm && requestedSwarm && swarmError && swarmError !== dismissedSwarmError && (
          <ErrorPopup
            title="Swarm ID could not load"
            onDismiss={() => setDismissedSwarmError(swarmError)}
            actions={
              <Button variant="secondary" onClick={retrySwarm}>
                Retry Swarm ID
              </Button>
            }
          >
            {swarmError}
          </ErrorPopup>
        )}
        {error && (
          <ErrorPopup
            title="Connection failed"
            onDismiss={() => setError(undefined)}
          >
            {error}
          </ErrorPopup>
        )}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { pool } = useRound();
  const { rounds } = useRoundDirectory();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const roundPage = pathname !== "/" && pathname !== "/deploy";
  const selected = pool ? rounds.find((entry) => entry.pool.toLowerCase() === pool.toLowerCase()) ?? { pool } : undefined;
  const choices = selected && !rounds.some((entry) => entry.pool === selected.pool) ? [...rounds, selected] : rounds;
  return (
    <div className="min-h-screen bg-page text-primary">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="site-wordmark">
            RankedShares
          </Link>
          <nav aria-label="Main" className="site-links">
            <NavLink to="/" end className="site-link">All rounds</NavLink>
            <NavLink to="/deploy" className="site-create">Create round <span aria-hidden="true">+</span></NavLink>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))]">
        {roundPage && selected && <RoundNavigation selected={selected} rounds={choices} pathname={pathname} onSwitch={(value) => navigate(roundHref(value))} />}
        {pathname !== "/" && <div className="toolbar">
          <Connections showSwarm={roundPage && !["/round", "/vote", "/liquidity"].includes(pathname)} />
        </div>}
        <main id="main" className="py-6">
          {roundPage && !pool ? <Notice>Choose a round to continue. <Link to="/">Find or open a round</Link>.</Notice> : <div key={roundPage ? pool : pathname}>{children}</div>}
        </main>
      </div>
      <footer role="contentinfo" className="mt-12 border-t border-edge py-6 text-sm text-secondary">
        <div className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))]">
          <p>
            Every number on these pages is read from the chain.{" "}
            <a href={AUDIT_URL} className="underline underline-offset-4">
              You can {AUDIT_LABEL}
            </a>.
          </p>
          <p className="mt-1">{chain.name}</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <Shell>
        <Outlet />
      </Shell>
    </Providers>
  );
}
export function HydrateFallback() {
  return (
    <main className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))] py-6">
      <h1>RankedShares</h1>
      <Notice>Loading RankedShares…</Notice>
    </main>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))] py-6">
      <h1>Unable to load this page.</h1>
      <Notice error>{errorMessage(error)}</Notice>
      <a href="/">Browse funding rounds</a>
    </main>
  );
}
