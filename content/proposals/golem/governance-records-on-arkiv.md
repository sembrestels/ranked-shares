---
title: Governance records on Arkiv
type: grant
goal: 16000
currency: USDC
summary: Put Golem's own governance history on Arkiv: every Octant epoch, allocation
  and project, plus the ballots and results of this funding round, stored as
  queryable records with a public page that rebuilds the history from Arkiv alone.
  A real dataset for the mainnet launch, owned by nobody.
duration: 5
---
## Why this matters

Arkiv needs a dataset on launch day that people care about and that shows what the database is for. Golem's governance is that dataset. Octant has run more than a dozen epochs and moved thousands of ETH, and that history lives in the Octant backend and in scattered explorer links. This funding round already writes its ballots to Arkiv. Putting both there, with a page that reads only from Arkiv, makes the history tamper-evident, queryable by anyone, and a live demonstration of the product on the foundation's own data.

## What we will build

- **Importer**: reads every Octant epoch, project, allocation and matching result from the public contracts and API, and writes them to Arkiv as records with indexed attributes (epoch, project, donor, amount)
- **Round records**: the projects, sponsorships, sealed and revealed ballots and the tally of this RankedShares round, written to Arkiv by the existing ballot path and completed with the results
- **Public page**: a static site that rebuilds the whole history from Arkiv queries alone, no backend: epochs, projects over time, this round's outcome, and a query box for ad-hoc questions
- **Verification**: a script anyone can run that recomputes an epoch's allocations from the Arkiv records and compares them with the on-chain result

## Requirements

- The page has no server; every number comes from an Arkiv query in the browser
- Records are written by a wallet the community controls, and the importer is open source so anyone can re-run it and compare
- The dataset is updated within a week of each new Octant allocation window closing

## Milestones

### A - Octant history - 7,000 USDC

- [ ] Importer published and all past Octant epochs written to the Arkiv testnet
- [ ] Verification script recomputes at least three epochs and matches the on-chain result

### B - This round and the page - 6,000 USDC

- [ ] This round's projects, ballots and tally on Arkiv, readable from the records alone
- [ ] Public page live, reading only from Arkiv, with the ad-hoc query box

### C - Mainnet and upkeep - 3,000 USDC

- [ ] Dataset migrated to Arkiv mainnet within 30 days of launch
- [ ] Two subsequent Octant windows imported within a week of closing, and a handover note for the next maintainer
