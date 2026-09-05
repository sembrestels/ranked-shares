"""Write reference/vectors/zisk/fixture_<scenario>.json (spec Z7).

Usage, from `reference/`:  python3 -m zisk.make_fixture [--scenario NAME] [--out DIR]

Scenarios: `main` (every case the guest must handle), `nosealed`, `nodirect`, and `big`
(200 sealed and 2000 direct voters, 16 projects) which is only built on demand for
cycle measurements and is not committed.
"""

import json
import os
import sys

from keccak import keccak256
from pbear import pbear
from zisk import commitments as cm
from zisk import secp256k1 as ec
from zisk import sealed

MASTER = keccak256(b"zisk fixture master secret")
SALT = keccak256(b"zisk fixture key salt")
CHAIN_ID = 31337
# anvil's first account (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) deploys the mock
# token at nonce 0, the mock NFT at nonce 1, the ZisK verifier at nonce 2 and the pool at
# nonce 3, so the committed proof of this fixture verifies both in the Foundry tests
# (`deployCodeTo` at this address) and on a fresh anvil (scripts/e2e-anvil.sh).
POOL = 0xCF7ED3ACCA5A467E9E704C703E8D87F634FB0FC9
MIN_DIRECT_VOTE = 10_000_000  # 10 USDC at 6 decimals
USDC = 1_000_000

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vectors", "zisk")
COMMITTED = ("main", "nosealed", "nodirect")

FIXTURE_KEYS = (
    "scenario", "chainId", "pool", "m", "costs", "totalWeight", "minDirectVote", "nftTakeover",
    "master", "keySalt", "sk", "pk", "voters", "voterChain", "inputsHash", "funded", "outputHash",
)
VOTER_KEYS = ("addr", "directWeight", "seatWeight", "directBallot", "ciphertext", "directRanks", "sealedRanks", "k")


def hx(n):
    return "0x" + format(int(n), "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def bx(b):
    return "0x" + b.hex() if b else ""


def det_k(label):
    return int.from_bytes(keccak256(b"zisk-k:" + label.encode()), "big") % ec.N


def ballot(m, order, kept=None):
    """Strict ranking over the first `kept` projects of `order`, rest unranked."""
    kept = m if kept is None else kept
    ranks = [0] * m
    for pos in range(kept):
        ranks[order[pos]] = pos + 1
    return ranks


def _bad_x():
    """The smallest x with no point on the curve, as 32 bytes."""
    x = 1
    while ec.decompress(b"\x02" + x.to_bytes(32, "big")) is not None:
        x += 1
    return x.to_bytes(32, "big")


class Roster:
    def __init__(self, m):
        self.m = m
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)
        self.voters = []

    def add(self, addr, direct=0, seat=0, direct_ranks=None, sealed_ranks=None, k_label=None, raw_ciphertext=None):
        v = {"addr": addr, "directWeight": direct, "seatWeight": seat,
             "directBallot": bytes(direct_ranks) if direct_ranks is not None else b"",
             "ciphertext": b"", "directRanks": direct_ranks, "sealedRanks": None, "k": None}
        if raw_ciphertext is not None:
            v["ciphertext"] = raw_ciphertext
        elif sealed_ranks is not None:
            k = det_k(k_label)
            v["k"] = k
            v["ciphertext"] = sealed.encrypt(self.pk, addr, sealed_ranks, k)
        if v["ciphertext"]:
            v["sealedRanks"] = sealed.decrypt(self.sk, addr, v["ciphertext"], self.m)
        self.voters.append(v)
        return v


def _roster(scenario):
    """(m, costs, roster, total_weight). Only this function differs between scenarios."""
    if scenario == "big":
        m = 16
        costs = [(c + 1) * 2500 * USDC for c in range(m)]
    else:
        m = 4
        # 50, 100, 150, 200 USDC: with the `main` roster below (255 USDC of public and
        # 210 USDC of sealed voting weight) PB-EAR funds projects 1, 2 and 0 and leaves 3
        # unfunded, so the fixture exercises a partial result.
        costs = [(c + 1) * 50 * USDC for c in range(m)]
    rot = lambda i: [(c + i) % m for c in range(m)]
    r = Roster(m)
    base = 0x1000
    dust = 7 * USDC  # unclaimed NFT seats and per-seat division dust

    if scenario == "nosealed":
        for i in range(3):
            r.add(base + i, direct=40 * USDC * (i + 1), direct_ranks=ballot(m, rot(i), kept=3))
        r.add(base + 0x506, direct=5 * USDC)  # never voted
    elif scenario == "nodirect":
        for i in range(5):
            r.add(base + 0x10 + i, seat=30 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % m), k_label=f"s{i}")
        r.add(base + 0x505, seat=30 * USDC)  # silent seat holder
    elif scenario == "big":
        for i in range(2000):
            r.add(base + i, direct=(10 + i % 50) * USDC, direct_ranks=ballot(m, rot(i % m), kept=1 + i % 5))
        for i in range(200):
            r.add(base + 0x1000 + i, seat=40 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % 7), k_label=f"b{i}")
    elif scenario == "main":
        # three public-only voters
        for i in range(3):
            r.add(base + i, direct=40 * USDC * (i + 1), direct_ranks=ballot(m, rot(i), kept=3))
        # six sealed voters with valid ballots
        first = r.add(base + 0x10, seat=30 * USDC, sealed_ranks=ballot(m, rot(1)), k_label="s0")
        for i in range(1, 6):
            r.add(base + 0x10 + i, seat=30 * USDC, sealed_ranks=ballot(m, rot(i % m), kept=1 + i % m), k_label=f"s{i}")
        # one address with both kinds of weight and both ballots
        r.add(base + 0x500, direct=15 * USDC, seat=30 * USDC, direct_ranks=ballot(m, rot(2)), sealed_ranks=ballot(m, rot(3)), k_label="both")
        # absent sealed ballots of every kind the guest must survive
        r.add(base + 0x501, seat=30 * USDC, raw_ciphertext=first["ciphertext"])  # copied from another voter
        r.add(base + 0x502, seat=30 * USDC, raw_ciphertext=b"\x02" + _bad_x() + bytes(m))  # x off the curve
        r.add(base + 0x503, seat=30 * USDC, raw_ciphertext=b"\x02" + ec.P.to_bytes(32, "big") + bytes(m))  # x >= p
        r.add(base + 0x504, seat=30 * USDC, raw_ciphertext=b"\x04" + first["ciphertext"][1:])  # bad prefix
        # silent seat holder, silent direct voter below the minimum
        r.add(base + 0x505, seat=30 * USDC)
        r.add(base + 0x506, direct=5 * USDC)
        # a revoked NFT seat that still carries a ballot: 0x507 claimed the one-seat NFT
        # sponsorship (30 USDC), voted sealed, and 0x508 took the seat over afterwards, so
        # 0x508 holds its own 30 USDC list seat plus the 30 USDC NFT seat.
        r.add(base + 0x507, seat=0, sealed_ranks=ballot(m, rot(0), kept=1), k_label="revoked")
        r.add(base + 0x508, seat=60 * USDC, sealed_ranks=[m] * m, k_label="invalid")  # decrypts to an invalid ranking
    else:
        raise SystemExit(f"unknown scenario {scenario!r}")

    takeover = None
    if scenario == "main":
        takeover = {"from": addr_hex(base + 0x507), "to": addr_hex(base + 0x508),
                    "sponsorshipAmount": hx(30 * USDC), "tokenId": 1}
    total_weight = sum(v["directWeight"] + v["seatWeight"] for v in r.voters) + dust
    return m, costs, r, total_weight, takeover


def entries(voters):
    public = [(v["directWeight"], v["directRanks"]) for v in voters if v["directBallot"]]
    sealed_block = [(v["seatWeight"], v["sealedRanks"]) for v in voters if v["ciphertext"] and v["sealedRanks"] is not None]
    return public + sealed_block


def build(scenario="main"):
    m, costs, roster, total_weight, takeover = _roster(scenario)
    voters = roster.voters
    ents = entries(voters)
    abstaining = total_weight - sum(w for w, _ in ents)
    assert abstaining >= 0
    funded = pbear(costs, ents, abstaining)
    chain = cm.voter_chain(voters)
    ih = cm.inputs_hash(CHAIN_ID, POOL, chain, len(voters), costs, total_weight)
    oh = cm.output_hash(ih, roster.pk, funded)
    fx = {
        "scenario": scenario,
        "chainId": CHAIN_ID,
        "pool": addr_hex(POOL),
        "m": m,
        "costs": [hx(c) for c in costs],
        "totalWeight": hx(total_weight),
        "minDirectVote": hx(MIN_DIRECT_VOTE),
        "nftTakeover": takeover,
        "master": "0x" + MASTER.hex(),
        "keySalt": "0x" + SALT.hex(),
        "sk": hx(roster.sk),
        "pk": "0x" + roster.pk.hex(),
        "voters": [
            {
                "addr": addr_hex(v["addr"]),
                "directWeight": hx(v["directWeight"]),
                "seatWeight": hx(v["seatWeight"]),
                "directBallot": bx(v["directBallot"]),
                "ciphertext": bx(v["ciphertext"]),
                "directRanks": v["directRanks"],
                "sealedRanks": v["sealedRanks"],
                "k": hx(v["k"]) if v["k"] is not None else None,
            }
            for v in voters
        ],
        "voterChain": "0x" + chain.hex(),
        "inputsHash": "0x" + ih.hex(),
        "funded": funded,
        "outputHash": "0x" + oh.hex(),
    }
    assert tuple(fx.keys()) == FIXTURE_KEYS
    return fx


def write_fixture(fx, scenario, out_dir=VECTORS):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"fixture_{scenario}.json")
    with open(path, "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
    return path


def main(argv):
    scenarios, out_dir = COMMITTED, VECTORS
    args = argv[1:]
    while args:
        flag, value, *args = args
        if flag == "--scenario":
            scenarios = (value,)
        elif flag == "--out":
            out_dir = value
        else:
            raise SystemExit(__doc__)
    for scenario in scenarios:
        print(write_fixture(build(scenario), scenario, out_dir))


if __name__ == "__main__":
    main(sys.argv)
