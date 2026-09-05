"""secp256k1 in affine coordinates, enough for ECDH and SEC1 compression.

Points are (x, y) tuples; None is the point at infinity. Not constant-time: this is a
reference for tests and fixtures, never for a real key.
"""

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)


def is_on_curve(pt):
    if pt is None:
        return True
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - x * x * x - 7) % P == 0


def add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    (x1, y1), (x2, y2) = p, q
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * pow(2 * y1, P - 2, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, P - 2, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)


def mul(k, pt):
    k %= N
    result, acc = None, pt
    while k:
        if k & 1:
            result = add(result, acc)
        acc = add(acc, acc)
        k >>= 1
    return result


def compress(pt):
    x, y = pt
    return bytes([2 + (y & 1)]) + x.to_bytes(32, "big")


def decompress(b):
    if len(b) != 33 or b[0] not in (2, 3):
        return None
    x = int.from_bytes(b[1:], "big")
    if x >= P:
        return None
    y2 = (x * x * x + 7) % P
    y = pow(y2, (P + 1) // 4, P)  # p ≡ 3 mod 4
    if y * y % P != y2:
        return None
    if (y & 1) != b[0] - 2:
        y = P - y
    return (x, y)
