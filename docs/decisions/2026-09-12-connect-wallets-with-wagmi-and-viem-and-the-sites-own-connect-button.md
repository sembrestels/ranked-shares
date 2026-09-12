---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Connect wallets with wagmi and viem and the site's own connect button

## Context and Problem Statement

Every persona except the observer signs transactions on Arc testnet (chain id 5042002)
and later Arc mainnet (5042), neither of which wallets know by default. Which wallet
stack should the frontend use?

`thedao-rfps/web` uses wagmi and viem with the `injected` connector (EIP-6963 wallet
discovery) and `walletConnect` when a project id is set, an optional dev-only `mock`
connector, and its own `ConnectButton` and `ConnectInline` components over a
`useConnectors` hook. No third-party connect modal. `octocash` does the same.

## Decision Drivers

- Custom chain with add-and-switch prompting when the wallet is on the wrong network.
- Injected wallets for the demo; WalletConnect for phones.
- A connect button styled with the design tokens from the start, not themed later.
- Same stack as the sibling projects, so the components can be copied.

## Considered Options

- wagmi and viem with injected and WalletConnect connectors and the site's own button
- wagmi and viem with RainbowKit (the earlier proposal of this date)
- wagmi and viem with ConnectKit or Reown AppKit
- viem alone with a hand-written flow, as `prover/src/web/` does

## Decision Outcome

Chosen option: "wagmi and viem with injected and WalletConnect connectors and the
site's own button", because it is what the house projects do, it keeps the connect UI
inside the design system, and it avoids a third-party modal that would need theming.
The button, the connector hook, and the wagmi config are copied from thedao-rfps and
adapted to the Arc chains.

### Consequences

- Good, because chain reads in the write path and all writes share one viem
  configuration with the API's ABI types.
- Good, because the connect UI is an atom in the component hierarchy from day one.
- Bad, because wrong-network switching is handled by wagmi's `useSwitchChain`, called
  by our code, not by a kit; one hook and one test.
- Bad, because WalletConnect requires a Reown project id; it is optional and the
  injected flow works without it.
- Neutral, because no SIWE session is needed: every state change is a transaction.
  Add thedao-rfps's session context only when a feature needs a server session.

## Implementation Plan

- **Affected paths**: `web/app/lib/wagmi.ts` (Arc chains via `defineChain`, connectors),
  `web/app/lib/chains.ts`, `web/app/hooks/use-connectors.ts`,
  `web/app/components/wallet/ConnectButton.tsx` and `ConnectInline.tsx`,
  `web/app/context/providers.tsx` (wagmi and query providers), a `useEnsureChain` hook
  that switches or prompts to add Arc before any write.
- **Dependencies**: `wagmi`, `viem`, `@tanstack/react-query`,
  `@walletconnect/ethereum-provider` (pinned as thedao-rfps pins it).
- **Patterns to follow**: thedao-rfps's `wagmi.ts` shape, including the dev-only mock
  connector behind `VITE_MOCK_WALLET`; write with `useWriteContract` and wait for the
  receipt before refetching the API; show the chain's name and the pool's token symbol
  in the button's connected state.
- **Patterns to avoid**: reading pool state through the wallet's provider; more than
  one chain configuration; storing the WalletConnect id in the repo.
- **Configuration**: `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID`
  (optional), `VITE_MOCK_WALLET` (dev only).

### Verification

- [ ] Connecting on the wrong network prompts to add and switch to Arc testnet before
      the first write.
- [ ] Contribute, vote, and claim each complete from an injected wallet on Arc testnet.
- [ ] The app renders and reads the API with no wallet connected.
- [ ] With the WalletConnect id unset, the injected flow still works and the picker
      hides WalletConnect.

## Pros and Cons of the Options

### wagmi and viem with the site's own button

- Good, because it matches the house projects and the design system.
- Bad, because network switching and the picker are our code.

### wagmi and viem with RainbowKit

- Good, because custom chains and switching come built in.
- Bad, because the modal is a third-party look inside a token-based design system and
  none of the sibling projects use it.

### wagmi and viem with ConnectKit or Reown AppKit

- Good, because they cover many wallets.
- Bad, because of the same theming cost, and AppKit ties the app to Reown's hosted
  configuration.

### viem alone with a hand-written flow

- Good, because it is the smallest dependency set.
- Bad, because reconnect on reload, account switches, and mobile wallets would be
  built by hand; thedao-rfps v1 did this and replaced it.

## More Information

- Reference: `/home/sem/Projects/fund/thedao-rfps/web/app/lib/wagmi.ts`,
  `app/hooks/use-connectors.ts`, `app/components/wallet/`.
- Supersedes the same-day proposal "Connect wallets with wagmi, viem and RainbowKit",
  withdrawn before acceptance.
