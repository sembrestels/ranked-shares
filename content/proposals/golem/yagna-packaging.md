---
title: Yagna packaging for home nodes
type: grant
goal: 10000
currency: USDC
summary: Package the yagna provider as a NixOS module, a Docker Compose stack, and
  Umbrel and Start9 apps, each with automatic updates and a wallet setup screen,
  so running a Golem provider at home is one install instead of an evening of
  shell scripts.
duration: 4
---
## Why this matters

Golem has hundreds of providers online and most of them were set up by hand from the install script, which means they drift out of date and go offline silently. Meanwhile home-server platforms like Umbrel and Start9 have tens of thousands of users who install a node with one click and never see a terminal. Golem is not in any of those catalogues. NixOS users, who run a large share of hobbyist infrastructure, have no module either.

Packaging is cheap, boring and exactly what a community can do without waiting on the core team.

## What we will do

- **NixOS module**: `services.yagna` with options for the wallet, subnet, pricing and runtimes, sent as a pull request to nixpkgs
- **Docker Compose stack**: yagna plus the provider agent and the VM runtime, with a documented way to pass through KVM and, where present, a GPU
- **Umbrel app** and **Start9 package**: install, show a QR for the wallet, show earnings and job count in the app UI, update automatically with each yagna release
- A shared setup guide covering the router and NAT configuration questions that fill the support channel

## Requirements

- Every package pins a yagna release and has a tested upgrade path to the next one
- Each package is submitted to its official catalogue; where a catalogue declines, the package is published with install instructions and the reason
- No package embeds a wallet key; the user brings or generates one on first run

## Milestones

### A - NixOS and Docker - 4,000 USDC

- [ ] NixOS module merged into nixpkgs or open as a pull request with review in progress, with a test that starts a provider in a VM
- [ ] Docker Compose stack published with the KVM and GPU passthrough guide, verified on three machines

### B - Umbrel and Start9 - 4,000 USDC

- [ ] Umbrel app submitted to the community app store with earnings and job count in the UI
- [ ] Start9 package submitted to the registry with the same screens

### C - Maintenance - 2,000 USDC

- [ ] Two yagna releases shipped through all four packages within two weeks of the upstream release
- [ ] Setup guide for router and NAT published and linked from the docs
