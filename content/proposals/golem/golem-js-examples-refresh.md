---
title: golem-js examples and tutorials refresh
type: grant
goal: 12000
currency: USDC
summary: Make every example and tutorial in the Golem developer docs run again on
  current Node and yagna versions, add a weekly CI job that executes them against a
  live testnet provider, and fix or flag what breaks, so a developer's first hour
  on Golem ends with a working job instead of a stack trace.
duration: 4
---
## Why this matters

The first thing a developer does on Golem is copy an example from the docs. Today many of those examples target golem-js and yagna versions that are several releases old, and the tutorials were written before the deposits payment flow and the GPU runtime existed. A developer who hits a broken example in the first hour leaves and does not come back. Golem's own team is focused on Arkiv, so nobody is watching this rot.

This is not new features. It is making what exists work, and keeping it working with a test that runs on its own.

## What we will do

- Inventory every code example and tutorial in the Golem docs and the golem-js repository, and record which ones run on the current golem-js and yagna release
- Fix the ones that can be fixed with a small change; open an issue with a minimal reproduction for the ones that need SDK changes
- Add a runner that executes every example on a schedule against a testnet provider and publishes a status page: green, red, or skipped with the issue link
- Rewrite the three tutorials with the most traffic (first task, GPU task, payments with deposits) against the current APIs, and add one new tutorial for the deposits flow
- Send everything as pull requests to the official repositories; nothing lives only in a fork

## Requirements

- All work merged upstream or, where maintainers decline, published with the reason
- The status page and its runner are open source and can be run by anyone with a yagna requestor
- Every fixed example has a test that fails when it breaks again

## Milestones

### A - Inventory and runner - 4,500 USDC

- [ ] Public inventory of every example and tutorial with its current status and the failing output
- [ ] Runner executing all examples weekly against a testnet provider, status page live
- [ ] Issues filed upstream for every failure that needs an SDK change

### B - Fixes and tutorials - 7,500 USDC

- [ ] At least 80% of examples green on the status page, the rest linked to an open upstream issue
- [ ] Three rewritten tutorials and the deposits tutorial merged into the docs
- [ ] Handover note on how to add an example to the runner, and a named maintainer for the status page for 12 months
