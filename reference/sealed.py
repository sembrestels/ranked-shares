"""Sealed-ballot packing, key derivation and encryption (spec B4)."""

import grumpkin
import poseidon2
from keccak import keccak256

DOMAIN = int.from_bytes(b"RankedShares/sealed/v2", "big")


def pack(ranks):
    return sum(r << (8 * c) for c, r in enumerate(ranks))


def validate(ranks, m):
    """True iff ranks is a competition ranking over m projects (PBEAR._setBallot rules)."""
    if len(ranks) != m or any(r < 0 or r > m for r in ranks):
        return False
    counts = [0] * (m + 1)
    for r in ranks:
        counts[r] += 1
    seen = 0
    for r in range(1, m + 1):
        if counts[r] and r != seen + 1:
            return False
        seen += counts[r]
    return True


def unpack(packed, m):
    if packed < 0 or packed >= 1 << (8 * m):
        return None
    ranks = [(packed >> (8 * c)) & 0xFF for c in range(m)]
    return ranks if validate(ranks, m) else None


def derive_sk(master, key_salt):
    return int.from_bytes(keccak256(master + key_salt), "big") % grumpkin.Q


def pubkey(sk):
    return grumpkin.mul(sk, grumpkin.G)


def mask(shared, voter):
    return poseidon2.hash([DOMAIN, shared[0], shared[1], voter])


def encrypt(pk, voter, ranks, k):
    r = grumpkin.mul(k, grumpkin.G)
    s = grumpkin.mul(k, pk)
    c = (pack(ranks) + mask(s, voter)) % grumpkin.P
    return (r[0], r[1], c)


def decrypt(sk, voter, ct, m):
    rx, ry, c = ct
    if rx == 0 or not grumpkin.is_on_curve((rx, ry)):
        return None
    s = grumpkin.mul(sk, (rx, ry))
    if s is None:
        return None
    packed = (c - mask(s, voter)) % grumpkin.P
    return unpack(packed, m)
