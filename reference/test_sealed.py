import json
import os
import sys
import unittest

import grumpkin
import sealed
from keccak import keccak256

VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "sealed.json")
MASTER = keccak256(b"test master secret")
SALT = keccak256(b"test key salt")


def det_k(label):
    return int.from_bytes(keccak256(b"k:" + label), "big") % grumpkin.Q


class GrumpkinTest(unittest.TestCase):
    def test_generator_on_curve(self):
        self.assertTrue(grumpkin.is_on_curve(grumpkin.G))
        self.assertEqual(grumpkin.G[0], 1)
        self.assertEqual(grumpkin.G[1], 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C)

    def test_group_order(self):
        # `grumpkin.mul` reduces the scalar mod Q first, so it would satisfy this for any
        # Q. The ladder below does not reduce, so it is the stated Q that makes Q·G the
        # point at infinity and (Q − 1)·G the negation of G.
        self.assertEqual(
            grumpkin.Q,
            21888242871839275222246405745257275088696311157297823662689037894645226208583,
        )

        def unreduced_mul(k, pt):
            result, acc = None, pt
            while k:
                if k & 1:
                    result = grumpkin.add(result, acc)
                acc = grumpkin.add(acc, acc)
                k >>= 1
            return result

        self.assertEqual(unreduced_mul(3, grumpkin.G), grumpkin.mul(3, grumpkin.G))
        self.assertIsNone(unreduced_mul(grumpkin.Q, grumpkin.G))
        self.assertEqual(
            unreduced_mul(grumpkin.Q - 1, grumpkin.G),
            (grumpkin.G[0], grumpkin.P - grumpkin.G[1]),
        )

    def test_add_double_consistency(self):
        two_g = grumpkin.add(grumpkin.G, grumpkin.G)
        self.assertEqual(two_g, grumpkin.mul(2, grumpkin.G))
        three_g = grumpkin.add(two_g, grumpkin.G)
        self.assertEqual(three_g, grumpkin.mul(3, grumpkin.G))
        self.assertTrue(grumpkin.is_on_curve(three_g))

    def test_scalar_mul_is_bilinear(self):
        a, b = 123456789, 987654321
        lhs = grumpkin.mul(a, grumpkin.mul(b, grumpkin.G))
        rhs = grumpkin.mul((a * b) % grumpkin.Q, grumpkin.G)
        self.assertEqual(lhs, rhs)


class PackingTest(unittest.TestCase):
    def test_pack_unpack_round_trip(self):
        self.assertEqual(sealed.unpack(sealed.pack([1, 2, 2, 4]), 4), [1, 2, 2, 4])
        self.assertEqual(sealed.unpack(sealed.pack([0, 0, 0]), 3), [0, 0, 0])
        self.assertEqual(sealed.pack([1, 2]), 1 + (2 << 8))

    def test_unpack_rejects_invalid(self):
        self.assertIsNone(sealed.unpack(1 << 32, 4))          # too wide for m = 4
        self.assertIsNone(sealed.unpack(sealed.pack([5, 0, 0, 0]), 4))  # rank > m
        self.assertIsNone(sealed.unpack(sealed.pack([1, 3, 3, 0]), 4))  # gap in ranking


class SealedTest(unittest.TestCase):
    def setUp(self):
        self.sk = sealed.derive_sk(MASTER, SALT)
        self.pk = sealed.pubkey(self.sk)
        self.voter = 0x1111111111111111111111111111111111111111

    def test_sk_in_group(self):
        self.assertTrue(0 < self.sk < grumpkin.Q)
        self.assertTrue(grumpkin.is_on_curve(self.pk))

    def test_round_trip(self):
        ranks = [2, 1, 0, 3]
        ct = sealed.encrypt(self.pk, self.voter, ranks, det_k(b"a"))
        self.assertTrue(grumpkin.is_on_curve((ct[0], ct[1])))
        self.assertEqual(sealed.decrypt(self.sk, self.voter, ct, 4), ranks)

    def test_wrong_voter_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"b"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter + 1, ct, 4))

    def test_wrong_key_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"c"))
        self.assertIsNone(sealed.decrypt((self.sk + 1) % grumpkin.Q, self.voter, ct, 4))

    def test_invalid_ranking_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 3, 3, 0], det_k(b"d"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter, ct, 4))

    def test_wrong_m_is_absent(self):
        ct = sealed.encrypt(self.pk, self.voter, [1, 2, 3, 4], det_k(b"e"))
        self.assertIsNone(sealed.decrypt(self.sk, self.voter, ct, 3))

    def test_domain(self):
        self.assertEqual(sealed.DOMAIN, int.from_bytes(b"RankedShares/sealed/v2", "big"))

    def test_vectors(self):
        with open(VECTORS) as f:
            v = json.load(f)
        sk = int(v["sk"], 16)
        pk = tuple(int(x, 16) for x in v["pk"])
        self.assertEqual(sk, sealed.derive_sk(bytes.fromhex(v["master"][2:]), bytes.fromhex(v["keySalt"][2:])))
        self.assertEqual(pk, sealed.pubkey(sk))
        for case in v["cases"]:
            ct = tuple(int(x, 16) for x in case["ciphertext"])
            voter = int(case["voter"], 16)
            if case.get("note"):
                # A ciphertext made for another address: only the decryption outcome is pinned.
                self.assertIsNone(sealed.decrypt(sk, voter, ct, case["m"]))
                continue
            self.assertEqual(sealed.encrypt(pk, voter, case["ranks"], int(case["k"], 16)), ct)
            self.assertEqual(sealed.decrypt(sk, voter, ct, case["m"]), case["plaintext"])


def hx(n):
    return "0x" + format(n, "064x")


def addr_hex(a):
    return "0x" + format(a, "040x")


def write_vectors():
    sk = sealed.derive_sk(MASTER, SALT)
    pk = sealed.pubkey(sk)
    cases = []
    specs = [
        (0x1111111111111111111111111111111111111111, 4, [2, 1, 0, 3], b"v1"),
        (0x2222222222222222222222222222222222222222, 4, [0, 0, 0, 0], b"v2"),
        (0x3333333333333333333333333333333333333333, 16, list(range(1, 17)), b"v3"),
        (0x4444444444444444444444444444444444444444, 31, [1] * 31, b"v4"),
    ]
    for voter, m, ranks, label in specs:
        k = det_k(label)
        ct = sealed.encrypt(pk, voter, ranks, k)
        cases.append({"voter": addr_hex(voter), "m": m, "ranks": ranks, "k": hx(k),
                      "ciphertext": [hx(x) for x in ct], "plaintext": sealed.decrypt(sk, voter, ct, m)})
    # a ciphertext made for voter 1, replayed by voter 2: absent
    ct = sealed.encrypt(pk, specs[0][0], specs[0][2], det_k(b"v1"))
    cases.append({"voter": addr_hex(specs[1][0]), "m": 4, "ranks": specs[0][2],
                  "k": hx(det_k(b"v1")), "ciphertext": [hx(x) for x in ct], "plaintext": None,
                  "note": "replayed under another address"})
    out = {"master": "0x" + MASTER.hex(), "keySalt": "0x" + SALT.hex(), "sk": hx(sk),
           "pk": [hx(pk[0]), hx(pk[1])], "domain": hx(sealed.DOMAIN), "cases": cases}
    with open(VECTORS, "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write":
        write_vectors()
    else:
        unittest.main()
