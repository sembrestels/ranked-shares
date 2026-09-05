"""Write reference/vectors/fixture_<profile>_<scenario>.json (plan 1, Task 6, for the shape).

Usage: python3 reference/tools/make_fixture.py --profile test|default [--out DIR]
Run from the repository root; `--out` defaults to `reference/vectors/`.

Scenarios, one file each:

* `main`     the full roster: public-only voters, sealed voters, an address with both,
             a replayed ciphertext, a silent seat holder, a silent direct voter.
* `smallm`   `m = mMax - 1` projects, so every consumer sees `m < M_MAX`, and a tally
             that ends with a terminal `NONE` step at `level >= m` instead of by
             exhaustion: abstaining weight keeps a project affordable that no
             combination of voting weight can reach.
* `nosealed` no ciphertext anywhere: `sealedCount == 0`, `numBatches == 1` and a single
             ingest proof over an empty batch with `hIn == hOut == 0`.
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

VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vectors")

# The default profile costs about ten seconds a scenario, so it only gets `main`.
SCENARIOS = {"test": ("main", "smallm", "nosealed"), "default": ("main",)}


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


def _roster(profile, scenario):
    """The registration order of one scenario: (m, costs, voters, total_weight).

    Only this function differs between scenarios; everything downstream is shared.
    """
    m = profile.m_max - 1 if scenario == "smallm" else profile.m_max
    costs = [(c + 1) * 25_000_000 for c in range(m)]  # 25, 50, 75 ... USDC
    rot = lambda i: [(c + i) % m for c in range(m)]

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
    dust = 7_000_000  # unclaimed NFT seats and per-seat division dust

    if scenario == "nosealed":
        # Public block only: three direct voters and one who never cast a ballot.
        for i in range(3):
            add(base + i, 40_000_000 * (i + 1), 0, ballot(m, rot(i), kept=min(m, 3)), None, "")
        add(base + 503, 5_000_000, 0, None, None, "")
    elif scenario == "smallm":
        # Every ballot ranks project 0 first, so it is funded at level 1 for 25 USDC and
        # the 35 USDC left over never reaches project 1 (50) or project 2 (75) at any
        # level; 42 USDC of abstaining weight keeps both affordable, so the tally is not
        # exhausted and ends with a NONE step at level == m.
        add(base + 0, 20_000_000, 0, ballot(m, rot(0), kept=m), None, "")
        add(base + 1, 15_000_000, 0, ballot(m, rot(0), kept=1), None, "")
        first = add(base + 10, 0, 5_000_000, None, ballot(m, rot(0), kept=1), "s0")
        for i in range(1, 5):
            add(base + 10 + i, 0, 5_000_000, None, ballot(m, rot(0), kept=1 + i % m), f"s{i}")
        add(base + 501, 0, 5_000_000, None, None, "", copy_from=first)
        add(base + 502, 0, 30_000_000, None, None, "")
        add(base + 503, 5_000_000, 0, None, None, "")
    else:
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

    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in voters) + dust
    return m, costs, voters, total_weight, sk, pk


def _ingest_proofs(profile, m, sealed_voters, checkpoints, num_batches, total_weight, pk):
    """One proof per batch, each covering sealed entries [k·B, (k+1)·B); returns the
    proofs and the state they leave behind."""
    state = cm.empty_state(profile, m, total_weight)
    proofs = []
    state_in = 0
    for k in range(num_batches):
        for j in range(profile.batch):
            i = k * profile.batch + j
            if i < len(sealed_voters):
                v = sealed_voters[i]
                cm.ingest(state, i, v["seatWeight"], None if v["sealedRanks"] is None else sealed.pack(v["sealedRanks"]))
        state_out = cm.state_commit(profile, state)
        proofs.append({"k": k, "nSealed": len(sealed_voters), "m": m, "budget": hx(total_weight),
                       "pkX": hx(pk[0]), "pkY": hx(pk[1]), "hIn": hx(checkpoints[k]), "hOut": hx(checkpoints[k + 1]),
                       "stateIn": hx(state_in), "stateOut": hx(state_out)})
        state_in = state_out
    return proofs, state


def _tally_proofs(profile, state, costs, transcript, funded, costs_hash):
    """K transcript steps per proof, until done. A step is consumed exactly when
    `tally_step` absorbs it, which it signals by advancing `t_hash`; a done or
    exhausted state absorbs nothing and gets a dummy NONE step."""
    m = state.m
    proofs = []
    cursor = 0
    while not state.done:
        s_in = cm.state_commit(profile, state)
        for _ in range(profile.k):
            step = transcript[cursor] if cursor < len(transcript) else [state.level] + [0] * m + [cm.NONE, 0]
            before = state.t_hash
            cm.tally_step(profile, state, costs, step)
            if state.t_hash != before:
                cursor += 1
        proofs.append({"costsHash": hx(costs_hash), "stateIn": hx(s_in), "stateOut": hx(cm.state_commit(profile, state)),
                       "done": int(state.done), "tHashOut": hx(state.t_hash), "fundedCount": state.funded_count,
                       "fundedOrderPacked": hx(cm.funded_order_packed(state))})
    assert cursor == len(transcript)
    assert state.t_hash == cm.transcript_hash(transcript)
    assert state.funded_order[: state.funded_count] == funded
    return proofs


def _encode(profile, m, costs, voters, total_weight, sk, pk, public_entries, sealed_entries,
            h_pub, h_sealed, checkpoints, num_batches, costs_hash, inputs_root,
            funded, transcript, ingest_proofs, tally_proofs):
    return {
        "profile": {"name": profile.name, "nSealedMax": profile.n_sealed_max, "mMax": profile.m_max, "batch": profile.batch, "k": profile.k},
        "master": "0x" + MASTER.hex(), "keySalt": "0x" + SALT.hex(), "sk": hx(sk), "pk": [hx(pk[0]), hx(pk[1])],
        "m": m,
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


def build(profile, scenario="main"):
    m, costs, voters, total_weight, sk, pk = _roster(profile, scenario)

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
    assert len(checkpoints) == 1 + num_batches

    if scenario == "smallm":
        assert m < profile.m_max
        assert transcript and transcript[-1][m + 1] == cm.NONE, "smallm must end with a terminal NONE step"
        assert transcript[-1][0] >= m, "the terminal NONE must sit at level >= m"
    if scenario == "nosealed":
        assert len(sealed_entries) == 0 and num_batches == 1
        assert public_entries, "nosealed still needs a public block"

    ingest_proofs, state = _ingest_proofs(profile, m, sealed_voters, checkpoints, num_batches, total_weight, pk)
    if scenario == "nosealed":
        assert len(ingest_proofs) == 1
        assert ingest_proofs[0]["hIn"] == ingest_proofs[0]["hOut"] == hx(0)
    tally_proofs = _tally_proofs(profile, state, costs, transcript, funded, costs_hash)

    return _encode(profile, m, costs, voters, total_weight, sk, pk, public_entries, sealed_entries,
                   h_pub, h_sealed, checkpoints, num_batches, costs_hash, inputs_root,
                   funded, transcript, ingest_proofs, tally_proofs)


def write_fixture(fx, scenario, out_dir=VECTORS):
    """Write one fixture and return its path."""
    path = os.path.join(out_dir, f"fixture_{fx['profile']['name']}_{scenario}.json")
    with open(path, "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
    return path


def main(argv):
    name = argv[argv.index("--profile") + 1] if "--profile" in argv else "test"
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else VECTORS
    profile = PROFILES[name]
    for scenario in SCENARIOS[name]:
        fx = build(profile, scenario)
        path = write_fixture(fx, scenario, out_dir)
        print(path, "voters", len(fx["voters"]), "sealed", fx["sealedCount"],
              "steps", len(fx["transcript"]), "proofs", len(fx["ingestProofs"]) + len(fx["tallyProofs"]))


if __name__ == "__main__":
    main(sys.argv)
