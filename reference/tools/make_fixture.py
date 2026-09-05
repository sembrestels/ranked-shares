"""Write reference/vectors/fixture_<profile>.json (see plan 1, Task 6, for the shape).

Usage: python3 reference/tools/make_fixture.py --profile test|default
Run from the repository root.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import commitments as cm  # noqa: E402
import grumpkin  # noqa: E402
import sealed  # noqa: E402
from keccak import keccak256  # noqa: E402
from pbear import pbear_transcript  # noqa: E402
from profiles import PROFILES  # noqa: E402

MASTER = keccak256(b"fixture master secret")
SALT = keccak256(b"fixture key salt")
MIN_DIRECT_VOTE = 10_000_000  # 10 USDC at 6 decimals


def hx(n):
    return "0x" + format(int(n), "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def det_k(label):
    return int.from_bytes(keccak256(b"fixture-k:" + label.encode()), "big") % grumpkin.Q


def ballot(m, order, kept=None):
    """Strict ranking over the first `kept` projects of `order`, rest unranked."""
    kept = m if kept is None else kept
    ranks = [0] * m
    for pos in range(kept):
        ranks[order[pos]] = pos + 1
    return ranks


def build(profile):
    m = profile.m_max
    costs = [(c + 1) * 25_000_000 for c in range(m)]  # 25, 50, 75 ... USDC
    rot = lambda i: [(c + i) % m for c in range(m)]

    # Registration order: public-only, sealed-only, both, abstaining, replayed, dropped seat.
    voters = []
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)

    def add(addr, direct, seat, direct_ranks, sealed_ranks, k_label, copy_from=None):
        v = {"addr": addr, "directWeight": direct, "seatWeight": seat, "hasDirect": direct_ranks is not None,
             "directRanks": direct_ranks, "ciphertext": None, "sealedRanks": None}
        if copy_from is not None:
            v["ciphertext"] = copy_from["ciphertext"]
        elif sealed_ranks is not None:
            v["ciphertext"] = sealed.encrypt(pk, addr, sealed_ranks, det_k(k_label))
        if v["ciphertext"] is not None:
            v["sealedRanks"] = sealed.decrypt(sk, addr, v["ciphertext"], m)
        voters.append(v)
        return v

    base = 0x1000
    n_sealed = min(profile.n_sealed_max, 2 * profile.batch + 1)  # spans > 2 batches
    # 3 public-only voters
    for i in range(3):
        add(base + i, 40_000_000 * (i + 1), 0, ballot(m, rot(i), kept=min(m, 3)), None, "")
    # sealed voters with valid ballots
    first = add(base + 10, 0, 30_000_000, None, ballot(m, rot(1)), "s0")
    for i in range(1, n_sealed - 2):
        add(base + 10 + i, 0, 30_000_000, None, ballot(m, rot(i % m), kept=1 + i % m), f"s{i}")
    # one address with both direct and sealed weight
    add(base + 500, 15_000_000, 30_000_000, ballot(m, rot(2)), ballot(m, rot(3)), "both")
    # one sealed voter whose ciphertext is a copy of another voter's: decrypts to absent
    add(base + 501, 0, 30_000_000, None, None, "", copy_from=first)
    # one seat holder who never voted (no ciphertext, abstaining)
    add(base + 502, 0, 30_000_000, None, None, "")
    # one direct voter with no ballot (abstaining)
    add(base + 503, 5_000_000, 0, None, None, "")

    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in voters) + 7_000_000  # + NFT dust
    public = [(v["directWeight"], v["directRanks"]) for v in voters if v["hasDirect"]]
    sealed_voters = [v for v in voters if v["ciphertext"] is not None]
    sealed_block = [(v["seatWeight"], v["sealedRanks"]) for v in sealed_voters]
    assert len(sealed_voters) <= profile.n_sealed_max
    funded, transcript = pbear_transcript(costs, public, sealed_block, total_weight)

    public_entries = [(v["addr"], v["directWeight"], sealed.pack(v["directRanks"])) for v in voters if v["hasDirect"]]
    sealed_entries = [(v["addr"], v["seatWeight"], *v["ciphertext"]) for v in sealed_voters]
    h_pub = cm.public_chain(public_entries)
    h_sealed, checkpoints = cm.sealed_chain(sealed_entries, profile.batch)
    costs_hash = cm.costs_hash(costs)
    inputs_root = cm.inputs_root(h_pub, h_sealed, len(sealed_entries), costs_hash, total_weight)
    num_batches = max(1, -(-len(sealed_entries) // profile.batch))

    # Ingest proofs: batch k covers sealed entries [k·B, (k+1)·B).
    state = cm.empty_state(profile, m, total_weight)
    ingest_proofs = []
    state_in = 0
    for k in range(num_batches):
        for j in range(profile.batch):
            i = k * profile.batch + j
            if i < len(sealed_voters):
                v = sealed_voters[i]
                cm.ingest(state, i, v["seatWeight"], None if v["sealedRanks"] is None else sealed.pack(v["sealedRanks"]))
        state_out = cm.state_commit(profile, state)
        ingest_proofs.append({"k": k, "nSealed": len(sealed_entries), "m": m, "budget": hx(total_weight),
                              "pkX": hx(pk[0]), "pkY": hx(pk[1]), "hIn": hx(checkpoints[k]), "hOut": hx(checkpoints[k + 1]),
                              "stateIn": hx(state_in), "stateOut": hx(state_out)})
        state_in = state_out

    # Tally proofs: K transcript steps each, until done. A step is consumed exactly
    # when `tally_step` absorbs it, which it signals by advancing `t_hash`; a done or
    # exhausted state absorbs nothing and gets a dummy NONE step.
    tally_proofs = []
    cursor = 0
    while not state.done:
        s_in = cm.state_commit(profile, state)
        for _ in range(profile.k):
            step = transcript[cursor] if cursor < len(transcript) else [state.level] + [0] * m + [cm.NONE, 0]
            before = state.t_hash
            cm.tally_step(profile, state, costs, step)
            if state.t_hash != before:
                cursor += 1
        tally_proofs.append({"costsHash": hx(costs_hash), "stateIn": hx(s_in), "stateOut": hx(cm.state_commit(profile, state)),
                             "done": int(state.done), "tHashOut": hx(state.t_hash), "fundedCount": state.funded_count,
                             "fundedOrderPacked": hx(cm.funded_order_packed(state))})
    assert cursor == len(transcript)
    assert state.t_hash == cm.transcript_hash(transcript)
    assert state.funded_order[: state.funded_count] == funded

    return {
        "profile": {"name": profile.name, "nSealedMax": profile.n_sealed_max, "mMax": profile.m_max, "batch": profile.batch, "k": profile.k},
        "master": "0x" + MASTER.hex(), "keySalt": "0x" + SALT.hex(), "sk": hx(sk), "pk": [hx(pk[0]), hx(pk[1])],
        "costs": [hx(c) for c in costs], "totalWeight": hx(total_weight), "minDirectVote": hx(MIN_DIRECT_VOTE),
        "voters": [{"addr": addr_hex(v["addr"]), "directWeight": hx(v["directWeight"]), "seatWeight": hx(v["seatWeight"]),
                    "hasDirect": v["hasDirect"], "directRanks": v["directRanks"],
                    "directPacked": hx(sealed.pack(v["directRanks"]) if v["hasDirect"] else 0),
                    "ciphertext": None if v["ciphertext"] is None else [hx(x) for x in v["ciphertext"]],
                    "sealedRanks": v["sealedRanks"]} for v in voters],
        "publicEntries": [[addr_hex(a), hx(w), hx(p)] for a, w, p in public_entries],
        "sealedEntries": [[addr_hex(a), hx(w), hx(rx), hx(ry), hx(c)] for a, w, rx, ry, c in sealed_entries],
        "hPub": "0x" + h_pub.hex(), "hSealed": hx(h_sealed), "checkpoints": [hx(c) for c in checkpoints],
        "sealedCount": len(sealed_entries), "numBatches": num_batches,
        "costsHash": hx(costs_hash), "inputsRoot": "0x" + inputs_root.hex(),
        "funded": funded, "transcript": transcript, "transcriptHash": hx(cm.transcript_hash(transcript)),
        "ingestProofs": ingest_proofs, "tallyProofs": tally_proofs,
    }


def main(argv):
    name = argv[argv.index("--profile") + 1] if "--profile" in argv else "test"
    fx = build(PROFILES[name])
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vectors", f"fixture_{name}.json")
    with open(out, "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
    print(out, "voters", len(fx["voters"]), "sealed", fx["sealedCount"], "steps", len(fx["transcript"]), "proofs", len(fx["ingestProofs"]) + len(fx["tallyProofs"]))


if __name__ == "__main__":
    main(sys.argv)
