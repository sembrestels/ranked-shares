import unittest

from zisk import secp256k1 as ec


class Secp256k1Test(unittest.TestCase):
    def test_generator(self):
        self.assertTrue(ec.is_on_curve(ec.G))
        self.assertEqual(ec.P, 2**256 - 2**32 - 977)

    def test_doubling(self):
        self.assertEqual(
            ec.mul(2, ec.G),
            (
                0xC6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5,
                0x1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52A,
            ),
        )

    def test_known_public_key(self):
        # From the widely reproduced secp256k1 test vectors (Chuck Batson).
        k = 0xAA5E28D6A97A2479A65527F7290311A3624D4CC0FA1578598EE3C2613BF99522
        self.assertEqual(
            ec.mul(k, ec.G),
            (
                0x34F9460F0E4F08393D192B3C5133A6BA099AA0AD9FD54EBCCFACDFA239FF49C6,
                0x0B71EA9BD730FD8923F6D25A7A91E7DD7728A960686CB5A901BB419E0F2CA232,
            ),
        )

    def test_group_order(self):
        self.assertIsNone(ec.mul(ec.N, ec.G))
        self.assertEqual(ec.mul(ec.N - 1, ec.G), (ec.G[0], ec.P - ec.G[1]))

    def test_compress_round_trip(self):
        for k in (1, 2, 3, 12345, ec.N - 1):
            pt = ec.mul(k, ec.G)
            c = ec.compress(pt)
            self.assertEqual(len(c), 33)
            self.assertIn(c[0], (2, 3))
            self.assertEqual(c[0] - 2, pt[1] & 1)
            self.assertEqual(ec.decompress(c), pt)

    def test_decompress_rejects_garbage(self):
        x = ec.G[0].to_bytes(32, "big")
        self.assertIsNone(ec.decompress(b"\x04" + x))
        self.assertIsNone(ec.decompress(b"\x02" + x[:-1]))
        self.assertIsNone(ec.decompress(b"\x02" + ec.P.to_bytes(32, "big")))
        # x = 5: 5³ + 7 = 132 is a quadratic non-residue mod p, so no point has this x.
        self.assertIsNone(ec.decompress(b"\x02" + (5).to_bytes(32, "big")))


if __name__ == "__main__":
    unittest.main()
