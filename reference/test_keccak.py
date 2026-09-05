import unittest

from keccak import keccak256


class KeccakTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(
            keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        )

    def test_abc(self):
        self.assertEqual(
            keccak256(b"abc").hex(),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
        )

    def test_block_boundaries(self):
        # 135, 136 and 137 bytes exercise the three padding cases of the 136-byte rate:
        # the 0x81 single pad byte, a full extra block, and a partial extra block.
        digests = {n: keccak256(b"a" * n) for n in (135, 136, 137, 300)}
        for out in digests.values():
            self.assertEqual(len(out), 32)
        self.assertEqual(len(set(digests.values())), 4)

    def test_solidity_packed_shape(self):
        # keccak256(abi.encodePacked(bytes32(0), address(0xAA), uint256(5))) computed with
        # `cast keccak` equals hashing the raw 84 bytes.
        data = b"\x00" * 32 + (0xAA).to_bytes(20, "big") + (5).to_bytes(32, "big")
        self.assertEqual(len(data), 84)
        self.assertEqual(len(keccak256(data)), 32)
        self.assertEqual(
            keccak256(data).hex(),
            "f945b14e80aa69995a230f3f8c5eaea7c784bbf321db607dafac900db1c01b2a",
        )


if __name__ == "__main__":
    unittest.main()
