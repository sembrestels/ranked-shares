---
status: proposed
date: 2026-09-12
decision-makers: Sem
---

# Connect wallets with wagmi, viem and RainbowKit

## Context and Problem Statement

Every persona except the observer signs transactions: contribute, vote, claim seats,
subscribe an LP position, accept a proposal, open, sweep. The frontend runs on Arc
testnet (chain id 5042002) and later Arc mainnet (5042), neither of which wallets know
by default. Which wallet connection stack should the frontend use?

## Decision Drivers

- Custom chain definition with add-and-switch prompting when the wallet is on the
  wrong network (story map, activity 3).
- Injected wallets for the demo; WalletConnect for phones, since Donor Dani follows
  the round from a phone.
- Hooks that fit React and viem, which the framework record chooses.
- A connect button that needs no design work in R1 but can be themed with the design
  tokens in Develop.

## Considered Options

- wagmi and viem with RainbowKit for the connect UI
- wagmi and viem with ConnectKit
- wagmi and viem with Reown AppKit
- viem alone with a hand-written connect flow, as `prover/src/web/` does

## Decision Outcome

Chosen option: "wagmi and viem with RainbowKit", because wagmi gives typed React hooks
over the viem clients the repo already uses, RainbowKit handles custom chains and
wrong-network switching out of the box, and its theme API accepts the token values the
Develop phase will define. ConnectKit is an equal alternative; RainbowKit is chosen for
its custom-chain documentation and larger install base. AppKit is not chosen because it
pulls in Reown's hosted services beyond the WalletConnect relay.

### Consequences

- Good, because chain reads and writes share one viem client configuration across the
  frontend and the tests.
- Good, because wrong-network handling and mobile connection are solved, not built.
- Bad, because WalletConnect requires a project id from Reown's cloud; it is a
  configuration value, not a code dependency, and can be left unset for injected-only
  demos.
- Neutral, because RainbowKit's default look will be replaced by the tokens; until then
  it is the one visibly third-party element.

## Implementation Plan

- **Affected paths**: `frontend/src/chain/` (chain definition, wagmi config),
  `frontend/src/app/` (providers), the connect button as an atom in the component
  hierarchy.
- **Dependencies**: `wagmi`, `viem`, `@rainbow-me/rainbowkit`, `@tanstack/react-query`
  (wagmi's peer). Pin exact versions.
- **Patterns to follow**: define Arc testnet and Arc mainnet once with viem's
  `defineChain`, as `prover/src/web/main.ts` does for the testnet; read with wagmi's
  `useReadContract` and generated ABIs; write with `useWriteContract` and wait for
  receipts before updating the UI.
- **Patterns to avoid**: reading state through the wallet's provider; more than one
  chain configuration; storing the WalletConnect project id in the repo.
- **Configuration**: `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID`
  (optional).

### Verification

- [ ] Connecting on the wrong network prompts to add and switch to Arc testnet.
- [ ] Contribute, vote, and claim each complete from an injected wallet on Arc testnet.
- [ ] The app renders and reads chain state with no wallet connected.
- [ ] With the WalletConnect id unset, the injected flow still works.

## Pros and Cons of the Options

### wagmi and viem with RainbowKit

- Good, because typed hooks, custom chains, and network switching are built in.
- Bad, because the modal is opinionated until themed.

### wagmi and viem with ConnectKit

- Good, because it is equivalent in features and slightly lighter.
- Neutral, because its custom-chain path is less documented.

### wagmi and viem with Reown AppKit

- Good, because it covers the most wallets.
- Bad, because it ties the app to Reown's hosted configuration and analytics.

### viem alone with a hand-written flow

- Good, because it is the smallest dependency set and already exists for one page.
- Bad, because network switching, reconnection, and mobile wallets would all be built
  by hand for a demo deadline.

## More Information

- Framework record of the same date.
- Revisit if the site is served from Swarm (WalletConnect's relay and the modal's
  assets must load from a gateway) or if the demo needs a wallet RainbowKit lacks.
