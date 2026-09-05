"""Sealed-ballot encryption of the zisk variant (spec Z3): secp256k1 ECDH, keccak pad."""

from ballots import validate  # noqa: F401  (re-exported; the tests use sealed.validate)
from keccak import keccak256
from zisk import secp256k1 as ec

DOMAIN = b"RankedShares/sealed/secp256k1"


def derive_sk(master, key_salt):
    return int.from_bytes(keccak256(master + key_salt), "big") % ec.N


def pubkey(sk):
    return ec.compress(ec.mul(sk, ec.G))


def ballot_key(shared_x, voter):
    return keccak256(DOMAIN + shared_x.to_bytes(32, "big") + voter.to_bytes(20, "big"))


def pad(key, m):
    blocks = b"".join(keccak256(key + bytes([b])) for b in range((m + 31) // 32))
    return blocks[:m]


def _xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def encrypt(pk, voter, ranks, k):
    """R ‖ (ranks ⊕ pad). `ranks` is not validated: the fixtures encrypt garbage on purpose."""
    r = ec.compress(ec.mul(k, ec.G))
    s = ec.mul(k, ec.decompress(pk))
    return r + _xor(bytes(ranks), pad(ballot_key(s[0], voter), len(ranks)))


def decrypt(sk, voter, ciphertext, m):
    """The ranks, or None when the ballot is absent for any reason (spec Z4 step 3)."""
    if len(ciphertext) != 33 + m:
        return None
    r = ec.decompress(ciphertext[:33])
    if r is None:
        return None
    s = ec.mul(sk, r)
    if s is None:
        return None
    ranks = list(_xor(ciphertext[33:], pad(ballot_key(s[0], voter), m)))
    return ranks if validate(ranks, m) else None
