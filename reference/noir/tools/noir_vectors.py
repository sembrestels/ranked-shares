"""Print Noir test assertions computed by the Python reference.

Usage, from `reference/`: python3 -m noir.tools.noir_vectors
Paste the output into the #[test] functions of noir/sealed and noir/pbear.
"""

import json
import os

from noir import commitments as cm
from noir import poseidon2
from noir import sealed
from noir.profiles import PROFILES
from pbear import NONE, pbear_transcript

HERE = os.path.dirname(os.path.abspath(__file__))


def hx(n):
    return "0x" + format(int(n), "x")


def main():
    print("// sponge")
    for inputs in ([1], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6]):
        print(f"assert(sponge({inputs}) == {hx(poseidon2.hash(inputs))});")
    print(f"assert(sponge_var([1, 2, 3, 0, 0], 3) == {hx(poseidon2.hash([1, 2, 3]))});")
    print(f"assert(sponge_var([7, 0, 0], 1) == {hx(poseidon2.hash([7]))});")
    print(f"assert(sponge_var([0; 4], 0) == {hx(poseidon2.hash([]))});")

    print("// sealed vectors")
    with open(os.path.join(HERE, "..", "..", "vectors", "noir", "sealed.json")) as f:
        v = json.load(f)
    sk = int(v["sk"], 16)
    print(f"// sk_lo = {hx(sk & ((1 << 128) - 1))}, sk_hi = {hx(sk >> 128)}")
    print(f"// pk = ({v['pk'][0]}, {v['pk'][1]})")
    for case in v["cases"]:
        if case.get("note"):
            continue
        rx, ry, c = (int(x, 16) for x in case["ciphertext"])
        print(f"// case m={case['m']} ranks={case['ranks']} voter={case['voter']}")
        print(f"//   rx={hx(rx)} ry={hx(ry)} c={hx(c)} packed={hx(sealed.pack(case['ranks']))}")

    print("// pbear: the [30, 70] example of test_commitments on the test profile")
    p = PROFILES["test"]
    costs = [30, 70]
    funded, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
    s = cm.empty_state(p, 2, 100)
    print(f"assert(commit(empty_state(2, 100)) == {hx(cm.state_commit(p, s))});")
    cm.ingest(s, 0, 60, sealed.pack([2, 1]))
    print(f"// after ingest of entry 0 (60, [2,1]): {hx(cm.state_commit(p, s))}")
    for i, step in enumerate(transcript):
        cm.tally_step(p, s, costs, step)
        print(f"// after step {i} {step}: commit={hx(cm.state_commit(p, s))} t_hash={hx(s.t_hash)} done={s.done}")
    print(f"// funded={funded} NONE={NONE}")


if __name__ == "__main__":
    main()
