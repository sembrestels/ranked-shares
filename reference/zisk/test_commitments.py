import unittest

from keccak import keccak256
from zisk import commitments as cm

EMPTY = keccak256(b"")


class CommitmentsTest(unittest.TestCase):
    def test_voter_chain_one_voter_by_hand(self):
        v = {"addr": 0x1000, "directWeight": 5, "seatWeight": 7, "directBallot": b"\x01\x02", "ciphertext": b""}
        expected = keccak256(
            bytes(32) + (0x1000).to_bytes(20, "big") + cm.w32(5) + cm.w32(7) + keccak256(b"\x01\x02") + EMPTY
        )
        self.assertEqual(cm.voter_chain([v]), expected)
        self.assertEqual(cm.voter_chain([]), bytes(32))

    def test_voter_chain_is_order_sensitive(self):
        a = {"addr": 1, "directWeight": 0, "seatWeight": 0, "directBallot": b"", "ciphertext": b""}
        b = {"addr": 2, "directWeight": 0, "seatWeight": 0, "directBallot": b"", "ciphertext": b""}
        self.assertNotEqual(cm.voter_chain([a, b]), cm.voter_chain([b, a]))

    def test_inputs_hash_by_hand(self):
        chain = keccak256(b"chain")
        costs = [25, 50]
        expected = keccak256(
            cm.w32(31337) + (0xABCD).to_bytes(20, "big") + chain + cm.w32(3)
            + keccak256(cm.w32(25) + cm.w32(50)) + cm.w32(1000)
        )
        self.assertEqual(cm.inputs_hash(31337, 0xABCD, chain, 3, costs, 1000), expected)

    def test_abi_encode_output_layout(self):
        ih = keccak256(b"inputs")
        pk = bytes([2]) + bytes(range(32))
        enc = cm.abi_encode_output(ih, pk, [3, 0])
        words = [enc[i : i + 32] for i in range(0, len(enc), 32)]
        self.assertEqual(len(enc), 32 * 9)  # 3 heads, 2 for the pk tail, 1 length + 2 ids
        self.assertEqual(words[0], ih)
        self.assertEqual(words[1], cm.w32(0x60))  # offset of `bytes pk`
        self.assertEqual(words[2], cm.w32(0x60 + 32 + 64))  # offset of `uint256[] funded`
        self.assertEqual(words[3], cm.w32(33))
        self.assertEqual(words[4] + words[5], pk + bytes(31))
        self.assertEqual(words[6], cm.w32(2))
        self.assertEqual(words[7], cm.w32(3))
        self.assertEqual(words[8], cm.w32(0))
        enc2 = cm.abi_encode_output(ih, pk, [])
        self.assertEqual(len(enc2), 32 * 7)
        self.assertEqual(enc2[-32:], cm.w32(0))
        self.assertEqual(cm.output_hash(ih, pk, [3, 0]), keccak256(enc))


if __name__ == "__main__":
    unittest.main()
