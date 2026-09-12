---
title: Arkiv reference apps
type: grant
goal: 20000
currency: USDC
summary: Three small open-source apps built on the Arkiv testnet and updated for
  mainnet, each with a tutorial: a game leaderboard, an agent memory store, and an
  audit log for a DAO. The apps are the examples the docs currently lack and the
  first things a developer can copy on launch day.
duration: 5
---
## Why this matters

Arkiv is where Golem's effort goes now: a new testnet this month, audits through October, and a mainnet around Devcon. Its pitch is "a database with blockchain guarantees", and the use cases on the site are leaderboards, agent memory and historical records. What is missing is a working app for each of those that a developer can clone, run and read in an hour. Docs describe an API; reference apps show what to build with it, and they catch the SDK's rough edges before mainnet users do.

The three apps are chosen to cover the three things Arkiv does differently from a normal database: wallet-owned rows, time-scoped storage that expires, and queries over indexed attributes.

## What we will build

- **Leaderboard**: a browser game where every score is a row owned by the player's wallet; scores expire after a season; the board is a query. Shows ownership and expiry.
- **Agent memory**: an assistant that stores its conversation memory on Arkiv through the Arkiv MCP server, so the memory is portable between agents and owned by the user. Shows the MCP path and per-user data.
- **DAO audit log**: proposals, votes and payouts of a small DAO written to Arkiv, with a page that reconstructs the history from queries alone. Shows tamper evidence and historical records.

Each app: one repository, a deployed demo on the testnet, a tutorial that builds it from an empty folder, and a list of SDK issues found while building it, filed upstream.

## Requirements

- Open source, each under 2,000 lines so it can be read in one sitting
- Built on the September testnet and re-verified on mainnet within 30 days of launch
- Every friction point found in the SDK or docs is filed as an issue with a reproduction

## Milestones

### A - Leaderboard - 6,000 USDC

- [ ] App deployed on testnet, repository and tutorial published
- [ ] SDK and docs issues filed

### B - Agent memory - 7,000 USDC

- [ ] App deployed on testnet using the Arkiv MCP server, repository and tutorial published
- [ ] SDK and docs issues filed

### C - DAO audit log and mainnet - 7,000 USDC

- [ ] App deployed on testnet, repository and tutorial published
- [ ] All three apps verified on mainnet within 30 days of launch, with a changelog of what had to change
- [ ] Apps and tutorials linked from the Arkiv Hub
