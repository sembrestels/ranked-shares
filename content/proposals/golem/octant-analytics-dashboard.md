---
title: Octant analytics dashboard
type: grant
goal: 10000
currency: USDC
summary: An open-source dashboard of Octant: GLM locked over time, rewards claimed
  versus donated, allocations and matching per project and per epoch, and donor
  concentration, updated automatically after each allocation window.
duration: 4
---
## Why this matters

Octant publishes results epoch by epoch, but the questions people ask cut across epochs: is GLM locking growing, which projects keep getting funded, how much of the rewards are donated rather than claimed, how concentrated are the donors. Today answering any of these means scraping the API and building a spreadsheet, and every analysis is thrown away when the next epoch closes. A maintained dashboard turns the same data into a shared reference that projects, donors and the foundation can point at.

## What we will build

- An indexer that pulls epochs, locks, rewards, allocations and matching from the Octant contracts and public API, and stores them in a small open database
- A dashboard with the core views: GLM locked and number of lockers over time; rewards claimed versus donated per epoch; funding per project across all epochs; matching ratio per project; donor concentration per epoch
- A CSV and JSON export for every view
- Automatic refresh after each allocation window closes, and on a daily schedule during a window

## Requirements

- Open source, self-hostable with one command, no paid data provider
- Every number links to the transaction or API record it comes from
- Reviewed by at least two Octant beneficiaries before the first public release

## Milestones

### A - Indexer and first views - 5,000 USDC

- [ ] Indexer published with all past epochs loaded
- [ ] Dashboard live with locks over time, claimed versus donated, and funding per project

### B - Full dashboard - 3,500 USDC

- [ ] Matching ratio and donor concentration views, CSV and JSON exports
- [ ] Reviewed by two beneficiaries, feedback published and addressed

### C - Two live windows - 1,500 USDC

- [ ] Dashboard refreshed automatically through two allocation windows without manual work
- [ ] Handover note and a named maintainer for the following 12 months
