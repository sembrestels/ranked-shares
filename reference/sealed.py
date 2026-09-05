"""Sealed-ballot packing, key derivation and encryption (spec B4)."""

import grumpkin
import poseidon2
from keccak import keccak256

from ballots import pack, unpack, validate  # noqa: F401  (re-exported for the Noir tests)

DOMAIN = int.from_bytes(b"RankedShares/sealed/v2", "big")


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
