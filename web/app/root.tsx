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
import { Button, ErrorPopup, Field, Input, Notice } from "./components/ui";
import { StageBarContainer } from "./components/stage/stage-bar-container";
import { AUDIT_LABEL, AUDIT_URL } from "./lib/copy";
import { errorMessage } from "./lib/proposals";
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

function Connections() {
  const { address, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { client, info, error: swarmError, retry } = useSwarm();
  const [error, setError] = useState<string>();
  const [swarmBusy, setSwarmBusy] = useState(false);
  const [dismissedSwarmError, setDismissedSwarmError] = useState<string>();
  function retrySwarm() {
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
        <Button
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
      <div className="connection-popups">
        {swarmError && swarmError !== dismissedSwarmError && (
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

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b py-2 no-underline ${isActive ? "border-signal" : "border-transparent"}`;

export function Shell({ children }: { children: ReactNode }) {
  const { pool } = useRound();
  const search = pool ? `?pool=${pool}` : "";
  return (
    <div className="min-h-screen bg-page text-primary">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <header className="bg-inverse text-on-inverse">
        <div className="mx-auto flex w-[min(var(--width-page),calc(100%-var(--space-8)))] flex-wrap items-center justify-between gap-6 py-6">
          <NavLink to={`/${search}`} className="font-heading text-lg no-underline">
            RankedShares
          </NavLink>
          <nav aria-label="Main" className="flex flex-wrap gap-6 text-sm">
            <NavLink to={`/${search}`} end className={navLinkClass}>Round</NavLink>
            <NavLink to={`/proposals${search}`} className={navLinkClass}>Proposals</NavLink>
            <NavLink to={`/vote${search}`} className={navLinkClass}>Vote</NavLink>
            <NavLink to={`/liquidity${search}`} className={navLinkClass}>Liquidity</NavLink>
            <NavLink to={`/submit${search}`} className={navLinkClass}>Submit an idea</NavLink>
            <NavLink to={`/setup${search}`} className={navLinkClass}>Organizer</NavLink>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))]">
        <div className="toolbar">
          <RoundPicker />
          <Connections />
        </div>
        <StageBarContainer />
        <main id="main" className="py-6">{children}</main>
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
      <Notice>Loading the proposal board…</Notice>
    </main>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))] py-6">
      <h1>Unable to load this page.</h1>
      <Notice error>{errorMessage(error)}</Notice>
      <a href="/">Return to proposals</a>
    </main>
  );
}
