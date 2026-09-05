"""Write the Prover.toml of one proof of a fixture, replaying the reference.

Usage:
  cd reference && python3 -m noir.tools.noir_inputs --fixture test_main --ingest 0 --out P.toml
  cd reference && python3 -m noir.tools.noir_inputs --fixture test_main --tally 1 --out P.toml
Fixtures live in reference/vectors/noir/fixture_<name>.json.
"""

import json
import os
import sys

from noir import commitments as cm
from noir import sealed
from noir.profiles import PROFILES
from pbear import NONE

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(HERE, "..", "..", "vectors", "noir")


def q(n):
    """TOML string for a field/integer value."""
    return f'"{int(n)}"'


def load(name):
    with open(os.path.join(VECTORS, f"fixture_{name}.json")) as f:
        return json.load(f)


def profile_of(fx):
    return PROFILES[fx["profile"]["name"]]


def sealed_voters(fx):
    return [v for v in fx["voters"] if v["hasSealed"]]


def replay_ingest(fx, upto_batch):
    """State after ingest batches 0..upto_batch (inclusive), and the state before it."""
    p = profile_of(fx)
    m = fx["m"]
    budget = int(fx["totalWeight"], 16)
    voters = sealed_voters(fx)
    state = cm.empty_state(p, m, budget)
    before = None
    for k in range(upto_batch + 1):
        before = cm.State(**vars(state))
        before.weights = list(state.weights)
        before.ballots = list(state.ballots)
        for j in range(p.batch):
            i = k * p.batch + j
            if i < len(voters):
                v = voters[i]
                cm.ingest(state, i, int(v["seatWeight"], 16), None if v["sealedRanks"] is None else sealed.pack(v["sealedRanks"]))
    return before, state


def state_after_all_ingest(fx):
    p = profile_of(fx)
    n = fx["sealedCount"]
    last = max(1, -(-n // p.batch)) - 1
    _, state = replay_ingest(fx, last)
    return state


def state_toml(state, p):
    lines = ["[state]"]
    lines.append("weights = [" + ", ".join(q(w) for w in state.weights) + "]")
    lines.append("ballots = [" + ", ".join(q(b) for b in state.ballots) + "]")
    lines.append("funded = [" + ", ".join("true" if f else "false" for f in state.funded) + "]")
    lines.append("funded_order = [" + ", ".join(q(x) for x in state.funded_order) + "]")
    lines.append(f"funded_count = {q(state.funded_count)}")
    lines.append(f"level = {q(state.level)}")
    lines.append(f"spent = {q(state.spent)}")
    lines.append(f"done = {'true' if state.done else 'false'}")
    lines.append(f"m = {q(state.m)}")
    lines.append(f"budget = {q(state.budget)}")
    lines.append(f"t_hash = {q(state.t_hash)}")
    return lines


def ingest_toml(fx, k):
    p = profile_of(fx)
    proof = fx["ingestProofs"][k]
    before, _ = replay_ingest(fx, k)
    voters = sealed_voters(fx)
    sk = int(fx["sk"], 16)
    lines = [
        f"k = {q(k)}",
        f"n_sealed = {q(fx['sealedCount'])}",
        f"m = {q(fx['m'])}",
        f"budget = {q(int(fx['totalWeight'], 16))}",
        f"pk_x = {q(int(proof['pkX'], 16))}",
        f"pk_y = {q(int(proof['pkY'], 16))}",
        f"h_in = {q(int(proof['hIn'], 16))}",
        f"h_out = {q(int(proof['hOut'], 16))}",
        f"state_in = {q(int(proof['stateIn'], 16))}",
        f"state_out = {q(int(proof['stateOut'], 16))}",
        f"sk_lo = {q(sk & ((1 << 128) - 1))}",
        f"sk_hi = {q(sk >> 128)}",
        "",
    ]
    lines += state_toml(before, p)
    for j in range(p.batch):
        i = k * p.batch + j
        lines.append("")
        lines.append("[[entries]]")
        if i < len(voters):
            v = voters[i]
            rx, ry, c = (int(x, 16) for x in v["ciphertext"])
            lines += [f"addr = {q(int(v['addr'], 16))}", f"seat_weight = {q(int(v['seatWeight'], 16))}",
                      f"rx = {q(rx)}", f"ry = {q(ry)}", f"c = {q(c)}"]
        else:
            lines += ['addr = "0"', 'seat_weight = "0"', 'rx = "0"', 'ry = "0"', 'c = "0"']
    return "\n".join(lines) + "\n"


def tally_toml(fx, g):
    p = profile_of(fx)
    proof = fx["tallyProofs"][g]
    costs = [int(c, 16) for c in fx["costs"]]
    m = fx["m"]
    state = state_after_all_ingest(fx)
    transcript = fx["transcript"]
    cursor = 0
    # replay groups before g
    for _ in range(g):
        for _ in range(p.k):
            step = transcript[cursor] if cursor < len(transcript) else [state.level] + [0] * m + [NONE, 0]
            before = state.t_hash
            cm.tally_step(p, state, costs, step)
            if state.t_hash != before:
                cursor += 1
    # the K steps of group g, as the circuit will see them
    steps = []
    probe = cm.State(**vars(state))
    probe.weights = list(state.weights)
    probe.ballots = list(state.ballots)
    probe.funded = list(state.funded)
    probe.funded_order = list(state.funded_order)
    for _ in range(p.k):
        step = transcript[cursor] if cursor < len(transcript) else [probe.level] + [0] * m + [NONE, 0]
        steps.append(step)
        before = probe.t_hash
        cm.tally_step(p, probe, costs, step)
        if probe.t_hash != before:
            cursor += 1
    lines = [
        f"costs_hash = {q(int(proof['costsHash'], 16))}",
        f"state_in = {q(int(proof['stateIn'], 16))}",
        f"state_out = {q(int(proof['stateOut'], 16))}",
        f"done = {q(proof['done'])}",
        f"t_hash_out = {q(int(proof['tHashOut'], 16))}",
        f"funded_count = {q(proof['fundedCount'])}",
        f"funded_order_packed = {q(int(proof['fundedOrderPacked'], 16))}",
        "costs = [" + ", ".join(q(c) for c in costs + [0] * (p.m_max - m)) + "]",
        "",
    ]
    lines += state_toml(state, p)
    for step in steps:
        level, pub, best, total = step[0], step[1 : m + 1], step[m + 1], step[m + 2]
        lines.append("")
        lines.append("[[steps]]")
        lines.append(f"level = {q(level)}")
        lines.append("pub_support = [" + ", ".join(q(x) for x in pub + [0] * (p.m_max - m)) + "]")
        lines.append(f"best = {q(best)}")
        lines.append(f"total = {q(total)}")
    return "\n".join(lines) + "\n"


def main(argv):
    name = argv[argv.index("--fixture") + 1]
    out = argv[argv.index("--out") + 1]
    fx = load(name)
    if "--ingest" in argv:
        text = ingest_toml(fx, int(argv[argv.index("--ingest") + 1]))
    else:
        text = tally_toml(fx, int(argv[argv.index("--tally") + 1]))
    with open(out, "w") as f:
        f.write(text)
    print(out)


if __name__ == "__main__":
    main(sys.argv)
