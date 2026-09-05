"""Differential tests for the zisk variant's sealed-ballot decryption against
reference/vectors/zisk/sealed.json.

Run, from `reference/` (the module form is required so `reference/` is on `sys.path`):

    cd reference && python3 -m unittest zisk.test_sealed
    cd reference && python3 -m zisk.test_sealed --write
"""

import json
import os
import sys
import unittest

from keccak import keccak256
from zisk import secp256k1 as ec
from zisk import sealed

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vectors", "zisk", "sealed.json")
MASTER = keccak256(b"zisk test master secret")
SALT = keccak256(b"zisk test key salt")
VOTER = 0x1000


def det_k(label):
    return int.from_bytes(keccak256(b"zisk-k:" + label), "big") % ec.N


def hx(b):
    return "0x" + (b.hex() if isinstance(b, bytes) else format(b, "x"))


def h32(n):
    return "0x" + format(n, "064x")


CASES = [
    # (label, m, ranks)
    ("strict", 4, [1, 2, 3, 4]),
    ("ties", 4, [1, 2, 2, 4]),
    ("partial", 4, [2, 1, 0, 0]),
    ("indifferent", 4, [0, 0, 0, 0]),
    ("one", 1, [1]),
    ("long", 31, [1 + (i % 5) if i % 5 else 0 for i in range(31)]),  # not a valid ranking; encrypt must not care
    ("wide", 40, list(range(1, 41))),  # more than one pad block
]


class SealedTest(unittest.TestCase):
    def setUp(self):
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)

    def test_key_derivation(self):
        self.assertEqual(self.sk, int.from_bytes(keccak256(MASTER + SALT), "big") % ec.N)
        self.assertEqual(self.pk, ec.compress(ec.mul(self.sk, ec.G)))
        self.assertEqual(len(self.pk), 33)

    def test_round_trip(self):
        for label, m, ranks in CASES:
            if not sealed.validate(ranks, m):
                continue
            ct = sealed.encrypt(self.pk, VOTER, ranks, det_k(label.encode()))
            self.assertEqual(len(ct), 33 + m)
            self.assertEqual(sealed.decrypt(self.sk, VOTER, ct, m), ranks)

    def test_wrong_address_or_key_or_length_is_absent(self):
        ct = sealed.encrypt(self.pk, VOTER, [1, 2, 3, 4], det_k(b"strict"))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER + 1, ct, 4))
        self.assertIsNone(sealed.decrypt((self.sk + 1) % ec.N, VOTER, ct, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct, 5))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct[:-1], 4))

    def test_malformed_point_is_absent(self):
        tail = bytes(4)
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x04" + bytes(32) + tail, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x02" + ec.P.to_bytes(32, "big") + tail, 4))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, b"\x02" + (5).to_bytes(32, "big") + tail, 4))

    def test_invalid_plaintext_is_absent(self):
        ct = sealed.encrypt(self.pk, VOTER, [4, 4, 4, 4], det_k(b"bad"))
        self.assertIsNone(sealed.decrypt(self.sk, VOTER, ct, 4))

    def test_vectors_are_current(self):
        with open(VECTORS) as f:
            committed = json.load(f)
        self.assertEqual(committed, build_vectors())
        for v in committed["vectors"]:
            sk = int(v["sk"], 16)
            ct = bytes.fromhex(v["ciphertext"][2:])
            got = sealed.decrypt(sk, int(v["voter"], 16), ct, v["m"])
            expected = v["ranks"] if sealed.validate(v["ranks"], v["m"]) else None
            self.assertEqual(got, expected, v)


def build_vectors():
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)
    out = []
    for label, m, ranks in CASES:
        k = det_k(label.encode())
        out.append({
            "master": hx(MASTER), "keySalt": hx(SALT), "sk": h32(sk), "pk": hx(pk),
            "voter": "0x" + format(VOTER, "040x"), "m": m, "ranks": ranks, "k": h32(k),
            "ciphertext": hx(sealed.encrypt(pk, VOTER, ranks, k)),
        })
    return {"vectors": out}


def write_vectors():
    os.makedirs(os.path.dirname(VECTORS), exist_ok=True)
    with open(VECTORS, "w") as f:
        json.dump(build_vectors(), f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write":
        write_vectors()
    else:
        unittest.main()
