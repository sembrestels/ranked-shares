# Short EURC results demo

Pool: `0x70387e2963bc7fd796545988edb8ea08449f9b96` on Arc Testnet (5042002).

Voting opened on 13 September 2026 at **09:02:02 Madrid**, with a fixed deadline
of **09:09:38 Madrid**: a 7 minute 36 second voting window. This pool uses the
combined contribution-and-vote API, Arkiv storage, and Noir proofs.

The 15 Urbe Hub proposal texts and Swarm references are unchanged. For this
explicitly simulated round, each on-chain request is divided by 1,000; the texts
still describe the original project scope. Requests total **32.25 test EURC**,
competing for a **20 test EURC** budget. Every payout recipient remains
`0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF`.

The same 20 operator-controlled demo wallets cast distinct randomized rankings,
with broad agreement on affordable shared equipment and facilities and different
orders and ties inside priority groups. Two wallets contribute 1 EURC each and
vote publicly with a permit; 18 vote encrypted with sponsored seats. The final
on-chain result funds **11 proposals**, allocating **19.05 EURC** and leaving
**0.95 EURC** unallocated. This is simulated participation rather than independent
community voting.

The pool closed at **09:09:51 Madrid** and reached **Proven** finality with a
successful public transcript audit at **09:12:24 Madrid**. One ingest proof and
three tally proofs were verified and accepted in one `advanceMany` transaction.
The frontend displays the final allocation; funded recipients have not yet
claimed their payouts.

- Closing transaction: `0x177c68fc4d738f9238b9e4a25ef213db94a60f9d217ac66a1e610713f07aa039`
- CRE report transaction: `0x9cd11ee9fd023222774fe75ca04c19c919d8703f3bbdc35bdb4b2a62eb978b2b`
- Noir proof transaction: `0x30633e66126fdde88ba2443eee13341172622e10d6d5e6d2236252d1e21211af`

Open `/round?pool=0x70387e2963bc7fd796545988edb8ea08449f9b96` in the app to inspect
the closed result. [Arkiv verification evidence](../arkiv/submission.md) includes
all 20 of this round's live entities and their creation receipts.

[short-round-deployment.json](short-round-deployment.json) records confirmed
proposal, voting, storage, closing and proof transactions. It publishes individual
rankings only for the two public ballots. `finality`, `fundedProjects`, and
`auditedAt` record the completed on-chain proof and public transcript audit.

## Run or resume

From the repository root:

```sh
bun cre/scripts/short-round-demo.ts prepare
bun cre/scripts/short-round-demo.ts deploy-vote
# Pause the existing organizer-funded storage worker before this command.
bun cre/scripts/short-round-demo.ts sync
bun cre/scripts/short-round-demo.ts verify
# At or after the deadline:
bun cre/scripts/short-round-demo.ts close
bun cre/scripts/short-round-demo.ts report
cd prover
node --import tsx scripts/prove-short-demo.ts
```

These commands resume this specific pool. Private state, encrypted voter backups,
storage journals and proof caches use separate `demo/.local/short-round-*` files.
Signed operator and voter transactions are persisted before broadcast. Keep those
files backed up privately and run only one instance of each operator at a time.

The report runs the previously approved local CRE simulation with the simulator
forwarder and workflow authentication disabled. The subsequent Noir proof is
verified by the deployed verifier contracts. A simulated report by itself does
not establish `Proven` finality. This deployment is for test assets only.

The storage worker for the earlier two pools can resume after the short-round
uploads finish. Once this round closes, it accepts no further ballots and does
not need an ongoing upload worker. Its Arkiv retention is approximately 15 days
after the voting deadline; original Arc transaction history also retains the
accepted payloads.
